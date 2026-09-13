'use client';

import { useHoldClock } from '../_lib/useHoldClock';

/** The face colours the mockup names. Not the site palette — these are a
 *  cube's stickers, and a judge reads the video against them.
 *
 *  They tint the two colour words in the instruction, which is all that is
 *  left of the two 78px sticker diagrams this screen used to carry. The
 *  diagrams said which face goes where; the video below says what the hand
 *  does, which is the part a beginner gets wrong, and it says the face
 *  positions too. Two 9-square grids restating a video is the same fact
 *  three times on one screen — and their 134px was the only thing keeping
 *  that video small enough to fit a short phone. */
const WHITE = '#F4F1EA';
const GREEN = '#00FF55';

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
 *  NO CAMERA PREVIEW, per the mockup: the athlete is looking at their
 *  cube, not at the page. The solve screen brings the camera back.
 *
 *  THE ONE <video> ON THIS SCREEN IS A FILE, NOT A CAMERA, and that
 *  distinction is the whole of its safety. It plays /cube-cover.mp4 from
 *  `src`; it never receives `srcObject`, never touches the recorder's
 *  videoRef, and calls no getUserMedia. Playing a file opens no capture
 *  device, so it cannot compete for the camera the run is already
 *  recording from — and MediaRecorder reads the camera TRACK, never a
 *  <video> element, so nothing here can reach the clip either. This
 *  stage still starts and stops no recording. */
export default function CoverStage({
  seconds,
  onDone,
}: {
  /** The SAME hold duration as the two timer holds — this stage replaced
   *  one of the three and did not shorten it. It goes to useHoldClock,
   *  the run's one clock, so this stage cannot drift from the two timer
   *  holds about how long a hold is. */
  seconds: number;
  onDone: () => void;
}) {
  // The same clock every other hold uses. This stage used to keep its own
  // private copy of the countdown, which is exactly how two holds come to
  // disagree about how long a hold is; that copy is not coming back. It
  // still advances itself: nothing in the athlete's hands has to change
  // here, and the note below already says what the end leads to.
  const { remaining } = useHoldClock(seconds, onDone);

  return (
    <div className="oc-solve-cover">
      <div className="oc-solve-cover-count">
        <span className="oc-solve-cover-n">{remaining}</span>
        <span className="oc-solve-cover-unit">СЕКУНД</span>
      </div>

      {/* The two colour words stay tinted, as they were: they are the
          only thing on the line a judge later reads the video against,
          and the tint is what ties them to the diagrams below. */}
      <p className="oc-solve-cover-say">
        <span style={{ color: GREEN }}>Ногоон</span> төвийг камер руу,{' '}
        <span style={{ color: WHITE }}>цагаан</span> төвийг дээш харуулж, коверт халхлан
        байрлуулна уу.
      </p>

      {/* THE ONE FACT NOTHING ELSE ON THIS SCREEN CARRIES: the deadline,
          and what the end of the count brings.

          It said "Хугацаа дуусгаад коверт шоогоо нуугаарай" — hide your
          cube in the cover — which was a third imperative on a screen
          whose instruction already gives that order and whose video
          already performs it. This is not an instruction at all: it is a
          STATE that has to be true at zero. "аль хэдийн халхлагдсан" —
          already covered — is the whole point, because a cube still on
          its way into the cover when the count ends leaves the clip with
          no visible mark for the inspection to be measured from.

          The verb root recurs, and that is deliberate: it is the deadline
          ON that action, so it has to name it. What does not recur is the
          speech act — an order above, a condition here — nor the
          orientation, nor anything the video shows. */}
      <p className="oc-solve-cover-note">
        Хугацаа дуусахад шоо аль хэдийн халхлагдсан байх ёстой — дараа нь ажиглалтаа
        эхлүүлнэ.
      </p>

      {/* THE SAME INSTRUCTION, PERFORMED. A still diagram says which face
          goes where; this says what the hand does, which is the part a
          first-time athlete gets wrong.

          playsInline AND muted are both required and both set. Without
          playsInline iOS Safari takes a playing <video> fullscreen, which
          would cover the run mid-attempt; without muted the browser
          blocks autoplay outright and the athlete gets a still frame.
          The file itself carries no audio track, so muted costs nothing.

          aria-hidden: it is a silent loop demonstrating exactly what the
          sentence above already says. A screen reader that announced it
          would be repeating the instruction as an unlabelled video. */}
      <video
        className="oc-solve-cover-demo"
        src="/cube-cover.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden
      />
    </div>
  );
}
