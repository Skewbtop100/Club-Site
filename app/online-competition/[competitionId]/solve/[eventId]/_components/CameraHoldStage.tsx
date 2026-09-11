'use client';

import { useEffect, useState } from 'react';

/** "Hold something still in front of the camera for N seconds."
 *
 *  Parameterised from OrientationHoldStage, which was one hard-coded
 *  instance of it: the same preview, the same instruction slot, the same
 *  clock. The solve flow has more than one such hold — the cube in a
 *  known orientation before the solve, the athlete's own timer before and
 *  after it — and three copies of this timer would drift apart. The timer
 *  is the thing a judge measures the hold against, so there is exactly
 *  one of it.
 *
 *  IT DOES NOT TOUCH THE RECORDING. Recording runs continuously across
 *  these stages; this component starts and stops nothing. Its only effect
 *  is the clock that calls onDone.
 *
 *  ONE PRESENTATION, NOT TWO. The tick bar is gone and the mockup's
 *  countdown number has taken its place on all three holds. The mockup
 *  uses that number wherever it holds an athlete in front of the camera —
 *  zero, cover and verify all show the same 50px volt count and the same
 *  СЕКУНД — and a second presentation for the other two holds would make
 *  them read as different kinds of thing, which is exactly what they are
 *  not. `seconds` still drives the timeout, the number and the sentence,
 *  so none of the three can disagree with the other two. */
export default function CameraHoldStage({
  seconds,
  label,
  instruction,
  footnote,
  videoRef,
  onDone,
}: {
  /** How long to hold, in whole seconds. Also what the countdown starts
   *  from, so the number IS the clock rather than a separate animation
   *  of it. */
  seconds: number;
  /** WHICH hold this is, in the mockup's in-frame caption slot. The three
   *  holds are distinguished by nothing else. */
  label: string;
  /** The dominant line: what to hold, how, and for how long — BUILT FROM
   *  `seconds`, not written beside it.
   *
   *  Every instruction here names the duration ("...8 секунд барина уу"),
   *  which made the number two facts in two places: a hold whose timer
   *  said 8 and whose sentence said 5 would be wrong in the way nobody
   *  checks. Taking the number as an argument means the sentence can only
   *  say what the timer does. */
  instruction: (seconds: number) => string;
  /** What happens when the count reaches zero. The mockup's volt line. */
  footnote: string;
  videoRef: (el: HTMLVideoElement | null) => void;
  onDone: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((r) => Math.max(r - 1, 0));
    }, 1000);
    const t = setTimeout(onDone, seconds * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-hold">
      <div className="oc-solve-hold-count">
        <span className="oc-solve-hold-rule" aria-hidden />
        <span className="oc-solve-hold-n">{remaining}</span>
        <span className="oc-solve-hold-unit">СЕКУНД</span>
      </div>

      <p className="oc-solve-hold-say">{instruction(seconds)}</p>

      <div className="oc-solve-hold-cam">
        <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
        <span className="oc-solve-hold-caption">{label}</span>
        <span className="oc-solve-hold-corner oc-solve-hold-corner-tl" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-tr" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-bl" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-br" aria-hidden />
      </div>

      <p className="oc-solve-hold-next">{footnote}</p>
    </div>
  );
}
