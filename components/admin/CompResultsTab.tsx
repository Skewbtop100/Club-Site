'use client';

import { useEffect, useState, useRef } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import { subscribeResultsByComp } from '@/lib/firebase/services/results';
import type { Competition, Result, AdvancementConfig } from '@/lib/types';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';

export default function CompResultsTab() {
  const [comps, setComps]       = useState<Competition[]>([]);
  const [compId, setCompId]     = useState('');
  const [evId, setEvId]         = useState('');
  const [round, setRound]       = useState(1);
  const [results, setResults]   = useState<Result[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsub = subscribeCompetitions((data) => setComps(data));
    return unsub;
  }, []);

  useEffect(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    if (!compId) { setResults([]); return; }
    const unsub = subscribeResultsByComp(compId, setResults);
    unsubRef.current = unsub;
    return () => unsub();
  }, [compId]);

  const selComp = comps.find(c => c.id === compId);
  const evList = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : [];
  const rounds = evId
    ? [...new Set(results.filter(r => r.eventId === evId).map(r => r.round || 1))].sort()
    : [];
  // WCA ranking: valid average first, then single; DNF/negative = worst
  function wcaSort(a: Result, b: Result) {
    const scoreOf = (r: Result): [number, number] => {
      const avg = r.average != null && r.average > 0 ? r.average : null;
      const sng = r.single  != null && r.single  > 0 ? r.single  : null;
      return [avg ?? Infinity, sng ?? Infinity];
    };
    const [pa, sa] = scoreOf(a);
    const [pb, sb] = scoreOf(b);
    return pa !== pb ? pa - pb : sa - sb;
  }

  const tableRows = results
    .filter(r => r.eventId === evId && (r.round || 1) === round)
    .sort(wcaSort);

  // Advancement cutoff for this round
  const evConfig   = selComp?.eventConfig?.[evId];
  const totalRounds = evConfig?.rounds ?? 1;
  const isFinalRound = round >= totalRounds;
  const advConfig: AdvancementConfig | undefined =
    !isFinalRound ? (evConfig?.advancement?.[String(round)] as AdvancementConfig | undefined) : undefined;
  const rawAdvCount = advConfig
    ? advConfig.type === 'fixed'
      ? advConfig.value
      : Math.floor(tableRows.length * advConfig.value / 100)
    : 0;
  const advanceCount = Math.min(rawAdvCount, tableRows.length - 1); // must leave at least 1 below

  return (
    <div className="wca-live-layout">
      {/* Sidebar */}
      <div className="wca-sidebar">
        <div className="wca-sidebar-comp-sel">
          <select value={compId} onChange={e => { setCompId(e.target.value); setEvId(''); setRound(1); }}>
            <option value="">— Select competition —</option>
            {comps.sort((a,b) => (String(b.date) || '').localeCompare(String(a.date) || '')).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="wca-sidebar-events">
          {!compId && <div style={{ padding: '0.9rem 0.85rem', color: 'var(--muted)', fontSize: '0.8rem' }}>Select a competition</div>}
          {evList.map(ev => (
            <div key={ev.id} className={`wca-event-item${evId === ev.id ? ' active' : ''}`}
              onClick={() => { setEvId(ev.id); setRound(1); }}>
              <span className="wca-event-short">{ev.short}</span>
              <span>{ev.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="wca-main">
        <div className="wca-main-header">
          <div>
            <div className="wca-comp-title">{selComp?.name || 'Select a competition'}</div>
            {selComp && <div className="wca-comp-meta">{selComp.status}{selComp.date ? ` · ${String(selComp.date)}` : ''}</div>}
          </div>
        </div>

        {evId && rounds.length > 0 && (
          <div className="wca-event-round-bar" style={{ display: 'flex' }}>
            <div className="wca-event-round-title">{WCA_EVENTS.find(e => e.id === evId)?.name}</div>
            <div className="wca-round-tabs">
              {rounds.map(r => (
                <button key={r} className={`wca-round-tab${round === r ? ' active' : ''}`} onClick={() => setRound(r)}>
                  R{r}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="wca-table-wrap">
          {!evId
            ? <div className="wca-empty">Select an event to view results.</div>
            : tableRows.length === 0
              ? <div className="wca-empty">No results for this round yet.</div>
              : (
                <table className="wca-results-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th className="th-r">Single</th>
                      <th className="th-r">Average</th>
                      <th className="th-r">S1</th><th className="th-r">S2</th>
                      <th className="th-r">S3</th><th className="th-r">S4</th><th className="th-r">S5</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.flatMap((r, i) => {
                      const isAdvancing = advanceCount > 0 && i < advanceCount;
                      const isLastAdvancing = advanceCount > 0 && i === advanceCount - 1;
                      const rowCls = i === 0 ? 'row-gold' : i === 1 ? 'row-silver' : i === 2 ? 'row-bronze' : r.source === 'import' ? 'row-imported' : '';
                      const advRow = (
                        <tr key={r.id} className={rowCls} style={isAdvancing ? { borderLeft: '3px solid #22c55e' } : { borderLeft: '3px solid transparent' }}>
                          <td className={`wca-td-rank${i < 3 ? ` wca-rank-${i+1}` : ''}`}
                            style={isAdvancing ? { color: '#4ade80' } : undefined}>
                            {i+1}
                          </td>
                          <td className="wca-td-name">
                            <div className="wca-name">{r.athleteName || r.athleteId}</div>
                          </td>
                          <td className={`wca-td-best${r.single != null && r.single < 0 ? ' dnf-solve' : ''}`}>{fmtTime(r.single)}</td>
                          <td className={`wca-td-avg${r.average != null && r.average < 0 ? ' dnf-avg' : ''}`}>{fmtTime(r.average)}</td>
                          {([0,1,2,3,4] as const).map(si => {
                            const sv = r.solves?.[si] ?? null;
                            return <td key={si} className={`wca-td-solve${sv !== null && sv < 0 ? ' dnf-solve' : ''}`}>{fmtTime(sv)}</td>;
                          })}
                          <td>
                            {r.source === 'import' && <span className="badge-imported">Imported</span>}
                          </td>
                        </tr>
                      );
                      if (isLastAdvancing) {
                        const cutoffLabel = advConfig?.type === 'fixed'
                          ? `✓ Top ${advanceCount} advance to next round`
                          : `✓ Top ${advConfig?.value}% advance (${advanceCount} athletes)`;
                        return [
                          advRow,
                          <tr key="advance-cutoff">
                            <td colSpan={10} style={{ padding: 0, borderBottom: 'none' }}>
                              <div style={{
                                borderTop: '2px dashed #22c55e',
                                padding: '0.25rem 0.75rem',
                                fontSize: '0.72rem',
                                color: '#4ade80',
                                background: 'rgba(34,197,94,0.05)',
                                letterSpacing: '0.01em',
                              }}>
                                {cutoffLabel}
                              </div>
                            </td>
                          </tr>,
                        ];
                      }
                      return [advRow];
                    })}
                  </tbody>
                </table>
              )
          }
        </div>
      </div>
    </div>
  );
}
