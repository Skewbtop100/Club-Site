// ── Picking a run back up ───────────────────────────────────────────────
// Pure — no Firestore, no clock, no React — so the arithmetic that decides
// WHICH attempt an athlete solves next is unit-tested directly
// (tests/competition-fields/run-resume.test.cjs) rather than only read.
//
// Why it exists: attempts are filed one at a time as they are recorded
// (see submission-id.ts), so the server already knows how far a run got.
// Leaving the page therefore stops being a way to discard a solve that
// went badly — the athlete comes back to the attempt AFTER the last one
// they filed, with the earlier ones intact and counted.

import type { AttemptTime, ResultFormat } from './ao5';

/** One attempt already on the server, as the solve page reads it back.
 *  `attempt` is the stored `round` field: the 1-based index within the
 *  run, NOT the competition round (that is `competitionRound`). */
export interface FiledAttempt {
  /** The onlineSubmissions document id it was read from. */
  submissionId: string;
  attempt: number;
  competitionRound: number;
  /** Centiseconds. 0 for a DNF, which is how createSubmission stores it. */
  reportedTime: number;
  isDnf: boolean;
}

/** The run's captured shape, for the round being planned. */
export interface RunShape {
  format: ResultFormat;
  /** attemptsForFormat(format) — 5 for Ao5, 3 for Mo3/Bo3, and so on. */
  attempts: number;
  timeLimitCs: number | null;
  /** This ROUND's cutoff, and how many attempts its phase covers. Both
   *  null when the round has none. */
  cutoffCs: number | null;
  cutoffPhase: number | null;
}

export type ResumeKind =
  /** No round is open for this event — nothing can be solved or finished. */
  | 'no-live-round'
  /** Nothing filed for the live round: attempt 1, as before. */
  | 'fresh'
  /** Some attempts are filed; the run continues at the next one. */
  | 'resume'
  /** Every attempt is filed, or the cutoff already ended the run. The
   *  athlete left before finishing and only owes the result. */
  | 'complete';

export interface ResumePlan {
  kind: ResumeKind;
  /** The competition round this run belongs to — the LIVE one, always.
   *  Null only when no round is open. */
  competitionRound: number | null;
  /** 1-based attempt to solve next. attempts + 1 when the run is done. */
  nextAttempt: number;
  /** The attempts already filed, rebuilt from what the server stored, in
   *  order from attempt 1. This is what the summary and the average are
   *  computed from on a resumed run. */
  priorAttempts: { timeCs: number | null; isDnf: boolean }[];
  /** The cutoff was already missed — the run is over at whatever it has. */
  cutOff: boolean;
  /** An unfinished run in a DIFFERENT round, if there is one. It cannot be
   *  continued (only one round is open at a time) and nothing here tries
   *  to; it is reported so the athlete can be told why their earlier
   *  attempts stop where they do. */
  unfinishedRound: number | null;
}

/** One attempt's value for display and for the provisional result, with
 *  the event's per-attempt limit applied.
 *
 *  Shared by the live run and by a resumed one on purpose: the same stored
 *  attempt has to score the same either way, and a second copy of this
 *  rule is how the two would drift. Mirrors effectiveAttemptTime for a
 *  time nobody has judged yet — no status, no penalty. */
export function resolveAttemptTime(
  a: { timeCs: number | null; isDnf: boolean },
  timeLimitCs: number | null,
): AttemptTime {
  if (a.isDnf || a.timeCs === null) return 'DNF';
  if (timeLimitCs !== null && a.timeCs > timeLimitCs) return 'DNF';
  return a.timeCs;
}

/** Has this run failed its cutoff?
 *
 *  At the end of the cutoff phase, a run that never beat the cutoff ends
 *  there. STRICTLY better is required — equalling the cutoff is not
 *  beating it — and an attempt over the time limit is a DNF, so it can
 *  never beat it either.
 *
 *  Evaluated on a RESUMED run too: an athlete whose first two attempts
 *  already missed the cutoff does not get to continue by reloading. */
export function cutoffFailed(
  times: AttemptTime[],
  cutoffPhase: number | null,
  cutoffCs: number | null,
): boolean {
  if (cutoffPhase === null || cutoffCs === null) return false;
  if (times.length < cutoffPhase) return false;
  return times.slice(0, cutoffPhase).every((t) => t === 'DNF' || t >= cutoffCs);
}

/** What this athlete should be shown when the solve page opens.
 *
 *  `filed` is every attempt they have on the server for this competition
 *  and event, across all rounds; `liveRound` is the round currently open,
 *  from the same resolver the scramble route gates with.
 *
 *  ONLY the live round is ever planned for. A run started in round 1 is
 *  never carried into round 2 — its attempts are not in `mine`, its
 *  competitionRound is not the one written on new attempts, and the
 *  athlete is told about it through `unfinishedRound` instead. */
export function planResume(filed: FiledAttempt[], liveRound: number | null, shape: RunShape): ResumePlan {
  const unfinishedRound = unfinishedRoundOther(filed, liveRound, shape.attempts);

  if (liveRound === null) {
    return {
      kind: 'no-live-round',
      competitionRound: null,
      nextAttempt: 1,
      priorAttempts: [],
      cutOff: false,
      unfinishedRound,
    };
  }

  // The CONTIGUOUS prefix, not the highest number filed. A gap can only
  // come from something this client cannot do (attempts are filed in
  // order, one at a time), and filling the gap is the only safe reading of
  // it — resuming past a missing attempt would leave a run that can never
  // be completed.
  const byAttempt = new Map<number, FiledAttempt>();
  for (const f of filed) {
    if (f.competitionRound !== liveRound) continue;
    if (f.attempt < 1 || f.attempt > shape.attempts) continue;
    byAttempt.set(f.attempt, f);
  }
  const priorAttempts: { timeCs: number | null; isDnf: boolean }[] = [];
  for (let attempt = 1; attempt <= shape.attempts; attempt += 1) {
    const f = byAttempt.get(attempt);
    if (!f) break;
    priorAttempts.push({ timeCs: f.isDnf ? null : f.reportedTime, isDnf: f.isDnf });
  }

  const times = priorAttempts.map((a) => resolveAttemptTime(a, shape.timeLimitCs));
  const cutOff = cutoffFailed(times, shape.cutoffPhase, shape.cutoffCs);
  const nextAttempt = priorAttempts.length + 1;
  const complete = cutOff || priorAttempts.length >= shape.attempts;

  return {
    kind: complete ? 'complete' : priorAttempts.length > 0 ? 'resume' : 'fresh',
    competitionRound: liveRound,
    nextAttempt,
    priorAttempts,
    cutOff,
    unfinishedRound,
  };
}

/** The highest round, other than the live one, that has attempts but not a
 *  full run's worth. Null when there is none. */
function unfinishedRoundOther(filed: FiledAttempt[], liveRound: number | null, perRun: number): number | null {
  const counts = new Map<number, number>();
  for (const f of filed) {
    if (f.competitionRound === liveRound) continue;
    counts.set(f.competitionRound, (counts.get(f.competitionRound) ?? 0) + 1);
  }
  let worst: number | null = null;
  for (const [round, count] of counts) {
    if (count >= perRun) continue;
    if (worst === null || round > worst) worst = round;
  }
  return worst;
}

/** What the athlete is told when the page opens onto a run that is already
 *  under way. Null when there is nothing to explain — a fresh run says
 *  nothing, because nothing happened.
 *
 *  It exists because the flow otherwise looks identical to starting over:
 *  same camera prompt, same countdown. An athlete who believes they are
 *  starting fresh will solve attempt 1 again and find it refused. */
export function resumeNotice(plan: ResumePlan): string | null {
  const filed = plan.priorAttempts.length;
  if (plan.kind === 'no-live-round') return null;
  if (plan.kind === 'complete') {
    return plan.cutOff
      ? `Энэ раундын ${filed} оролдлого хадгалагдсан бөгөөд шүүлтүүр давагдаагүй тул раунд дууссан. Дүнгээ илгээнэ үү.`
      : `Энэ раундын бүх оролдлого (${filed}) хадгалагдсан байна. Дүнгээ илгээнэ үү.`;
  }
  if (plan.kind === 'resume') {
    return `Өмнө нь хадгалагдсан ${filed} оролдлого байна. Та ${plan.nextAttempt}-р оролдлогоос үргэлжлүүлнэ.`;
  }
  if (plan.unfinishedRound !== null) {
    return `Таны ${plan.unfinishedRound}-р раундын оролдлого дуусаагүй үлдсэн байна. Тэр раунд хаагдсан тул энэ раундыг шинээр эхлүүлнэ.`;
  }
  return null;
}
