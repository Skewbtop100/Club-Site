'use client';

import { useEffect } from 'react';

const ZERO_DISPLAY_MS = 5000;

/** "zeroDisplay" — first stage of each attempt. Recording starts the
 *  instant this mounts (see page.tsx's effect keyed on
 *  stage === 'zeroDisplay') — this frozen "0.00", held for 5 seconds
 *  before the scramble is revealed, is the athlete's on-video proof that
 *  their timer read zero before scrambling began. No camera preview here
 *  beyond what cameraSetup already established. */
export default function ZeroDisplayStage({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, ZERO_DISPLAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-zero">
      <p className="oc-solve-countdown-number">0.00</p>
      <p
        style={{
          marginTop: 8,
          font: '500 10px var(--oc-font-mono), monospace',
          letterSpacing: '.24em',
          color: '#8A8474',
          textAlign: 'center',
        }}
      >
        ЦАГ ТЭГ ДЭЭР БАЙНА
      </p>
    </div>
  );
}
