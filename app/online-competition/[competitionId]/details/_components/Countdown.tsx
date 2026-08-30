'use client';

import { useEffect, useState } from 'react';

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days} ӨДӨР ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Live-ticking countdown to `startAtMs`. Updates every second on the
 *  client only (SSR renders the initial static value from a fresh
 *  Date.now() call, then the interval takes over after mount). */
export default function Countdown({ startAtMs }: { startAtMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (startAtMs === null) {
    return <span>—</span>;
  }

  const remaining = startAtMs - now;
  if (remaining <= 0) {
    return <span>ЭХЭЛСЭН</span>;
  }

  return <span>{formatRemaining(remaining)}</span>;
}
