import type { OnlineCompetition, OnlineRegistration } from '@/lib/online-competition/types';
import { fmtDateTime } from '../../_components/hub/format';
import RegistrationStatusBadge from '../../_components/RegistrationStatusBadge';
import { competeGateCopy } from '@/lib/online-competition/registration-view';

export default function UpcomingCard({
  competition,
  registration,
}: {
  competition: OnlineCompetition;
  registration: OnlineRegistration;
}) {
  const myEvents = competition.events.filter((e) => registration.events.includes(e.eventId));
  const codes = myEvents.map((e) => e.eventId.toUpperCase()).join(', ');
  // Approved only (D7). This card has no button to hide — what it has is
  // a line promising the competition will start FOR THIS ATHLETE, which
  // is the claim that has to go.
  const gate = competeGateCopy(registration.status);

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
      {/* NO NOTIFICATION EXISTS. This said "эхлэхэд сануулга ирнэ" — a
          reminder will come when it starts — and nothing sends one. Worse,
          it was shown while the athlete's round was already open, because
          this card is chosen by competition.status. It now says where the
          round will appear, which is a thing that actually happens. */}
      <p style={{ marginTop: 8, font: '400 11px var(--oc-font-mono), monospace', color: '#9A958A' }}>
        {gate ? codes : `${codes} · раунд нээгдэхэд энд гарна`}
      </p>
      {gate && (
        <p className="oc-v3-gate-line" style={{ marginTop: 6 }}>
          {gate.message}
        </p>
      )}
    </div>
  );
}
