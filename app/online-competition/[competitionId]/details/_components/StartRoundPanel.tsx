'use client';

import Link from 'next/link';
import type { OnlineCompetitionEventConfig, OnlineRegistration } from '@/lib/online-competition/types';
import type { RoundAccess } from '@/lib/online-competition/round-access';
import { deriveEventState } from '@/lib/online-competition/event-state';
import { competeGateCopy } from '@/lib/online-competition/registration-view';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';

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
}: {
  competitionId: string;
  /** The competition's configured events, in configured order. */
  events: OnlineCompetitionEventConfig[];
  registration: OnlineRegistration | null;
  /** eventId -> this athlete's round access, or null when the lookup
   *  failed / has not resolved. */
  access: Record<string, RoundAccess> | null;
  loading: boolean;
}) {
  if (!registration) return null;

  const mine = events.filter((e) => registration.events.includes(e.eventId));
  if (mine.length === 0) return null;

  // Approved only (D7) — the same gate the dashboard uses, and the same
  // wording, so the two cannot tell the athlete different things.
  const gate = competeGateCopy(registration.status);

  return (
    <section className="oc-cd-start">
      <p className="oc-cd-start-label">ТА ОРОЛЦОЖ БАЙНА</p>

      {gate ? (
        <p className="oc-cd-start-note">{gate.message}</p>
      ) : (
        <div className="oc-cd-start-rows">
          {mine.map((e) => {
            const state = deriveEventState({ startAt: null }, access?.[e.eventId], Date.now());
            const liveRound = access?.[e.eventId]?.liveRound ?? null;
            return (
              <div key={e.eventId} className="oc-cd-start-row">
                <span className="oc-v3-ev-icon" aria-hidden>
                  {hasWcaEventIcon(e.eventId) ? (
                    <WcaEventIcon eventId={e.eventId} size={16} />
                  ) : (
                    e.eventId.slice(0, 4).toUpperCase()
                  )}
                </span>
                <span className="oc-cd-start-name">{e.label}</span>
                <span className="oc-cd-start-round">
                  {liveRound !== null ? `РАУНД ${liveRound}` : `${e.rounds} раунд`}
                </span>
                {state === 'live' ? (
                  <Link href={`/online-competition/${competitionId}/solve/${e.eventId}`} className="oc-v3-start-btn">
                    Эхлүүлэх
                  </Link>
                ) : (
                  <span className="oc-cd-start-state">
                    {loading
                      ? '...'
                      : state === 'notqualified'
                        ? 'ШАЛГАРААГҮЙ'
                        : 'РАУНД НЭЭГЭЭГҮЙ'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
