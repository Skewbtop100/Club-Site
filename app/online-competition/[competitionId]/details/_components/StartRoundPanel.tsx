'use client';

import Link from 'next/link';
import type { OnlineCompetitionEventConfig, OnlineRegistration } from '@/lib/online-competition/types';
import type { RoundAccess } from '@/lib/online-competition/round-access';
import { deriveEventState } from '@/lib/online-competition/event-state';
import { competeGateCopy, registrationStatusCopy } from '@/lib/online-competition/registration-view';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';

const RETRY_BUTTON = {
  border: '1px solid #DFFF4F',
  background: 'transparent',
  color: '#DFFF4F',
  padding: '8px 14px',
  font: '600 9px var(--oc-font-mono), monospace',
  letterSpacing: '.1em',
  cursor: 'pointer',
} as const;

/** The athlete's way into their own live round, on the page they actually
 *  navigate to.
 *
 *  WHY IT IS HERE: the only start button in the product used to be on the
 *  dashboard, behind `competition.status === 'live'`. An approved athlete
 *  whose round was open but whose competition had not been moved to live
 *  had no path to solving at all — the hub sent them to this page, this
 *  page sent them to the dashboard, and the dashboard showed an upcoming
 *  card. Opening a round now announces the competition (round-open.ts), so
 *  that particular dead end is closed; this panel means the athlete does
 *  not have to know the dashboard is where solving lives.
 *
 *  Rendered only for someone who has registered. Everyone else is already
 *  being shown the registration flow below it, and a start button is not
 *  an answer to "how do I enter". */
export default function StartRoundPanel({
  competitionId,
  events,
  registration,
  access,
  loading,
  failed = false,
  onRetry,
  registrationFailed = false,
  onRetryRegistration,
}: {
  competitionId: string;
  /** The competition's configured events, in configured order. */
  events: OnlineCompetitionEventConfig[];
  registration: OnlineRegistration | null;
  /** eventId -> this athlete's round access, or null when the lookup
   *  failed / has not resolved. */
  access: Record<string, RoundAccess> | null;
  loading: boolean;
  /** The lookup FAILED — shown as "could not check", with a retry, never as
   *  a closed round. */
  failed?: boolean;
  onRetry?: () => void;
  /** The athlete's registration could not be READ. Without this the panel
   *  simply vanished, exactly as it does for someone never registered —
   *  on competition day that reads as "you are not in". */
  registrationFailed?: boolean;
  onRetryRegistration?: () => void;
}) {
  if (!registration) {
    if (!registrationFailed || loading) return null;
    return (
      <section className="oc-cd-start" role="alert">
        <p className="oc-cd-start-label">ТАНЫ БҮРТГЭЛ</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p className="oc-cd-start-note" style={{ margin: 0 }}>
            Таны бүртгэлийг ачаалж чадсангүй — энэ нь та бүртгүүлээгүй гэсэн үг биш. Дахин оролдоно уу.
          </p>
          {onRetryRegistration && (
            <button type="button" onClick={onRetryRegistration} style={RETRY_BUTTON}>
              ДАХИН АЧААЛАХ
            </button>
          )}
        </div>
      </section>
    );
  }

  const mine = events.filter((e) => registration.events.includes(e.eventId));
  if (mine.length === 0) return null;

  // Approved only (D7) — the same gate the dashboard uses, and the same
  // wording, so the two cannot tell the athlete different things.
  const gate = competeGateCopy(registration.status);
  const icon = (eventId: string) => (
    <span className="oc-v3-ev-icon" aria-hidden>
      {hasWcaEventIcon(eventId) ? <WcaEventIcon eventId={eventId} size={16} /> : eventId.slice(0, 4).toUpperCase()}
    </span>
  );

  return (
    <section className="oc-cd-start">
      {/* The registration's own headline — "ТА БҮРТГҮҮЛЭХ ХҮСЭЛТ ИЛГЭЭСЭН",
          "БҮРТГЭЛ БАТАЛГААЖСАН" — the same words as the Бүртгүүлэх panel.
          It said "ТА ОРОЛЦОЖ БАЙНА" for every status, a pending request
          included. */}
      <p className="oc-cd-start-label">{registrationStatusCopy(registration.status).headline}</p>

      {registration.status === 'pending' ? (
        // PENDING: the events requested, and nothing about starting — the
        // headline says it is a request, and no round can be started until
        // it is approved, so there is no button or state to show per row.
        <div className="oc-cd-start-rows">
          {mine.map((e) => (
            <div key={e.eventId} className="oc-cd-start-row">
              {icon(e.eventId)}
              <span className="oc-cd-start-name">{e.label}</span>
              <span className="oc-cd-start-round">{e.rounds} раунд</span>
            </div>
          ))}
        </div>
      ) : gate ? (
        <p className="oc-cd-start-note">{gate.message}</p>
      ) : (
        <div className="oc-cd-start-rows">
          {mine.map((e) => {
            const state = deriveEventState({ startAt: null }, access?.[e.eventId], Date.now());
            const liveRound = access?.[e.eventId]?.liveRound ?? null;
            return (
              <div key={e.eventId} className="oc-cd-start-row">
                {icon(e.eventId)}
                <span className="oc-cd-start-name">{e.label}</span>
                <span className="oc-cd-start-round">
                  {liveRound !== null ? `РАУНД ${liveRound}` : `${e.rounds} раунд`}
                </span>
                {state === 'live' ? (
                  <Link href={`/online-competition/${competitionId}/live`} className="oc-v3-start-btn">
                    Эхлүүлэх
                  </Link>
                ) : (
                  <span className="oc-cd-start-state">
                    {loading
                      ? '...'
                      : failed
                        ? 'ШАЛГАЖ ЧАДСАНГҮЙ'
                        : state === 'notqualified'
                          ? 'ШАЛГАРААГҮЙ'
                          : 'РАУНД НЭЭГЭЭГҮЙ'}
                  </span>
                )}
              </div>
            );
          })}
          {failed && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
              <p className="oc-cd-start-note" role="alert" style={{ margin: 0 }}>
                Раунд нээлттэй эсэхийг шалгаж чадсангүй — энэ нь раунд хаагдсан гэсэн үг биш.
              </p>
              {onRetry && (
                <button type="button" onClick={onRetry} style={RETRY_BUTTON}>
                  ДАХИН ШАЛГАХ
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
