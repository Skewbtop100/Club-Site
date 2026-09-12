'use client';

import { useScreenFill } from './ScreenFill';

/** The beat before an attempt starts: get your timer ready.
 *
 *  WHY IT EXISTS: pressing ОРОЛДЛОГОО ЭХЛЭХ used to land straight on the
 *  timer check, whose eight seconds start counting the moment it renders.
 *  An athlete who had not already picked up their timer spent the first
 *  half of a hold a judge measures reaching for it. This screen gives
 *  them that moment somewhere it costs nothing.
 *
 *  IT IS NOT ON THE RECORDING, and that is the point of putting it here
 *  rather than inside the hold. The clip still begins at the timer check,
 *  where the evidence begins — see the recording-start effect in
 *  page.tsx. Nothing that happens on this screen is evidence of anything,
 *  so there is no camera preview on it either: an athlete fumbling for
 *  their timer is not something a judge needs five seconds of, on every
 *  attempt, on every clip.
 *
 *  It advances on its own. There is no decision to make here, so a button
 *  would only be a second press between the athlete and the same place.
 *
 *  ONE LINE, and the five seconds are the screen filling behind it rather
 *  than a number beside it. It also carried "{N}-р эвлүүлэлт эхлэх гэж
 *  байна"; the bar above already names the attempt, and a screen with one
 *  instruction on it should have one sentence on it.
 *
 *  THE FILL IS FOR SCREENS WITH NO PREVIEW, which this is — and so is
 *  the cover-prep beat before the cover hold, the other screen in the run
 *  that is one sentence on an empty background. Both draw it through
 *  useScreenFill. The three camera holds count with a number instead:
 *  colour moving behind a live preview competes with the picture the
 *  athlete is trying to frame. They share the clock, not the picture. */
const INTRO_SECONDS = 5;

export default function AttemptIntroStage({ onDone }: { onDone: () => void }) {
  // One argument arms the clock and sizes the sweep — see useScreenFill.
  const fill = useScreenFill(INTRO_SECONDS, onDone);

  return (
    <div className="oc-solve-intro">
      {fill}
      <span className="oc-solve-intro-eyebrow">БЭЛТГЭЛ</span>
      <p className="oc-solve-intro-say">Цагаа 0.00 болгож шалгуулахдаа бэлдээрэй.</p>
    </div>
  );
}
