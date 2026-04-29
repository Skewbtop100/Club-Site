'use client';

import { useEffect, useState, useRef } from 'react';
import { subscribeCompetitions, updateCompetition } from '@/lib/firebase/services/competitions';
import { subscribeResultsByComp, saveResult, deleteResult as deleteResultFn } from '@/lib/firebase/services/results';
import type { Competition, Result, AdvancementConfig } from '@/lib/types';
import { fmtTime, parseTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import { useLang, type TranslationKey } from '@/lib/i18n';

// ── helpers ──────────────────────────────────────────────────────────────────

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

/** Human-readable round name following WCA convention */
function getRoundLabel(roundNum: number, totalRounds: number, t: (k: TranslationKey) => string): string {
  if (totalRounds === 1) return t('admin.round.final');
  if (roundNum === totalRounds) return t('admin.round.final');
  if (totalRounds === 4 && roundNum === 3) return t('admin.round.semi');
  if (roundNum === 1) return t('admin.round.first');
  if (roundNum === 2) return t('admin.round.second');
  if (roundNum === 3) return t('admin.round.third');
  return `${t('admin.round.generic')} ${roundNum}`;
}

/** Mark the best (dropped-best) and worst (dropped-worst) solve indices in an ao5 */
function getSolveHint(solves: (number | null)[], idx: number): 'best' | 'worst' | null {
  if (!solves || solves.length < 5) return null;
  // rank: valid time ascending < DNF < DNS < null (null = not entered)
  const rank = (v: number | null): number => {
    if (v === null) return 4e9;
    if (v === -2) return 3e9;  // DNS
    if (v < 0)   return 2e9;  // DNF
    return v;
  };
  const scored = solves.map((v, i) => ({ r: rank(v), i })).sort((a, b) => a.r !== b.r ? a.r - b.r : a.i - b.i);
  if (scored[0].i === idx) return 'best';
  if (scored[4].i === idx) return 'worst';
  return null;
}

const rKey = (evId: string, r: number) => `${evId}_r${r}`;

// ── component ─────────────────────────────────────────────────────────────────

export default function CompResultsTab() {
  const { t } = useLang();
  const [comps, setComps]     = useState<Competition[]>([]);
  const [compId, setCompId]   = useState('');
  const [evId, setEvId]       = useState('');
  const [round, setRound]     = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  // Sidebar: which events are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Edit modal
  const [editRow,    setEditRow]    = useState<Result | null>(null);
  const [editSolves, setEditSolves] = useState<string[]>(['', '', '', '', '']);
  const [editSaving, setEditSaving] = useState(false);
  const [editError,  setEditError]  = useState('');

  // Bulk-delete
  const [deleteMode,    setDeleteMode]    = useState(false);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Round status
  const [statusWorking, setStatusWorking] = useState(false);

  // ── subscriptions ───────────────────────────────────────────────────────────

  useEffect(() => {
    return subscribeCompetitions(data => setComps(data));
  }, []);

  useEffect(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    if (!compId) { setResults([]); return; }
    const unsub = subscribeResultsByComp(compId, setResults);
    unsubRef.current = unsub;
    return () => unsub();
  }, [compId]);

  // Reset navigation when competition changes
  useEffect(() => {
    setEvId(''); setRound(1); setExpanded(new Set());
    setDeleteMode(false); setSelected(new Set()); setDeleteConfirm(false);
  }, [compId]);

  // Reset delete mode when event/round changes
  useEffect(() => {
    setDeleteMode(false); setSelected(new Set()); setDeleteConfirm(false);
  }, [evId, round]);

  // ── edit handlers ────────────────────────────────────────────────────────────

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
    setEditSaving(true); setEditError('');
    try {
      const parsed = editSolves.map(s => parseTime(s.trim() || null));
      await saveResult(editRow.id, { ...editRow, solves: parsed, single: bestOf(parsed), average: calcAo5(parsed) });
      setEditRow(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  }

  // ── bulk-delete handlers ─────────────────────────────────────────────────────

  function toggleRow(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll(ids: string[], on: boolean) {
    setSelected(on ? new Set(ids) : new Set());
  }

  async function doDeleteSelected() {
    if (!selected.size) return;
    setDeleteWorking(true);
    try {
      await Promise.all([...selected].map(id => deleteResultFn(id)));
      setDeleteMode(false); setSelected(new Set()); setDeleteConfirm(false);
    } catch { /* ignore */ } finally { setDeleteWorking(false); }
  }

  // ── round status handler ─────────────────────────────────────────────────────

  async function setRoundStatus(ev: string, r: number, newStatus: 'complete' | 'ongoing' | null) {
    if (!compId || !selComp) return;
    setStatusWorking(true);
    try {
      const existing = (selComp.roundStatus ?? {}) as Record<string, 'complete' | 'ongoing'>;
      const updated  = { ...existing };
      const key = rKey(ev, r);
      if (newStatus === null) delete updated[key]; else updated[key] = newStatus;
      await updateCompetition(compId, { roundStatus: updated });
    } catch { /* ignore */ } finally { setStatusWorking(false); }
  }

  // ── derived data ─────────────────────────────────────────────────────────────

  const visibleComps = comps.filter(c => c.status === 'live' || c.status === 'upcoming');
  const selComp      = comps.find(c => c.id === compId);
  const clubAthleteIds = new Set((selComp?.athletes ?? []).map(a => a.id));

  const compEvents = selComp?.events
    ? WCA_EVENTS.filter(e => (selComp.events as Record<string, boolean>)?.[e.id])
    : [];

  function totalRoundsFor(ev: string) {
    return selComp?.eventConfig?.[ev]?.rounds ?? 1;
  }

  // WCA ranking: average first, then single; negatives = worst
  function wcaSort(a: Result, b: Result) {
    const s = (r: Result): [number, number] => {
      const avg = r.average != null && r.average > 0 ? r.average : null;
      const sng = r.single  != null && r.single  > 0 ? r.single  : null;
      return [avg ?? Infinity, sng ?? Infinity];
    };
    const [pa, sa] = s(a), [pb, sb] = s(b);
    return pa !== pb ? pa - pb : sa - sb;
  }

  const tableRows = results
    .filter(r => r.eventId === evId && (r.round || 1) === round)
    .sort(wcaSort);

  const rowIds      = tableRows.map(r => r.id);
  const allChecked  = rowIds.length > 0 && rowIds.every(id => selected.has(id));
  const someChecked = rowIds.some(id => selected.has(id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked]);

  // Advancement cutoff
  const evCfg       = selComp?.eventConfig?.[evId];
  const totalRounds = evCfg?.rounds ?? 1;
  const isFinal     = round >= totalRounds;
  const advCfg: AdvancementConfig | undefined =
    !isFinal ? (evCfg?.advancement?.[String(round)] as AdvancementConfig | undefined) : undefined;
  const rawAdv  = advCfg
    ? advCfg.type === 'fixed' ? advCfg.value : Math.floor(tableRows.length * advCfg.value / 100)
    : 0;
  const advanceCount = Math.min(rawAdv, tableRows.length - 1);

  const colSpan  = deleteMode ? 12 : 11;
  const curStatus = selComp?.roundStatus?.[rKey(evId, round)] ?? null;

  // ── solve input style ────────────────────────────────────────────────────────

  const solveInputStyle: React.CSSProperties = {
    width: '4.5rem', padding: '0.28rem 0.3rem', fontSize: '0.82rem',
    borderRadius: '5px', textAlign: 'center', fontFamily: 'inherit',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
    color: 'var(--text)', outline: 'none',
  };

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="wca-live-layout">

      {/* ── Sidebar ── */}
      <div className="wca-sidebar">
        {/* Competition selector */}
        <div className="wca-sidebar-comp-sel">
          <select value={compId} onChange={e => setCompId(e.target.value)}>
            <option value="">{t('admin.cr.select-comp')}</option>
            {visibleComps
              .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.status === 'live' ? ' 🔴' : ''}
                </option>
              ))}
          </select>
        </div>

        {/* Event list — collapsible groups */}
        <div className="wca-sidebar-events">
          {!compId && (
            <div style={{ padding: '0.9rem 0.85rem', color: 'var(--muted)', fontSize: '0.8rem' }}>
              {t('admin.cr.select-comp-prompt')}
            </div>
          )}
          {compEvents.map(ev => {
            const total      = totalRoundsFor(ev.id);
            const isOpen     = expanded.has(ev.id);
            const hasActive  = evId === ev.id;

            return (
              <div key={ev.id} className="wca-ev-group">
                {/* Event header row */}
                <div
                  className={`wca-ev-header${hasActive ? ' has-active' : ''}`}
                  onClick={() => {
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

                {/* Round sub-items */}
                {isOpen && Array.from({ length: total }, (_, i) => i + 1).map(r => {
                  const label   = getRoundLabel(r, total, t);
                  const st      = selComp?.roundStatus?.[rKey(ev.id, r)] ?? null;
                  const isActive = evId === ev.id && round === r;
                  return (
                    <div
                      key={r}
                      className={`wca-ev-round-item${isActive ? ' active' : ''}${st === 'complete' ? ' complete' : ''}`}
                      onClick={() => { setEvId(ev.id); setRound(r); }}
                    >
                      {/* Status icon */}
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

      {/* ── Main area ── */}
      <div className="wca-main">

        {/* Competition title */}
        <div className="wca-main-header">
          <div>
            <div className="wca-comp-title">{selComp?.name ?? t('admin.cr.select-comp-prompt')}</div>
            {selComp && (
              <div className="wca-comp-meta">
                <span>{selComp.status}</span>
                {selComp.date && <span>· {String(selComp.date).slice(0, 10)}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Round header */}
        {evId && (
          <div className="wca-round-header">
            <div className="wca-round-header-left">
              <span className="wca-round-event-name">
                {WCA_EVENTS.find(e => e.id === evId)?.name}
              </span>
              <span className="wca-round-label">
                {getRoundLabel(round, totalRoundsFor(evId), t)}
              </span>
              {/* Status badge */}
              {curStatus === 'ongoing'  && <span className="wca-round-badge wca-round-badge-live">{t('admin.cr.round.live-badge')}</span>}
              {curStatus === 'complete' && <span className="wca-round-badge wca-round-badge-done">{t('admin.cr.round.complete-badge')}</span>}
            </div>
            {/* Admin: round tabs + status buttons */}
            <div className="wca-round-header-right">
              {/* Round tabs (mobile round navigation) */}
              <div className="wca-round-tabs">
                {Array.from({ length: totalRoundsFor(evId) }, (_, i) => i + 1).map(r => (
                  <button
                    key={r}
                    className={`wca-round-tab${round === r ? ' active' : ''}`}
                    onClick={() => setRound(r)}
                  >
                    {getRoundLabel(r, totalRoundsFor(evId), t)}
                  </button>
                ))}
              </div>
              {/* Status buttons */}
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                <button
                  disabled={statusWorking}
                  onClick={() => setRoundStatus(evId, round, curStatus === 'ongoing' ? null : 'ongoing')}
                  className={`wca-status-btn${curStatus === 'ongoing' ? ' active-live' : ''}`}
                >
                  {t('admin.cr.round.live-btn')}
                </button>
                <button
                  disabled={statusWorking}
                  onClick={() => setRoundStatus(evId, round, curStatus === 'complete' ? null : 'complete')}
                  className={`wca-status-btn${curStatus === 'complete' ? ' active-done' : ''}`}
                >
                  {t('admin.cr.round.done-btn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table area */}
        <div className="wca-table-wrap">
          {!evId
            ? <div className="wca-empty">{t('admin.cr.empty-event')}</div>
            : tableRows.length === 0
              ? <div className="wca-empty">{t('admin.cr.empty-results')}</div>
              : (
                <>
                  {/* Toolbar */}
                  <div className="wca-table-toolbar">
                    {deleteMode ? (
                      <>
                        <button onClick={() => { setDeleteMode(false); setSelected(new Set()); setDeleteConfirm(false); }} className="wca-toolbar-btn">
                          {t('admin.btn.cancel')}
                        </button>
                        <button
                          disabled={selected.size === 0}
                          onClick={() => selected.size > 0 && setDeleteConfirm(true)}
                          className="wca-toolbar-btn danger"
                          style={{ opacity: selected.size === 0 ? 0.4 : 1 }}
                        >
                          {t('admin.cr.btn.delete-selected')} ({selected.size})
                        </button>
                      </>
                    ) : (
                      <button onClick={() => { setDeleteMode(true); setSelected(new Set()); }} className="wca-toolbar-btn danger-outline">
                        {t('admin.cr.btn.delete-mode')}
                      </button>
                    )}
                  </div>

                  {/* Results table — WCA Live style */}
                  <table className="wca-results-table">
                    <thead>
                      <tr>
                        {deleteMode && (
                          <th style={{ width: '2rem', textAlign: 'center' }}>
                            <input
                              ref={selectAllRef}
                              type="checkbox"
                              checked={allChecked}
                              onChange={e => toggleAll(rowIds, e.target.checked)}
                              style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                            />
                          </th>
                        )}
                        <th style={{ width: '2rem' }}>#</th>
                        <th>{t('admin.cr.col.athlete')}</th>
                        <th>{t('admin.cr.col.country')}</th>
                        <th className="th-r">1</th>
                        <th className="th-r">2</th>
                        <th className="th-r">3</th>
                        <th className="th-r">4</th>
                        <th className="th-r">5</th>
                        <th className="th-r">{t('admin.cr.col.average')}</th>
                        <th className="th-r">{t('admin.cr.col.best')}</th>
                        <th style={{ width: '2.5rem' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.flatMap((r, i) => {
                        const isAdvancing     = advanceCount > 0 && i < advanceCount;
                        const isLastAdvancing = advanceCount > 0 && i === advanceCount - 1;
                        const isClub          = clubAthleteIds.has(r.athleteId);
                        const isChecked       = selected.has(r.id);

                        // Row class: gold/silver/bronze take priority, then club highlight
                        const rowCls = i === 0 ? 'row-gold' : i === 1 ? 'row-silver' : i === 2 ? 'row-bronze' : isClub ? 'row-club' : '';

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
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleRow(r.id)}
                                  style={{ accentColor: '#ef4444', cursor: 'pointer' }}
                                />
                              </td>
                            )}

                            {/* Rank */}
                            <td className={`wca-td-rank${i < 3 ? ` wca-rank-${i + 1}` : ''}`}
                              style={isAdvancing ? { color: '#4ade80' } : undefined}>
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

                            {/* Edit action */}
                            <td style={{ textAlign: 'right' }}>
                              <button onClick={() => openEdit(r)} title={t('admin.btn.edit')} className="res-act-btn res-act-edit">
                                <span className="res-act-text">{t('admin.btn.edit')}</span>
                                <span className="res-act-icon">✏️</span>
                              </button>
                            </td>
                          </tr>
                        );

                        // Advancement cutoff separator
                        if (isLastAdvancing) {
                          const label = advCfg?.type === 'fixed'
                            ? `${t('admin.cr.advance-prefix')} ${advanceCount} ${t('admin.cr.advance-fixed')}`
                            : `${t('admin.cr.advance-prefix')} ${advCfg?.value}% (${advanceCount} ${t('admin.cr.advance-percent-suffix')})`;
                          return [
                            dataRow,
                            <tr key="adv-cutoff">
                              <td colSpan={colSpan} style={{ padding: 0, borderBottom: 'none' }}>
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
                </>
              )
          }
        </div>
      </div>

      {/* ── Edit Modal ───────────────────────────────────────────────────────── */}
      {editRow && (
        <div onClick={() => !editSaving && setEditRow(null)} className="wca-modal-backdrop">
          <div onClick={e => e.stopPropagation()} className="wca-modal" style={{ borderColor: 'rgba(99,102,241,0.35)' }}>
            <div className="wca-modal-title">{t('admin.cr.edit.title')}</div>
            <div className="wca-modal-sub">{editRow.athleteName || editRow.athleteId}</div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.22rem' }}>
                  <label style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.04em' }}>S{i + 1}</label>
                  <input
                    type="text"
                    value={editSolves[i]}
                    onChange={e => { const v = [...editSolves]; v[i] = e.target.value; setEditSolves(v); }}
                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                    placeholder="—"
                    style={solveInputStyle}
                  />
                </div>
              ))}
            </div>

            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '1rem', opacity: 0.7 }}>
              {t('admin.cr.edit.help-prefix')} <code style={{ fontFamily: 'monospace' }}>9.45</code>,{' '}
              <code style={{ fontFamily: 'monospace' }}>1:23.45</code>,{' '}
              <code style={{ fontFamily: 'monospace' }}>DNF</code>, {t('admin.cr.edit.help-or')}{' '}
              <code style={{ fontFamily: 'monospace' }}>DNS</code>
            </div>

            {editError && <div style={{ fontSize: '0.78rem', color: '#f87171', marginBottom: '0.8rem' }}>{editError}</div>}

            <div className="wca-modal-actions">
              <button onClick={() => setEditRow(null)} disabled={editSaving} className="wca-modal-btn">{t('admin.btn.cancel')}</button>
              <button onClick={saveEdit} disabled={editSaving} className="wca-modal-btn primary" style={{ background: editSaving ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.7)', borderColor: 'rgba(99,102,241,0.6)' }}>
                {editSaving ? t('admin.cr.edit.saving') : t('admin.btn.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Delete Confirmation Modal ───────────────────────────────────── */}
      {deleteConfirm && (
        <div onClick={() => !deleteWorking && setDeleteConfirm(false)} className="wca-modal-backdrop">
          <div onClick={e => e.stopPropagation()} className="wca-modal" style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
            <div className="wca-modal-title">{t('admin.cr.delete.title')}</div>
            <div className="wca-modal-sub" style={{ marginBottom: '1.25rem' }}>
              <strong style={{ color: 'var(--text)' }}>{selected.size} {selected.size === 1 ? t('admin.cr.delete.result-1') : t('admin.cr.delete.result-n')}</strong>
              {' '}— {t('admin.cr.delete.warning')}
            </div>
            <div className="wca-modal-actions">
              <button onClick={() => setDeleteConfirm(false)} disabled={deleteWorking} className="wca-modal-btn">{t('admin.btn.cancel')}</button>
              <button onClick={doDeleteSelected} disabled={deleteWorking} className="wca-modal-btn danger" style={{ background: deleteWorking ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)', borderColor: 'rgba(239,68,68,0.6)' }}>
                {deleteWorking ? t('admin.cr.delete.deleting') : `${t('admin.btn.delete')} ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
