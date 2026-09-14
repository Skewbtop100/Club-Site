// ── Consistency checks on a filed attempt ──────────────────────────────
// Pure arithmetic over two clocks that were recorded independently: the
// athlete's own stopwatch (`reportedTime`, which they typed in) and the
// recorder's stage marks (`marks`, measured from the video's first
// frame). Where those two disagree by more than they physically can, the
// attempt is worth a judge's attention.
//
// NO VIDEO IS READ, nothing is inferred, and nothing here decides
// anything. A flag is a reason to look, not a verdict — every flagged
// attempt stays exactly as visible, as reviewable and as approvable as it
// was, and the judge's three buttons are untouched. The point is to tell
// a judge WHERE to spend attention across a hundred submissions, not to
// spend it for them.
//
// ── THE UNIT TRAP ──
// reportedTime is CENTISECONDS and every mark is MILLISECONDS. Comparing
// them directly reads a 20-second solve as 2 seconds, which would make
// IMPOSSIBLE fire on almost every honest attempt. Everything below is
// converted to milliseconds once, at the boundary, and the centisecond
// value is never compared to a mark.

import { effectiveAttemptTime } from './ao5';
import type { SolveMarks } from './types';

/** How far the recorded solve window may exceed the reported time before
 *  it is worth a look, in MILLISECONDS.
 *
 *  Some gap is normal and expected: the window is button-press to
 *  button-press, and it contains the athlete reaching for the timer,
 *  reading it, and reaching for the screen. Thirty seconds is far more
 *  than that — it is the shape of an athlete who stopped, did something
 *  else, and came back, or who forgot the button entirely.
 *
 *  Exported and named so it is tuned HERE, once, rather than discovered
 *  as a literal inside a comparison. */
export const SUSPICIOUS_GAP_MS = 30_000;

/** The marks a complete attempt carries. `recordingEnd` is deliberately
 *  not in this list — it is written from MediaRecorder's `onstop`, which
 *  can legitimately be missed if the recorder is torn down abruptly, and
 *  flagging that would report a recorder detail as an athlete problem. */
const REQUIRED_MARKS = ['coverStart', 'solveStart', 'solveEnd', 'cubeShown'] as const;

export type SubmissionFlagCode = 'IMPOSSIBLE' | 'SUSPICIOUS_GAP' | 'MISSING_MARKS';

/** 'red'     — at least one check fired; worth opening.
 *  'none'    — checked, and everything agreed.
 *  'neutral' — NOT CHECKED, which is a third thing and not a pass. A
 *              legacy attempt (filed before marks existed) and a DNF both
 *              land here, and a judge reading 'none' as "verified" on one
 *              of those would be reading a guarantee that was never made. */
export type SubmissionCheckSeverity = 'red' | 'none' | 'neutral';

export interface SubmissionChecks {
  /** Codes only. Mongolian wording lives in the review UI — an API that
   *  returned prose would be deciding how a screen reads, and would have
   *  to be redeployed to change a label. Empty when nothing fired. */
  flags: SubmissionFlagCode[];
  severity: SubmissionCheckSeverity;
}

/** The fields these checks read, as Firestore hands them back. */
export interface CheckableSubmission {
  reportedTime?: unknown;
  isDnf?: unknown;
  penalty?: unknown;
  /** The raw stored map. `undefined` means the document has NO marks
   *  field — a legacy attempt — which is a different thing from a marks
   *  map that is present and empty, and the two get different answers. */
  marks?: unknown;
}

function markMs(marks: Record<string, unknown>, key: keyof SolveMarks): number | null {
  const v = marks[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** The reported time in MILLISECONDS with its penalty applied, or null
 *  when this attempt has no time to check.
 *
 *  ── WHY status IS FORCED TO 'approved' ──
 *  effectiveAttemptTime answers "what does this attempt score", and its
 *  first rule is that anything not yet approved scores DNF. That is
 *  correct for a scorer and wrong here: the attempts these checks exist
 *  for are PENDING ones — the queue a judge is about to work through — so
 *  passing the real status would return DNF for every single one and
 *  quietly disable the entire feature.
 *
 *  The function is still the right one to call, because what is wanted
 *  from it is the PENALTY arithmetic: +2 adds its two seconds, and an
 *  explicit DNF (isDnf, or penalty 'DNF') is still recognised and still
 *  skips the attempt. Only the not-yet-judged gate is bypassed, and only
 *  because "not yet judged" is the state being examined.
 *
 *  timeLimitCs is null on purpose. The limit decides whether a time
 *  COUNTS, which is the judge's business; these checks ask whether two
 *  clocks AGREE, which is a separate question. A solve over its limit is
 *  still worth flagging as impossible if the recording says it never
 *  happened. */
function reportedMs(sub: CheckableSubmission): number | null {
  if (typeof sub.reportedTime !== 'number' || !Number.isFinite(sub.reportedTime)) return null;
  const effective = effectiveAttemptTime(
    {
      status: 'approved',
      reportedTime: sub.reportedTime,
      isDnf: sub.isDnf === true,
      penalty: sub.penalty === '+2' || sub.penalty === 'DNF' ? sub.penalty : null,
    },
    null,
  );
  return typeof effective === 'number' ? effective * 10 : null;
}

/** Runs every check. Never throws, never writes, and returns an empty
 *  flag list for an attempt that reads clean. */
export function checkSubmission(sub: CheckableSubmission): SubmissionChecks {
  const hasMarksField = typeof sub.marks === 'object' && sub.marks !== null;

  // LEGACY: no marks field at all. Nothing to compare the reported time
  // against, so nothing is checked and nothing is claimed.
  if (!hasMarksField) return { flags: [], severity: 'neutral' };

  // DNF: skipped entirely. There is no reported time to reconcile — the
  // athlete is not claiming one — so every check below is meaningless
  // rather than passing.
  const reported = reportedMs(sub);
  if (reported === null) return { flags: [], severity: 'neutral' };

  const marks = sub.marks as Record<string, unknown>;
  const flags: SubmissionFlagCode[] = [];

  if (REQUIRED_MARKS.some((key) => markMs(marks, key) === null)) {
    flags.push('MISSING_MARKS');
  }

  // The recorded solve window, button-press to button-press. Both ends
  // are needed; when either is missing MISSING_MARKS above has already
  // said so, and there is no window to measure against.
  const start = markMs(marks, 'solveStart');
  const end = markMs(marks, 'solveEnd');
  if (start !== null && end !== null && end >= start) {
    const windowMs = end - start;
    if (reported > windowMs) {
      // The athlete's stopwatch ran longer than the recording says the
      // solve lasted. Not "unlikely" — the solve is bounded by those two
      // presses, so a longer time cannot have been measured inside it.
      flags.push('IMPOSSIBLE');
    } else if (windowMs - reported > SUSPICIOUS_GAP_MS) {
      flags.push('SUSPICIOUS_GAP');
    }
  }

  return { flags, severity: flags.length > 0 ? 'red' : 'none' };
}
