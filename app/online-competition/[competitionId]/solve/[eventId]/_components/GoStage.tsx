'use client';

import { useEffect } from 'react';

/** "go" — the flash that ends the inspection.
 *
 *  Full-bleed over the scrolling column, the same way `ready` is. The bar
 *  stays above it: it is the frame of the run, and ГАРАХ is the only way
 *  out of one.
 *
 *  It starts and stops nothing — the recording has been running since the
 *  opening hold. What it does is put a hard, unmissable end on the
 *  inspection window, which is the half of "fifteen seconds" the athlete
 *  cannot be trusted to supply for themselves. */
export default function GoStage({ ms, onDone }: { ms: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oc-solve-goflash" role="status">
      <div className="oc-solve-goflash-grid" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="oc-solve-goflash-cell" />
        ))}
      </div>
      <span className="oc-solve-goflash-title">ЭВЛҮҮЛЖ ЭХЛЭЭРЭЙ</span>
      <span className="oc-solve-goflash-sub">БИЧЛЭГ ЯВЖ БАЙНА</span>
    </div>
  );
}
