'use client';

import { useEffect, useState } from 'react';

const START_COUNT = 8;

export default function GoStage({
  videoRef,
  onStartRecording,
  onDone,
  cameraError,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onStartRecording: () => Promise<boolean>;
  onDone: () => void;
  cameraError: string | null;
}) {
  const [count, setCount] = useState(START_COUNT);

  // Camera + MediaRecorder start here, at the top of `go` — recording
  // continues uninterrupted through `goNow` and into `rec`.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    onStartRecording().then((ok) => {
      if (cancelled || !ok) return; // camera failed — cameraError renders below, countdown never starts
      interval = setInterval(() => {
        setCount((c) => {
          if (c <= 1) {
            if (interval) clearInterval(interval);
            // Deferred to its own tick — calling onDone() synchronously
            // here (inside setCount's updater) triggers the parent's
            // setStage() while React is still processing this
            // component's own state update, which is what produced the
            // "Cannot update a component while rendering a different
            // component" warning. The countdown timing itself is
            // unaffected: this only delays the *transition callback* by
            // one tick, not the 1000ms interval it fires from.
            setTimeout(() => onDone(), 0);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-go">
      <div>
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
          КАМЕРАА ТОХИРУУЛ
        </p>
        <div className="oc-solve-camera-box" style={{ marginTop: 10 }}>
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <span className="oc-solve-corner oc-solve-corner-tl" aria-hidden />
          <span className="oc-solve-corner oc-solve-corner-br" aria-hidden />
        </div>
        {cameraError && (
          <p style={{ marginTop: 10, font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>
            {cameraError}
          </p>
        )}
      </div>

      <div>
        <p key={count} className="oc-solve-countdown-number">
          {count}
        </p>
        <p
          style={{
            marginTop: 8,
            font: '500 10px var(--oc-font-mono), monospace',
            letterSpacing: '.24em',
            color: '#8A8474',
            textAlign: 'center',
          }}
        >
          СЕКУНДЫН ДАРАА ЭХЭЛНЭ
        </p>
      </div>
    </div>
  );
}
