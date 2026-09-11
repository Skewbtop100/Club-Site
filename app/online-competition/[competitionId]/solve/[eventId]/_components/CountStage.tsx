'use client';

import { useEffect, useState } from 'react';

/** "count" — WCA's fifteen seconds of inspection, counted for real.
 *
 *  THE ONE CLOCK THAT OWNS THE INSPECTION. The mockup also puts an
 *  inspection panel inside `rec` — АЖИГЛАХ ХУГАЦАА, fifteen ticks, a
 *  "/ 15" counter — and that is deliberately not built: a second readout
 *  of the same fifteen seconds is a second clock, and two clocks for one
 *  rule is how they come to disagree. Inspection ends when this stage
 *  does; nothing after it counts inspection.
 *
 *  IT WRITES NO PENALTY, and nothing about it can. WCA gives +2 past
 *  fifteen seconds and a DNF past seventeen, and this platform CAN carry
 *  both — `penalty: '+2' | 'DNF'` is a stored field, the review route
 *  sets it, and effectiveAttemptTime applies it ahead of the time limit
 *  for every scorer. But it is a JUDGE'S field: firestore.rules pins
 *  `penalty == null` on create and gives athletes no update at all. So
 *  this countdown is not a referee and does not pretend to be one — it
 *  ENDS the window rather than penalising an overrun, which is the one
 *  thing a client clock can honestly do. An athlete who inspects past the
 *  flash does it on camera, and the judge's existing +2 is what answers
 *  that.
 *
 *  IT DOES NOT TOUCH THE RECORDING. The camera has been running since the
 *  opening hold and films the athlete throughout — so what a judge sees
 *  is the cover coming off, the inspection, and the first turn. They do
 *  NOT see this number: the recording is of the cube, not of the screen. */
export default function CountStage({
  seconds,
  videoRef,
  onDone,
}: {
  seconds: number;
  videoRef: (el: HTMLVideoElement | null) => void;
  /** Reached two ways, and they are the same door: the count running out,
   *  or the athlete saying they are ready before it does. */
  onDone: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const interval = setInterval(() => setRemaining((r) => Math.max(r - 1, 0)), 1000);
    const t = setTimeout(onDone, seconds * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-count">
      <span className="oc-solve-count-label">АЖИГЛАХ ХУГАЦАА</span>
      <span className="oc-solve-count-n">{remaining}</span>
      <div className="oc-solve-count-cam">
        <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
      </div>
      {/* NOT IN THE MOCKUP, and here on purpose. WCA inspection is UP TO
          fifteen seconds, not exactly fifteen: an athlete who has planned
          their solve at six has to be able to go at six. Without this the
          platform would make every athlete hold a finished plan for the
          rest of the count, which is a real cost and not one the rules
          ask them to pay. It can only ever SHORTEN the window, so there
          is nothing here to exploit. */}
      <button type="button" className="oc-solve-count-go" onClick={onDone}>
        Ажиглаж дууслаа
      </button>
    </div>
  );
}
