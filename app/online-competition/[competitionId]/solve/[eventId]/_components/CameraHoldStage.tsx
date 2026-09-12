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
 *  ONE COUNTDOWN, NOT TWO. The tick bar is gone and the mockup's
 *  countdown number has taken its place on all three holds — the same
 *  50px volt count and the same СЕКУНД wherever an athlete is held in
 *  front of the camera. `seconds` drives the timeout, the number and the
 *  sentence, so none of the holds can disagree with the others about how
 *  long it lasted. That is the part that must stay singular, because the
 *  count is what a judge measures the hold against.
 *
 *  `layout` and `end` vary AROUND that count, and only they do. The timer
 *  check before an attempt leads with its instruction and ends on a
 *  button; the closing hold leads with the count and advances itself.
 *  They are passed explicitly rather than inferred from `label`, so a
 *  call site says which it is instead of a reader having to work it
 *  out. */
export default function CameraHoldStage({
  seconds,
  label,
  instruction,
  footnote,
  layout = 'count-first',
  end = 'auto',
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
  /** What happens when the count reaches zero. The mockup's volt line.
   *  Null where the next screen speaks for itself — the timer check ends
   *  on a button that names where it goes, which said the same thing
   *  twice. */
  footnote: string | null;
  /** Which block leads.
   *  'count-first'       — the count, then the instruction (the closing hold).
   *  'instruction-first' — the instruction, then the count. For the timer
   *                        check, where the sentence is the task and the
   *                        count is how long it lasts; leading with the
   *                        number asked the athlete to read the clock
   *                        before they knew what it was for. */
  layout?: 'count-first' | 'instruction-first';
  /** How the hold ends.
   *  'auto'    — advances itself the instant the count reaches zero.
   *  { label } — shows that button and WAITS. Used where the athlete has
   *              something physical to do between the hold and the next
   *              screen (put the timer down, pick up the cube); advancing
   *              on its own started the scramble appearing while their
   *              hands were still full. */
  end?: 'auto' | { label: string };
  videoRef: (el: HTMLVideoElement | null) => void;
  onDone: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);
  const waitsForPress = end !== 'auto';

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((r) => Math.max(r - 1, 0));
    }, 1000);
    // Only an auto hold advances itself. A hold that ends on a button
    // must not also have a timeout racing the press.
    const t = waitsForPress ? null : setTimeout(onDone, seconds * 1000);
    return () => {
      clearInterval(interval);
      if (t !== null) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = (
    <div className="oc-solve-hold-count">
      <span className="oc-solve-hold-rule" aria-hidden />
      <span className="oc-solve-hold-n">{remaining}</span>
      <span className="oc-solve-hold-unit">СЕКУНД</span>
    </div>
  );
  const say = <p className="oc-solve-hold-say">{instruction(seconds)}</p>;

  return (
    <div className="oc-solve-hold">
      {layout === 'instruction-first' ? say : count}
      {layout === 'instruction-first' ? count : say}

      <div className="oc-solve-hold-cam">
        <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
        <span className="oc-solve-hold-caption">{label}</span>
        <span className="oc-solve-hold-corner oc-solve-hold-corner-tl" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-tr" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-bl" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-br" aria-hidden />
      </div>

      {footnote !== null && <p className="oc-solve-hold-next">{footnote}</p>}

      {/* THE HOLD IS EVIDENCE. The button cannot be pressed before the
          count reaches zero, because the seconds in front of the camera
          are the thing a judge measures — a hold the athlete could cut
          short is not a hold.
          Gated on the DISPLAYED number rather than on a second timer of
          its own, so the athlete is never told to wait by a clock they
          cannot see. A backgrounded tab throttles the interval, which
          makes the button enable LATE rather than early: the safe
          direction, and the only one worth failing in. */}
      {end !== 'auto' && (
        <button
          type="button"
          className="oc-solve-hold-go"
          disabled={remaining > 0}
          onClick={onDone}
        >
          {end.label}
        </button>
      )}
    </div>
  );
}
