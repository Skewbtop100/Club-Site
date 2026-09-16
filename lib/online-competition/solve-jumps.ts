// ── Jumping to the moments a judge actually watches ───────────────────
// THE SIX SEEK TARGETS, and the arithmetic behind each one. Extracted from
// SubmissionDetailPanel verbatim — the comments below came with the code
// they explain, and not a number in the table changed in the move.
//
// WHY IT IS SHARED: a practice run goes through the same stages as a
// competition attempt, in the same order, recorded by the same hook. So the
// offsets are the same offsets, and a second copy of them would be a second
// thing to keep in step — with the failure mode that a judge on one screen
// jumps to a moment that has quietly moved on the other.
//
// PURE. Marks and a scramble string in, a millisecond offset or null out —
// no React, no DOM, no Firestore. The one thing it imports is
// solve-stage-timing, which is where the stage durations already live.

import type { SolveMarks } from './types';
import { COVER_SECONDS, coverMidpointMs } from './solve-stage-timing';


/** The six segments of a run a judge steps through. Keyed by identity
 *  rather than by label, so the stills lookup below — and any future one
 *  — binds to the phase and not to its display text. */
export type PhaseKey = 'start' | 'cover' | 'inspect' | 'finish' | 'timer' | 'cube';

/** How far before `solveEnd` ТӨГСГӨЛ lands — far enough back to see the
 *  last few moves land rather than the cube already finished and still. */
export const BEFORE_END_MS = 5000;

/** How far into a hold the two hold buttons land. A mark names the
 *  instant a button was PRESSED, which is the instant a stage BEGAN, and
 *  at +0 the athlete is still moving their hands: the timer (or the cube)
 *  is not yet up and steady. Three seconds into an eight-second hold is
 *  the settled middle of it. */
export const INTO_HOLD_MS = 3000;

// ── Jumping to the moments a judge actually watches ────────────────────
// The clip runs a minute and a half and five moments in it decide the
// attempt: the scrambled cube under the cover, the solve starting, the
// cube being completed, the timer being shown, the cube shown at the end.
// Finding those by dragging a scrubber is the slowest part of judging a
// round, and the submission already knows where they are — `marks` stores
// each one as a millisecond offset into the video (SolveMarks).
//
// NONE OF THESE IS THE MARK ITSELF. A mark names the instant a stage
// BEGAN, and what a judge needs to see is rarely at a stage's edge: the
// holds need a moment for the thing being held up to come to rest, the
// cover needs its instruction read first, and the finish is the one thing
// that is only visible BEFORE its mark. Each entry below therefore says
// where it aims and why, and the offsets are named constants rather than
// numbers sitting in the table.

/** One mark, or null when it was never recorded. Null is what disables a
 *  button — the guard that keeps a missing mark from becoming a NaN seek. */
export function at(marks: Partial<SolveMarks> | undefined, key: keyof SolveMarks): number | null {
  const ms = marks?.[key];
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

export const JUMPS: {
  key: PhaseKey;
  label: string;
  /** False only for ЭХЛЭЛ, which is correct whatever was recorded. Used
   *  to tell "this submission has no marks" from "this one button has
   *  nothing to aim at". */
  needsMarks: boolean;
  resolve: (marks: Partial<SolveMarks> | undefined, scramble: string | null) => number | null;
}[] = [
  { key: 'start', label: 'ЭХЛЭХ', needsMarks: false, resolve: () => 0 },

  // THE MIDDLE OF THE COVER STAGE, where the athlete is holding the
  // scrambled cube steady in the orientation a judge verifies.
  //
  // TWO WAYS TO FIND IT, and the order matters.
  //
  // The recorded one: `coverStart` names the transition itself, so the
  // midpoint is that plus half the stage. It needs nothing but the
  // submission, and it stays right if the reveal's timing is ever
  // changed.
  //
  // The inferred one, for every submission filed before that mark
  // existed: start from `scrambleShown` and add how long the reveal must
  // have run. THAT LENGTH IS NOT A CONSTANT — the reveal plays the
  // scramble one chunk at a time, so it is ten seconds for a 2x2, twenty
  // for a 3x3, forty-five for a 4x4 — which is why it needs the athlete's
  // actual scramble, and why it is unavailable when that cannot be looked
  // up. It is also only as correct as the assumption that today's stage
  // timing is what that old attempt was recorded under.
  {
    key: 'cover',
    label: 'КОВЕР',
    needsMarks: true,
    resolve: (marks, scramble) => {
      const recorded = at(marks, 'coverStart');
      if (recorded !== null) return recorded + (COVER_SECONDS * 1000) / 2;
      const shown = at(marks, 'scrambleShown');
      if (shown === null || scramble === null) return null;
      return coverMidpointMs(shown, scramble);
    },
  },

  // No offset: not a hold to settle into but an act to catch, and the
  // frame that matters is the one where the cover comes off.
  { key: 'inspect', label: 'ЭВЛҮҮЛЭХ', needsMarks: true, resolve: (m) => at(m, 'solveStart') },

  // JUST BEFORE THE SOLVE ENDS — the cube being completed, which is the
  // thing a judge is actually checking.
  //
  // Backwards from a mark, so it is the one target that can land before
  // the stage it belongs to. A solve faster than BEFORE_END_MS would seek
  // back past its own start, into the cover stage, and show a scrambled
  // cube at the moment labelled "the finish". Clamped to solveStart.
  {
    key: 'finish',
    label: 'ТӨГСГӨЛ',
    needsMarks: true,
    resolve: (m) => {
      const end = at(m, 'solveEnd');
      if (end === null) return null;
      const start = at(m, 'solveStart');
      const target = end - BEFORE_END_MS;
      return start !== null && target < start ? start : target;
    },
  },

  { key: 'timer', label: 'ЦАГ', needsMarks: true, resolve: (m) => {
    const end = at(m, 'solveEnd');
    return end === null ? null : end + INTO_HOLD_MS;
  } },
  { key: 'cube', label: 'ШОО', needsMarks: true, resolve: (m) => {
    const shown = at(m, 'cubeShown');
    return shown === null ? null : shown + INTO_HOLD_MS;
  } },
];

/** One entry of the table, for a caller that holds on to one. */
export type Jump = (typeof JUMPS)[number];
