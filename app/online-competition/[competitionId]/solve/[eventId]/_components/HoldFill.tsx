'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/** THE CLOCK AND ITS PICTURE, returned together from one call.
 *
 *  Every hold in the run is "stay still in front of the camera for N
 *  seconds, then something happens". There are three of them — the timer
 *  check, the cover, the closing hold — and until now each carried its
 *  own setInterval counting a number down. The number is gone; the time
 *  is shown as the screen filling with colour instead.
 *
 *  WHY THE TWO ARE ONE FUNCTION. `seconds` sets the timeout AND the
 *  fill's animation-duration, and the only way to be sure a hold cannot
 *  show an eight-second sweep over a five-second wait is for there to be
 *  no second place to pass a duration to. A caller gets `done` and `fill`
 *  from one argument or neither.
 *
 *  THE TIMEOUT IS THE CLOCK; THE FILL IS A PICTURE OF IT. `done` is what
 *  gates the button on the timer check, and it flips on a real-time
 *  setTimeout, never on an animation event. They can only ever disagree
 *  in one direction — a backgrounded tab throttles the timeout, so the
 *  button arrives late rather than early — and late is the only direction
 *  worth failing in for something a judge measures.
 *
 *  IT IS BEHIND EVERYTHING, never over the video. The fill paints at
 *  z-index -1 inside the solve body, so on the holds that show a camera
 *  preview it fills the space around an opaque box and never tints the
 *  picture the athlete is being asked to check. See .oc-solve-fill. */
export function useHoldFill(
  seconds: number,
  /** Called once, when the time runs out. The auto-advancing holds pass
   *  their onDone; the one that ends on a button passes nothing and reads
   *  `done` instead. */
  onElapsed?: () => void,
): { done: boolean; fill: ReactNode } {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDone(true);
      onElapsed?.();
    }, seconds * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    done,
    /* GONE at zero, not parked at full. A hold that ends leaves no trace
       of its clock: on the timer check the fill vanishing and the button
       lighting are one change at one moment, which is what makes "ready"
       legible as an event rather than as a number that stopped moving.
       On the two auto holds the same instant is the stage changing. */
    fill: done ? null : (
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
        {/* The number was also the only text saying how long this lasts.
            A fill says it to everyone who can see it and to nobody else,
            so the sentence stays, unseen. Stated once, not counted down:
            a live region ticking once a second would be unusable. */}
        <span className="oc-sr-only">{seconds} секунд хүлээнэ үү.</span>
      </>
    ),
  };
}
