'use client';

import { useHoldFill } from './HoldFill';

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
 *  ONE COUNTDOWN, NOT TWO — now useHoldFill, shared with the cover. The
 *  counting number is gone from all three holds and the time shows as the
 *  screen filling with colour instead; `seconds` drives the timeout, the
 *  fill and the sentence, so no hold can disagree with another about how
 *  long it lasted. That is the part that must stay singular, because the
 *  hold is what a judge measures.
 *
 *  Losing the number also removed the only thing `layout` ordered. There
 *  is no count block in the column any more, so there is nothing to put
 *  before or after the instruction, and the prop went with it.
 *
 *  `end` still varies: the timer check before an attempt waits for a
 *  press, the closing hold advances itself. It is passed explicitly
 *  rather than inferred from `label`, so a call site says which it is
 *  instead of a reader having to work it out. */
export default function CameraHoldStage({
  seconds,
  label,
  instruction,
  footnote,
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
  const waitsForPress = end !== 'auto';
  // Only an auto hold advances itself. A hold that ends on a button gets
  // no onElapsed at all, so nothing races the press.
  const { done, fill } = useHoldFill(seconds, waitsForPress ? undefined : onDone);

  return (
    <div className="oc-solve-hold">
      {fill}
      <p className="oc-solve-hold-say">{instruction(seconds)}</p>

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
          time runs out, because the seconds in front of the camera are
          the thing a judge measures — a hold the athlete could cut short
          is not a hold.
          Gated on useHoldFill's `done`, the same real-time timeout that
          drives the fill, so the button and the picture of the clock
          cannot disagree about when the hold ended. A backgrounded tab
          throttles that timeout, which makes the button arrive LATE
          rather than early: the safe direction, and the only one worth
          failing in. */}
      {end !== 'auto' && (
        <button
          type="button"
          className="oc-solve-hold-go"
          disabled={!done}
          onClick={onDone}
        >
          {end.label}
        </button>
      )}
    </div>
  );
}
