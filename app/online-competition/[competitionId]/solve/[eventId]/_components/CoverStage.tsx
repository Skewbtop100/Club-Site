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
 *  THREE BANDS, STACKED. The athlete's own camera across the top, the
 *  sentence under it, and the demonstration filling everything below.
 *  Side by side, each frame got half a phone's width; stacked, each gets
 *  all of it — and the two are doing different jobs at different moments
 *  anyway. The live band is where they check their own shot; the
 *  demonstration is where they look to see how it goes.
 *
 *  EACH BAND CROPS TOWARD ITS OWN SUBJECT, and the two crops point
 *  different ways on purpose — see .oc-solve-cover-live and
 *  .oc-solve-cover-demo for what each keeps and what it gives up.
 *
 *  NEITHER <video> CAN REACH THE RECORDING, for two different reasons.
 *  The left one plays a FILE from `src`: it never receives `srcObject`,
 *  never touches the recorder's videoRef, and calls no getUserMedia, so
 *  it opens no capture device and cannot compete for the camera. The
 *  right one is handed the recorder's OWN callback ref — the same one
 *  every other preview in the run uses — so it attaches the stream that
 *  already exists rather than asking for a second one. And MediaRecorder
 *  reads the camera TRACK, never a <video> element, so neither of them
 *  can alter the clip. This stage still starts and stops no recording. */
export default function CoverStage({
  seconds,
  videoRef,
  onDone,
}: {
  /** The SAME hold duration as the two timer holds — this stage replaced
   *  one of the three and did not shorten it. It goes to useHoldClock,
   *  the run's one clock, so this stage cannot drift from the two timer
   *  holds about how long a hold is. */
  seconds: number;
  /** The recorder's own callback ref, exactly as the holds get it. NOT a
   *  second getUserMedia: it attaches the stream the run has been
   *  recording from since the opening hold. */
  videoRef: (el: HTMLVideoElement | null) => void;
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
      {/* THE ATHLETE'S OWN SHOT, across the top. The only element on this
          screen holding the recorder's ref. */}
      <div className="oc-solve-cover-band">
        <video ref={videoRef} className="oc-solve-cover-live" autoPlay playsInline muted />
      </div>

      {/* The two colour words stay tinted, as they were: they are the
          only thing on the line a judge later reads the video against,
          and the tint is what ties them to the diagrams below. */}
      <p className="oc-solve-cover-say">
        <span style={{ color: GREEN }}>Ногоон</span> төвийг камер руу,{' '}
        <span style={{ color: WHITE }}>цагаан</span> төвийг дээш харуулж, коверт халхлан
        байрлуулна уу.
      </p>


      {/* THE DEMONSTRATION, filling everything under the sentence, with
          the count laid into the corner of it.

          WHY THE CORNER. That frame's bottom right is the emptiest part
          of either picture — the subject is stacked up the middle — so
          the count costs nothing there, and it stops being a band of its
          own that the two videos have to share height with.

          playsInline AND muted are both required on it: without
          playsInline iOS Safari takes a playing <video> fullscreen and
          covers the run mid-attempt, and without muted the browser blocks
          autoplay outright and the athlete gets a still frame. The file
          carries no audio track, so muted costs nothing. */}
      <div className="oc-solve-cover-band oc-solve-cover-band-demo">
        <video
          className="oc-solve-cover-demo"
          src="/cube-cover.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden
        />
        <div className="oc-solve-cover-count">
          <span className="oc-solve-cover-n">{remaining}</span>
          <span className="oc-solve-cover-unit">СЕКУНД</span>
        </div>
      </div>
    </div>
  );
}
