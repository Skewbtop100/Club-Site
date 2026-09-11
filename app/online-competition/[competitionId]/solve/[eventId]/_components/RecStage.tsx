'use client';

import { useEffect, useState } from 'react';

/** WCA inspection markers, elapsed since this stage began.
 *
 *  INFORMATIONAL ONLY. Nothing is enforced at 8, 12 or 15 seconds — the
 *  athlete solves at their own pace, and the event's own time limit is
 *  applied later, at the keypad and again at scoring. These exist so an
 *  athlete who counts inspection by feel has something to check against. */
const MARKER_TIMES_MS = [8000, 12000, 15000];

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
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="oc-solve-rec-dot" aria-hidden />
          <span style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#D8402C' }}>
            БИЧИЖ БАЙНА
          </span>
        </div>
        {/* THE MARKER IS THE FRAME, and nothing else.
            The athlete is mid-solve: anything they could read is worse
            than nothing, because reading it costs them the solve they are
            reading it during. So it is the one-pixel border of the
            preview they are already looking past — no text, no number, no
            movement, and no layout change at any step. The colour walks
            from the neutral frame through two dim ambers to a dim red over
            an 800ms fade, so it registers as the frame having drifted
            rather than as an event that happened.

            It is deliberately NOT a sound. The cues were beeps until now;
            useSolveRecorder carries the reason nothing audio-shaped goes
            anywhere near this flow again. */}
        <div
          className={`oc-solve-camera-box-portrait${marker > 0 ? ` oc-solve-mark-${marker}` : ''}`}
          style={{ marginTop: 10 }}
        >
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <div className="oc-solve-tick-strip" aria-hidden />
        </div>
        <p style={{ marginTop: 10, font: '400 12px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>
          Дэлгэц дээр цаг харагдахгүй. Цагаа өөрөө хэмжиж, дараа нь бичнэ.
        </p>
      </div>

      <button type="button" className="oc-solve-btn-finish" onClick={onFinish}>
        Дуусгах
      </button>
    </div>
  );
}
