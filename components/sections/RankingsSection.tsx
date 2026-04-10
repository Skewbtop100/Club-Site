'use client';

import { useState, useMemo } from 'react';
import { WCA_EVENTS } from '@/lib/wca-events';
import { fmtTime, compareTime, formatDate } from '@/lib/time-utils';
import { getResultRecordBadges, getVisibleBadge, BADGE_STYLES } from '@/lib/record-badges';
import type { Result, Athlete, WcaRecords, EventVisibility } from '@/lib/types';

interface Props {
  results: Result[];
  athletes: Athlete[];
  wcaRecords: WcaRecords;
  eventVisibility: EventVisibility;
}

function isEventVisible(eventId: string, visibility: EventVisibility, results: Result[]): boolean {
  const vis = visibility[eventId] || 'auto';
  if (vis === 'hide') return false;
  if (vis === 'show') return true;
  return results.some((r) => r.eventId === eventId);
}

export default function RankingsSection({ results, athletes, wcaRecords, eventVisibility }: Props) {
  const [activeEvent, setActiveEvent] = useState('333');
  const [rankType, setRankType] = useState<'single' | 'average'>('single');

  const visibleEvents = useMemo(
    () => WCA_EVENTS.filter((ev) => isEventVisible(ev.id, eventVisibility, results)),
    [eventVisibility, results],
  );

  // If currently selected event is no longer visible, switch to first visible
  const safeEvent = useMemo(() => {
    if (visibleEvents.some((e) => e.id === activeEvent)) return activeEvent;
    return visibleEvents[0]?.id ?? '333';
  }, [visibleEvents, activeEvent]);

  const athleteNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach((a) => { m[a.id] = (a.name || '') + (a.lastName ? ' ' + a.lastName : ''); });
    return m;
  }, [athletes]);

  const wcaIdMap = useMemo(() => {
    const m: Record<string, string | null> = {};
    athletes.forEach((a) => { m[a.id] = a.wcaId || null; });
    return m;
  }, [athletes]);

  const rows = useMemo(() => {
    const eventResults = results.filter((r) => r.eventId === safeEvent);
    if (rankType === 'single') {
      const best: Record<string, Result> = {};
      eventResults.forEach((r) => {
        if (r.single !== null && r.single !== undefined) {
          const prev = best[r.athleteId];
          if (!prev || compareTime(r.single, prev.single) < 0) best[r.athleteId] = r;
        }
      });
      return Object.values(best).sort((a, b) => compareTime(a.single, b.single));
    } else {
      const best: Record<string, Result> = {};
      eventResults.forEach((r) => {
        if (r.average !== null && r.average !== undefined && r.average !== -1) {
          const prev = best[r.athleteId];
          if (!prev || compareTime(r.average, prev.average) < 0) best[r.athleteId] = r;
        }
      });
      return Object.values(best).sort((a, b) => compareTime(a.average, b.average));
    }
  }, [results, safeEvent, rankType]);

  return (
    <section id="rankings" style={{ padding: '6rem 2rem', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">LEADERBOARD</div>
          <h2 className="section-title">Event Rankings</h2>
          <p className="section-desc">Best single and average results across all WCA events. Ranked by single time, lowest first.</p>
        </div>

        {/* Single / Average toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
          {(['single', 'average'] as const).map((t) => (
            <button key={t} onClick={() => setRankType(t)} className={`tab-btn${rankType === t ? ' active' : ''}`}>
              {t === 'single' ? 'Single' : 'Average'}
            </button>
          ))}
        </div>

        {/* Event tabs */}
        <div className="tab-row" id="rankings-tabs">
          {visibleEvents.map((ev) => (
            <button
              key={ev.id}
              title={ev.name}
              onClick={() => setActiveEvent(ev.id)}
              className={`tab-btn${safeEvent === ev.id ? ' active' : ''}`}
            >
              {ev.name}
            </button>
          ))}
        </div>

        {/* Table */}
        {rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            No results yet for this event.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Athlete</th>
                  <th>{rankType === 'single' ? 'Single' : 'Average'}</th>
                  <th>Competition</th>
                  <th>Date</th>
                  {rankType === 'average' && <><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rank = i + 1;
                  const rankCls = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
                  const value = rankType === 'single' ? r.single : r.average;
                  const badges = getResultRecordBadges(safeEvent, rankType, value!, r.athleteId, results, wcaRecords);
                  const badge = getVisibleBadge(badges);
                  const isDnf = value === -1 || value === -2;
                  const wcaId = wcaIdMap[r.athleteId];
                  const solves = rankType === 'average' ? [...(r.solves || []).slice(0, 5)] : [];
                  while (solves.length < 5) solves.push(null);
                  const bestIdx = solves.reduce<number>((bi, s, idx) => {
                    if (s === null || s <= 0 || s === -1 || s === -2) return bi;
                    if (bi === -1) return idx;
                    return s < (solves[bi] as number) ? idx : bi;
                  }, -1);

                  return (
                    <tr key={r.id}>
                      <td><span className={`rank-num ${rankCls}`}>{rank}</span></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{athleteNameMap[r.athleteId] || r.athleteName || r.athleteId}</div>
                        {wcaId && <div className="wca-id">{wcaId}</div>}
                      </td>
                      <td>
                        <span className={isDnf ? 'time-dnf' : 'time-val'}>
                          {badge ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: '0.5rem', fontWeight: 900, letterSpacing: '0.04em', lineHeight: 1, padding: '1px 3px', borderRadius: 4, ...BADGE_STYLES[badge] }}>
                                {badge}
                              </span>
                              {fmtTime(value)}
                            </span>
                          ) : fmtTime(value)}
                        </span>
                      </td>
                      <td><span className="comp-name">{r.competitionName || r.competitionId || '—'}</span></td>
                      <td><span className="comp-date">{formatDate(r.submittedAt)}</span></td>
                      {rankType === 'average' && solves.map((s, idx) => (
                        <td key={idx}>
                          <span className={`rnk-solve${idx === bestIdx ? ' best-s' : ''}${s === -1 || s === -2 ? ' dnf-s' : ''}`}>
                            {fmtTime(s)}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title {
          font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800;
          color: var(--text-primary); margin-bottom: 0.6rem; text-align: center;
        }
        .section-desc { font-size: 1rem; color: var(--muted); max-width: 580px; margin: 0 auto; line-height: 1.65; }
        .tab-row { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 1.5rem; scrollbar-width: thin; scrollbar-color: var(--accent) transparent; }
        #rankings-tabs { justify-content: center; flex-wrap: wrap; }
        .tab-btn {
          flex-shrink: 0; padding: 0.4rem 0.95rem; border-radius: 999px;
          font-size: 0.8rem; font-weight: 600; border: 1px solid rgba(255,255,255,0.1);
          background: transparent; color: var(--muted); cursor: pointer; transition: all 0.2s;
          font-family: inherit;
        }
        .tab-btn:hover { color: var(--text); border-color: rgba(124,58,237,0.4); }
        .tab-btn.active { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; border-color: transparent; }
        .leaderboard-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        .leaderboard-table th { text-align: left; padding: 0.7rem 1rem; font-size: 0.73rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); border-bottom: 1px solid rgba(255,255,255,0.07); }
        .leaderboard-table td { padding: 0.75rem 1rem; font-size: 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .leaderboard-table tr:hover td { background: rgba(124,58,237,0.06); }
        .rank-num { font-weight: 700; font-size: 0.85rem; width: 2rem; text-align: center; display: inline-block; }
        .rank-1 { color: #fbbf24; } .rank-2 { color: #94a3b8; } .rank-3 { color: #cd7c3e; } .rank-other { color: var(--muted); }
        .wca-id { font-size: 0.75rem; color: var(--accent); font-family: monospace; margin-top: 0.1rem; }
        .time-val { font-family: monospace; font-weight: 600; }
        .time-dnf { color: #f87171; font-family: monospace; }
        .comp-name { font-size: 0.82rem; color: var(--muted); }
        .comp-date { font-size: 0.75rem; color: var(--muted); opacity: 0.6; }
        .rnk-solve { font-family: monospace; font-size: 0.82rem; color: var(--muted); }
        .rnk-solve.best-s { color: var(--text); font-weight: 700; }
        .rnk-solve.dnf-s { color: #f87171; }
        .empty-state { text-align: center; padding: 3rem 1rem; color: var(--muted); font-size: 0.95rem; }
        .empty-icon { font-size: 2.5rem; margin-bottom: 0.7rem; opacity: 0.4; }
        @media (max-width: 700px) { #rankings-tabs { justify-content: flex-start; flex-wrap: nowrap; } }
      `}</style>
    </section>
  );
}
