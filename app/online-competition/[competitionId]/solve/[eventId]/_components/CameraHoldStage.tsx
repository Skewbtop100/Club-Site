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
 *  EVERY HOLD ENDS ON A BUTTON NOW, and so there is no `end` prop left
 *  to say so. It used to default to 'auto' and the timer check was the
 *  only one that opted out; once the two closing holds opted out as well
 *  there was nothing on the other side of the branch, and a flag with one
 *  reachable value is a flag that lies about having a choice. The button
 *  label is a required prop instead, because a hold that cannot advance
 *  itself MUST name its way out — a missing label would be a dead end,
 *  and a required prop makes that a type error rather than a run that
 *  strands an athlete on a screen with no exit.
 *
 *  THE COUNT SITS IN THE BUTTON'S SLOT, at the bottom, and the button
 *  replaces it there when the time is up. One element becomes the other
 *  in one place, so "the wait is over" is a single change in a spot the
 *  athlete is already watching rather than a number going quiet at the
 *  top while something lights up at the bottom. It also gives the preview
 *  the height the count was using, which is the thing the athlete is
 *  actually looking at.
 *
 *  That is also why `layout` is gone: with the count at the bottom, the
 *  only thing left above the preview is the instruction, so
 *  "instruction-first" had nothing left to choose. */
export default function CameraHoldStage({
  seconds,
  label,
  instruction,
  footnote,
  endLabel,
  videoRef,
  onElapsed,
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
  /** What the button says when the count runs out, and REQUIRED: no
   *  hold advances itself any more, so this is the only way off the
   *  screen. Every one of them asks the athlete to do something physical
   *  between the hold and the next screen — put the timer down, pick the
   *  cube up, put the cube down — and advancing on its own started the
   *  next screen while their hands were still full. */
  endLabel: string;
  videoRef: (el: HTMLVideoElement | null) => void;
  /** Fired ONCE when the seconds run out — not when the athlete presses.
   *  Separate from onDone precisely because the two are no longer the
   *  same moment: this marks the end of the WAIT, onDone the end of the
   *  SCREEN, and the gap between them is however long the athlete takes.
   *  Used for the cube check's tone, which has to sound at zero rather
   *  than when someone gets round to pressing. */
  onElapsed?: () => void;
  onDone: () => void;
}) {
  // NOTHING BUT THE PRESS ADVANCES A HOLD. useHoldClock gets onElapsed,
  // never onDone, so no timer can move the run on behind the button —
  // `done` only decides whether the button is on screen to be pressed.
  const { remaining, done } = useHoldClock(seconds, onElapsed);

  const count = (
    <div className="oc-solve-hold-count">
      <span className="oc-solve-hold-rule" aria-hidden />
      <span className="oc-solve-hold-n">{remaining}</span>
      <span className="oc-solve-hold-unit">СЕКУНД</span>
    </div>
  );

  return (
    <div className="oc-solve-hold">
      {/* THE INSTRUCTION LEADS, and it is the only thing above the
          preview: the clock lives at the bottom on every hold now. */}
      <p className="oc-solve-hold-say">{instruction(seconds)}</p>

      {/* THE COUNT'S OLD HEIGHT IS THE PREVIEW'S. Every hold moved its
          clock into the button's slot, so every hold has that height
          going spare, and the preview is what the athlete is actually
          looking at — which is why the taller box is no longer a
          modifier class that one hold opted into. */}
      <div className="oc-solve-hold-cam">
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
      <div className="oc-solve-hold-slot">
        {done ? (
          <button type="button" className="oc-solve-hold-go" onClick={onDone}>
            {endLabel}
          </button>
        ) : (
          count
        )}
      </div>
    </div>
  );
}
