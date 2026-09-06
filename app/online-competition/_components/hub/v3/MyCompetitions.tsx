'use client';

import { useState } from 'react';
import Link from 'next/link';
import type {
  OnlineCompetition,
  OnlineCompetitionStatus,
  OnlineRegistration,
} from '@/lib/online-competition/types';
import { fmtDate } from './util';
import { EventChip } from './CompetitionCells';
import EmptyBlock from './EmptyBlock';

const HUB = '/online-competition';

export interface RegisteredView {
  registration: OnlineRegistration;
  competition: OnlineCompetition;
}

// Status treatment keyed off the competition's real status. There is no
// second axis to show — OnlineRegistration.status only has the single
// value 'registered' today (see types.ts), so a row's presence here IS
// the registration.
const STATUS: Record<OnlineCompetitionStatus, { dot: string; text: string; label: string }> = {
  live: { dot: '#DFFF4F', text: '#DFFF4F', label: 'ЯВАГДАЖ БАЙНА' },
  upcoming: { dot: '#4FD07A', text: '#4FD07A', label: 'БҮРТГҮҮЛСЭН' },
  finished: { dot: '#4A4740', text: '#6E6A62', label: 'ДУУССАН' },
};

export default function MyCompetitions({ views }: { views: RegisteredView[] }) {
  const [pastOpen, setPastOpen] = useState(false);

  const active = views
    .filter((v) => v.competition.status !== 'finished')
    .sort((a, b) => ms(a) - ms(b));
  const past = views.filter((v) => v.competition.status === 'finished').sort((a, b) => ms(b) - ms(a));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="oc-v3-card">
        <div className="oc-v3-card-head">
          <span className="oc-v3-label">Бүртгүүлсэн тэмцээн</span>
          <span className="oc-v3-count-badge">{active.length}</span>
        </div>
        {active.length === 0 ? (
          <EmptyBlock text="Тэмцээн алга." />
        ) : (
          active.map((v) => <Row key={v.competition.id} view={v} />)
        )}
      </div>

      <div className="oc-v3-card">
        <button type="button" className="oc-v3-section-toggle" onClick={() => setPastOpen((o) => !o)}>
          <span className="oc-v3-caret" aria-hidden>
            {pastOpen ? '▾' : '▸'}
          </span>
          <span className="oc-v3-label">Өмнө оролцсон</span>
          <span style={{ flex: 1 }} />
          <span className="oc-v3-count-badge">{past.length}</span>
        </button>
        {pastOpen &&
          (past.length === 0 ? (
            <EmptyBlock text="Тэмцээн алга." />
          ) : (
            past.map((v) => <Row key={v.competition.id} view={v} />)
          ))}
      </div>
    </div>
  );
}

function ms(v: RegisteredView): number {
  return v.competition.startAt ? v.competition.startAt.toMillis() : 0;
}

function Row({ view }: { view: RegisteredView }) {
  const { competition, registration } = view;
  const tone = STATUS[competition.status];
  // The events the athlete actually signed up for, not the competition's
  // full event list.
  const events = registration.events;

  return (
    <div className="oc-v3-mine-row">
      <div style={{ minWidth: 0 }}>
        <Link href={`${HUB}/${competition.id}/details`} className="oc-v3-row-name">
          {competition.name}
        </Link>
        {/* The schema has no venue/location field — these competitions are
            online — so this caption carries the real season tag when the
            doc has one. */}
        <p className="oc-v3-mine-sub" style={{ marginTop: 4 }}>
          {competition.season ? competition.season.toUpperCase() : 'ОНЛАЙН'}
        </p>
      </div>

      <span className="oc-v3-date">{competition.startAt ? fmtDate(competition.startAt) : '—'}</span>

      <div className="oc-v3-chips">
        {events.length === 0 ? (
          <span className="oc-v3-row-meta">—</span>
        ) : (
          events.map((eventId) => <EventChip key={eventId} eventId={eventId} />)
        )}
      </div>

      {/* No result column: there is no per-competition results summary in
          the schema yet (onlineSubmissions are per-attempt and readable
          only by their owner or an admin), so a past row shows the same
          date + chips as an active one rather than an invented placing. */}
      <div className="oc-v3-status-line">
        <span className="oc-v3-status-dot" style={{ background: tone.dot }} aria-hidden />
        <span className="oc-v3-status-text" style={{ color: tone.text }}>
          {tone.label}
        </span>
      </div>

      <Link href={`${HUB}/${competition.id}/details`} className="oc-v3-row-action">
        {competition.status === 'live' ? 'ОРОХ' : 'ДЭЛГЭРЭНГҮЙ'}
      </Link>
    </div>
  );
}
