'use client';

import { useHoldClock } from '../_lib/useHoldClock';

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
 *  ONE COUNTDOWN, NOT TWO. The mockup's countdown number is what every
 *  camera hold shows — the same 50px volt count and the same СЕКУНД
 *  wherever an athlete is held in front of the camera. `seconds` drives
 *  the timeout, the number and the sentence, so no hold can disagree with
 *  another about how long it lasted. That is the part that must stay
 *  singular, because the hold is what a judge measures.
 *
 *  THE COLOUR FILL IS NOT HERE, and deliberately so. A sweep of colour
 *  belongs to the attempt intro, which is a bare sentence on an empty
 *  screen; these three have a live preview on them, and a screen that
 *  changes colour behind the picture the athlete is trying to frame is
 *  competing with the one thing they are meant to be looking at. Only the
 *  intro uses it, so only the intro carries it — see AttemptIntroStage.
 *  What the three holds share with it is the CLOCK (useHoldClock), not
 *  the presentation.
 *
 *  WHERE THE COUNT SITS FOLLOWS FROM `end`, and there is no separate
 *  prop for it any more.
 *
 *  A hold that ADVANCES ITSELF puts the count at the top: nothing else on
 *  the screen is going to change, so the clock leads.
 *
 *  A hold that ENDS ON A BUTTON puts the count in the button's slot at the
 *  bottom, and the button replaces it there when the time is up. One
 *  element becomes the other in one place, so "the wait is over" is a
 *  single change in a spot the athlete is already watching rather than a
 *  number going quiet at the top while something lights up at the bottom.
 *  It also gives the preview the height the count was using, which is the
 *  thing the athlete is actually looking at.
 *
 *  That is why `layout` is gone: with the count at the bottom, the only
 *  thing left above the preview is the instruction, so "instruction-first"
 *  had nothing left to choose. */
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
  /** How the hold ends. Also decides where the count sits — see the
   *  note at the top of this file.
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
  const { remaining, done } = useHoldClock(seconds, waitsForPress ? undefined : onDone);

  const count = (
    <div className="oc-solve-hold-count">
      <span className="oc-solve-hold-rule" aria-hidden />
      <span className="oc-solve-hold-n">{remaining}</span>
      <span className="oc-solve-hold-unit">СЕКУНД</span>
    </div>
  );

  return (
    <div className="oc-solve-hold">
      {/* An auto hold's clock leads. A button hold's is at the bottom,
          in the slot the button will take. */}
      {!waitsForPress && count}

      <p className="oc-solve-hold-say">{instruction(seconds)}</p>

      {/* TALLER ON THE HOLD THAT MOVED ITS COUNT, and only there: that
          screen has the count's height going spare, and the preview is
          what the athlete is looking at. The other two holds are
          untouched — same box, same 4/3. */}
      <div className={`oc-solve-hold-cam${waitsForPress ? ' oc-solve-hold-cam-tall' : ''}`}>
        <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
        <span className="oc-solve-hold-caption">{label}</span>
        <span className="oc-solve-hold-corner oc-solve-hold-corner-tl" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-tr" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-bl" aria-hidden />
        <span className="oc-solve-hold-corner oc-solve-hold-corner-br" aria-hidden />
      </div>

      {footnote !== null && <p className="oc-solve-hold-next">{footnote}</p>}

      {/* THE SLOT: the clock, and then the way out, in one place.
          THE HOLD IS EVIDENCE, and the gate is unchanged in strength —
          it is STRONGER. The button used to render throughout and lean on
          `disabled={!done}`; now it does not exist until `done`, so there
          is nothing to press early rather than something inert to press.
          Either way the decision is useHoldClock's `done` — a single
          real-time timeout — and NOT the displayed number reaching zero.
          An interval that drifts or is throttled could open a gate early;
          a timeout can only fire late, and late is the only direction
          worth failing in for something a judge measures.
          The slot never empties: before `done` it holds the count, so the
          athlete watches the wait end in the exact spot the way out will
          appear. */}
      {end !== 'auto' && (
        <div className="oc-solve-hold-slot">
          {done ? (
            <button type="button" className="oc-solve-hold-go" onClick={onDone}>
              {end.label}
            </button>
          ) : (
            count
          )}
        </div>
      )}
    </div>
  );
}
