'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useLang } from '@/lib/i18n';
import { WCA_EVENTS } from '@/lib/wca-events';
import { fmtTime, compareTime, formatDate } from '@/lib/time-utils';
import { getResultRecordBadges, getVisibleBadge, BADGE_STYLES } from '@/lib/record-badges';
import CompetitionHistory from '@/components/shared/CompetitionHistory';
import type { Result, Athlete, Competition, WcaRecords, EventVisibility } from '@/lib/types';

interface Props {
  results: Result[];
  athletes: Athlete[];
  competitions: Competition[];
  wcaRecords: WcaRecords;
  eventVisibility: EventVisibility;
}

function isEventVisible(eventId: string, visibility: EventVisibility, results: Result[]): boolean {
  const vis = visibility[eventId] || 'auto';
  if (vis === 'hide') return false;
  if (vis === 'show') return true;
  return results.some((r) => r.eventId === eventId);
}

export default function RankingsSection({ results, athletes, competitions, wcaRecords, eventVisibility }: Props) {
  const { t } = useLang();
  const [activeEvent, setActiveEvent] = useState('333');
  const [rankType, setRankType] = useState<'single' | 'average'>('single');
  const [overlayComp, setOverlayComp] = useState<Competition | null>(null);
  const [expanded, setExpanded] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const visibleEvents = useMemo(
    () => WCA_EVENTS.filter((ev) => isEventVisible(ev.id, eventVisibility, results)),
    [eventVisibility, results],
  );

  // If currently selected event is no longer visible, switch to first visible
  const safeEvent = useMemo(() => {
    if (visibleEvents.some((e) => e.id === activeEvent)) return activeEvent;
    return visibleEvents[0]?.id ?? '333';
  }, [visibleEvents, activeEvent]);

  // Reset to collapsed when event or rank type changes
  useEffect(() => { setExpanded(false); }, [safeEvent, rankType]);

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
    <section id="rankings" className="rankings-section" style={{ background: 'var(--surface)' }}>
      <div className="rankings-inner">
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">{t('section-tag.leaderboard')}</div>
          <h2 className="section-title">{t('section-title.rankings')}</h2>
          <p className="section-desc">{t('section-desc.rankings')}</p>
        </div>

        {/* Single / Average toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
          {(['single', 'average'] as const).map((rt) => (
            <button key={rt} onClick={() => setRankType(rt)} className={`tab-btn${rankType === rt ? ' active' : ''}`}>
              {rt === 'single' ? t('rankings.single') : t('rankings.average')}
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
            {t('rankings.no-results')}
          </div>
        ) : (
          <>
          <div ref={tableRef} style={{ overflowX: 'auto' }}>
            <table className={`leaderboard-table${rankType === 'average' ? ' avg-mode' : ' single-mode'}`}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('rankings.athlete')}</th>
                  <th>{rankType === 'single' ? t('rankings.single') : t('rankings.average')}</th>
                  <th>{t('rankings.competition')}</th>
                  {rankType === 'single' && <th>{t('rankings.date')}</th>}
                  {rankType === 'average' && <><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>{t('rankings.date')}</th></>}
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
                    <tr key={r.id} className={!expanded && i >= 5 ? 'lb-hidden-row' : undefined}>
                      <td><span className={`rank-num ${rankCls}`}>{rank}</span></td>
                      <td className="athlete-cell">
                        <div className="athlete-name-text">{athleteNameMap[r.athleteId] || r.athleteName || r.athleteId}</div>
                        {wcaId && <div className="wca-id">{wcaId}</div>}
                      </td>
                      <td>
                        <span className={isDnf ? 'time-dnf' : 'time-val'}>
                          {badge ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.04em', lineHeight: 1, padding: '2px 4px', borderRadius: 4, ...BADGE_STYLES[badge] }}>
                                {badge}
                              </span>
                              {fmtTime(value)}
                            </span>
                          ) : fmtTime(value)}
                        </span>
                      </td>
                      <td>
                        <span
                          className="comp-name comp-name-link"
                          onClick={() => {
                            const comp = competitions.find((c) => c.id === r.competitionId);
                            if (comp) setOverlayComp(comp);
                          }}
                        >
                          {r.competitionName || r.competitionId || '—'}
                        </span>
                      </td>
                      {rankType === 'single' && (
                        <td><span className="comp-date">{formatDate(r.submittedAt)}</span></td>
                      )}
                      {rankType === 'average' && (
                        <>
                          {solves.map((s, idx) => (
                            <td key={idx}>
                              <span className={`rnk-solve${idx === bestIdx ? ' best-s' : ''}${s === -1 || s === -2 ? ' dnf-s' : ''}`}>
                                {fmtTime(s)}
                              </span>
                            </td>
                          ))}
                          <td><span className="comp-date">{formatDate(r.submittedAt)}</span></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length > 5 && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                className="lb-toggle-btn"
                onClick={() => {
                  if (expanded && tableRef.current) {
                    tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? 'Show less \u2191' : `Show all ${rows.length} results \u2193`}
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {overlayComp && (
        <CompetitionHistory
          comp={overlayComp}
          athletes={athletes}
          onClose={() => setOverlayComp(null)}
        />
      )}

      <style>{`
        .rankings-section { padding: 6rem 2rem; }
        .rankings-inner { max-width: 1400px; margin: 0 auto; padding: 0 2rem; }
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title {
          font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800;
          color: var(--text-primary); margin-bottom: 0.6rem; text-align: center;
          display: block; border-bottom: none; padding-bottom: 0; text-transform: none; letter-spacing: normal;
        }
        .section-title::before { display: none; }
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
        .leaderboard-table td { padding: 0.9rem 1rem; font-size: 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: middle; }
        .leaderboard-table tr:hover td { background: rgba(124,58,237,0.08); }
        .rank-num { font-weight: 800; font-size: 1rem; width: 2rem; text-align: center; display: inline-block; }
        .rank-1 { color: #facc15; } .rank-2 { color: #a8b4c4; } .rank-3 { color: #e09050; } .rank-other { color: var(--muted); }
        .wca-id { font-size: 0.72rem; color: var(--accent); font-family: monospace; margin-top: 0.15rem; }
        .time-val { font-family: monospace; font-weight: 700; font-size: 1rem; }
        .time-dnf { color: #f87171; font-family: monospace; font-weight: 700; font-size: 1rem; }
        .athlete-name-text { font-weight: 700; font-size: 0.95rem; }
        .comp-name { font-size: 0.82rem; color: var(--muted); }
        .comp-name-link { cursor: pointer; transition: color 0.2s; }
        .comp-name-link:hover { color: var(--text); text-decoration: underline; }
        .comp-date { font-size: 0.75rem; color: var(--muted); opacity: 0.6; white-space: nowrap; }
        .rnk-solve { font-family: monospace; font-size: 0.85rem; color: var(--muted); }
        .rnk-solve.best-s { color: var(--text); font-weight: 700; }
        .rnk-solve.dnf-s { color: #f87171; }
        .lb-hidden-row { display: none; }
        .lb-toggle-btn {
          padding: 0.4rem 1.2rem; border-radius: 999px;
          font-size: 0.82rem; font-weight: 600; font-family: inherit;
          background: transparent; color: var(--muted);
          border: 1px solid rgba(255,255,255,0.1);
          cursor: pointer; transition: all 0.2s;
        }
        .lb-toggle-btn:hover { color: var(--text); border-color: rgba(124,58,237,0.4); }
        .empty-state { text-align: center; padding: 3rem 1rem; color: var(--muted); font-size: 0.95rem; }
        .empty-icon { font-size: 2.5rem; margin-bottom: 0.7rem; opacity: 0.4; }
        @media (max-width: 700px) {
          .rankings-section { padding: 1.5rem 0; }
          .rankings-inner { max-width: none; padding: 0 0.75rem; }
          #rankings-tabs { justify-content: flex-start; flex-wrap: nowrap; padding: 0.5rem 0.75rem; margin-left: -0.75rem; margin-right: -0.75rem; scrollbar-width: none; }
          #rankings-tabs::-webkit-scrollbar { display: none; }
          .leaderboard-table.single-mode { min-width: 700px; }
          .leaderboard-table.avg-mode { min-width: 900px; }
          .leaderboard-table th { padding: 0.55rem 0.6rem; font-size: 0.7rem; }
          .leaderboard-table td { padding: 0.75rem 0.6rem; font-size: 0.88rem; }
          .leaderboard-table tbody tr { min-height: 56px; }
          .athlete-name-text { font-size: 0.9rem; font-weight: 700; white-space: normal; word-break: keep-all; }
          .wca-id { font-size: 0.68rem; }
          .rank-num { font-size: 0.95rem; font-weight: 800; }
          .time-val, .time-dnf { font-size: 0.95rem; }
          .comp-name { white-space: normal; word-break: keep-all; font-size: 0.8rem; }
          .comp-date { white-space: nowrap; font-size: 0.72rem; }
          .rnk-solve { font-size: 0.8rem; }
        }
      `}</style>
    </section>
  );
}
