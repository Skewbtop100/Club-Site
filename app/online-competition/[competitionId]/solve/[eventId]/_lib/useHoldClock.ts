'use client';

import { useEffect, useState } from 'react';

/** THE ONE CLOCK every timed screen in the run is measured by.
 *
 *  Four screens wait: the attempt intro, the timer check, the cover and
 *  the closing hold. Each used to count itself down with its own
 *  setInterval, which is how two holds come to disagree about how long a
 *  hold is — and the hold is the thing a judge measures.
 *
 *  IT REPORTS THE TIME, NOT A PICTURE OF IT. It returns numbers and lets
 *  each screen decide what to draw. The three camera holds draw the
 *  counting number; the intro, which has no preview to keep clear, draws
 *  a colour filling the screen. A hook that returned the picture as well
 *  would have to carry both, and one of them would be dead weight on
 *  every screen that did not use it.
 *
 *  TWO VALUES, AND THEY ARE NOT THE SAME THING:
 *
 *  `remaining` is for DISPLAY — a whole number ticking down once a
 *  second, which is what an athlete reads.
 *
 *  `done` is the DECISION, and it flips on a single real-time timeout
 *  rather than on the tick count reaching zero. It is what gates the
 *  timer check's ХОЛИЛТ ХАРАХ button, and the distinction matters
 *  because an interval that is throttled or that drifts would otherwise
 *  be able to open a gate early. A timeout can only fire late — a
 *  backgrounded tab delays it — and late is the only direction worth
 *  failing in for something that is evidence. */
export function useHoldClock(
  seconds: number,
  /** Called once, when the time runs out. The screens that advance
   *  themselves pass their onDone; the one that waits for a press passes
   *  nothing and reads `done` instead, so nothing can advance it behind
   *  the button. */
  onElapsed?: () => void,
): { remaining: number; done: boolean } {
  const [remaining, setRemaining] = useState(seconds);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setRemaining((r) => Math.max(r - 1, 0)), 1000);
    const t = setTimeout(() => {
      setDone(true);
      onElapsed?.();
    }, seconds * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { remaining, done };
}
