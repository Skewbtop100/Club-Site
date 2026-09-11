'use client';

import { useEffect, useState } from 'react';

/** WCA inspection markers, elapsed since this stage began.
 *
 *  INFORMATIONAL ONLY. Nothing is enforced at 8, 12 or 15 seconds — the
 *  athlete solves at their own pace, and the event's own time limit is
 *  applied later, at the keypad and again at scoring. These exist so an
 *  athlete who counts inspection by feel has something to check against. */
const MARKER_TIMES_MS = [8000, 12000, 15000];

/** The mockup's `rec`, MINUS its inspection panel — the ticks-and-count
 *  strip under the preview belongs with the dedicated `count` stage and
 *  arrives with it. The markers below stay exactly as they were. */
export default function RecStage({
  videoRef,
  onFinish,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onFinish: () => void;
}) {
  /** 0 before the first marker, then 1, 2, 3. Drives nothing but a border
   *  colour. */
  const [marker, setMarker] = useState(0);

  useEffect(() => {
    const timers = MARKER_TIMES_MS.map((ms, i) => setTimeout(() => setMarker(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="oc-solve-rec">
      <div className="oc-solve-rec-flag">
        <span className="oc-solve-rec-dot" aria-hidden />
        <span className="oc-solve-rec-flag-text">БИЧИЖ БАЙНА</span>
      </div>

      {/* THE MARKER IS THE FRAME, and nothing else.
          The athlete is mid-solve: anything they could read is worse
          than nothing, because reading it costs them the solve they are
          reading it during. So it is the one-pixel border of the
          preview they are already looking past — no text, no number, no
          movement, and no layout change at any step. The colour walks
          from the neutral frame through two dim ambers to a dim red over
          an 800ms fade, so it registers as the frame having drifted
          rather than as an event that happened. Same three colours and
          the same fade as before; only the frame they sit on is the
          mockup's 4/3 rather than the old portrait box.

          It is deliberately NOT a sound. The cues were beeps until now;
          useSolveRecorder carries the reason nothing audio-shaped goes
          anywhere near this flow again. */}
      <div className={`oc-solve-rec-box${marker > 0 ? ` oc-solve-mark-${marker}` : ''}`}>
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
