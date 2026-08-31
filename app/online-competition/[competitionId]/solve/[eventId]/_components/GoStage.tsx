'use client';

import { useEffect, useState } from 'react';

const START_COUNT = 8;

export default function GoStage({
  videoRef,
  onDone,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  onDone: () => void;
}) {
  const [count, setCount] = useState(START_COUNT);

  // Recording is already running by this point — it started at the top
  // of this attempt's reveal state and continues uninterrupted through
  // go -> goNow -> rec. This stage just shows the live preview and runs
  // the countdown.
  useEffect(() => {
    const interval = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(interval);
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

    return () => clearInterval(interval);
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
