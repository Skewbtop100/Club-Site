'use client';

/** "readyPrompt" — the mockup's `ready`: a full-bleed confirmation with
 *  one button on it.
 *
 *  A STAGE AFTER, NOT A SKIP. The mockup names its handler `skipZero`,
 *  which reads as a button shown DURING the hold that cuts it short. It
 *  is not built that way here and must not be: the hold is eight seconds
 *  of video a judge measures — the timer at 0.00, the cube in a known
 *  orientation — and an athlete who can end it early can hand in a hold
 *  too short to read. This renders only once the hold before it has run
 *  its full length, and clicking it starts the solve.
 *
 *  NO PREVIEW. The mockup's ready is a full-bleed moment, and the stage
 *  immediately before it is a camera hold whose whole job is framing. A
 *  second framing check here would be the third preview in a row.
 *
 *  WHAT THIS SCREEN NO LONGER SAYS. It carried a lead — "press the
 *  button, take the cover off, fifteen seconds of inspection start, begin
 *  solving before they run out" — and that was the run's ONLY statement
 *  that the fifteen seconds exist, that they are inspection, and that the
 *  cube comes out from under its cover. The screen after it shows a
 *  counter running 1 -> 15 with nothing naming it. That is a real gap and
 *  it is recorded here rather than quietly patched: nothing was added
 *  anywhere else to cover it.
 *
 *  Recording has been running continuously since zeroDisplay; this stage
 *  starts and stops nothing. */
export default function ReadyPromptStage({ onDone }: { onDone: () => void }) {
  return (
    <div className="oc-solve-ready">
      <div className="oc-solve-ready-badge">
        <span className="oc-solve-ready-check" aria-hidden>
          ✓
        </span>
        {/* WHAT THIS SCREEN CONFIRMS is the scramble, not the timer.
            It said "ЦАГ ШАЛГАГДЛАА" — the timer has been checked — which
            was true but long past: the timer check is four screens and
            about a minute back, before the scramble was even fetched.
            What has just finished, and what the athlete is being asked to
            confirm before inspection starts, is the scramble: every chunk
            shown and applied, the cube under its cover. */}
        <span className="oc-solve-ready-badge-text">ХОЛИЛТ ХИЙГДЛЭЭ</span>
      </div>

      {/* THE HEADING CARRIES THE WHOLE SCREEN NOW, and it names the two
          things the athlete does in order: hide the cube under its cover,
          then start solving when ready. The lead that used to sit under
          it is gone — see the note at the top of this file for what went
          with it. */}
      <p className="oc-solve-ready-title">
        Шоогоо коверт нуугаад бэлэн болмогц эвлүүлэлтээ эхлээрэй
      </p>

      {/* Sentence case in the source; .oc-solve-ready-go uppercases it.
          It says ЭВЛҮҮЛЭЛТЭЭ, not АЖИГЛАЛТАА — the button and the heading
          now name the same act. */}
      <button type="button" className="oc-solve-ready-go" onClick={onDone}>
        Эвлүүлэлтээ эхлүүлэх
      </button>
    </div>
  );
}
