'use client';

import { useHoldFill } from './HoldFill';

/** The face colours the mockup names. Not the site palette — these are a
 *  cube's stickers, and a judge reads the video against them. */
const WHITE = '#F4F1EA';
const GREEN = '#00FF55';

function Face({ colour, label }: { colour: string; label: string }) {
  return (
    <div className="oc-solve-cover-face">
      <div className="oc-solve-cover-grid" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} style={{ background: colour }} />
        ))}
      </div>
      <span className="oc-solve-cover-face-label">{label}</span>
    </div>
  );
}

/** "cover" — the cube goes under its cover, in a known orientation.
 *
 *  TAKES OVER orientationHold's eight seconds and its job: the cube held
 *  still, white up and green to camera, long enough for a judge to read
 *  the orientation off the video. It adds the thing that makes the
 *  inspection measurable — the cube ends up HIDDEN, so the moment the
 *  cover comes off is a visible mark on the recording. An inspection
 *  window with no visible start cannot be audited at all.
 *
 *  SINGLE PHASE. The mockup's cover is two: a countdown, then a БЭЛЭН
 *  button that goes live when the countdown ends. That second phase is
 *  `ready`, which follows this stage — same badge shape, same single volt
 *  button — so building both would put two go-aheads on two consecutive
 *  screens. The button stays on ready.
 *
 *  IT DOES NOT TOUCH THE RECORDING. Recording has been running since the
 *  opening hold and runs through this; the only effect here is the clock
 *  that calls onDone.
 *
 *  NO PREVIEW, per the mockup: the screen is two colour diagrams and the
 *  athlete is looking at their cube, not at the page. `count`, two
 *  screens later, brings the preview back. */
export default function CoverStage({
  seconds,
  onDone,
}: {
  /** The SAME hold duration as the two timer holds — this stage replaced
   *  one of the three and did not shorten it. Through useHoldFill it sets
   *  the timeout and the fill together, so the picture of the clock and
   *  the clock itself cannot disagree. */
  seconds: number;
  onDone: () => void;
}) {
  // The same clock every other hold uses. This stage kept its own copy of
  // the countdown, which is exactly how two holds come to disagree about
  // how long a hold is. It still advances itself: nothing in the
  // athlete's hands has to change here, and the note below already says
  // what the end leads to.
  const { fill } = useHoldFill(seconds, onDone);

  return (
    <div className="oc-solve-cover">
      {fill}

      <p className="oc-solve-cover-say">
        Шоогоо ковертоо нуугаад <span style={{ color: GREEN }}>ногоон</span> төвийг камер тал руу,{' '}
        <span style={{ color: WHITE }}>цагаан</span> төвийг дээш харуулж тавиарай.
      </p>

      <div className="oc-solve-cover-faces">
        <Face colour={WHITE} label="ДЭЭД ТАЛД" />
        <Face colour={GREEN} label="КАМЕР РУУ" />
      </div>

      <p className="oc-solve-cover-note">
        Хугацаа дуусаад ажиглах хугацаа эхэлнэ. Ковероо тэр үед нь авна.
      </p>
    </div>
  );
}
