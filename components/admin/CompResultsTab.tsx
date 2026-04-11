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

  // Bulk-delete state
  const [deleteMode,    setDeleteMode]    = useState(false);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);

  // Select-all checkbox ref for indeterminate state
  const selectAllRef = useRef<HTMLInputElement>(null);

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

  // Exit delete mode when event or round changes
  useEffect(() => {
    setDeleteMode(false);
    setSelected(new Set());
    setDeleteConfirm(false);
  }, [evId, round]);

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

  function enterDeleteMode() {
    setDeleteMode(true);
    setSelected(new Set());
    setDeleteConfirm(false);
  }

  function exitDeleteMode() {
    setDeleteMode(false);
    setSelected(new Set());
    setDeleteConfirm(false);
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[], checked: boolean) {
    setSelected(checked ? new Set(ids) : new Set());
  }

  async function doDeleteSelected() {
    if (selected.size === 0) return;
    setDeleteWorking(true);
    try {
      await Promise.all([...selected].map(id => deleteResultFn(id)));
      exitDeleteMode();
    } catch { /* ignore */ } finally {
      setDeleteWorking(false);
    }
  }

  // Only show live / upcoming competitions
  const visibleComps = comps.filter(c => c.status === 'live' || c.status === 'upcoming');

  const selComp = comps.find(c => c.id === compId);
  const evList  = selComp?.events
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

  const rowIds = tableRows.map(r => r.id);
  const allChecked   = rowIds.length > 0 && rowIds.every(id => selected.has(id));
  const someChecked  = rowIds.some(id => selected.has(id));

  // Keep select-all checkbox indeterminate when partially selected
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someChecked && !allChecked;
    }
  }, [someChecked, allChecked]);

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

  // colSpan: 11 base + 1 checkbox column when in delete mode
  const colSpan = deleteMode ? 12 : 11;

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
                <>
                  {/* ── Table toolbar ── */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    gap: '0.5rem', marginBottom: '0.5rem',
                  }}>
                    {deleteMode ? (
                      <>
                        <button
                          onClick={exitDeleteMode}
                          style={{
                            padding: '0.28rem 0.75rem', fontSize: '0.76rem', borderRadius: '6px',
                            cursor: 'pointer', fontFamily: 'inherit',
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                            color: 'var(--muted)',
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => selected.size > 0 && setDeleteConfirm(true)}
                          disabled={selected.size === 0}
                          style={{
                            padding: '0.28rem 0.75rem', fontSize: '0.76rem', borderRadius: '6px',
                            cursor: selected.size > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                            fontWeight: 600,
                            background: selected.size > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.05)',
                            border: `1px solid ${selected.size > 0 ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.2)'}`,
                            color: selected.size > 0 ? '#fca5a5' : 'rgba(252,165,165,0.35)',
                            transition: 'all 0.15s',
                          }}
                        >
                          Delete Selected ({selected.size})
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={enterDeleteMode}
                        style={{
                          padding: '0.28rem 0.75rem', fontSize: '0.76rem', borderRadius: '6px',
                          cursor: 'pointer', fontFamily: 'inherit',
                          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                          color: '#fca5a5',
                        }}
                      >
                        Delete Results
                      </button>
                    )}
                  </div>

                  {/* ── Results table ── */}
                  <table className="wca-results-table">
                    <thead>
                      <tr>
                        {deleteMode && (
                          <th style={{ width: '2rem', textAlign: 'center', paddingRight: '0.2rem' }}>
                            <input
                              ref={selectAllRef}
                              type="checkbox"
                              checked={allChecked}
                              onChange={e => toggleAll(rowIds, e.target.checked)}
                              style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                            />
                          </th>
                        )}
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
                        const isAdvancing     = advanceCount > 0 && i < advanceCount;
                        const isLastAdvancing = advanceCount > 0 && i === advanceCount - 1;
                        const isChecked       = selected.has(r.id);
                        const rowCls = i === 0 ? 'row-gold' : i === 1 ? 'row-silver' : i === 2 ? 'row-bronze' : r.source === 'import' ? 'row-imported' : '';
                        const dataRow = (
                          <tr
                            key={r.id}
                            className={rowCls}
                            style={{
                              ...(isAdvancing ? { borderLeft: '3px solid #22c55e' } : { borderLeft: '3px solid transparent' }),
                              ...(deleteMode && isChecked ? { background: 'rgba(239,68,68,0.07)' } : {}),
                            }}
                          >
                            {deleteMode && (
                              <td style={{ textAlign: 'center', paddingRight: '0.2rem' }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleRow(r.id)}
                                  style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                                />
                              </td>
                            )}
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
                              <td colSpan={colSpan} style={{ padding: 0, borderBottom: 'none' }}>
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
                </>
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

      {/* ── Bulk Delete Confirmation Modal ───────────────────────────── */}
      {deleteConfirm && (
        <div
          onClick={() => !deleteWorking && setDeleteConfirm(false)}
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
              Delete {selected.size} {selected.size === 1 ? 'result' : 'results'}?
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem', lineHeight: 1.55 }}>
              This will permanently delete{' '}
              <strong style={{ color: 'var(--text)' }}>{selected.size} {selected.size === 1 ? 'result' : 'results'}</strong>.{' '}
              This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(false)}
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
                onClick={doDeleteSelected}
                disabled={deleteWorking}
                style={{
                  padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
                  background: deleteWorking ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)',
                  border: '1px solid rgba(239,68,68,0.6)',
                  color: '#fff', cursor: deleteWorking ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontWeight: 600,
                }}
              >
                {deleteWorking ? 'Deleting…' : `Delete ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
