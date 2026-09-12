'use client';

import type { CSSProperties } from 'react';

import { useHoldClock } from '../_lib/useHoldClock';

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
 *  THE FILL LIVES HERE AND NOWHERE ELSE. This is the only waiting screen
 *  in the run with nothing on it but a sentence — no preview, no cube
 *  diagram — so it is the only one where the screen itself is free to
 *  become the clock. The three camera holds count with a number instead:
 *  colour moving behind a live preview competes with the picture the
 *  athlete is trying to frame. They share the clock, not the picture. */
const INTRO_SECONDS = 5;

export default function AttemptIntroStage({ onDone }: { onDone: () => void }) {
  // The same clock the three holds use. `remaining` is ignored here — the
  // fill IS the countdown — but the timeout that ends the screen is the
  // same one they are measured by, and INTRO_SECONDS drives both it and
  // the fill's animation-duration below. There is no second place to put
  // a duration, so the sweep cannot outlast the screen or stop short.
  useHoldClock(INTRO_SECONDS, onDone);

  return (
    <div className="oc-solve-intro">
      <div
        className="oc-solve-intro-fill"
        style={
          {
            '--oc-fill-duration': `${INTRO_SECONDS}s`,
            '--oc-fill-steps': INTRO_SECONDS,
          } as CSSProperties
        }
        aria-hidden
      />
      {/* The fill says how long this lasts to everyone who can see it and
          to nobody else. Stated once, not counted down: a live region
          ticking once a second would be unusable. */}
      <span className="oc-sr-only">{INTRO_SECONDS} секунд хүлээнэ үү.</span>
      <span className="oc-solve-intro-eyebrow">БЭЛТГЭЛ</span>
      <p className="oc-solve-intro-say">Цагаа 0.00 болгож шалгуулахдаа бэлдээрэй.</p>
    </div>
  );
}
