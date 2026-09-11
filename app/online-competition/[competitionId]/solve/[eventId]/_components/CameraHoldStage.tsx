'use client';

import { useEffect, useState } from 'react';

/** "Hold something still in front of the camera for N seconds."
 *
 *  Parameterised from OrientationHoldStage, which was one hard-coded
 *  instance of it: the same preview, the same instruction slot, the same
 *  one-segment-per-second tick bar. The solve flow has more than one such
 *  hold — the cube in a known orientation before the solve, the athlete's
 *  own timer before and after it — and three copies of this timer would
 *  drift apart. The timer is the thing a judge measures the hold against,
 *  so there is exactly one of it.
 *
 *  IT DOES NOT TOUCH THE RECORDING. Recording runs continuously across
 *  these stages; this component starts and stops nothing. Its only effect
 *  is the clock that calls onDone.
 *
 *  The tick bar is the progress indicator rather than a countdown number,
 *  deliberately: the instruction is what the athlete has to read, and a
 *  large number beside it competes for the same attention. It is also the
 *  clock — one segment per second, from the same `seconds` that sets the
 *  timeout and the sentence. */
export default function CameraHoldStage({
  seconds,
  label,
  instruction,
  videoRef,
  onDone,
}: {
  /** How long to hold, in whole seconds. Also the number of segments in
   *  the tick bar — one per second, so the bar IS the clock rather than a
   *  separate animation of it. */
  seconds: number;
  /** The small mono eyebrow above the preview. */
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
  videoRef: (el: HTMLVideoElement | null) => void;
  onDone: () => void;
}) {
  const [ticksFilled, setTicksFilled] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTicksFilled((t) => Math.min(t + 1, seconds));
    }, 1000);
    const t = setTimeout(onDone, seconds * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-go">
      <div>
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
          {label}
        </p>
        <div className="oc-solve-camera-box" style={{ marginTop: 10 }}>
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <span className="oc-solve-corner oc-solve-corner-tl" aria-hidden />
          <span className="oc-solve-corner oc-solve-corner-br" aria-hidden />
        </div>
      </div>

      <div>
        <p
          style={{
            font: '600 17px var(--oc-font-heading), sans-serif',
            color: '#F4F1EA',
            textAlign: 'center',
            lineHeight: 1.45,
          }}
        >
          {instruction(seconds)}
        </p>
        <div className="oc-solve-chunk-bar-track" style={{ marginTop: 14, justifyContent: 'center' }}>
          {Array.from({ length: seconds }).map((_, i) => (
            <span key={i} className={`oc-solve-chunk-bar${i < ticksFilled ? ' oc-solve-chunk-bar-filled' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
