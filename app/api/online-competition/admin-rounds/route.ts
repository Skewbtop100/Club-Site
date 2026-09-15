import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { roundKey } from '@/lib/online-competition/scrambles';
import { fetchRoundStates } from '@/lib/online-competition/round-results';
import { resolveEventLiveRounds } from '@/lib/online-competition/round-access';
import { notifyRoundFinalised } from '@/lib/online-competition/notifications-server';
import { RoundOpenError, openRound } from '@/lib/online-competition/round-open';
import { RoundCutError, resetRound } from '@/lib/online-competition/round-cut';
import type { QualifierMethod, RoundStatus } from '@/lib/online-competition/rounds';

// ── Round management (Раунд удирдах) ────────────────────────────────────
// Admin-cookie gated, Admin SDK only — onlineCompetitions/{id}/roundState
// and .../qualifiers are denied to every client write by firestore.rules,
// the same as scrambleData/groupAssignments.
//
// ── Which rounds exist ────────────────────────────────────────────────
// Rows come from the competition's CONFIGURED events (events[].rounds),
// not from imported scrambleData. Rounds are a property of the
// competition's format, and gating them on the optional scramble import
// would mean a competition that never imported a TNoodle file had no
// openable rounds at all — which, now that the solve flow requires a live
// round, would make it unsolvable. The scramble import stays an
// independent concern.

export interface RoundAdminView {
  eventId: string;
  label: string;
  round: number;
  status: RoundStatus;
  openedAt: number | null;
  /** What this round was ACTUALLY cut to, from roundState — null until it
   *  has been qualified at least once. */
  qualifierMethod: QualifierMethod | null;
  qualifierValue: number | null;
  /** What the admin PLANNED for this transition, from the competition
   *  document's events[].advancement. Null for the event's final round,
   *  which has no transition. Used only to prefill the ШАЛГАРУУЛАХ form —
   *  see the comment in ./qualify/route.ts. */
  plannedMethod: QualifierMethod | null;
  plannedValue: number | null;
  /** How many uids this round has advanced (0 when never advanced). */
  qualifierCount: number;
  /** Whether the PREVIOUS round has been advanced — the precondition for
   *  opening this one. Always true for round 1. */
  canOpen: boolean;
}

export async function GET(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const competitionId = new URL(req.url).searchParams.get('competitionId');
  if (!competitionId) {
    return NextResponse.json({ error: 'Missing competitionId' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const compSnap = await compRef.get();
  if (!compSnap.exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }

  const events = Array.isArray(compSnap.get('events')) ? compSnap.get('events') : [];
  const [states, qualifierSnap] = await Promise.all([
    fetchRoundStates(db, competitionId),
    compRef.collection('qualifiers').get(),
  ]);
  const qualifierCounts = new Map<string, number>();
  for (const d of qualifierSnap.docs) {
    const uids = d.get('uids');
    qualifierCounts.set(d.id, Array.isArray(uids) ? uids.length : 0);
  }

  const rounds: RoundAdminView[] = [];
  for (const e of events) {
    const eventId = typeof e?.eventId === 'string' ? e.eventId : '';
    if (!eventId) continue;
    const total = Number.isInteger(e?.rounds) && e.rounds > 0 ? e.rounds : 1;
    for (let round = 1; round <= total; round++) {
      const key = roundKey(eventId, round);
      const state = states.get(key);
      // The planned cut for the transition OUT of this round. Absent for
      // the last round, and for any competition saved before the Төрөл
      // tab existed.
      const plan = Array.isArray(e?.advancement)
        ? (e.advancement as { fromRound?: number; method?: QualifierMethod; value?: number }[]).find(
            (a) => a?.fromRound === round,
          )
        : undefined;
      rounds.push({
        eventId,
        label: typeof e?.label === 'string' && e.label ? e.label : eventId.toUpperCase(),
        round,
        status: state?.status ?? 'closed',
        openedAt: state?.openedAt ?? null,
        qualifierMethod: state?.qualifierMethod ?? null,
        qualifierValue: state?.qualifierValue ?? null,
        plannedMethod: plan?.method ?? null,
        plannedValue: plan?.value ?? null,
        qualifierCount: qualifierCounts.get(key) ?? 0,
        canOpen: round === 1 || qualifierCounts.has(roundKey(eventId, round - 1)),
      });
    }
  }

  // Which events have no round open at all — the same findLiveRound rule
  // the solve gate uses, not a scan of the `rounds` array above, so the
  // panel's warning and the athlete's 409 can never disagree.
  const liveStatus = await resolveEventLiveRounds(db, competitionId);
  const eventsWithoutLiveRound = liveStatus
    .filter((e) => e.liveRounds.length === 0)
    .map((e) => ({ eventId: e.eventId, label: e.label }));
  // More than one live round of an event: every athlete in it is refused
  // ('conflicting-live-rounds') until an admin closes one. openRound no
  // longer creates this state; this surfaces one left from before.
  const eventsWithConflictingLiveRounds = liveStatus
    .filter((e) => e.liveRounds.length > 1)
    .map((e) => ({ eventId: e.eventId, label: e.label, rounds: e.liveRounds }));

  return NextResponse.json({ rounds, eventsWithoutLiveRound, eventsWithConflictingLiveRounds });
}

/** Opens or closes a round.
 *
 *  Opening round N>1 requires round N-1 to have been advanced — the
 *  qualifiers doc is what defines who may attempt N, so without it the
 *  round would be live with nobody eligible. Closing only stops new
 *  attempts; it deliberately does NOT compute qualifiers (that is
 *  ./qualify), so an admin can pause a round without committing to a
 *  cut. */
export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
  const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
  const round = typeof body?.round === 'number' ? body.round : NaN;
  const action =
    body?.action === 'open' || body?.action === 'close' || body?.action === 'reset' || body?.action === 'notify'
      ? body.action
      : null;
  if (!competitionId || !eventId || !Number.isInteger(round) || round < 1 || !action) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  if (!(await compRef.get()).exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }
  const key = roundKey(eventId, round);

  if (action === 'open') {
    // The qualifier check, the roundState write and the competition's
    // status all move together — see openRound. Opening a round is what
    // announces a competition as live; keeping that in one transaction is
    // what stops the two notions of "live" from disagreeing again.
    try {
      const result = await openRound(db, competitionId, eventId, round);
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof RoundOpenError) {
        // `unassigned` rides alongside the message rather than being
        // formatted into it: the UI lists the names, and a server that
        // pre-joined them into one string would decide how — and how
        // many — for a screen it cannot see.
        return NextResponse.json(
          { error: e.message, unassigned: e.unassigned },
          { status: e.status },
        );
      }
      throw e;
    }
  }

  if (action === 'notify') {
    // МЭДЭГДЭЛ ДАХИН ИЛГЭЭХ — the retry for a close or cut whose
    // announcement failed. The same notifyRoundFinalised the transition
    // called, with the same inputs it had: the stored cut, if this round was
    // cut. Its markers make it send only what is still owed, so pressing it
    // twice, or after a success, sends nothing more. A FINISHED round only:
    // announcing a live round would publish partial results.
    const stateSnap = await compRef.collection('roundState').doc(key).get();
    if (stateSnap.get('status') !== 'done') {
      return NextResponse.json(
        { error: 'Зөвхөн дууссан раундын мэдэгдлийг дахин илгээх боломжтой.' },
        { status: 400 },
      );
    }
    const qualSnap = await compRef.collection('qualifiers').doc(key).get();
    const stored = qualSnap.exists ? qualSnap.get('uids') : null;
    const qualifiedUids = Array.isArray(stored) ? stored.filter((u): u is string => typeof u === 'string') : [];
    const { ok } = await notifyRoundFinalised({ competitionId, eventId, round, qualifiedUids });
    return NextResponse.json({ notified: ok }, { status: ok ? 200 : 503 });
  }

  if (action === 'reset') {
    // БУЦААХ — the way to redo a cut once the next round has started: close
    // that round, then reset it. Refused while live, while the round after
    // it has started, or once anything is filed in it — see resetRound.
    try {
      return NextResponse.json(await resetRound(db, competitionId, eventId, round));
    } catch (e) {
      if (e instanceof RoundCutError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  }

  await compRef.collection('roundState').doc(key).set(
    {
      eventId,
      round,
      status: 'done' satisfies RoundStatus,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Closing is one of the two ways a round ends, so athletes are told
  // here too — with no qualifiers, since closing deliberately computes no
  // cut. Never throws, and its own marker makes closing an already-closed
  // round send nothing. Awaited rather than fired-and-forgotten: this is a
  // serverless handler, and work left running past the response is not
  // guaranteed to finish.
  const { ok: notified } = await notifyRoundFinalised({ competitionId, eventId, round });

  // `notified: false` — the round IS closed, but the athletes were not told.
  return NextResponse.json({ status: 'done', notified });
}
