// ── The athlete's live competition view ─────────────────────────────────
// Pure — no Firestore, no React, no clock — so every rule behind the live
// screen (app/online-competition/[competitionId]/live) is unit-tested
// directly (tests/competition-fields/live-view.test.cjs). The route that
// feeds it (api/online-competition/competitions/[id]/live) only reads
// documents and hands them to these functions; the page only lays out
// what they return.
//
// ── THE RULES THIS FILE EXISTS TO HOLD ──
// Only an APPROVED attempt is ever shown as a time. A pending attempt is
// the athlete's own claim and still undecided; a rejected one is a judge's
// DNF (review/route.ts writes DNF as status 'rejected'). Concretely:
//   · the athlete's own slots show a pending attempt as SUBMITTED and a
//     rejected one as DNF — never the reported time of either;
//   · the standings take JUDGED submissions: approved, and rejected as a
//     DNF. That is exactly the set collectRoundResults (round-results.ts)
//     ranks qualifiers on, so a judge's DNF counts here the way it counts
//     there. Pending submissions do not enter the standings at all;
//   · the header's average is read off the athlete's OWN standings row,
//     so it cannot apply a different rule from the board beside it.

import {
  computeResult,
  cutoffPhaseFor,
  effectiveAttemptTime,
  isAveragingFormat,
  type AttemptTime,
  type ResultFormat,
} from './ao5';
import { fmtClock, minutesOfDay, scheduleTimings } from './schedule';
import type { RoundStatus } from './rounds';
import type { RoundAccess } from './round-access';
import type { ResumeKind } from './run-resume';
import type {
  OnlineCompetitionScheduleEntry,
  OnlineCompetitionStatus,
  OnlineRegistrationStatus,
} from './types';

// ── inputs ───────────────────────────────────────────────────────────────

/** One onlineSubmissions document, reduced to what scoring reads. The
 *  route builds these; nothing here knows about Firestore. */
export interface JudgedSubmission {
  uid: string;
  event: string;
  competitionRound: number;
  /** The stored `round` field: the ATTEMPT index 1..N within one run. */
  attempt: number;
  status: 'pending' | 'approved' | 'rejected';
  reportedTime: number;
  isDnf: boolean;
  penalty: '+2' | 'DNF' | null;
  /** epoch ms; 0 when unknown. Only used for "first run counts". */
  createdAt: number;
}

/** How one event+round is scored. */
export interface RoundRules {
  format: ResultFormat;
  /** attemptsForFormat(format). */
  attempts: number;
  timeLimitCs: number | null;
  /** THIS round's cutoff, or null. */
  cutoffCs: number | null;
}

/** The oldest submission in each attempt slot 1..attempts — the same
 *  "first run counts" rule collectRoundResults and the review grid use,
 *  so re-running a round can never replace what was filed first. */
function oldestPerSlot(subs: JudgedSubmission[], attempts: number): Map<number, JudgedSubmission> {
  const bySlot = new Map<number, JudgedSubmission>();
  for (const s of subs) {
    if (s.attempt < 1 || s.attempt > attempts) continue;
    const existing = bySlot.get(s.attempt);
    if (!existing || s.createdAt < existing.createdAt) bySlot.set(s.attempt, s);
  }
  return bySlot;
}

// ── the athlete's own attempt slots ─────────────────────────────────────

/** empty     — nothing filed in this slot
 *  submitted — filed, not yet judged. Carries NO time.
 *  time      — approved; timeCs is the judged time (+2 and limit applied)
 *  dnf       — approved as a DNF, over the limit, or rejected by a judge */
export type SlotState = 'empty' | 'submitted' | 'time' | 'dnf';

export interface AttemptSlot {
  attempt: number;
  state: SlotState;
  /** Non-null ONLY when state is 'time'. */
  timeCs: number | null;
}

/** One slot per attempt the format takes, from ONE athlete's submissions
 *  for ONE event+round. */
export function attemptSlots(mine: JudgedSubmission[], rules: RoundRules): AttemptSlot[] {
  const bySlot = oldestPerSlot(mine, rules.attempts);
  return Array.from({ length: rules.attempts }, (_, i): AttemptSlot => {
    const attempt = i + 1;
    const s = bySlot.get(attempt);
    if (!s) return { attempt, state: 'empty', timeCs: null };
    // Checked before anything reads reportedTime: an unjudged attempt's
    // time never leaves this function.
    if (s.status === 'pending') return { attempt, state: 'submitted', timeCs: null };
    // effectiveAttemptTime answers 'DNF' for every rejected attempt
    // whatever it claims, and applies the +2 and the time limit.
    const t = effectiveAttemptTime(s, rules.timeLimitCs);
    return t === 'DNF' ? { attempt, state: 'dnf', timeCs: null } : { attempt, state: 'time', timeCs: t };
  });
}

// ── standings ────────────────────────────────────────────────────────────

export interface StandingRow {
  /** 1-based. Athletes tied on result AND single share a rank. */
  rank: number;
  name: string;
  isMe: boolean;
  /** One per attempt: centiseconds, 'DNF', or null for a slot with no
   *  judged attempt (nothing filed, or still pending). */
  cells: (number | 'DNF' | null)[];
  /** Cell indices that did not count toward the result (an Ao5's best and
   *  worst). Empty unless the result exists. */
  excluded: number[];
  /** Every attempt this athlete owes is judged. */
  hasResult: boolean;
  /** The cutoff ended their round: a result with no average. */
  cutOff: boolean;
  /** The ranking value when hasResult — an average for ao5/mo3, the best
   *  single for bo-N. null = a DNF result, a cut-off, or no result yet. */
  value: number | null;
  best: number | null;
}

/** Standings for ONE event+round, from JUDGED submissions.
 *
 *  THE SAME SET THE QUALIFIER RANKING USES. collectRoundResults queries
 *  status in ['approved', 'rejected'] and scores a rejected attempt as a
 *  DNF through effectiveAttemptTime; this does both, with the same
 *  oldest-per-slot rule, so an athlete with one judge DNF has the same Ao5
 *  here as the qualify step gives them.
 *
 *  PENDING is dropped on the first line, before grouping, so an undecided
 *  submission cannot put an athlete on the board, fill a slot, or move a
 *  rank.
 *
 *  Unlike the official ranking, an athlete whose round is not fully judged
 *  yet is INCLUDED — this is a live board — with their judged attempts
 *  shown and no result. Order is the WCA mixed-round order round-results.ts
 *  uses: athletes with a rankable result first by value, then everyone
 *  else by best single, athletes with no single last. */
export function rankJudgedStandings(
  submissions: JudgedSubmission[],
  rules: RoundRules,
  nameOf: (uid: string) => string,
  meUid: string | null,
): StandingRow[] {
  const judged = submissions.filter((s) => s.status === 'approved' || s.status === 'rejected');

  const byUid = new Map<string, JudgedSubmission[]>();
  for (const s of judged) {
    const list = byUid.get(s.uid);
    if (list) list.push(s);
    else byUid.set(s.uid, [s]);
  }

  const phase = rules.cutoffCs !== null ? cutoffPhaseFor(rules.format) : null;

  const rows: (StandingRow & { uid: string })[] = [];
  for (const [uid, subs] of byUid) {
    const bySlot = oldestPerSlot(subs, rules.attempts);
    if (bySlot.size === 0) continue;
    let cells: (number | 'DNF' | null)[] = Array.from({ length: rules.attempts }, (_, i) => {
      const s = bySlot.get(i + 1);
      // A rejected attempt comes back 'DNF' here, whatever it reported.
      return s ? effectiveAttemptTime(s, rules.timeLimitCs) : null;
    });

    // The cutoff, decided from the judged times of the phase exactly as
    // collectRoundResults decides it: every phase attempt judged, none
    // strictly better than the cutoff.
    const cutOff =
      phase !== null &&
      cells.slice(0, phase).every((c) => c !== null && (c === 'DNF' || c >= rules.cutoffCs!));
    const owed = cutOff ? phase! : rules.attempts;
    // A cut-off athlete's later slots took no part in their result.
    if (cutOff) cells = cells.map((c, i) => (i < owed ? c : null));

    const hasResult = cells.slice(0, owed).every((c) => c !== null);
    let value: number | null = null;
    let excluded: number[] = [];
    if (hasResult && !cutOff) {
      const result = computeResult(cells.slice(0, owed) as AttemptTime[], rules.format);
      value = result.value;
      excluded = result.excludedIndices;
    }
    const finished = cells.filter((c): c is number => typeof c === 'number');
    const best = finished.length > 0 ? Math.min(...finished) : null;

    rows.push({ uid, rank: 0, name: nameOf(uid), isMe: uid === meUid, cells, excluded, hasResult, cutOff, value, best });
  }

  rows.sort((a, b) => {
    const aHas = a.value !== null;
    const bHas = b.value !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.value !== b.value) return a.value! - b.value!;
    if (a.best !== b.best) {
      if (a.best === null) return 1;
      if (b.best === null) return -1;
      return a.best - b.best;
    }
    return a.name.localeCompare(b.name, 'mn') || a.uid.localeCompare(b.uid);
  });

  // uid is dropped here: it was needed for the tie-break, and nothing on
  // the board is keyed by it.
  const out: StandingRow[] = [];
  rows.forEach(({ uid: _uid, ...row }, i) => {
    const prev = out[i - 1];
    const tied = prev !== undefined && prev.value === row.value && prev.best === row.best;
    out.push({ ...row, rank: tied ? prev.rank : i + 1 });
  });
  return out;
}

// ── the header's three numbers ──────────────────────────────────────────

export interface OwnRoundStats {
  /** Attempts filed in this round, judged or not. */
  filed: number;
  attempts: number;
  /** 'average' for ao5/mo3; 'single' for bo-N, which has no average. */
  averageKind: 'average' | 'single';
  /** Read off the athlete's own STANDINGS ROW — see standingsAverage. null
   *  when nothing is judged. */
  average: number | 'DNF' | null;
  /** This athlete's rank on the standings, and how many rows those
   *  standings have. rank null = not on the board yet. */
  rank: number | null;
  ranked: number;
}

export function ownRoundStats(
  slots: AttemptSlot[],
  standings: StandingRow[],
  rules: Pick<RoundRules, 'format' | 'attempts'>,
): OwnRoundStats {
  const me = standings.find((r) => r.isMe) ?? null;
  return {
    // The only number here taken from the slots: filed attempts include
    // pending ones, which the standings deliberately do not hold.
    filed: slots.filter((s) => s.state !== 'empty').length,
    attempts: rules.attempts,
    averageKind: isAveragingFormat(rules.format) ? 'average' : 'single',
    average: me ? standingsAverage(me, rules.format) : null,
    rank: me?.rank ?? null,
    ranked: standings.length,
  };
}

/** The header's figure, from the athlete's standings row — the same judged
 *  cells, the same cutoff decision, the same result.
 *
 *    · result exists    -> that result; a DNF result reads DNF
 *    · cut off          -> no average (null); a bo-N round shows its single
 *    · round unfinished -> provisional, from the judged attempts so far:
 *        - bo-N: the best single;
 *        - ao5/mo3: DNF once the judged DNFs already decide it (two in an
 *          Ao5, any in a Mo3 — nothing still to come can undo that);
 *          otherwise the mean of the judged times, leaving a lone Ao5 DNF
 *          out exactly as the finished average will drop it as the worst. */
function standingsAverage(row: StandingRow, format: ResultFormat): number | 'DNF' | null {
  const averaging = isAveragingFormat(format);
  if (row.cutOff) return averaging ? null : row.best;
  if (row.hasResult) return row.value ?? 'DNF';

  const judged = row.cells.filter((c): c is number | 'DNF' => c !== null);
  const times = judged.filter((c): c is number => typeof c === 'number');
  if (!averaging) return times.length > 0 ? Math.min(...times) : null;

  const dnfs = judged.length - times.length;
  if (dnfs >= (format === 'mo3' ? 1 : 2)) return 'DNF';
  return times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
}

// ── the wire shape ───────────────────────────────────────────────────────

export interface LiveRoundView {
  round: number;
  /** "Раунд 1" / "Финал" — roundLabel (detail-view.ts). */
  label: string;
  /** roundState; 'closed' for a round with no document. */
  status: RoundStatus;
  /** The signed-in athlete's qualification INTO this round: true/false
   *  once the previous round's qualifier list exists, null for round 1,
   *  for a signed-out viewer, and while the cut has not been made. */
  qualified: boolean | null;
  /** "13:00" from the announced programme, or null. Display only. */
  scheduledAt: string | null;
  standings: StandingRow[];
}

export interface LiveEventMe {
  /** The athlete's registration names this event. */
  registered: boolean;
  /** The SAME resolver the scramble route enforces with. */
  access: RoundAccess;
  /** planResume's verdict for the live round — what the solve page will
   *  do when opened. null when no round is live. */
  planKind: ResumeKind | null;
  nextAttempt: number | null;
  /** round number -> slots, for the live round and every round the
   *  athlete has filed in. */
  slotsByRound: Record<string, AttemptSlot[]>;
}

export interface LiveEventView {
  eventId: string;
  label: string;
  format: ResultFormat;
  attempts: number;
  rounds: LiveRoundView[];
  /** null for a signed-out viewer. */
  me: LiveEventMe | null;
}

export interface LiveViewPayload {
  competitionId: string;
  status: OnlineCompetitionStatus;
  signedIn: boolean;
  /** Status and events only — nothing else on the document crosses. */
  registration: { status: OnlineRegistrationStatus; events: string[] } | null;
  events: LiveEventView[];
}

// ── schedule ─────────────────────────────────────────────────────────────

const slotKey = (eventId: string, round: number) => `${eventId}_${round}`;

/** "13:00" for every round the programme announces, keyed `event_round`.
 *  Same accumulation the ХУВААРЬ tab uses (schedule.ts); the first entry
 *  for a round wins. Empty when the competition has no start time. */
export function scheduledRoundStarts(
  entries: Pick<OnlineCompetitionScheduleEntry, 'kind' | 'eventId' | 'round' | 'durationMin'>[],
  startAtMs: number | null,
): Map<string, string> {
  const out = new Map<string, string>();
  const anchor = minutesOfDay(startAtMs);
  if (anchor === null) return out;
  const timings = scheduleTimings(anchor, entries.map((e) => e.durationMin));
  entries.forEach((e, i) => {
    if (e.kind !== 'round' || !e.eventId || typeof e.round !== 'number') return;
    const key = slotKey(e.eventId, e.round);
    if (!out.has(key)) out.set(key, fmtClock(timings[i].startMin));
  });
  return out;
}

// ── what each round is, for this viewer ─────────────────────────────────

/** finished    — the round is done
 *  open        — live, and this athlete can start it now
 *  open-done   — live, and this athlete has already filed every attempt
 *  open-view   — live, but not this viewer's to solve
 *  notqualified — this athlete missed the cut into it
 *  notopen     — not opened yet */
export type RoundRowState = 'finished' | 'open' | 'open-done' | 'open-view' | 'notqualified' | 'notopen';

export interface MeEventContext {
  /** Signed in, registered for the event, registration approved. */
  canCompete: boolean;
  access: RoundAccess | null;
  planKind: ResumeKind | null;
}

export function meContextFor(payload: Pick<LiveViewPayload, 'registration'>, event: Pick<LiveEventView, 'me'>): MeEventContext | null {
  if (!event.me) return null;
  return {
    canCompete: payload.registration?.status === 'approved' && event.me.registered,
    access: event.me.access,
    planKind: event.me.planKind,
  };
}

export function roundRowState(
  round: Pick<LiveRoundView, 'round' | 'status' | 'qualified'>,
  me: MeEventContext | null,
): RoundRowState {
  if (round.status === 'done') return 'finished';
  if (round.status === 'live') {
    if (!me || !me.canCompete) return 'open-view';
    // The gate is the authority for the live round, exactly as
    // deriveEventState treats it.
    if (me.access && me.access.liveRound === round.round) {
      if (me.access.reason === 'not-qualified') return 'notqualified';
      if (me.access.reason === 'ok') return me.planKind === 'complete' ? 'open-done' : 'open';
    }
    if (round.qualified === false) return 'notqualified';
    // Live, but not the round the gate admits to. Only one round per event
    // may be live (openRound refuses a second); if two ever are, the gate
    // admits nobody and liveRound is null, so every live row lands here.
    return 'open-view';
  }
  if (me?.canCompete && round.qualified === false) return 'notqualified';
  return 'notopen';
}

/** The rounds of one event this athlete has REACHED, in order — what their
 *  schedule lists.
 *
 *    · not signed in, or not registered for the event: none;
 *    · round 1: reached by registering;
 *    · round N > 1: reached only once they are on round N-1's qualifier
 *      list (`qualified === true`, resolved server-side from that list).
 *      Not qualified, or the cut not made yet, and the round is not
 *      listed — and neither is anything after it, so an inconsistent
 *      document cannot list round 3 for someone who never reached round 2.
 *
 *  The same qualifier document resolveRoundAccess reads, so a round listed
 *  here is a round the solve gate admits them to once it is opened. */
export function roundsReached(event: Pick<LiveEventView, 'rounds' | 'me'>): LiveRoundView[] {
  if (!event.me?.registered) return [];
  const out: LiveRoundView[] = [];
  for (const r of [...event.rounds].sort((a, b) => a.round - b.round)) {
    if (r.round > 1 && r.qualified !== true) break;
    out.push(r);
  }
  return out;
}

export interface RoundRef {
  eventId: string;
  round: number;
}

/** The round the athlete can solve now: the first event, in configured
 *  order, with a round they can start; failing that, the first whose
 *  round they have already finished filing. null when neither exists. */
export function pickCurrentRound(payload: LiveViewPayload): RoundRef | null {
  let finishedFiling: RoundRef | null = null;
  for (const e of payload.events) {
    const me = meContextFor(payload, e);
    for (const r of e.rounds) {
      const state = roundRowState(r, me);
      if (state === 'open') return { eventId: e.eventId, round: r.round };
      if (state === 'open-done' && finishedFiling === null) finishedFiling = { eventId: e.eventId, round: r.round };
    }
  }
  return finishedFiling;
}

/** Why there is no current round, most decisive reason first. */
export type IdleReason =
  | 'finished'
  | 'signed-out'
  | 'not-registered'
  | 'gate'
  | 'not-qualified'
  | 'not-started'
  | 'no-open-round';

export function idleReason(payload: LiveViewPayload): IdleReason {
  if (payload.status === 'finished') return 'finished';
  if (!payload.signedIn) return 'signed-out';
  if (!payload.registration) return 'not-registered';
  if (payload.registration.status !== 'approved') return 'gate';
  const anyLive = payload.events.some((e) => e.rounds.some((r) => r.status === 'live'));
  const anyNotQualified = payload.events.some((e) => {
    const me = meContextFor(payload, e);
    return e.rounds.some((r) => r.status === 'live' && roundRowState(r, me) === 'notqualified');
  });
  if (anyNotQualified) return 'not-qualified';
  if (!anyLive && payload.status === 'upcoming') return 'not-started';
  return 'no-open-round';
}

/** Which round the header's three numbers describe: the current round, or
 *  failing that the last round (in configured order) the athlete filed
 *  anything in. null when they have filed nothing. */
export function statsRound(payload: LiveViewPayload, current: RoundRef | null): RoundRef | null {
  if (current) return current;
  let last: RoundRef | null = null;
  for (const e of payload.events) {
    for (const r of e.rounds) {
      const slots = e.me?.slotsByRound[String(r.round)];
      if (slots && slots.some((s) => s.state !== 'empty')) last = { eventId: e.eventId, round: r.round };
    }
  }
  return last;
}

/** Which standings tab opens first: the round the header describes, else
 *  the latest round of the first event that has been opened, else the
 *  first event's first round. */
export function defaultStandingsTarget(payload: LiveViewPayload, preferred: RoundRef | null): RoundRef | null {
  if (preferred) return preferred;
  for (const e of payload.events) {
    const opened = e.rounds.filter((r) => r.status !== 'closed');
    if (opened.length > 0) return { eventId: e.eventId, round: opened[opened.length - 1].round };
  }
  const first = payload.events[0];
  return first && first.rounds.length > 0 ? { eventId: first.eventId, round: first.rounds[0].round } : null;
}
