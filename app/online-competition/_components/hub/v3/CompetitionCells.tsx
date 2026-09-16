'use client';

import { useEffect, useState } from 'react';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';

/** Wall-clock, refreshed each minute. Starts null so nothing time-relative
 *  is painted during SSR / first client render (they'd disagree). */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* CapacityCell and RegistrationCell used to live here — the competitions
 * list's seat-progress bar and its registration countdown pill. Both were
 * removed with the list's redesign (see CompetitionList.tsx) and nothing
 * else rendered either one:
 *
 *   - CapacityCell's number was a literal "—" and its bar was always
 *     empty, because no public registered count existed. There is one now
 *     (the athlete-counts route), and the list shows it as a plain number.
 *   - RegistrationCell's countdown repeated the detail page's much larger
 *     one, and its "closed" branch only tested registrationDeadline —
 *     predating registrationOpensAt, so it offered БҮРТГҮҮЛЭХ before
 *     registration opened. The list now asks registrationWindow(), the
 *     same helper the panel and firestore.rules agree on.
 *
 * The hub's own upcoming card (UpcomingCard.tsx) keeps its capacity bar
 * and countdown; it is a single featured card, not a row in a list. */

/** 28px event square. @cubing/icons ships the real WCA glyph set (already
 *  a dependency, loaded globally in app/layout.tsx), so these are real
 *  icons; the uppercase event code is the fallback for an id that set
 *  doesn't publish. */
export function EventChip({ eventId }: { eventId: string }) {
  return (
    <span className="oc-v3-ev-icon" title={eventId.toUpperCase()}>
      {hasWcaEventIcon(eventId) ? <WcaEventIcon eventId={eventId} size={16} /> : eventId.toUpperCase()}
    </span>
  );
}
