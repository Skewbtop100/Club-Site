'use client';

import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';
import { fmtDate, fmtTime } from './util';
import { CapacityCell, RegistrationCell, useNow } from './CompetitionCells';
import EmptyBlock from './EmptyBlock';

const HUB = '/online-competition';

export default function AllCompetitionsTable({ competitions }: { competitions: OnlineCompetition[] }) {
  const now = useNow();

  return (
    <div className="oc-v3-card">
      <div className="oc-v3-all-head">
        <span />
        <span className="oc-v3-th">Тэмцээн</span>
        <span className="oc-v3-th">Эхлэх</span>
        <span className="oc-v3-th">Төрлүүд</span>
        <span className="oc-v3-th">Тамирчин</span>
        <span />
      </div>

      {competitions.length === 0 ? (
        <EmptyBlock text="Тэмцээн алга." />
      ) : (
        competitions.map((c) => (
          <div key={c.id} className="oc-v3-all-row">
            <span className="oc-v3-icon-30">
              {c.events[0] && hasWcaEventIcon(c.events[0].eventId) ? (
                <WcaEventIcon eventId={c.events[0].eventId} size={16} />
              ) : (
                <span style={{ font: '700 11px var(--oc-font-mono), monospace' }}>
                  {c.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
            </span>

            <Link href={`${HUB}/${c.id}/details`} className="oc-v3-row-name">
              {c.name}
            </Link>

            <span className="oc-v3-date">
              {c.startAt ? `${fmtDate(c.startAt)} · ${fmtTime(c.startAt)}` : '—'}
            </span>

            <span className="oc-v3-row-meta">
              {c.events.length > 0 ? c.events.map((e) => e.label).join(' · ') : '—'}
            </span>

            <CapacityCell limit={c.participantLimit} />

            <RegistrationCell competition={c} now={now} />
          </div>
        ))
      )}
    </div>
  );
}
