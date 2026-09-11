'use client';

import { useMemo, useState } from 'react';
import type { CompetitionRoster } from '@/app/api/online-competition/competitions/[id]/roster/route';
import { eventHasAverage, rankRoster } from '@/lib/online-competition/roster-view';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';

/** The public roster: who is competing, ranked by their LIFETIME personal
 *  best for the selected event.
 *
 *  NOT results in this competition. The numbers come from the
 *  onlineParticipants stats rollup, so the tab is meaningful before the
 *  competition starts — which is the point of it — and does not change
 *  while it runs. This competition's standings are a separate feature and
 *  nothing here reads a submission. */
export default function AthletesTab({ roster }: { roster: CompetitionRoster | null }) {
  // Default to the first configured event, as the review grid does. There
  // is deliberately no unfiltered state: a rank needs one event to sort by.
  const [eventId, setEventId] = useState<string | null>(null);
  const selected = eventId ?? roster?.events[0]?.eventId ?? null;
  const selectedEvent = roster?.events.find((e) => e.eventId === selected) ?? null;

  const rows = useMemo(
    () => (roster && selected ? rankRoster(roster.athletes, selected) : []),
    [roster, selected],
  );

  if (!roster) return <p className="oc-cd-soon">Ачааллаж байна...</p>;
  if (roster.events.length === 0) return <p className="oc-cd-soon">Энэ тэмцээнд төрөл тохируулаагүй байна.</p>;

  const showAverage = selectedEvent ? eventHasAverage(selectedEvent.format) : false;

  return (
    <div className="oc-ro-tab">
      <div className="oc-ro-filters" role="tablist" aria-label="Төрөл">
        {roster.events.map((e) => (
          <button
            key={e.eventId}
            type="button"
            role="tab"
            aria-selected={e.eventId === selected}
            className={`oc-ro-filter${e.eventId === selected ? ' oc-ro-filter-on' : ''}`}
            onClick={() => setEventId(e.eventId)}
          >
            <span className="oc-v3-ev-icon" aria-hidden>
              {hasWcaEventIcon(e.eventId) ? (
                <WcaEventIcon eventId={e.eventId} size={14} />
              ) : (
                e.eventId.slice(0, 4).toUpperCase()
              )}
            </span>
            {e.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        /* Nobody approved yet — the ordinary state before a competition
           fills up, and distinct from "this event has nobody in it". */
        <p className="oc-cd-soon" style={{ marginTop: 14 }}>
          {roster.approvedCount === 0
            ? 'Одоогоор баталгаажсан тамирчин алга. Бүртгэл хаагдсаны дараа энд харагдана.'
            : 'Энэ төрөлд бүртгүүлсэн тамирчин алга.'}
        </p>
      ) : (
        <div className="oc-cd-table-wrap" style={{ marginTop: 14 }}>
          <table className="oc-ro-table">
            <thead>
              <tr>
                <th scope="col" className="oc-ro-col-rank">#</th>
                <th scope="col" colSpan={2}>ТАМИРЧИН</th>
                <th scope="col" className="oc-ro-col-num">SINGLE</th>
                {/* No column of dashes for a bo-N event, which has no
                    average at all. */}
                {showAverage && <th scope="col" className="oc-ro-col-num">ДУНДАЖ</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.athlete.uid}>
                  <td className="oc-ro-col-rank">{r.rank ?? '—'}</td>
                  <td className="oc-ro-col-avatar">
                    <span className="oc-ro-avatar" aria-hidden>
                      {r.athlete.initials}
                    </span>
                  </td>
                  <td className="oc-ro-col-name">{r.athlete.name}</td>
                  <td className="oc-ro-col-num oc-cd-mono">
                    {r.pr === null ? '—' : fmtCentiseconds(r.pr)}
                  </td>
                  {showAverage && (
                    <td className="oc-ro-col-num oc-cd-mono">
                      {r.average === null ? '—' : fmtCentiseconds(r.average)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="oc-ro-note">
        Хувийн дээд амжилтаар эрэмбэлэв — энэ тэмцээний дүн биш.
      </p>
    </div>
  );
}
