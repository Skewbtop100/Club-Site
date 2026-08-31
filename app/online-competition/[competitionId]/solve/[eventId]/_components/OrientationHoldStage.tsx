'use client';

import { useEffect, useState } from 'react';

const HOLD_MS = 5000;
const HOLD_SECONDS = 5;

/** "orientationHold" — replaces the old countdown-number "go" stage.
 *  Recording is already running (started at zeroDisplay) and continues
 *  uninterrupted through this stage; it just shows the live preview and
 *  an instruction to hold the cube in a known reference orientation for
 *  5 seconds, so a judge reviewing the footage can verify the scramble
 *  was applied to a cube whose orientation is provably known before the
 *  solve began. No countdown NUMBER here (that was the old "go" stage's
 *  dominant element) — the instruction text is the dominant content;
 *  progress is shown via the same tick pattern as the reveal stage's
 *  progress bar instead. */
export default function OrientationHoldStage({
  videoRef,
  onDone,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onDone: () => void;
}) {
  const [ticksFilled, setTicksFilled] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTicksFilled((t) => Math.min(t + 1, HOLD_SECONDS));
    }, 1000);
    const t = setTimeout(onDone, HOLD_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-go">
      <div>
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
          ШООГОО БАЙРШУУЛ
        </p>
        <div className="oc-solve-camera-box" style={{ marginTop: 10 }}>
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <span className="oc-solve-corner oc-solve-corner-tl" aria-hidden />
          <span className="oc-solve-corner oc-solve-corner-br" aria-hidden />
        </div>
      </div>

      <div>
        <p
          style={{
            font: '600 17px var(--oc-font-heading), sans-serif',
            color: '#F4F1EA',
            textAlign: 'center',
            lineHeight: 1.45,
          }}
        >
          Шоогоо цагаан тал дээшээ, ногоон тал дэлгэц рүү харагдахаар байрлуулаад 5 секунд хөдөлгөөнгүй барина уу.
        </p>
        <div className="oc-solve-chunk-bar-track" style={{ marginTop: 14, justifyContent: 'center' }}>
          {Array.from({ length: HOLD_SECONDS }).map((_, i) => (
            <span key={i} className={`oc-solve-chunk-bar${i < ticksFilled ? ' oc-solve-chunk-bar-filled' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
