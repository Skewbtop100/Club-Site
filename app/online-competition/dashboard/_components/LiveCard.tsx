import Link from 'next/link';
import type { OnlineCompetition, OnlineRegistration } from '@/lib/online-competition/types';
import { fmtDateTime } from '../../_components/hub/format';
import { deriveEventState } from './eventState';

function EventStatus({
  competitionId,
  eventId,
  state,
}: {
  competitionId: string;
  eventId: string;
  state: ReturnType<typeof deriveEventState>;
}) {
  if (state === 'done') {
    return (
      <span className="oc-dash-status-done">
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid #2E9E5B' }} />
        <span style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.1em', color: '#1D6E3E' }}>
          ДУУССАН
        </span>
      </span>
    );
  }
  if (state === 'dns') {
    return (
      <span className="oc-dash-status-dns">
        <span
          aria-hidden
          style={{ width: 11, height: 11, border: '1.5px solid #D8402C', transform: 'rotate(45deg)' }}
        />
        <span style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.1em', color: '#B22E1D' }}>
          DNS
        </span>
      </span>
    );
  }
  if (state === 'live') {
    return (
      // Phase 5's real solve flow — the old auto-timer page at
      // /online-competition/{id} is unrouted-to dead code now (kept for
      // reference/rollback, see the comment at the top of that file).
      <Link href={`/online-competition/${competitionId}/solve/${eventId}`} className="oc-dash-btn-start">
        Эхлүүлэх
      </Link>
    );
  }
  return (
    <button type="button" disabled className="oc-dash-btn-start-disabled">
      Эхлүүлэх
    </button>
  );
}

export default function LiveCard({
  competition,
  registration,
}: {
  competition: OnlineCompetition;
  registration: OnlineRegistration;
}) {
  const myEvents = competition.events.filter((e) => registration.events.includes(e.eventId));
  const state = deriveEventState(competition);
  const completed = state === 'done' ? myEvents.length : 0;
  const total = myEvents.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="oc-dash-live-card">
      <div className="oc-dash-live-top">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <p style={{ font: '500 15px var(--oc-font-heading), sans-serif', color: '#16140F' }}>
              {competition.name}
            </p>
            <p style={{ marginTop: 3, font: '400 10px var(--oc-font-mono), monospace', color: '#8A8474' }}>
              {fmtDateTime(competition.startAt)}
            </p>
          </div>
          <span className="oc-dash-badge-live">ЯВАГДАЖ БУЙ</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="oc-detail-progress-track" style={{ flex: 1 }}>
            <div className="oc-detail-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span style={{ font: '500 10px var(--oc-font-mono), monospace', color: '#4C473C', whiteSpace: 'nowrap' }}>
            {completed}/{total} төрөл дууссан
          </span>
        </div>
      </div>

      {myEvents.map((e) => (
        <div key={e.eventId} className="oc-dash-event-row">
          <div style={{ flex: 1 }}>
            <p style={{ font: '600 13px var(--oc-font-mono), monospace', color: '#16140F' }}>
              {e.eventId.toUpperCase()}
            </p>
            <p style={{ marginTop: 3, font: '400 10px var(--oc-font-mono), monospace', color: '#8A8474' }}>
              {e.rounds} раунд
            </p>
          </div>
          <EventStatus competitionId={competition.id} eventId={e.eventId} state={state} />
        </div>
      ))}
    </div>
  );
}
