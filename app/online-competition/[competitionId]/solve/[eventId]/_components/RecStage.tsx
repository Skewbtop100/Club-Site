'use client';

import { useEffect } from 'react';

// Standard WCA-style inspection warning cues, elapsed since this stage
// (not the whole attempt) began. After 12s no further cues are given —
// the athlete solves at their own pace with no time limit enforced.
const BEEP_CUE_TIMES_MS = [8000, 12000];

export default function RecStage({
  videoRef,
  onFinish,
  onBeep,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onFinish: () => void;
  onBeep: () => void;
}) {
  useEffect(() => {
    const timers = BEEP_CUE_TIMES_MS.map((ms) => setTimeout(onBeep, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div className="oc-solve-camera-box-portrait" style={{ marginTop: 10 }}>
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
