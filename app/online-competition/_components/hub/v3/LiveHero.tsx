import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { fmtDate, fmtTime, splitTrailingYear } from './util';

/** Full-bleed banner for the one competition that's currently live. Only
 *  rendered when such a competition actually exists — there is no
 *  "featured/upcoming" fallback state. */
export default function LiveHero({ competition }: { competition: OnlineCompetition }) {
  const [namePrefix, year] = splitTrailingYear(competition.name);

  const eyebrow = competition.season
    ? `${competition.season.toUpperCase()} · ЯВАГДАЖ БАЙНА`
    : 'ЯВАГДАЖ БАЙНА';

  // Registration counts aren't publicly readable (registrations live under
  // onlineParticipants/{uid}/registrations, readable only by a signed-in
  // user, with no collection-group rule), so the "{registered}/{capacity}
  // тамирчин" segment of the spec'd meta line is reduced to the capacity
  // the competition actually declares — no invented count.
  const meta = [
    competition.events.length > 0 ? `${competition.events.length} төрөл` : null,
    competition.participantLimit != null ? `${competition.participantLimit} тамирчны хязгаар` : null,
    competition.startAt ? fmtDate(competition.startAt) : null,
    competition.startAt ? fmtTime(competition.startAt) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="oc-v3-hero">
      <div className="oc-v3-hero-overlay" aria-hidden />

      <div className="oc-v3-hero-content">
        <p
          style={{
            font: '500 9px var(--oc-font-mono), monospace',
            letterSpacing: '.24em',
            color: '#A8B96A',
          }}
        >
          {eyebrow}
        </p>
        <h1
          style={{
            marginTop: 12,
            font: '600 36px var(--oc-font-heading), sans-serif',
            letterSpacing: '-.015em',
            color: '#F4F1EA',
          }}
        >
          {namePrefix}
          {year && <span style={{ color: '#DFFF4F' }}>{year}</span>}
        </h1>
        {meta && (
          <p style={{ marginTop: 12, font: '400 13px var(--oc-font-mono), monospace', color: '#9A958A' }}>
            {meta}
          </p>
        )}
      </div>

      <div className="oc-v3-hero-cta-wrap">
        <Link href={`/online-competition/${competition.id}/details`} className="oc-v3-hero-cta">
          Бүртгүүлэх
        </Link>
      </div>
    </div>
  );
}
