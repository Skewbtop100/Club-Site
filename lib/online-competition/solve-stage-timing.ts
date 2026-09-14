// ── How long the pre-solve stages last ────────────────────────────────
// The solve flow owns these numbers because it runs them; the admin
// review flow needs them because it computes where to seek in the
// recording. They live here so there is ONE of each rather than one per
// reader — a judge jumping to a moment that has quietly moved is worse
// than no jump button at all, because it looks like it worked.
//
// Pure arithmetic: no React, no DOM, importable from either side.

import { splitScrambleIntoChunks } from '@/app/online-competition/[competitionId]/solve/[eventId]/_lib/scrambleChunks';

/** THE COVER, which is a different kind of hold and says so.
 *
 *  It shared HOLD_SECONDS when all three were the same job — hold still
 *  in front of the camera while a judge reads something off the video.
 *  The cover is not that. It asks the athlete to READ an instruction and
 *  then DO it: cube under the cover, green to the camera, white up. Eight
 *  seconds was the reading time and the doing time together, so the doing
 *  started late and the orientation a judge checks was being settled in
 *  the last second or two of it.
 *
 *  Separate from HOLD_SECONDS rather than one constant with an exception,
 *  because the two numbers answer different questions: HOLD_SECONDS is
 *  "how long must a judge see this for", and this is "how long does the
 *  athlete need". A change to either must not silently move the other. */
export const COVER_SECONDS = 20;

/** One scramble chunk's time on screen, in the reveal. */
export const GROUP_DISPLAY_MS = 5000;

/** How long the scramble reveal runs, for THIS scramble.
 *
 *  NOT A CONSTANT, WHICH IS THE WHOLE POINT OF THIS FUNCTION. The reveal
 *  shows the scramble one chunk at a time at GROUP_DISPLAY_MS each, and
 *  the chunk count follows the scramble's length (splitScrambleIntoChunks
 *  — five moves per chunk, with a lone trailing move folded back). So the
 *  stage is ten seconds for a 2x2, twenty for a 3x3, and forty-five for a
 *  4x4.
 *
 *  Anything downstream that treats this as a fixed twenty seconds is
 *  correct for 3x3 and wrong for every other event — which is exactly the
 *  bug this function exists to prevent, since 3x3 is what gets tested. */
export function revealDurationMs(scramble: string): number {
  return splitScrambleIntoChunks(scramble).length * GROUP_DISPLAY_MS;
}

/** Where the cover stage's midpoint falls, as an offset into the
 *  recording, given the `scrambleShown` mark and the scramble the athlete
 *  was actually given.
 *
 *  The cover runs from the end of the reveal for COVER_SECONDS, and its
 *  middle is where the athlete has finished reading the instruction and
 *  is holding the cube steady in the orientation a judge verifies. The
 *  start of it is too early — they are still reading — and the end of it
 *  runs into the next screen. */
export function coverMidpointMs(scrambleShownMs: number, scramble: string): number {
  return scrambleShownMs + revealDurationMs(scramble) + (COVER_SECONDS * 1000) / 2;
}
