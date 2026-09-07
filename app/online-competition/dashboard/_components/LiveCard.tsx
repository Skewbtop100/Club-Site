'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetition, OnlineRegistration } from '@/lib/online-competition/types';
import type { RoundAccess } from '@/lib/online-competition/round-access';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fmtDateTime } from '../../_components/hub/format';
import { deriveEventState } from './eventState';

/** The four event states from the solve-flow phase, repainted in v3. The
 *  state machine itself (eventState.ts) is untouched. */
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
      <span className="oc-v3-done-chip">
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid #4FD07A' }} />
        ДУУССАН
      </span>
    );
  }
  if (state === 'dns') {
    return (
      <span className="oc-v3-dns-chip">
        <span aria-hidden style={{ width: 11, height: 11, border: '1.5px solid #E8543C', transform: 'rotate(45deg)' }} />
        DNS
      </span>
    );
  }
  // Round 2+ and this athlete didn't make the cut — say so, rather than
  // showing a disabled button with no explanation.
  if (state === 'notqualified') {
    return (
      <span className="oc-v3-dns-chip" title="Өмнөх раундад шалгараагүй">
        <span aria-hidden style={{ width: 11, height: 11, border: '1.5px solid #E8543C', transform: 'rotate(45deg)' }} />
        ШАЛГАРААГҮЙ
      </span>
    );
  }
  if (state === 'live') {
    return (
      <Link href={`/online-competition/${competitionId}/solve/${eventId}`} className="oc-v3-start-btn">
        Эхлүүлэх
      </Link>
    );
  }
  return (
    <button type="button" disabled className="oc-v3-start-btn-disabled">
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
  const { user } = useOnlineAuth();
  const uid = user && !user.isAnonymous ? user.uid : null;

  // Per-event round access for this athlete. `undefined` until it
  // resolves; a failed lookup leaves it undefined too, so every row simply
  // keeps the previous schedule-based state instead of falsely claiming
  // someone didn't qualify.
  const [access, setAccess] = useState<Record<string, RoundAccess> | undefined>(undefined);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetch(
      `/api/online-competition/round-access?competitionId=${encodeURIComponent(competition.id)}&uid=${encodeURIComponent(uid)}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { events: Record<string, RoundAccess> }) => {
        if (!cancelled) setAccess(d.events ?? {});
      })
      .catch(() => {
        /* keep the schedule-based state */
      });
    return () => {
      cancelled = true;
    };
  }, [uid, competition.id]);

  const myEvents = competition.events.filter((e) => registration.events.includes(e.eventId));
  const state = deriveEventState(competition);
  const completed = state === 'done' ? myEvents.length : 0;
  const total = myEvents.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div>
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
          <span className="oc-v3-chip oc-v3-chip-pending" style={{ alignSelf: 'flex-start' }}>
            <span className="oc-v3-dot" aria-hidden />
            ЯВАГДАЖ БУЙ
          </span>
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="oc-v3-bar" style={{ flex: 1, height: 4 }}>
            <div className="oc-v3-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span style={{ font: '500 10px var(--oc-font-mono), monospace', color: '#9A958A', whiteSpace: 'nowrap' }}>
            {completed}/{total} төрөл дууссан
          </span>
        </div>
      </div>

      {myEvents.map((e) => (
        <div key={e.eventId} className="oc-v3-ev-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ font: '600 13px var(--oc-font-mono), monospace', color: '#F4F1EA' }}>
              {e.eventId.toUpperCase()}
            </p>
            <p style={{ marginTop: 3, font: '400 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
              {e.rounds} раунд
            </p>
          </div>
          <EventStatus
            competitionId={competition.id}
            eventId={e.eventId}
            state={deriveEventState(competition, access?.[e.eventId])}
          />
        </div>
      ))}
    </div>
  );
}
