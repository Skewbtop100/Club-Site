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
import { attemptsForFormat, resolveResultFormat } from '@/lib/online-competition/ao5';
import { normalizeCompetitionStatus } from '@/lib/online-competition/admin-competitions';
import { normalizeStoredEvents, normalizeStoredSchedule } from '@/lib/online-competition/competition-shape';
import { scheduleTimings } from '@/lib/online-competition/schedule';
import { roundRosterProgress } from '@/lib/online-competition/round-roster-progress';
import { fetchScrambleRoster } from '@/lib/online-competition/scramble-roster';
import { toAdminJudged } from '@/lib/online-competition/round-submissions';
import type { JudgedSubmission } from '@/lib/online-competition/live-view';
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
  /** ── The programme's slot for this round ──
   *  From the competition's schedule, which times its rows positionally
   *  (each starts when the one before ends — see scheduleTimings). Both
   *  null when the competition has no start time, or when the programme has
   *  no row for this round: a round with no announced slot is normal, not
   *  an error. */
  scheduledStartMs: number | null;
  scheduledEndMs: number | null;
  /** ── How far through it the athletes are ──
   *  From roundRosterProgress, which defers "finished" to
   *  rankJudgedStandings — the same judgement the public standings and the
   *  qualifier make, cutoff included. `complete + incomplete` is always
   *  `participants`. `pendingSubmissions` is the judge's queue for this
   *  round and is counted separately, because it is submissions and not
   *  athletes. */
  participants: number;
  complete: number;
  incomplete: number;
  notStarted: number;
  pendingSubmissions: number;
  pendingAthletes: number;
}

/** The competition-level answer to "what is happening right now" — the
 *  status header's whole content. Derived from the `rounds` array below, so
 *  the header cannot disagree with the row it is summarising. */
export interface RoundsSummary {
  competitionName: string;
  competitionStatus: string;
  /** The live round whose programme slot is earliest, as `event_round`.
   *  More than one live round of an event is a state openRound no longer
   *  creates but which older data can hold; eventsWithConflictingLiveRounds
   *  is what tells the admin about that, and picking deterministically here
   *  means the header does not also flicker. Null when nothing is live. */
  nowKey: string | null;
  /** What comes next: the earliest round by programme order that is closed
   *  AND has not been advanced. A round that HAS been advanced is behind us
   *  even though its status is 'closed', which is why qualifierCount is in
   *  the test. Deliberately not "the next OPENABLE round" — whether it can
   *  open is `canOpen`, and a round blocked on its predecessor is exactly
   *  what an admin needs to see as next. Null when the programme is
   *  exhausted. */
  nextKey: string | null;
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

  // ── THE PROGRAMME, AS INSTANTS ──
  // scheduleTimings is the one accumulator: row 1 starts at the
  // competition's start and every other row starts when the one before it
  // ends. Anchored at 0 and offset from startAt rather than read through
  // minutesOfDay, which resolves in the timezone of whichever machine runs
  // it — on the server, not the admin's. Same reasoning, and the same
  // first-row-wins rule, as scheduledRoundStartMs in live-view.ts.
  const startAtMs: number | null = compSnap.get('startAt')?.toMillis?.() ?? null;
  const schedule = normalizeStoredSchedule(compSnap.get('schedule'));
  const timings = scheduleTimings(0, schedule.map((e) => e.durationMin));
  const slots = new Map<string, { startMs: number; endMs: number }>();
  if (startAtMs !== null) {
    schedule.forEach((e, i) => {
      if (e.kind !== 'round' || !e.eventId || typeof e.round !== 'number') return;
      const key = roundKey(e.eventId, e.round);
      if (slots.has(key)) return;
      slots.set(key, {
        startMs: startAtMs + timings[i].startMin * 60_000,
        endMs: startAtMs + timings[i].endMin * 60_000,
      });
    });
  }
  /** Programme order, for the summary. A round with no announced slot sorts
   *  after every round that has one. */
  const slotOrder = (key: string) => slots.get(key)?.startMs ?? Infinity;

  const [states, qualifierSnap, roster, subsSnap] = await Promise.all([
    fetchRoundStates(db, competitionId),
    compRef.collection('qualifiers').get(),
    // ── THE ROSTER: ONE read for every round ──
    // eligibleAthletesForRound is this, filtered by event and then by the
    // previous round's qualifiers — so reusing it here is what keeps the
    // participant count and the athletes the scramble gate admits from
    // disagreeing. It is the expensive read on this page: an unfiltered
    // collectionGroup('registrations') scan plus a batch get of profiles.
    // A filtered collection-group query would need a COLLECTION_GROUP index
    // this project does not have (see countRegistrationsFor, which took the
    // editor down in production by assuming otherwise). Fetched once here
    // rather than per round.
    fetchScrambleRoster(db, competitionId),
    // ── EVERY submission for this competition, all three statuses ──
    // One single-field equality query, no composite index. The public live
    // route asks a narrower question (judged only, through the
    // (competitionId, status) index); the admin needs PENDING too, and
    // `status` would then be a three-value `in` — so dropping the status
    // filter is both cheaper in index terms and one query instead of two.
    db.collection('onlineSubmissions').where('competitionId', '==', competitionId).get(),
  ]);
  const qualifierCounts = new Map<string, number>();
  /** The same documents as a membership test, for the round rosters below.
   *  An unreadable `uids` is an empty round rather than a broken one —
   *  eligibleAthletesForRound treats it the same way. */
  const qualifierUids = new Map<string, Set<string>>();
  for (const d of qualifierSnap.docs) {
    const uids = d.get('uids');
    const list = Array.isArray(uids) ? uids.filter((u): u is string => typeof u === 'string') : [];
    qualifierCounts.set(d.id, list.length);
    qualifierUids.set(d.id, new Set(list));
  }

  // Bucketed by event+round once, so each round below is a lookup rather
  // than a filter over the whole competition.
  const subsByRound = new Map<string, JudgedSubmission[]>();
  for (const d of subsSnap.docs) {
    const judged = toAdminJudged(d.data());
    if (!judged) continue;
    const key = roundKey(judged.event, judged.competitionRound);
    const list = subsByRound.get(key);
    if (list) list.push(judged);
    else subsByRound.set(key, [judged]);
  }

  // Configured events, normalised, so format / cutoff / time limit read the
  // same way here as in the scorer.
  const configured = new Map(normalizeStoredEvents(compSnap.get('events')).map((e) => [e.eventId, e]));
  /** Who is eligible for one round: registered for the event, and for round
   *  2+ also in the previous round's qualifiers. eligibleAthletesForRound's
   *  rule, over data already in hand. */
  const rosterFor = (eventId: string, round: number): string[] => {
    const registered = roster.filter((a) => a.events.includes(eventId)).map((a) => a.uid);
    if (round <= 1) return registered;
    const uids = qualifierUids.get(roundKey(eventId, round - 1));
    return uids ? registered.filter((u) => uids.has(u)) : [];
  };

  const rounds: RoundAdminView[] = [];
  for (const e of events) {
    const eventId = typeof e?.eventId === 'string' ? e.eventId : '';
    if (!eventId) continue;
    const total = Number.isInteger(e?.rounds) && e.rounds > 0 ? e.rounds : 1;
    for (let round = 1; round <= total; round++) {
      const key = roundKey(eventId, round);
      const state = states.get(key);
      const cfg = configured.get(eventId);
      const format = resolveResultFormat(cfg?.resultFormat);
      const progress = roundRosterProgress(rosterFor(eventId, round), subsByRound.get(key) ?? [], {
        format,
        attempts: attemptsForFormat(format),
        timeLimitCs: typeof cfg?.timeLimitCs === 'number' ? cfg.timeLimitCs : null,
        cutoffCs: (cfg?.cutoffs ?? []).find((c) => c.round === round)?.cutoffCs ?? null,
      });
      const slot = slots.get(key);
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
        scheduledStartMs: slot?.startMs ?? null,
        scheduledEndMs: slot?.endMs ?? null,
        participants: progress.participants,
        complete: progress.complete,
        incomplete: progress.incomplete,
        notStarted: progress.notStarted,
        pendingSubmissions: progress.pendingSubmissions,
        pendingAthletes: progress.pendingAthletes,
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

  const byProgramme = (a: RoundAdminView, b: RoundAdminView) =>
    slotOrder(roundKey(a.eventId, a.round)) - slotOrder(roundKey(b.eventId, b.round));
  const live = rounds.filter((r) => r.status === 'live').sort(byProgramme);
  const next = rounds.filter((r) => r.status === 'closed' && r.qualifierCount === 0).sort(byProgramme);
  const summary: RoundsSummary = {
    competitionName: typeof compSnap.get('name') === 'string' ? compSnap.get('name') : '',
    competitionStatus: normalizeCompetitionStatus(compSnap.get('status')),
    nowKey: live[0] ? roundKey(live[0].eventId, live[0].round) : null,
    nextKey: next[0] ? roundKey(next[0].eventId, next[0].round) : null,
  };

  return NextResponse.json({ rounds, summary, eventsWithoutLiveRound, eventsWithConflictingLiveRounds });
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
