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
 *  Recording has been running continuously since zeroDisplay; this stage
 *  starts and stops nothing. */
export default function ReadyPromptStage({ onDone }: { onDone: () => void }) {
  return (
    <div className="oc-solve-ready">
      <div className="oc-solve-ready-badge">
        <span className="oc-solve-ready-check" aria-hidden>
          ✓
        </span>
        {/* True at this point and not before it: the opening hold showed
            the athlete's own timer reading 0.00 to the camera. */}
        <span className="oc-solve-ready-badge-text">ЦАГ ШАЛГАГДЛАА</span>
      </div>

      {/* The mockup's ready sits between the countdown and the scramble,
          so its words are about bringing the scramble out. This one sits
          after the orientation hold, with the scramble already applied —
          the layout is the mockup's, the sentence is about where it
          actually is. */}
      <p className="oc-solve-ready-title">Бэлэн болмогц эвлүүлж эхлээрэй</p>
      <p className="oc-solve-ready-lead">
        Товч дарсны дараа дэлгэц дээр цаг харагдахгүй. Цагаа өөрөө хэмжиж, эвлүүлж дуусаад бичнэ.
      </p>

      <button type="button" className="oc-solve-ready-go" onClick={onDone}>
        Эвлүүлж эхлүүлэх
      </button>
    </div>
  );
}
