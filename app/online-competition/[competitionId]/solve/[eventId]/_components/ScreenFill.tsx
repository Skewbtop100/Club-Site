'use client';

import type { CSSProperties, ReactNode } from 'react';

import { useHoldClock } from '../_lib/useHoldClock';

/** A SCREEN THAT IS ITS OWN CLOCK: one sentence, and the colour rising
 *  behind it is how long is left.
 *
 *  WHICH SCREENS GET THIS, and it is a line worth holding: only the ones
 *  with NO camera preview. The attempt intro and the cover-prep beat are
 *  both a single instruction on an otherwise empty screen, so the screen
 *  itself is free to become the clock. Every screen that shows a live
 *  preview counts with a number instead — colour moving behind the
 *  picture an athlete is trying to frame competes with the picture, which
 *  is why the three camera holds went back to .oc-solve-hold-n.
 *
 *  ONE ARGUMENT, TWO EFFECTS. `seconds` arms useHoldClock's timeout AND
 *  sets the fill's animation-duration, so there is no second place to put
 *  a duration and the sweep cannot outlast the screen or stop short of
 *  it. The timeout is the clock; the fill is a picture of it. */
export function useScreenFill(
  seconds: number,
  /** Called once, when the time runs out. Both screens that use this
   *  advance themselves — neither asks the athlete for anything. */
  onElapsed: () => void,
): ReactNode {
  useHoldClock(seconds, onElapsed);

  return (
    <>
      <div
        className="oc-solve-fill"
        style={
          {
            '--oc-fill-duration': `${seconds}s`,
            '--oc-fill-steps': seconds,
          } as CSSProperties
        }
        aria-hidden
      />
      {/* The fill says how long this lasts to everyone who can see it and
          to nobody else. Stated once, not counted down: a live region
          ticking once a second would be unusable. */}
      <span className="oc-sr-only">{seconds} секунд хүлээнэ үү.</span>
    </>
  );
}
