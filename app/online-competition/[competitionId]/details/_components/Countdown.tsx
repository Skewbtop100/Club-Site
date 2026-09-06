'use client';

import { useEffect, useState } from 'react';

/** Live-ticking countdown to `startAtMs`. Updates every second on the
 *  client only (SSR renders the initial static value from a fresh
 *  Date.now() call, then the interval takes over after mount).
 *
 *  The tick logic is unchanged from the original; only the output markup
 *  changed — the days figure and the HH:MM:SS clock are now two stacked
 *  elements so the v3 hero can size them independently. */
export default function Countdown({ startAtMs }: { startAtMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (startAtMs === null) {
    return <span className="oc-v3-cd-days">—</span>;
  }

  const remaining = startAtMs - now;
  if (remaining <= 0) {
    return <span className="oc-v3-cd-days">ЭХЭЛСЭН</span>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <>
      <span className="oc-v3-cd-days">{days} ӨДӨР</span>
      <span className="oc-v3-cd-clock">
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </span>
    </>
  );
}
