'use client';

import { useEffect, useState } from 'react';

/** Live-ticking countdown to a deadline, for the detail header's
 *  БҮРТГЭЛ ХААГДАХАД cell.
 *
 *  Retargeted from `startAtMs` to a general `targetMs`: the rebuilt header
 *  has no "time until the competition starts" cell — the mockup's two
 *  cells are ТАМИРЧИН and БҮРТГЭЛ ХААГДАХАД — so what this counts down to
 *  is now the registration deadline. The tick logic is unchanged.
 *
 *  Coarser output than before, and deliberately. The old cell rendered a
 *  days figure plus a live HH:MM:SS clock; the mockup asks for
 *  "N ӨДӨР ҮЛДСЭН", so the seconds clock is gone. It still ticks every
 *  second, because the unit steps down as the deadline nears: below a day
 *  it reads hours and below an hour minutes, rather than sitting on
 *  "0 ӨДӨР ҮЛДСЭН" for the last twenty-three hours of registration —
 *  which is exactly the window in which the number matters most. */
export default function Countdown({ targetMs }: { targetMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // No deadline declared is not the same as a passed one, and must not
  // render as "closed" — an em dash says "not stated", which is true.
  if (targetMs === null) return <span className="oc-v3-cd-days oc-cd-muted">—</span>;

  const remaining = targetMs - now;
  if (remaining <= 0) {
    // Muted, not volt: volt is the colour of time you still have.
    return <span className="oc-v3-cd-days oc-cd-muted">БҮРТГЭЛ ХААГДСАН</span>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60);

  const text =
    days >= 1 ? `${days} ӨДӨР ҮЛДСЭН` : hours >= 1 ? `${hours} ЦАГ ҮЛДСЭН` : `${Math.max(1, minutes)} МИН ҮЛДСЭН`;

  return <span className="oc-v3-cd-days">{text}</span>;
}
