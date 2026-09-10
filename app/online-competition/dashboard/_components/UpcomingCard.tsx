import type { OnlineCompetition, OnlineRegistration } from '@/lib/online-competition/types';
import { fmtDateTime } from '../../_components/hub/format';
import RegistrationStatusBadge from '../../_components/RegistrationStatusBadge';

export default function UpcomingCard({
  competition,
  registration,
}: {
  competition: OnlineCompetition;
  registration: OnlineRegistration;
}) {
  const myEvents = competition.events.filter((e) => registration.events.includes(e.eventId));
  const codes = myEvents.map((e) => e.eventId.toUpperCase()).join(', ');

  return (
    <div style={{ padding: '15px 18px', borderBottom: '1px solid #16161B' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ font: '600 15px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
            {competition.name}
          </p>
          <p style={{ marginTop: 4, font: '400 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
            {fmtDateTime(competition.startAt)}
          </p>
        </div>
        <span
          style={{
            alignSelf: 'flex-start',
            border: '1px solid #2A2A31',
            color: '#9A958A',
            padding: '6px 8px',
            font: '600 8px var(--oc-font-mono), monospace',
            letterSpacing: '.14em',
            whiteSpace: 'nowrap',
          }}
        >
          УДАХГҮЙ
        </span>
      </div>
      {/* The registration's review status, with its explanation — on the
          dashboard there is room, and "pending" without "the organiser is
          reviewing it" invites the athlete to wonder what they did wrong. */}
      <div style={{ marginTop: 10 }}>
        <RegistrationStatusBadge status={registration.status} withDetail />
      </div>
      <p style={{ marginTop: 8, font: '400 11px var(--oc-font-mono), monospace', color: '#9A958A' }}>
        {codes} · эхлэхэд сануулга ирнэ
      </p>
    </div>
  );
}
