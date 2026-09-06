'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { fmtDate, fmtRemaining } from './util';

const HUB = '/online-competition';

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

/** Registered/capacity block — the same treatment as the hub's upcoming
 *  card. The registered count reads "—" because registrations live under
 *  onlineParticipants/{uid}/registrations, which Firestore rules only
 *  expose to their owner (and there's no collection-group rule), so no
 *  public per-competition count exists; the track is left unfilled rather
 *  than asserting a fabricated 0. */
export function CapacityCell({ limit }: { limit: number | null | undefined }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          style={{
            font: '700 14px var(--oc-font-mono), monospace',
            fontVariantNumeric: 'tabular-nums',
            color: '#F4F1EA',
          }}
        >
          —
        </span>
        <span style={{ font: '400 10px var(--oc-font-mono), monospace', color: '#4A4740' }}>
          / {limit != null ? limit : '∞'}
        </span>
        <span
          style={{ font: '500 8px var(--oc-font-mono), monospace', letterSpacing: '.1em', color: '#6E6A62' }}
        >
          ТАМИРЧИН
        </span>
      </div>
      <div className="oc-v3-bar" style={{ marginTop: 6 }} />
      <p style={{ marginTop: 5, font: '400 9px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
        {limit != null ? `${limit} суудал` : 'Хязгааргүй'}
      </p>
    </div>
  );
}

/** Registration action column. Only two real states exist: the schema has
 *  no "registration opens at" field, so a competition counts as open
 *  until its registrationDeadline passes — the mockup's "not yet open"
 *  branch has nothing to key off and is deliberately not rendered. A
 *  finished competition is never registerable regardless of deadline. */
export function RegistrationCell({
  competition,
  now,
}: {
  competition: OnlineCompetition;
  now: number | null;
}) {
  const deadlineMs = competition.registrationDeadline ? competition.registrationDeadline.toMillis() : null;
  const openedMs = competition.createdAt ? competition.createdAt.toMillis() : null;

  const finished = competition.status === 'finished';
  const closed = finished || (now !== null && deadlineMs !== null && deadlineMs <= now);
  const msLeft = now !== null && deadlineMs !== null ? deadlineMs - now : null;

  // Fill = how much of the createdAt -> registrationDeadline window has
  // elapsed. Both are real fields; with no createdAt the track stays empty.
  let elapsedPct = 0;
  if (!closed && msLeft !== null && msLeft > 0 && openedMs !== null && deadlineMs !== null && deadlineMs > openedMs) {
    elapsedPct = Math.min(100, Math.max(0, ((now as number) - openedMs) / (deadlineMs - openedMs) * 100));
  }

  if (closed) {
    return (
      <div>
        <p style={{ font: '500 8px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#6E6A62' }}>
          {finished ? 'ТЭМЦЭЭН ДУУССАН' : 'БҮРТГЭЛ ХААГДСАН'}
        </p>
        <p
          style={{
            marginTop: 5,
            font: '500 11px var(--oc-font-mono), monospace',
            fontVariantNumeric: 'tabular-nums',
            color: '#9A958A',
          }}
        >
          {competition.registrationDeadline ? fmtDate(competition.registrationDeadline) : '—'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <Link href={`${HUB}/${competition.id}/details`} className="oc-v3-reg-btn">
        Бүртгүүлэх
      </Link>
      {msLeft !== null && msLeft > 0 && (
        <div className="oc-v3-countdown">
          <div className="oc-v3-countdown-fill" style={{ width: `${elapsedPct}%` }} aria-hidden />
          <span className="oc-v3-countdown-text">{fmtRemaining(msLeft)} үлдсэн</span>
        </div>
      )}
    </div>
  );
}

/** 28px event square. @cubing/icons ships the real WCA glyph set (already
 *  a dependency, loaded globally in app/layout.tsx), so these are real
 *  icons; the uppercase event code is the fallback for an id that set
 *  doesn't publish. */
export function EventChip({ eventId }: { eventId: string }) {
  return (
    <span className="oc-v3-chip" title={eventId.toUpperCase()}>
      {hasWcaEventIcon(eventId) ? <WcaEventIcon eventId={eventId} size={16} /> : eventId.toUpperCase()}
    </span>
  );
}
