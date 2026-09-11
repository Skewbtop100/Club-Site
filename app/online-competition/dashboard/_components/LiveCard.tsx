'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OnlineCompetition, OnlineRegistration } from '@/lib/online-competition/types';
import RegistrationStatusBadge from '../../_components/RegistrationStatusBadge';
import { competeGateCopy } from '@/lib/online-competition/registration-view';
import { authedFetchWithRetry } from '@/lib/online-competition/authed-fetch';
import type { RoundAccess } from '@/lib/online-competition/round-access';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fmtDateTime } from '../../_components/hub/format';
import { deriveEventState } from '@/lib/online-competition/event-state';

/** The four event states from the solve-flow phase, repainted in v3. The
 *  state machine itself (lib/online-competition/event-state.ts) is
 *  untouched. */
function EventStatus({
  competitionId,
  eventId,
  state,
  gate,
}: {
  competitionId: string;
  eventId: string;
  state: ReturnType<typeof deriveEventState>;
  /** Non-null when this athlete's registration is not approved — see
   *  competeGateCopy. Decided before anything else: a round being live
   *  does not matter to someone who has not been let into the
   *  competition. */
  gate: ReturnType<typeof competeGateCopy>;
}) {
  if (gate) {
    return (
      <span className="oc-v3-lock-chip" title={gate.message}>
        <span aria-hidden style={{ width: 11, height: 11, border: '1.5px solid #4A4740', borderRadius: '50%' }} />
        {gate.label}
      </span>
    );
  }
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
    // The uid comes from the verified token now, not from the URL.
    authedFetchWithRetry(
      `/api/online-competition/round-access?competitionId=${encodeURIComponent(competition.id)}`,
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
  // Approved only (D7). Hiding the button is all this can do — the solve
  // page itself is not gated until PR-3.
  const gate = competeGateCopy(registration.status);
  const state = deriveEventState(competition, undefined, Date.now());
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
            {/* The review status, and — when it is not approved — the
                reason there is no Эхлүүлэх below. Still not ENFORCED:
                the solve page reads no registration (PR-3). */}
            <div style={{ marginTop: 8 }}>
              <RegistrationStatusBadge status={registration.status} withDetail />
            </div>
          </div>
          <span className="oc-v3-chip oc-v3-chip-pending" style={{ alignSelf: 'flex-start' }}>
            <span className="oc-v3-dot" aria-hidden />
            ЯВАГДАЖ БУЙ
          </span>
        </div>
        {gate ? (
          /* No progress bar: "0/2 төрөл дууссан" under a registration
             that cannot solve reads as a competition already under way
             for this athlete. The reason takes its place. */
          <p className="oc-v3-gate-line" style={{ marginTop: 12 }}>
            {gate.message}
          </p>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="oc-v3-bar" style={{ flex: 1, height: 4 }}>
              <div className="oc-v3-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span style={{ font: '500 10px var(--oc-font-mono), monospace', color: '#9A958A', whiteSpace: 'nowrap' }}>
              {completed}/{total} төрөл дууссан
            </span>
          </div>
        )}
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
            state={deriveEventState(competition, access?.[e.eventId], Date.now())}
            gate={gate}
          />
        </div>
      ))}
    </div>
  );
}
