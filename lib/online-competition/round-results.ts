import type { Firestore } from 'firebase-admin/firestore';
import { computeAo5, type AttemptTime } from './ao5';
import { roundKey } from './scrambles';
import { normalizeRoundStatus, type RoundRanking, type RoundStateDoc } from './rounds';

// ── Ranking a competition round's results ───────────────────────────────
// Server-only. Turns approved submissions into the ordered standings the
// qualifier selection works from.
//
// ── How a submission is attributed to a competition round ──────────────
// A submission's `round` field is its ATTEMPT index 1-5, not a competition
// round — the solve flow writes `round: i + 1` per attempt, and nothing on
// the doc records which competition round it belongs to (see the storage
// note at the top of admin/_components/ReviewGrid.tsx).
//
// So attribution uses time instead: a round is attributed every approved
// submission created while it was the live round, i.e. from its own
// `openedAt` up to the moment a LATER round of the same event was opened.
// That works because rounds open in order and a round must be advanced
// before the next can open, so the windows never overlap. A round that was
// never opened has no start bound and takes everything before the next
// round's opening, which keeps competitions that predate round management
// rankable instead of silently scoring zero athletes.
//
// The alternative — adding a real competition-round field to submissions —
// is the proper fix, but it changes the solve flow's write shape and every
// existing doc, so it is deliberately out of scope here.

const ATTEMPTS_PER_ROUND = 5;

interface ApprovedAttempt {
  attempt: number;
  createdAt: number;
  time: AttemptTime;
}

/** Same effective-time rule as athleteStats/seasonPoints: a judge's +2
 *  adds 200cs, a DNF is a DNF. */
function effectiveTime(data: FirebaseFirestore.DocumentData): AttemptTime {
  if (data.isDnf === true || data.penalty === 'DNF') return 'DNF';
  const reported = typeof data.reportedTime === 'number' ? data.reportedTime : 0;
  return reported + (data.penalty === '+2' ? 200 : 0);
}

export async function fetchRoundStates(
  db: Firestore,
  competitionId: string,
): Promise<Map<string, RoundStateDoc>> {
  const snap = await db
    .collection('onlineCompetitions')
    .doc(competitionId)
    .collection('roundState')
    .get();
  const out = new Map<string, RoundStateDoc>();
  for (const d of snap.docs) {
    const data = d.data();
    out.set(d.id, {
      status: normalizeRoundStatus(data.status),
      openedAt: data.openedAt?.toMillis?.() ?? null,
      qualifierMethod: data.qualifierMethod ?? null,
      qualifierValue: typeof data.qualifierValue === 'number' ? data.qualifierValue : null,
    });
  }
  return out;
}

/** [start, end) in epoch ms during which this round was the live one. */
function roundWindow(
  states: Map<string, RoundStateDoc>,
  eventId: string,
  round: number,
): { start: number; end: number } {
  const start = states.get(roundKey(eventId, round))?.openedAt ?? 0;
  let end = Number.POSITIVE_INFINITY;
  for (const [key, state] of states) {
    const [keyEvent, keyRound] = [key.slice(0, key.lastIndexOf('_')), Number(key.slice(key.lastIndexOf('_') + 1))];
    if (keyEvent !== eventId || !Number.isFinite(keyRound) || keyRound <= round) continue;
    if (state.openedAt !== null && state.openedAt < end) end = state.openedAt;
  }
  return { start, end };
}

/** Standings for one event+round, best Ao5 first.
 *
 *  Only athletes with all five attempts approved AND a real (non-DNF) Ao5
 *  are ranked — everyone else is simply absent, which is what makes them
 *  non-qualifying by construction rather than by a separate rule. */
export async function rankRoundResults(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<RoundRanking[]> {
  const states = await fetchRoundStates(db, competitionId);
  const { start, end } = roundWindow(states, eventId, round);

  const snap = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .where('status', '==', 'approved')
    .get();

  const byUid = new Map<string, ApprovedAttempt[]>();
  for (const d of snap.docs) {
    const data = d.data();
    if (data.event !== eventId) continue;
    const createdAt = data.createdAt?.toMillis?.() ?? 0;
    if (createdAt < start || createdAt >= end) continue;
    const attempt = typeof data.round === 'number' ? data.round : 0;
    if (attempt < 1 || attempt > ATTEMPTS_PER_ROUND) continue;
    const uid = data.uid;
    if (typeof uid !== 'string') continue;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid)!.push({ attempt, createdAt, time: effectiveTime(data) });
  }

  const ranked: RoundRanking[] = [];
  for (const [uid, attempts] of byUid) {
    // An athlete can re-run the solve flow, leaving several approved
    // submissions in one attempt slot. Take the OLDEST per slot — the same
    // "first run counts" rule the review grid surfaces — so the ranking is
    // deterministic rather than depending on read order.
    const bySlot = new Map<number, ApprovedAttempt>();
    for (const a of attempts) {
      const existing = bySlot.get(a.attempt);
      if (!existing || a.createdAt < existing.createdAt) bySlot.set(a.attempt, a);
    }
    if (bySlot.size < ATTEMPTS_PER_ROUND) continue;
    const times: AttemptTime[] = [];
    for (let i = 1; i <= ATTEMPTS_PER_ROUND; i++) times.push(bySlot.get(i)!.time);
    const { ao5 } = computeAo5(times);
    if (ao5 === null) continue; // DNF average never qualifies.
    ranked.push({ uid, displayName: uid.slice(0, 10), ao5, attempts: bySlot.size });
  }

  ranked.sort((a, b) => a.ao5 - b.ao5 || a.uid.localeCompare(b.uid));

  if (ranked.length > 0) {
    const docs = await db.getAll(
      ...ranked.map((r) => db.collection('onlineParticipants').doc(r.uid)),
    );
    const nameByUid = new Map(docs.map((d) => [d.id, (d.data()?.displayName as string | undefined) ?? '']));
    for (const r of ranked) r.displayName = nameByUid.get(r.uid) || r.uid.slice(0, 10);
  }

  return ranked;
}
