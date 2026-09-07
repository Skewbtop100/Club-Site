'use client';

import { useMemo } from 'react';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import type { ScrambleRosterAthlete } from '@/lib/online-competition/scramble-roster';
import { eventCode, eventLabel } from './shared';

// ── Tab 01 · Бүртгэл ─────────────────────────────────────────────────────
// Real registration data only. The schema has exactly two facts to report
// here — how many athletes registered, and how many of them have an
// admin-approved profile (onlineParticipants.profileStatus === 'approved',
// set by the athlete-verification review in admin/athletes). There is no
// waitlist, no cancellation and no per-competition approval step anywhere
// in the schema, so no such counters are shown.

const ROW_COLUMNS = 'minmax(150px, 1.6fr) 110px 130px';

export default function RegistrationTab({
  competition,
  athletes,
}: {
  competition: OnlineCompetitionAdminView | null;
  athletes: ScrambleRosterAthlete[];
}) {
  const approved = athletes.filter((a) => a.profileStatus === 'approved').length;

  // Per-event breakdown. Driven by the competition's configured events,
  // plus any event someone is registered for that the competition no
  // longer lists — dropping those would under-report the real roster.
  const byEvent = useMemo(() => {
    const ids = [...new Set([...(competition?.events ?? []).map((e) => e.eventId), ...athletes.flatMap((a) => a.events)])];
    return ids.map((eventId) => {
      const registered = athletes.filter((a) => a.events.includes(eventId));
      return {
        eventId,
        label: eventLabel(competition, eventId),
        registered: registered.length,
        approved: registered.filter((a) => a.profileStatus === 'approved').length,
        configured: (competition?.events ?? []).some((e) => e.eventId === eventId),
      };
    });
  }, [competition, athletes]);

  return (
    <>
      <div className="oc-sc-statgrid">
        <div className="oc-sc-statcell">
          <span className="oc-sc-statlabel">Нийт бүртгэл</span>
          <span className="oc-sc-statvalue">{athletes.length}</span>
          <span className="oc-sc-statsub">ТАМИРЧИН</span>
        </div>
        <div className="oc-sc-statcell">
          <span className="oc-sc-statlabel">Баталгаажсан</span>
          <span className="oc-sc-statvalue oc-sc-statvalue-volt">{approved}</span>
          <span className="oc-sc-statsub">ПРОФАЙЛ ЗӨВШӨӨРӨГДСӨН</span>
        </div>
      </div>

      {athletes.length === 0 ? (
        <p className="oc-sc-empty">Энэ тэмцээнд бүртгүүлсэн тамирчин алга.</p>
      ) : (
        <div className="oc-sc-table">
          <div className="oc-sc-thead" style={{ gridTemplateColumns: ROW_COLUMNS, minWidth: 420 }}>
            <span className="oc-sc-th">Төрөл</span>
            <span className="oc-sc-th" style={{ textAlign: 'right' }}>
              Оролцогч
            </span>
            <span className="oc-sc-th" style={{ textAlign: 'right' }}>
              Баталгаажсан
            </span>
          </div>
          {byEvent.map((row) => (
            <div key={row.eventId} className="oc-sc-trow" style={{ gridTemplateColumns: ROW_COLUMNS, minWidth: 420 }}>
              <span className="oc-sc-cellname">
                <span className="oc-sc-icon" aria-hidden>
                  {eventCode(row.eventId)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="oc-sc-name">{row.label}</span>
                  {/* Only ever shown for an event nobody configured — real
                      state, not decoration. */}
                  {!row.configured && <span className="oc-sc-subline">ТЭМЦЭЭНД ТОХИРУУЛААГҮЙ ТӨРӨЛ</span>}
                </span>
              </span>
              <span className="oc-sc-num" style={{ textAlign: 'right' }}>
                {row.registered}
              </span>
              <span
                className={`oc-sc-num${row.approved === 0 ? ' oc-sc-num-dim' : ''}`}
                style={{ textAlign: 'right' }}
              >
                {row.approved}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="oc-sc-foot">
        БАТАЛГААЖСАН = ПРОФАЙЛЫН БАТАЛГААЖУУЛАЛТ ЗӨВШӨӨРӨГДСӨН ТАМИРЧИН (АДМИН · ТАМИРЧИД ХЭСЭГ)
      </p>
    </>
  );
}
