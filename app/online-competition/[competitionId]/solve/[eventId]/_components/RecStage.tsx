'use client';

/** The mockup's `rec`: the recording flag, the preview, and the button
 *  that ends the solve.
 *
 *  NO STATE AT ALL, and that is the point of it. It used to run three
 *  timers that walked the preview's border from neutral through two dim
 *  ambers to a dim red at 8, 12 and 15 seconds — an aid for an athlete
 *  counting WCA inspection by feel. Inspection is now a stage of its own
 *  with a fifteen-second countdown on it, before this screen exists; the
 *  markers were left counting from the start of the SOLVE, which was
 *  never inspection, and the only thing they could still suggest to an
 *  athlete mid-solve was that some rule was running that is not.
 *
 *  The mockup's inspection panel — АЖИГЛАХ ХУГАЦАА, fifteen ticks, a
 *  "/ 15" — is absent for the same reason and one more: it would be a
 *  second clock for the fifteen seconds `count` already owns.
 *
 *  It starts and stops no recording. The clip has been running since the
 *  opening hold and runs on through the closing one. */
export default function RecStage({
  videoRef,
  onFinish,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onFinish: () => void;
}) {
  return (
    <div className="oc-solve-rec">
      <div className="oc-solve-rec-flag">
        <span className="oc-solve-rec-dot" aria-hidden />
        <span className="oc-solve-rec-flag-text">БИЧИЖ БАЙНА</span>
      </div>

      <div className="oc-solve-rec-box">
        <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
        <span className="oc-solve-rec-caption">КАМЕР</span>
      </div>

      <button type="button" className="oc-solve-btn-finish" onClick={onFinish}>
        Эвлүүлэлт дууссан
      </button>

      <p className="oc-solve-rec-note">
        Дэлгэц дээр цаг харагдахгүй. Эвлүүлж дуусаад товч дээр дарж цагаа бичиж оруулна.
      </p>
    </div>
  );
}
