// One-off maintenance script: assign `competitionRound` to historical
// onlineSubmissions documents that predate the field.
//
// Attribution reuses the platform's EXISTING de-facto rule — roundWindow()
// in lib/online-competition/round-results.ts, which maps a round to the
// interval [its openedAt, the next later round's openedAt) — imported
// directly rather than reimplemented, so the backfill can never disagree
// with what rankRoundResults has been doing all along.
//
// DRY RUN BY DEFAULT. Nothing is written without --commit.
//
// Run (no test runner / ts-node in this project, so compile then run —
// same convention as scripts/test-cube-state-simulator.ts):
//
//   npx tsc scripts/backfill-competition-round.ts \
//     --outDir .tmp-backfill-build --module node16 --moduleResolution node16 \
//     --target es2022 --esModuleInterop --skipLibCheck
//
//   # credentials: either a service account key file...
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//     node .tmp-backfill-build/scripts/backfill-competition-round.js
//   # ...or the same env vars the app's API routes use
//   # (ONLINE_COMP_FIREBASE_CLIENT_EMAIL / ONLINE_COMP_FIREBASE_PRIVATE_KEY
//   #  / NEXT_PUBLIC_FIREBASE_PROJECT_ID).
//
//   # after reviewing the dry-run output:
//   ... node .tmp-backfill-build/scripts/backfill-competition-round.js --commit
//
// Safety rules this script holds to:
//   * writes ONLY `competitionRound`, never any other field
//   * never deletes anything
//   * never touches a document that already has the field
//   * targets documents by document ID only
//   * assigns NOTHING for any ambiguous case — every one is printed with
//     its document IDs instead of being guessed at with a fallback

import admin from 'firebase-admin';
import { fetchRoundStates, roundWindow } from '../lib/online-competition/round-results';
import type { RoundStateDoc } from '../lib/online-competition/rounds';

const COMMIT = process.argv.includes('--commit');
const ATTEMPTS_PER_RUN = 5;

// ── Credentials ──────────────────────────────────────────────────────────
function initAdmin(): admin.app.App {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const projectId =
    process.env.ONLINE_COMP_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.ONLINE_COMP_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.ONLINE_COMP_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'No credentials. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, or the\n' +
        'ONLINE_COMP_FIREBASE_CLIENT_EMAIL / ONLINE_COMP_FIREBASE_PRIVATE_KEY /\n' +
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID env vars used by the app.',
    );
    process.exit(1);
  }
  return admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

// ── Types ────────────────────────────────────────────────────────────────
interface Sub {
  id: string;
  competitionId: string;
  event: string;
  uid: string;
  /** attempt index 1-5 */
  attempt: number;
  status: string;
  createdAt: number | null;
  hasField: boolean;
}

interface Flag {
  kind: string;
  detail: string;
  docIds: string[];
}

const flags: Flag[] = [];
/** Doc ids suppressed by any ambiguity — never assigned, never written. */
const suppressed = new Set<string>();

function flag(kind: string, detail: string, docIds: string[]) {
  flags.push({ kind, detail, docIds });
  for (const id of docIds) suppressed.add(id);
}

function fmtTime(ms: number | null): string {
  if (ms === null) return 'no createdAt';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function main() {
  const app = initAdmin();
  const db = app.firestore();

  console.log(`\n=== backfill competitionRound — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ===\n`);

  // ── Load every submission ──────────────────────────────────────────────
  const subsSnap = await db.collection('onlineSubmissions').get();
  const subs: Sub[] = subsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      competitionId: typeof data.competitionId === 'string' ? data.competitionId : '',
      event: typeof data.event === 'string' ? data.event : '',
      uid: typeof data.uid === 'string' ? data.uid : '',
      attempt: typeof data.round === 'number' ? data.round : 0,
      status: typeof data.status === 'string' ? data.status : 'pending',
      createdAt: data.createdAt?.toMillis?.() ?? null,
      hasField: typeof data.competitionRound === 'number',
    };
  });

  const already = subs.filter((s) => s.hasField);
  const candidates = subs.filter((s) => !s.hasField);

  // ── Per competition ────────────────────────────────────────────────────
  const byComp = new Map<string, Sub[]>();
  for (const s of candidates) {
    if (!byComp.has(s.competitionId)) byComp.set(s.competitionId, []);
    byComp.get(s.competitionId)!.push(s);
  }

  /** docId -> proposed competitionRound */
  const proposal = new Map<string, number>();
  /** competitionId -> event -> round -> count */
  const breakdown = new Map<string, Map<string, Map<number, number>>>();
  const compNames = new Map<string, string>();
  /** Human-readable roundState shape per competition/event — this is what
   *  makes an "overlapping windows" verdict explainable. */
  const inventory: string[] = [];

  for (const [competitionId, compSubs] of byComp) {
    const compSnap = await db.collection('onlineCompetitions').doc(competitionId).get();
    if (!compSnap.exists) {
      flag(
        'orphaned competition',
        `competitionId "${competitionId}" has no onlineCompetitions doc — no rounds to attribute to`,
        compSubs.map((s) => s.id),
      );
      continue;
    }
    compNames.set(competitionId, (compSnap.get('name') as string | undefined) ?? competitionId);

    const eventsCfg = Array.isArray(compSnap.get('events')) ? compSnap.get('events') : [];
    const roundsByEvent = new Map<string, number>();
    for (const e of eventsCfg) {
      const eventId = typeof e?.eventId === 'string' ? e.eventId : '';
      if (!eventId) continue;
      roundsByEvent.set(eventId, Number.isInteger(e?.rounds) && e.rounds > 0 ? e.rounds : 1);
    }

    const states: Map<string, RoundStateDoc> = await fetchRoundStates(db, competitionId);
    const qualifiersSnap = await db
      .collection('onlineCompetitions')
      .doc(competitionId)
      .collection('qualifiers')
      .get();
    const qualifierCounts = new Map<string, number>();
    for (const d of qualifiersSnap.docs) {
      const uids = d.get('uids');
      qualifierCounts.set(d.id, Array.isArray(uids) ? uids.length : 0);
    }

    // Group this competition's candidates by event.
    const byEvent = new Map<string, Sub[]>();
    for (const s of compSubs) {
      if (!byEvent.has(s.event)) byEvent.set(s.event, []);
      byEvent.get(s.event)!.push(s);
    }

    for (const [eventId, eventSubs] of byEvent) {
      const totalRounds = roundsByEvent.get(eventId) ?? 1;
      const windows: { round: number; start: number; end: number }[] = [];
      for (let round = 1; round <= totalRounds; round++) {
        const { start, end } = roundWindow(states, eventId, round);
        windows.push({ round, start, end });
      }

      const stateLines: string[] = [];
      for (let round = 1; round <= totalRounds; round++) {
        const st = states.get(`${eventId}_${round}`);
        stateLines.push(
          st
            ? `r${round}=${st.status}${st.openedAt ? ` opened ${fmtTime(st.openedAt)}` : ' never opened'}`
            : `r${round}=no roundState doc`,
        );
      }
      inventory.push(
        `  ${competitionId} · ${eventId}: ${eventSubs.length} candidate doc(s), ` +
          `${totalRounds} round(s) configured — ${stateLines.join(', ')}`,
      );

      // ── Flag B2: openedAt must increase with round number ─────────────
      const opened = windows
        .map((w) => ({ round: w.round, openedAt: states.get(`${eventId}_${w.round}`)?.openedAt ?? null }))
        .filter((x): x is { round: number; openedAt: number } => x.openedAt !== null);
      for (let i = 1; i < opened.length; i++) {
        if (opened[i].openedAt <= opened[i - 1].openedAt) {
          flag(
            're-opened / out-of-order round',
            `${competitionId} · ${eventId}: round ${opened[i].round} openedAt (${fmtTime(
              opened[i].openedAt,
            )}) is not after round ${opened[i - 1].round} (${fmtTime(opened[i - 1].openedAt)}) — ` +
              `window boundaries for this event are unusable`,
            eventSubs.map((s) => s.id),
          );
        }
      }

      // ── Flag B1: a round advanced more athletes than its own window
      // can account for — the fingerprint of an openedAt rewritten by a
      // re-open after the round had already been judged and advanced.
      for (const w of windows) {
        const advanced = qualifierCounts.get(`${eventId}_${w.round}`) ?? 0;
        if (advanced === 0) continue;
        const uidsInWindow = new Set(
          subs
            .filter(
              (s) =>
                s.competitionId === competitionId &&
                s.event === eventId &&
                s.status === 'approved' &&
                s.createdAt !== null &&
                s.createdAt >= w.start &&
                s.createdAt < w.end,
            )
            .map((s) => s.uid),
        );
        if (uidsInWindow.size < advanced) {
          flag(
            're-opened round (openedAt rewritten)',
            `${competitionId} · ${eventId} round ${w.round}: advanced ${advanced} athlete(s) but its ` +
              `window [${fmtTime(w.start === 0 ? null : w.start)} .. ${
                Number.isFinite(w.end) ? fmtTime(w.end) : 'now'
              }) contains approved solves from only ${uidsInWindow.size} — openedAt looks rewritten`,
            eventSubs.map((s) => s.id),
          );
        }
      }

      // ── Per-document attribution ──────────────────────────────────────
      const noWindow: string[] = [];
      const multiWindow: string[] = [];
      for (const s of eventSubs) {
        if (s.createdAt === null) {
          noWindow.push(s.id);
          continue;
        }
        const matches = windows.filter((w) => s.createdAt! >= w.start && s.createdAt! < w.end);
        if (matches.length === 0) {
          noWindow.push(s.id);
        } else if (matches.length > 1) {
          // Overlapping windows — e.g. a configured round that was never
          // opened has no start bound and swallows everything.
          multiWindow.push(s.id);
        } else {
          proposal.set(s.id, matches[0].round);
        }
      }
      if (noWindow.length > 0) {
        flag(
          'outside every round window',
          `${competitionId} · ${eventId}: ${noWindow.length} submission(s) whose createdAt falls in no round window`,
          noWindow,
        );
      }
      if (multiWindow.length > 0) {
        flag(
          'overlapping round windows',
          `${competitionId} · ${eventId}: ${multiWindow.length} submission(s) match more than one round.
` +
            `      ${totalRounds} rounds configured but their windows overlap — ${stateLines.join(', ')}.
` +
            `      A round with no roundState doc has no start bound (roundWindow's legacy allowance), so it
` +
            `      claims every submission the next opened round doesn't. Nothing here can be attributed
` +
            `      without inventing a fallback, so nothing is.`,
          multiWindow,
        );
      }
    }
  }

  // ── Flag C1: more than one run's worth inside a single round ───────────
  const groups = new Map<string, Sub[]>();
  for (const s of candidates) {
    const round = proposal.get(s.id);
    if (round === undefined) continue;
    const key = `${s.competitionId}|${s.event}|${s.uid}|${round}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  for (const [key, list] of groups) {
    if (list.length <= ATTEMPTS_PER_RUN) continue;
    const [competitionId, eventId, uid, round] = key.split('|');
    flag(
      'duplicate runs in one round',
      `${competitionId} · ${eventId} round ${round} · uid ${uid.slice(0, 10)}: ${list.length} submissions ` +
        `(more than one ${ATTEMPTS_PER_RUN}-attempt run) — attempts of the two runs cannot be told apart`,
      list.map((s) => s.id),
    );
  }

  // ── Flag C2: a single attempt slot re-run more than 5 times ────────────
  const slots = new Map<string, Sub[]>();
  for (const s of candidates) {
    const key = `${s.competitionId}|${s.event}|${s.uid}|${s.attempt}`;
    if (!slots.has(key)) slots.set(key, []);
    slots.get(key)!.push(s);
  }
  for (const [key, list] of slots) {
    if (list.length <= ATTEMPTS_PER_RUN) continue;
    const [competitionId, eventId, uid, attempt] = key.split('|');
    flag(
      'attempt slot re-run',
      `${competitionId} · ${eventId} · uid ${uid.slice(0, 10)} attempt ${attempt}: ${list.length} submissions ` +
        `share this slot`,
      list.map((s) => s.id),
    );
  }

  // Ambiguity always wins over a proposal.
  for (const id of suppressed) proposal.delete(id);

  for (const s of candidates) {
    const round = proposal.get(s.id);
    if (round === undefined) continue;
    if (!breakdown.has(s.competitionId)) breakdown.set(s.competitionId, new Map());
    const byEv = breakdown.get(s.competitionId)!;
    if (!byEv.has(s.event)) byEv.set(s.event, new Map());
    const byRound = byEv.get(s.event)!;
    byRound.set(round, (byRound.get(round) ?? 0) + 1);
  }

  // ── Report ─────────────────────────────────────────────────────────────
  const cannot = candidates.length - proposal.size;

  console.log('── Totals ──────────────────────────────────────────────');
  console.log(`  submissions scanned        : ${subs.length}`);
  console.log(`  already have the field     : ${already.length}`);
  console.log(`  would be assigned          : ${proposal.size}`);
  console.log(`  CANNOT be attributed       : ${cannot}`);
  console.log('');

  console.log('── Proposed assignment, per competition / event ────────');
  if (breakdown.size === 0) {
    console.log('  (nothing to assign)');
  }
  for (const [competitionId, byEv] of breakdown) {
    console.log(`\n  ${compNames.get(competitionId) ?? competitionId}  [${competitionId}]`);
    for (const [eventId, byRound] of byEv) {
      const parts = [...byRound.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, n]) => `round ${round}: ${n} docs`);
      console.log(`    ${eventId}, ${parts.join('; ')}`);
    }
  }
  console.log('');

  console.log('── Round state inventory (why attribution went the way it did) ─');
  if (inventory.length === 0) console.log('  (none)');
  for (const line of inventory) console.log(line);
  console.log('');

  console.log('── Ambiguous — NOTHING will be assigned to these ───────');
  if (flags.length === 0) {
    console.log('  (none)');
  }
  for (const f of flags) {
    console.log(`\n  [${f.kind}] ${f.detail}`);
    console.log(`    ${f.docIds.length} doc(s): ${f.docIds.join(', ')}`);
  }
  console.log('');

  // ── Write ──────────────────────────────────────────────────────────────
  if (!COMMIT) {
    console.log(`DRY RUN — nothing written. Re-run with --commit to apply ${proposal.size} update(s).\n`);
    return;
  }

  const entries = [...proposal.entries()];
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = db.batch();
    for (const [docId, round] of entries.slice(i, i + CHUNK)) {
      // By document ID only, and only this one field.
      batch.update(db.collection('onlineSubmissions').doc(docId), { competitionRound: round });
    }
    await batch.commit();
    written += Math.min(CHUNK, entries.length - i);
    console.log(`  committed ${written}/${entries.length}`);
  }
  console.log(`\nDone — ${written} document(s) updated.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
