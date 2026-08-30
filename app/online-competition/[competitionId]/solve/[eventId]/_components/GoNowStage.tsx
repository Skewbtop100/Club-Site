'use client';

import { useEffect } from 'react';

const FLASH_DURATION_MS = 400;

export default function GoNowStage({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, FLASH_DURATION_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-gonow">
      <div className="oc-solve-gonow-grid" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="oc-solve-gonow-cell" />
        ))}
      </div>
      <p className="oc-solve-gonow-title">ЭВЛҮҮЛЖ ЭХЛЭЭРЭЙ</p>
      <p style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.24em', color: 'rgba(13,12,10,.55)', textAlign: 'center' }}>
        БИЧЛЭГ ЯВЖ БАЙНА
      </p>
    </div>
  );
}
