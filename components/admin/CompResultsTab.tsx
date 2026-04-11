'use client';

import { useEffect, useState, useRef } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import { subscribeResultsByComp, saveResult, deleteResult as deleteResultFn } from '@/lib/firebase/services/results';
import type { Competition, Result, AdvancementConfig } from '@/lib/types';
import { fmtTime, parseTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';

function calcAo5(solves: (number | null)[]): number | null {
  const vals = solves.filter(v => v !== null) as number[];
  if (vals.length < 5) return null;
  const dnfCount = vals.filter(v => v < 0).length;
  if (dnfCount >= 2) return -1;
  const sorted = [...vals].sort((a, b) => { if (a < 0 && b < 0) return 0; if (a < 0) return 1; if (b < 0) return -1; return a - b; });
  const mid = sorted.slice(1, 4);
  if (mid.some(v => v < 0)) return -1;
  return Math.round(mid.reduce((s, v) => s + v, 0) / 3);
}

function bestOf(solves: (number | null)[]): number {
  const v = solves.filter(x => x !== null && Number(x) > 0) as number[];
  return v.length ? Math.min(...v) : -1;
}

export default function CompResultsTab() {
  const [comps, setComps]     = useState<Competition[]>([]);
  const [compId, setCompId]   = useState('');
  const [evId, setEvId]       = useState('');
  const [round, setRound]     = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  // Edit modal state
  const [editRow,    setEditRow]    = useState<Result | null>(null);
  const [editSolves, setEditSolves] = useState<string[]>(['', '', '', '', '']);
  const [editSaving, setEditSaving] = useState(false);
  const [editError,  setEditError]  = useState('');

  // Delete confirmation state
  const [deleteRow,     setDeleteRow]     = useState<Result | null>(null);
  const [deleteWorking, setDeleteWorking] = useState(false);

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

  function openEdit(r: Result) {
    setEditRow(r);
    setEditSolves([0, 1, 2, 3, 4].map(i => {
      const v = r.solves?.[i] ?? null;
      return v !== null ? fmtTime(v) : '';
    }));
    setEditError('');
  }

  async function saveEdit() {
    if (!editRow) return;
    setEditSaving(true);
    setEditError('');
    try {
      const parsed = editSolves.map(s => parseTime(s.trim() || null));
      const single = bestOf(parsed);
      const average = calcAo5(parsed);
      await saveResult(editRow.id, { ...editRow, solves: parsed, single, average });
      setEditRow(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  }

  async function doDelete() {
    if (!deleteRow) return;
    setDeleteWorking(true);
    try {
      await deleteResultFn(deleteRow.id);
      setDeleteRow(null);
    } catch { /* ignore */ } finally {
      setDeleteWorking(false);
    }
  }

  // Only show live / upcoming competitions
  const visibleComps = comps.filter(c => c.status === 'live' || c.status === 'upcoming');

  const selComp = comps.find(c => c.id === compId);
  const evList = selComp?.events
    ? WCA_EVENTS.filter(e => (selComp.events as Record<string, boolean>)?.[e.id])
    : [];
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
  const evConfig    = selComp?.eventConfig?.[evId];
  const totalRounds = evConfig?.rounds ?? 1;
  const isFinalRound = round >= totalRounds;
  const advConfig: AdvancementConfig | undefined =
    !isFinalRound ? (evConfig?.advancement?.[String(round)] as AdvancementConfig | undefined) : undefined;
  const rawAdvCount = advConfig
    ? advConfig.type === 'fixed'
      ? advConfig.value
      : Math.floor(tableRows.length * advConfig.value / 100)
    : 0;
  const advanceCount = Math.min(rawAdvCount, tableRows.length - 1);

  const solveInputStyle: React.CSSProperties = {
    width: '4.5rem', padding: '0.28rem 0.3rem', fontSize: '0.82rem',
    borderRadius: '5px', textAlign: 'center', fontFamily: 'inherit',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
    color: 'var(--text)', outline: 'none',
  };

  return (
    <div className="wca-live-layout">
      {/* Sidebar */}
      <div className="wca-sidebar">
        <div className="wca-sidebar-comp-sel">
          <select value={compId} onChange={e => { setCompId(e.target.value); setEvId(''); setRound(1); }}>
            <option value="">— Select competition —</option>
            {visibleComps
              .sort((a, b) => (String(b.date) || '').localeCompare(String(a.date) || ''))
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.status === 'live' ? ' 🔴' : ''}
                </option>
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
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.flatMap((r, i) => {
                      const isAdvancing    = advanceCount > 0 && i < advanceCount;
                      const isLastAdvancing = advanceCount > 0 && i === advanceCount - 1;
                      const rowCls = i === 0 ? 'row-gold' : i === 1 ? 'row-silver' : i === 2 ? 'row-bronze' : r.source === 'import' ? 'row-imported' : '';
                      const dataRow = (
                        <tr key={r.id} className={rowCls} style={isAdvancing ? { borderLeft: '3px solid #22c55e' } : { borderLeft: '3px solid transparent' }}>
                          <td className={`wca-td-rank${i < 3 ? ` wca-rank-${i + 1}` : ''}`}
                            style={isAdvancing ? { color: '#4ade80' } : undefined}>
                            {i + 1}
                          </td>
                          <td className="wca-td-name">
                            <div className="wca-name">{r.athleteName || r.athleteId}</div>
                          </td>
                          <td className={`wca-td-best${r.single != null && r.single < 0 ? ' dnf-solve' : ''}`}>{fmtTime(r.single)}</td>
                          <td className={`wca-td-avg${r.average != null && r.average < 0 ? ' dnf-avg' : ''}`}>{fmtTime(r.average)}</td>
                          {([0, 1, 2, 3, 4] as const).map(si => {
                            const sv = r.solves?.[si] ?? null;
                            return <td key={si} className={`wca-td-solve${sv !== null && sv < 0 ? ' dnf-solve' : ''}`}>{fmtTime(sv)}</td>;
                          })}
                          <td>
                            {r.source === 'import' && <span className="badge-imported">Imported</span>}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <button
                              onClick={() => openEdit(r)}
                              title="Edit result"
                              className="res-act-btn res-act-edit"
                            >
                              <span className="res-act-text">Edit</span>
                              <span className="res-act-icon">✏️</span>
                            </button>
                            <button
                              onClick={() => setDeleteRow(r)}
                              title="Delete result"
                              className="res-act-btn res-act-delete"
                            >
                              <span className="res-act-text">Delete</span>
                              <span className="res-act-icon">🗑️</span>
                            </button>
                          </td>
                        </tr>
                      );
                      if (isLastAdvancing) {
                        const cutoffLabel = advConfig?.type === 'fixed'
                          ? `✓ Top ${advanceCount} advance to next round`
                          : `✓ Top ${advConfig?.value}% advance (${advanceCount} athletes)`;
                        return [
                          dataRow,
                          <tr key="advance-cutoff">
                            <td colSpan={11} style={{ padding: 0, borderBottom: 'none' }}>
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
                      return [dataRow];
                    })}
                  </tbody>
                </table>
              )
          }
        </div>
      </div>

      {/* ── Edit Modal ───────────────────────────────────────────────── */}
      {editRow && (
        <div
          onClick={() => !editSaving && setEditRow(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--card, #1a1730)',
              border: '1px solid rgba(99,102,241,0.35)',
              borderRadius: '14px',
              padding: '1.5rem',
              maxWidth: '400px', width: '100%',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
            }}
          >
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.2rem' }}>
              Edit Result
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '1.1rem' }}>
              {editRow.athleteName || editRow.athleteId}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.22rem' }}>
                  <label style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                    S{i + 1}
                  </label>
                  <input
                    type="text"
                    value={editSolves[i]}
                    onChange={e => {
                      const v = [...editSolves];
                      v[i] = e.target.value;
                      setEditSolves(v);
                    }}
                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                    placeholder="—"
                    style={solveInputStyle}
                  />
                </div>
              ))}
            </div>

            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '1rem', opacity: 0.7 }}>
              Enter times like <code style={{ fontFamily: 'monospace' }}>9.45</code>, <code style={{ fontFamily: 'monospace' }}>1:23.45</code>, <code style={{ fontFamily: 'monospace' }}>DNF</code>, or <code style={{ fontFamily: 'monospace' }}>DNS</code>
            </div>

            {editError && (
              <div style={{ fontSize: '0.78rem', color: '#f87171', marginBottom: '0.8rem' }}>{editError}</div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditRow(null)}
                disabled={editSaving}
                style={{
                  padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                style={{
                  padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
                  background: editSaving ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.7)',
                  border: '1px solid rgba(99,102,241,0.6)',
                  color: '#fff', cursor: editSaving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontWeight: 600,
                }}
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────────── */}
      {deleteRow && (
        <div
          onClick={() => !deleteWorking && setDeleteRow(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--card, #1a1730)',
              border: '1px solid rgba(239,68,68,0.35)',
              borderRadius: '14px',
              padding: '1.5rem',
              maxWidth: '360px', width: '100%',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
            }}
          >
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.4rem' }}>
              Delete result?
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem', lineHeight: 1.55 }}>
              Delete result for{' '}
              <strong style={{ color: 'var(--text)' }}>
                {deleteRow.athleteName || deleteRow.athleteId}
              </strong>?
              {' '}This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteRow(null)}
                disabled={deleteWorking}
                style={{
                  padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={doDelete}
                disabled={deleteWorking}
                style={{
                  padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
                  background: deleteWorking ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)',
                  border: '1px solid rgba(239,68,68,0.6)',
                  color: '#fff', cursor: deleteWorking ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontWeight: 600,
                }}
              >
                {deleteWorking ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
