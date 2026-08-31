'use client';

import { useEffect } from 'react';

/** One-time gate shown before attempt #1's reveal — requests camera
 *  permission up front so it's already granted (and the stream already
 *  live) by the time recording needs to start at the very first reveal.
 *  Attempts 2-5 reuse the same stream and never see this stage again. */
export default function CameraSetupStage({
  videoRef,
  hasCamera,
  error,
  onRequestCamera,
  onDone,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  hasCamera: boolean;
  error: string | null;
  onRequestCamera: () => Promise<boolean>;
  onDone: () => void;
}) {
  useEffect(() => {
    onRequestCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-go">
      <div>
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
          КАМЕРАА ЗӨВШӨӨРНӨ ҮҮ
        </p>
        <div className="oc-solve-camera-box" style={{ marginTop: 10 }}>
          <video ref={videoRef} autoPlay playsInline muted className="oc-solve-camera-video" />
          <span className="oc-solve-corner oc-solve-corner-tl" aria-hidden />
          <span className="oc-solve-corner oc-solve-corner-br" aria-hidden />
        </div>
        {error && (
          <p style={{ marginTop: 10, font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>
            {error}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {!hasCamera && !error && (
          <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#8A8474', textAlign: 'center' }}>
            Камерын зөвшөөрөл хүлээж байна...
          </p>
        )}
        <button
          type="button"
          className="oc-solve-btn-confirm"
          style={{ width: 'auto', padding: '12px 24px' }}
          disabled={!hasCamera}
          onClick={onDone}
        >
          Бэлэн боллоо
        </button>
        {error && (
          <button
            type="button"
            className="oc-solve-btn-redo"
            style={{ flex: 'none', width: 'auto', padding: '10px 20px' }}
            onClick={() => onRequestCamera()}
          >
            Дахин оролдох
          </button>
        )}
      </div>
    </div>
  );
}
