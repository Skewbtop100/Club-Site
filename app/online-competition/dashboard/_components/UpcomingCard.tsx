import type { OnlineCompetition, OnlineRegistration } from '@/lib/online-competition/types';
import { fmtDateTime } from '../../_components/hub/format';

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
    <div className="oc-dash-upcoming-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <p style={{ font: '500 15px var(--oc-font-heading), sans-serif', color: '#16140F' }}>{competition.name}</p>
          <p style={{ marginTop: 3, font: '400 10px var(--oc-font-mono), monospace', color: '#8A8474' }}>
            {fmtDateTime(competition.startAt)}
          </p>
        </div>
        <span className="oc-dash-badge-outline">УДАХГҮЙ</span>
      </div>
      <p style={{ font: '400 11px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>
        {codes} · эхлэхэд сануулга ирнэ
      </p>
    </div>
  );
}
