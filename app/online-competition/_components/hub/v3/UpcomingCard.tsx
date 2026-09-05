'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import { fmtDate, fmtRemaining, fmtTime } from './util';
import EmptyBlock from './EmptyBlock';

const HUB = '/online-competition';

export default function UpcomingCard({ competitions }: { competitions: OnlineCompetition[] }) {
  // Countdowns are clock-dependent, so they'd differ between the server
  // render and the first client render. `now` starts null and is filled in
  // after mount — nothing time-relative is painted until then.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="oc-v3-card">
      <div className="oc-v3-card-head">
        <span className="oc-v3-label">Удахгүй болох тэмцээн</span>
        {/* No "all competitions" route exists yet — see HubNav's TODO. */}
        <Link href={HUB} className="oc-v3-label-link">
          БҮГД →
        </Link>
      </div>

      {competitions.length === 0 ? (
        <EmptyBlock text="Тэмцээн алга." />
      ) : (
        competitions.map((c) => <Row key={c.id} competition={c} now={now} />)
      )}
    </div>
  );
}

function Row({ competition, now }: { competition: OnlineCompetition; now: number | null }) {
  const limit = competition.participantLimit;
  const deadlineMs = competition.registrationDeadline ? competition.registrationDeadline.toMillis() : null;
  const openedMs = competition.createdAt ? competition.createdAt.toMillis() : null;

  // The schema has no "registration opens at" field, so there is no
  // not-yet-open state to render — a competition is treated as open for
  // registration until its registrationDeadline passes (or indefinitely
  // if it declares none). Until `now` is known (first paint) the button
  // is shown without a countdown rather than flashing the wrong state.
  const closed = now !== null && deadlineMs !== null && deadlineMs <= now;
  const msLeft = now !== null && deadlineMs !== null ? deadlineMs - now : null;

  // Fill = how much of the registration window has already elapsed. The
  // window is createdAt -> registrationDeadline, both real fields; with no
  // createdAt (legacy docs) the bar stays an empty track.
  let elapsedPct = 0;
  if (msLeft !== null && msLeft > 0 && openedMs !== null && deadlineMs !== null && deadlineMs > openedMs) {
    elapsedPct = Math.min(100, Math.max(0, ((now as number) - openedMs) / (deadlineMs - openedMs) * 100));
  }

  const meta = [
    competition.startAt ? `${fmtDate(competition.startAt)} · ${fmtTime(competition.startAt)}` : null,
    competition.events.length > 0 ? `${competition.events.length} төрөл` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="oc-v3-row">
      <span className="oc-v3-row-icon">
        {competition.events[0] ? (
          <WcaEventIcon eventId={competition.events[0].eventId} size={18} />
        ) : (
          <span style={{ font: '700 12px var(--oc-font-mono), monospace' }}>
            {competition.name.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      <div className="oc-v3-row-main">
        <Link href={`${HUB}/${competition.id}/details`} className="oc-v3-row-name">
          {competition.name}
        </Link>
        <p className="oc-v3-row-meta" style={{ marginTop: 4 }}>
          {meta || '—'}
        </p>
      </div>

      {/* Registered counts are not publicly readable (see LiveHero's note),
          so the count reads "—" and the progress track stays unfilled
          rather than asserting a fabricated 0. */}
      <div className="oc-v3-row-cap">
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
            style={{
              font: '500 8px var(--oc-font-mono), monospace',
              letterSpacing: '.1em',
              color: '#6E6A62',
            }}
          >
            ТАМИРЧИН
          </span>
        </div>
        <div className="oc-v3-bar" style={{ marginTop: 6 }} />
        <p style={{ marginTop: 5, font: '400 9px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
          {limit != null ? `${limit} суудал` : 'Хязгааргүй'}
        </p>
      </div>

      <div className="oc-v3-row-cta">
        {closed ? (
          <>
            <p
              style={{
                font: '500 8px var(--oc-font-mono), monospace',
                letterSpacing: '.12em',
                color: '#6E6A62',
              }}
            >
              БҮРТГЭЛ ХААГДСАН
            </p>
            <p
              style={{
                marginTop: 5,
                font: '500 11px var(--oc-font-mono), monospace',
                fontVariantNumeric: 'tabular-nums',
                color: '#9A958A',
              }}
            >
              {fmtDate(competition.registrationDeadline)}
            </p>
          </>
        ) : (
          <>
            <Link href={`${HUB}/${competition.id}/details`} className="oc-v3-reg-btn">
              Бүртгүүлэх
            </Link>
            {msLeft !== null && msLeft > 0 && (
              <div className="oc-v3-countdown">
                <div className="oc-v3-countdown-fill" style={{ width: `${elapsedPct}%` }} aria-hidden />
                <span className="oc-v3-countdown-text">{fmtRemaining(msLeft)} үлдсэн</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
