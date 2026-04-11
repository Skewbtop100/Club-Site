'use client';

import { useEffect, useState } from 'react';
import { subscribeResultsByComp } from '@/lib/firebase/services/results';
import type { Competition, Result, AdvancementConfig } from '@/lib/types';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';

// ── helpers ───────────────────────────────────────────────────────────────────

function getRoundLabel(roundNum: number, totalRounds: number): string {
  if (totalRounds === 1) return 'Final';
  if (roundNum === totalRounds) return 'Final';
  if (totalRounds === 4 && roundNum === 3) return 'Semi Final';
  const names: Record<number, string> = { 1: 'First Round', 2: 'Second Round', 3: 'Third Round' };
  return names[roundNum] ?? `Round ${roundNum}`;
}

function getSolveHint(solves: (number | null)[], idx: number): 'best' | 'worst' | null {
  if (!solves || solves.length < 5) return null;
  const rank = (v: number | null): number => {
    if (v === null) return 4e9;
    if (v === -2) return 3e9;
    if (v < 0) return 2e9;
    return v;
  };
  const scored = solves.map((v, i) => ({ r: rank(v), i })).sort((a, b) => a.r !== b.r ? a.r - b.r : a.i - b.i);
  if (scored[0].i === idx) return 'best';
  if (scored[4].i === idx) return 'worst';
  return null;
}

const rKey = (evId: string, r: number) => `${evId}_r${r}`;

function wcaSort(a: Result, b: Result) {
  const s = (r: Result): [number, number] => {
    const avg = r.average != null && r.average > 0 ? r.average : null;
    const sng = r.single  != null && r.single  > 0 ? r.single  : null;
    return [avg ?? Infinity, sng ?? Infinity];
  };
  const [pa, sa] = s(a), [pb, sb] = s(b);
  return pa !== pb ? pa - pb : sa - sb;
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  comp: Competition;
  onClose: () => void;
  isLive?: boolean;
}

export default function CompetitionResultsViewer({ comp, onClose, isLive }: Props) {
  const [evId, setEvId]       = useState('');
  const [round, setRound]     = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Real-time subscription
  useEffect(() => {
    setLoading(true);
    const unsub = subscribeResultsByComp(comp.id, (data) => {
      setResults(data.filter(r => r.status === 'published'));
      setLoading(false);
    });
    return unsub;
  }, [comp.id]);

  // Escape key + body scroll lock
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // ── derived data ─────────────────────────────────────────────────────────────

  const clubAthleteIds = new Set((comp.athletes ?? []).map(a => a.id));

  const compEvents = comp.events
    ? WCA_EVENTS.filter(e => (comp.events as Record<string, boolean>)?.[e.id])
    : [];

  function totalRoundsFor(ev: string) {
    return comp.eventConfig?.[ev]?.rounds ?? 1;
  }

  const tableRows = results
    .filter(r => r.eventId === evId && (r.round || 1) === round)
    .sort(wcaSort);

  const evCfg      = comp.eventConfig?.[evId];
  const totalRounds = evCfg?.rounds ?? 1;
  const isFinal     = round >= totalRounds;
  const advCfg: AdvancementConfig | undefined =
    !isFinal ? (evCfg?.advancement?.[String(round)] as AdvancementConfig | undefined) : undefined;
  const rawAdv = advCfg
    ? advCfg.type === 'fixed' ? advCfg.value : Math.floor(tableRows.length * advCfg.value / 100)
    : 0;
  const advanceCount = Math.min(rawAdv, tableRows.length - 1);

  const curStatus = comp.roundStatus?.[rKey(evId, round)] ?? null;

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      zIndex: 9999, background: 'var(--bg)', display: 'flex', flexDirection: 'column',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.7rem 1.25rem', borderBottom: '1px solid rgba(124,58,237,0.2)',
        flexShrink: 0, gap: '1rem', background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
          {isLive && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              fontSize: '0.7rem', fontWeight: 700, color: '#4ade80',
              background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)',
              padding: '0.15rem 0.5rem', borderRadius: '999px', flexShrink: 0,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', animation: 'vrPulseDot 1.4s ease-in-out infinite', display: 'inline-block' }} />
              LIVE
            </span>
          )}
          <span style={{
            fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {comp.name}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
            minWidth: '2.5rem', minHeight: '2.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.1rem', lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      ) : (
        <div
          className="wca-live-layout"
          style={{ flex: 1, minHeight: 0, borderRadius: 0, border: 'none' }}
        >

          {/* Sidebar */}
          <div className="wca-sidebar">
            <div className="wca-sidebar-events">
              {compEvents.length === 0 && (
                <div style={{ padding: '0.9rem 0.85rem', color: 'var(--muted)', fontSize: '0.8rem' }}>
                  No events configured
                </div>
              )}
              {compEvents.map(ev => {
                const total    = totalRoundsFor(ev.id);
                const isOpen   = expanded.has(ev.id);
                const hasActive = evId === ev.id;

                return (
                  <div key={ev.id} className="wca-ev-group">
                    {/* Event header — clicking selects the event (round 1) and toggles expansion */}
                    <div
                      className={`wca-ev-header${hasActive ? ' has-active' : ''}`}
                      onClick={() => {
                        setEvId(ev.id);
                        setRound(1);
                        setExpanded(prev => {
                          const n = new Set(prev);
                          n.has(ev.id) ? n.delete(ev.id) : n.add(ev.id);
                          return n;
                        });
                      }}
                    >
                      <div className="wca-ev-header-left">
                        <span className="wca-ev-name">{ev.name}</span>
                      </div>
                      <span className={`wca-ev-chevron${isOpen ? ' open' : ''}`}>▶</span>
                    </div>

                    {/* Round sub-items (desktop) */}
                    {isOpen && Array.from({ length: total }, (_, i) => i + 1).map(r => {
                      const label    = getRoundLabel(r, total);
                      const st       = comp.roundStatus?.[rKey(ev.id, r)] ?? null;
                      const isActive = evId === ev.id && round === r;
                      return (
                        <div
                          key={r}
                          className={`wca-ev-round-item${isActive ? ' active' : ''}${st === 'complete' ? ' complete' : ''}`}
                          onClick={() => { setEvId(ev.id); setRound(r); }}
                        >
                          {st === 'complete' && <span className="wca-round-status-icon" style={{ color: '#4ade80' }}>✓</span>}
                          {st === 'ongoing'  && <span className="wca-round-status-icon" style={{ color: '#4ade80' }}>●</span>}
                          {st === null       && <span className="wca-round-status-icon" style={{ color: 'transparent' }}>●</span>}
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main area */}
          <div className="wca-main" style={{ overflowY: 'auto' }}>

            {/* Round header */}
            {evId && (
              <div className="wca-round-header">
                <div className="wca-round-header-left">
                  <span className="wca-round-event-name">
                    {WCA_EVENTS.find(e => e.id === evId)?.name}
                  </span>
                  <span className="wca-round-label">
                    {getRoundLabel(round, totalRoundsFor(evId))}
                  </span>
                  {curStatus === 'ongoing'  && <span className="wca-round-badge wca-round-badge-live">● Live</span>}
                  {curStatus === 'complete' && <span className="wca-round-badge wca-round-badge-done">✓ Round Complete</span>}
                </div>
                {/* Round navigation tabs */}
                {totalRoundsFor(evId) > 1 && (
                  <div className="wca-round-header-right">
                    <div className="wca-round-tabs">
                      {Array.from({ length: totalRoundsFor(evId) }, (_, i) => i + 1).map(r => (
                        <button
                          key={r}
                          className={`wca-round-tab${round === r ? ' active' : ''}`}
                          onClick={() => setRound(r)}
                        >
                          {getRoundLabel(r, totalRoundsFor(evId))}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Table area */}
            <div className="wca-table-wrap">
              {!evId
                ? <div className="wca-empty">Select an event to view results.</div>
                : tableRows.length === 0
                  ? <div className="wca-empty">No results for this round yet.</div>
                  : (
                    <table className="wca-results-table">
                      <thead>
                        <tr>
                          <th style={{ width: '2rem' }}>#</th>
                          <th>Athlete</th>
                          <th>Country</th>
                          <th className="th-r">1</th>
                          <th className="th-r">2</th>
                          <th className="th-r">3</th>
                          <th className="th-r">4</th>
                          <th className="th-r">5</th>
                          <th className="th-r">Average</th>
                          <th className="th-r">Best</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.flatMap((r, i) => {
                          const isAdvancing     = advanceCount > 0 && i < advanceCount;
                          const isLastAdvancing = advanceCount > 0 && i === advanceCount - 1;
                          const isClub          = clubAthleteIds.has(r.athleteId);
                          const rowCls = i === 0 ? 'row-gold' : i === 1 ? 'row-silver' : i === 2 ? 'row-bronze' : isClub ? 'row-club' : '';

                          const dataRow = (
                            <tr
                              key={r.id}
                              className={rowCls}
                              style={isAdvancing ? { borderLeft: '3px solid #22c55e' } : { borderLeft: '3px solid transparent' }}
                            >
                              {/* Rank */}
                              <td
                                className={`wca-td-rank${i < 3 ? ` wca-rank-${i + 1}` : ''}`}
                                style={isAdvancing ? { color: '#4ade80' } : undefined}
                              >
                                {i + 1}
                              </td>

                              {/* Athlete */}
                              <td className="wca-td-name">
                                <div className="wca-name">{r.athleteName || r.athleteId}</div>
                              </td>

                              {/* Country */}
                              <td className="wca-td-country">{r.country || '—'}</td>

                              {/* Solves 1–5 */}
                              {([0, 1, 2, 3, 4] as const).map(si => {
                                const sv   = r.solves?.[si] ?? null;
                                const hint = getSolveHint(r.solves ?? [], si);
                                const isDnf = sv !== null && sv < 0;
                                const text  = hint ? `(${fmtTime(sv)})` : fmtTime(sv);
                                return (
                                  <td
                                    key={si}
                                    className={`wca-td-solve${isDnf ? ' dnf-solve' : hint === 'best' ? ' hint-best' : hint === 'worst' ? ' hint-worst' : ''}`}
                                  >
                                    {text}
                                  </td>
                                );
                              })}

                              {/* Average */}
                              <td className={`wca-td-avg${r.average != null && r.average < 0 ? ' dnf-avg' : ''}`}>
                                {fmtTime(r.average)}
                              </td>

                              {/* Best (single) */}
                              <td className={`wca-td-best${r.single != null && r.single < 0 ? ' dnf-solve' : ''}`}>
                                {fmtTime(r.single)}
                              </td>
                            </tr>
                          );

                          // Advancement cutoff separator
                          if (isLastAdvancing) {
                            const label = advCfg?.type === 'fixed'
                              ? `✓ Top ${advanceCount} advance to next round`
                              : `✓ Top ${advCfg?.value}% advance (${advanceCount} athletes)`;
                            return [
                              dataRow,
                              <tr key="adv-cutoff">
                                <td colSpan={10} style={{ padding: 0, borderBottom: 'none' }}>
                                  <div style={{
                                    borderTop: '2px dashed #22c55e', padding: '0.25rem 0.75rem',
                                    fontSize: '0.72rem', color: '#4ade80',
                                    background: 'rgba(34,197,94,0.05)', letterSpacing: '0.01em',
                                  }}>
                                    {label}
                                  </div>
                                </td>
                              </tr>,
                            ];
                          }
                          return [dataRow];
                        })}
                      </tbody>
                    </table>
                  )
              }
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes vrPulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.7); } }
      `}</style>
    </div>
  );
}
