'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { saveResult } from '@/lib/firebase/services/results';
import { fmtTime, parseTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Athlete, Competition } from '@/lib/types';

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

interface PanelState {
  id: number; athleteId: string; eventId: string; round: number; group: number;
  solves: string[]; penalties: ('none' | '+2' | 'dnf')[];
  currentSolveIdx: number; rawInput: string;
  selectedChip: number | null;   // which prior-solve chip is showing Edit button (during entry)
  editReturnIdx: number | null;  // where to return after editing a prior solve
  postEditMode: boolean;         // in all-entered view: chips are directly tappable to edit
  msg: string; msgType: string;
}
function emptyPanel(id: number): PanelState {
  return {
    id, athleteId: '', eventId: '', round: 1, group: 1,
    solves: ['', '', '', '', ''], penalties: ['none', 'none', 'none', 'none', 'none'],
    currentSolveIdx: 0, rawInput: '',
    selectedChip: null, editReturnIdx: null, postEditMode: false,
    msg: '', msgType: '',
  };
}

/** Strip formatting to get back the raw digit string for re-editing.
 *  "8.11" → "811", "1:11.11" → "11111", "11:11.11" → "111111"
 */
function timeToRawDigits(timeStr: string): string {
  return timeStr.replace(/[^0-9]/g, '');
}

function getRoundNames(totalRounds: number): string[] {
  if (totalRounds <= 1) return ['Final'];
  if (totalRounds === 2) return ['First Round', 'Final'];
  if (totalRounds === 3) return ['First Round', 'Second Round', 'Final'];
  return ['First Round', 'Second Round', 'Semi Final', 'Final'];
}

/** Convert raw digit string to parseable time string.
 *  "11" → "0.11", "111" → "1.11", "1111" → "11.11",
 *  "11111" → "1:11.11", "111111" → "11:11.11"
 */
function formatRawDigits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  const padded = d.length < 2 ? d.padStart(2, '0') : d;
  const cs = padded.slice(-2);
  const rest = padded.slice(0, -2);
  if (!rest || parseInt(rest, 10) === 0) return `0.${cs}`;
  const secsStr = rest.slice(-2).padStart(2, '0');
  const minsStr = rest.slice(0, -2);
  if (!minsStr || parseInt(minsStr, 10) === 0) return `${parseInt(secsStr, 10)}.${cs}`;
  return `${parseInt(minsStr, 10)}:${secsStr}.${cs}`;
}

export default function ResultsEntryTab() {
  const [athletes, setAthletes]   = useState<Athlete[]>([]);
  const [comps, setComps]         = useState<Competition[]>([]);
  const [compId, setCompId]       = useState('');
  const [panels, setPanels]       = useState<PanelState[]>([emptyPanel(0)]);

  // Inspection timer state
  const [showTimer, setShowTimer]       = useState(false);
  const [timerMs, setTimerMs]           = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStopped, setTimerStopped] = useState(false);
  const timerIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStartRef     = useRef<number>(0);
  const timerAccRef       = useRef<number>(0);
  const lastMilestoneRef  = useRef<number>(0);

  useEffect(() => {
    getAthletes().then(setAthletes);
    const unsub = subscribeCompetitions((data) => setComps(data));
    return unsub;
  }, []);
  useEffect(() => {
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, []);

  function updatePanel(id: number, patch: Partial<PanelState>) {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  function setPenaltyCurrent(panelId: number, pen: 'none' | '+2' | 'dnf') {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const ps = [...p.penalties];
      const idx = p.currentSolveIdx;
      if (idx >= 5) return p;
      ps[idx] = ps[idx] === pen ? 'none' : pen;
      return { ...p, penalties: ps };
    }));
  }

  function advanceSolve(panelId: number) {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const idx = p.currentSolveIdx;
      if (idx >= 5) return p;
      const newSolves = [...p.solves];
      newSolves[idx] = p.penalties[idx] === 'dnf' ? '' : formatRawDigits(p.rawInput);
      // If we were editing a prior solve, return to the original position
      const nextIdx = p.editReturnIdx !== null ? p.editReturnIdx : idx + 1;
      return { ...p, solves: newSolves, currentSolveIdx: nextIdx, rawInput: '', editReturnIdx: null, selectedChip: null };
    }));
  }

  function startEditPriorSolve(panelId: number, solveIdx: number, returnTo?: number) {
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      return {
        ...p,
        currentSolveIdx: solveIdx,
        rawInput: p.penalties[solveIdx] === 'dnf' ? '' : timeToRawDigits(p.solves[solveIdx]),
        editReturnIdx: returnTo !== undefined ? returnTo : p.currentSolveIdx,
        selectedChip: null,
        postEditMode: false,
      };
    }));
  }

  function computeResult(p: PanelState) {
    const parsed = p.solves.map((s, i) => {
      if (p.penalties[i] === 'dnf') return -1;
      const v = parseTime(s); if (v === null) return null;
      return p.penalties[i] === '+2' ? (v < 0 ? v : v + 200) : v;
    });
    return { single: bestOf(parsed), average: calcAo5(parsed), parsed };
  }

  async function submit(panelId: number) {
    const panel = panels.find(p => p.id === panelId)!;
    if (!panel.athleteId || !compId || !panel.eventId) {
      updatePanel(panelId, { msg: 'Please fill athlete, event and round.', msgType: 'error' }); return;
    }
    const { single, average, parsed } = computeResult(panel);
    const comp = comps.find(c => c.id === compId);
    const ath  = athletes.find(a => a.id === panel.athleteId);
    const docId = `${compId}_${panel.eventId}_r${panel.round}_${panel.athleteId}`;
    try {
      await saveResult(docId, {
        athleteId: panel.athleteId, athleteName: ath?.name || '',
        competitionId: compId, competitionName: comp?.name || '',
        eventId: panel.eventId, round: panel.round,
        single: single < 0 ? single : single, average,
        solves: parsed, status: 'published', source: 'entry',
      });
      updatePanel(panelId, { msg: `✓ Saved! Single: ${fmtTime(single)} Ao5: ${fmtTime(average)}`, msgType: 'success' });
    } catch (e: unknown) {
      updatePanel(panelId, { msg: 'Error: ' + (e instanceof Error ? e.message : String(e)), msgType: 'error' });
    }
  }

  // ── Inspection timer helpers ──────────────────────────────────────────────────

  function playBeep(freq: number, dur: number) {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur);
      osc.onended = () => ctx.close();
    } catch { /* audio unavailable */ }
  }

  function tapTimer() {
    if (timerRunning) {
      if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
      setTimerRunning(false);
      setTimerStopped(true);
    } else {
      timerStartRef.current = Date.now() - timerAccRef.current;
      setTimerRunning(true);
      setTimerStopped(false);
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - timerStartRef.current;
        timerAccRef.current = elapsed;
        setTimerMs(elapsed);
        const s = elapsed / 1000;
        if (s >= 8  && lastMilestoneRef.current < 8)  { lastMilestoneRef.current = 8;  playBeep(880,  0.18); }
        if (s >= 12 && lastMilestoneRef.current < 12) { lastMilestoneRef.current = 12; playBeep(1100, 0.18); }
        if (s >= 17) {
          clearInterval(timerIntervalRef.current!);
          timerIntervalRef.current = null;
          setTimerRunning(false);
          setTimerStopped(true);
        }
      }, 30);
    }
  }

  function resetTimer() {
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    setTimerRunning(false);
    setTimerStopped(false);
    timerAccRef.current    = 0;
    lastMilestoneRef.current = 0;
    setTimerMs(0);
  }

  function fmtInspection(ms: number) { return (ms / 1000).toFixed(1) + 's'; }

  function timerColor(ms: number) {
    const s = ms / 1000;
    if (s >= 17) return '#7f1d1d';
    if (s >= 15) return '#ef4444';
    if (s >= 12) return '#f97316';
    if (s >= 8)  return '#fbbf24';
    return '#f8fafc';
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const selComp     = comps.find(c => c.id === compId);
  const evList      = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : WCA_EVENTS;
  const liveComps   = comps.filter(c => c.status === 'live' || c.status === 'upcoming');
  const compAthletes = selComp?.athletes;
  const eventConfig = selComp?.eventConfig || {};

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />Results Entry</div>

      {/* Competition selector + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ maxWidth: '340px', marginBottom: 0, flex: 1, minWidth: '200px' }}>
          <label>Competition</label>
          <select value={compId} onChange={e => { setCompId(e.target.value); setPanels([emptyPanel(0)]); resetTimer(); setShowTimer(false); }}>
            <option value="">— Select competition —</option>
            {liveComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {compId && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', paddingTop: '1.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Panels: <strong>{panels.length}</strong></span>
            <button className="btn-xs" onClick={() => setPanels(p => [...p, emptyPanel(p.length)])}>+ Add Panel</button>
            <button className="btn-xs" onClick={() => { if (panels.length <= 1) return; setPanels(p => p.slice(0, -1)); }}>− Remove</button>
            <button
              className="btn-xs"
              onClick={() => { if (showTimer) { resetTimer(); setShowTimer(false); } else setShowTimer(true); }}
              style={{
                background: showTimer
                  ? 'linear-gradient(135deg, rgba(45,212,191,0.35), rgba(6,182,212,0.35))'
                  : 'linear-gradient(135deg, rgba(45,212,191,0.15), rgba(6,182,212,0.15))',
                border: `1px solid ${showTimer ? 'rgba(45,212,191,0.65)' : 'rgba(45,212,191,0.35)'}`,
                color: showTimer ? '#5eead4' : '#2dd4bf',
              }}
            >
              Inspection Timer
            </button>
          </div>
        )}
      </div>

      {!compId && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
          Select a competition to start entering results.
        </div>
      )}


      {/* ── Entry Panels ─────────────────────────────────────────────────────── */}
      {compId && (
        <div className="multi-entry-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {panels.map(panel => {
            const cfg        = eventConfig[panel.eventId] || { rounds: 1, groups: 1 };
            const roundNames = getRoundNames(cfg.rounds);
            const groupCount = cfg.groups;
            // In edit mode we're not "all entered" even if currentSolveIdx reached 5
            const allEntered = panel.currentSolveIdx >= 5 && panel.editReturnIdx === null;
            const { single, average } = computeResult(panel);

            const panelAthletes = compAthletes
              ? athletes.filter(a => {
                  const ca = compAthletes.find(x => x.id === a.id);
                  if (!ca) return false;
                  if (!panel.eventId) return true;
                  return ca.events.includes(panel.eventId);
                })
              : athletes;

            const curIdx     = panel.currentSolveIdx;
            const curPenalty = curIdx < 5 ? panel.penalties[curIdx] : 'none';
            const preview    = curIdx < 5 && curPenalty !== 'dnf' ? formatRawDigits(panel.rawInput) : '';
            const canAdvance = curPenalty === 'dnf' || panel.rawInput.length > 0;
            const isEditMode = panel.editReturnIdx !== null;

            return (
              <div className="compact-panel" key={panel.id}>
                <div className="compact-panel-header">
                  <span className="compact-panel-title">Panel {panel.id + 1}</span>
                  <div className="compact-panel-actions">
                    <button className="btn-xs" onClick={() => updatePanel(panel.id, { ...emptyPanel(panel.id) })}>Clear</button>
                  </div>
                </div>

                {/* Athlete */}
                <select className="compact-select" value={panel.athleteId}
                  onChange={e => updatePanel(panel.id, { athleteId: e.target.value })}>
                  <option value="">— Athlete —</option>
                  {[...panelAthletes].sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>

                {/* Event */}
                <select className="compact-select" value={panel.eventId}
                  onChange={e => updatePanel(panel.id, { eventId: e.target.value, round: 1, group: 1 })}>
                  <option value="">— Event —</option>
                  {evList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>

                {/* Round + Group */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.3rem' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.2rem', paddingLeft: '0.1rem' }}>Round</div>
                    <select className="compact-select" value={panel.round} style={{ marginBottom: 0 }}
                      onChange={e => updatePanel(panel.id, { round: Number(e.target.value) })}>
                      {roundNames.map((name, idx) => (
                        <option key={idx} value={idx + 1}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.2rem', paddingLeft: '0.1rem' }}>Group</div>
                    <select className="compact-select" value={panel.group} style={{ marginBottom: 0 }}
                      onChange={e => updatePanel(panel.id, { group: Number(e.target.value) })}>
                      {Array.from({ length: Math.max(1, groupCount) }, (_, i) => (
                        <option key={i} value={i + 1}>Group {String.fromCharCode(65 + i)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* ── Inspection Timer (shown when toggled from toolbar) ────── */}
                <div style={{ marginBottom: showTimer ? '0.4rem' : 0 }}>
                  {showTimer && (() => {
                    const color  = timerColor(timerMs);
                    const isDnf  = timerMs / 1000 >= 17;
                    const isPlus2 = timerMs / 1000 >= 15 && !isDnf;
                    return (
                      <div
                        onClick={() => !timerStopped && tapTimer()}
                        style={{
                          borderRadius: '10px', overflow: 'hidden',
                          border: `1px solid ${color === '#f8fafc' ? 'rgba(255,255,255,0.1)' : color + '55'}`,
                          cursor: timerStopped ? 'default' : 'pointer',
                          userSelect: 'none', WebkitUserSelect: 'none',
                        }}
                      >
                        <div style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          padding: '1.25rem 1rem', background: `${color}11`, transition: 'background 0.25s', minHeight: '90px',
                        }}>
                          <div style={{
                            fontSize: '3rem', fontWeight: 800, lineHeight: 1,
                            color, transition: 'color 0.25s', fontVariantNumeric: 'tabular-nums',
                          }}>
                            {fmtInspection(timerMs)}
                          </div>
                          {isDnf && <div style={{ fontSize: '0.95rem', fontWeight: 700, color, marginTop: '0.4rem' }}>DNF!</div>}
                          {isPlus2 && <div style={{ fontSize: '0.95rem', fontWeight: 700, color, marginTop: '0.4rem' }}>+2 Penalty!</div>}
                          {!timerStopped && (
                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.5rem' }}>
                              {timerRunning ? 'TAP TO STOP' : 'TAP TO START'}
                            </div>
                          )}
                        </div>
                        {timerStopped && (
                          <div style={{ display: 'flex', justifyContent: 'center', padding: '0.45rem', background: 'rgba(0,0,0,0.25)' }}>
                            <button
                              onClick={e => { e.stopPropagation(); resetTimer(); }}
                              style={{
                                padding: '0.3rem 1.2rem', borderRadius: '7px', fontSize: '0.8rem',
                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                                color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                              }}
                            >Reset</button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* ── Solve Entry: one at a time ───────────────────────────── */}
                {!allEntered ? (
                  <div style={{ marginTop: '0.5rem' }}>
                    {/* Progress label */}
                    <div style={{
                      fontSize: '0.72rem', fontWeight: 700,
                      color: isEditMode ? '#a78bfa' : 'var(--muted)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      textAlign: 'center', marginBottom: '0.4rem',
                    }}>
                      {isEditMode ? `Editing Solve ${curIdx + 1}` : `Solve ${curIdx + 1} of 5`}
                    </div>

                    {/* Large input */}
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={curPenalty === 'dnf' ? '' : panel.rawInput}
                      placeholder={curPenalty === 'dnf' ? 'DNF' : '0'}
                      readOnly={curPenalty === 'dnf'}
                      onChange={e => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
                        updatePanel(panel.id, { rawInput: raw });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && canAdvance) {
                          e.preventDefault();
                          advanceSolve(panel.id);
                        }
                      }}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        fontSize: '2.2rem', fontWeight: 700, textAlign: 'center',
                        padding: '0.65rem 0.5rem', borderRadius: '10px',
                        marginBottom: '0.3rem', minHeight: '68px',
                        background: curPenalty === 'dnf' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${curPenalty === 'dnf' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.13)'}`,
                        color: curPenalty === 'dnf' ? '#f87171' : 'var(--text)',
                        fontFamily: 'inherit', outline: 'none',
                      }}
                    />

                    {/* Parsed preview */}
                    <div style={{
                      fontSize: '0.82rem', color: 'var(--muted)', textAlign: 'center',
                      minHeight: '1.3em', marginBottom: '0.5rem',
                    }}>
                      {curPenalty === 'dnf' ? 'DNF' : (preview ? `→ ${preview}` : '')}
                    </div>

                    {/* +2 / DNF / Next buttons */}
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        onClick={() => setPenaltyCurrent(panel.id, '+2')}
                        style={{
                          flex: 1, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.88rem',
                          fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', minHeight: '48px',
                          background: curPenalty === '+2' ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${curPenalty === '+2' ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`,
                          color: curPenalty === '+2' ? '#fbbf24' : 'var(--muted)',
                        }}
                      >+2</button>
                      <button
                        onClick={() => setPenaltyCurrent(panel.id, 'dnf')}
                        style={{
                          flex: 1, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.88rem',
                          fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', minHeight: '48px',
                          background: curPenalty === 'dnf' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${curPenalty === 'dnf' ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.1)'}`,
                          color: curPenalty === 'dnf' ? '#f87171' : 'var(--muted)',
                        }}
                      >DNF</button>
                      <button
                        onClick={() => canAdvance && advanceSolve(panel.id)}
                        style={{
                          flex: 2, padding: '0.6rem 0', borderRadius: '8px', fontSize: '0.9rem',
                          fontFamily: 'inherit', fontWeight: 700, minHeight: '48px',
                          cursor: canAdvance ? 'pointer' : 'not-allowed',
                          background: canAdvance ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.06)',
                          border: `1px solid ${canAdvance ? 'rgba(124,58,237,0.5)' : 'rgba(124,58,237,0.15)'}`,
                          color: canAdvance ? '#a78bfa' : 'rgba(167,139,250,0.3)',
                        }}
                      >
                        {isEditMode ? '✓ Update' : curIdx === 4 ? 'Done →' : '→ Next'}
                      </button>
                    </div>

                    {/* Solves entered so far (tappable chips) */}
                    {(() => {
                      // Determine count of "completed" solves for this view
                      // If in edit mode (editReturnIdx set), the "already done" ones are up to editReturnIdx
                      const completedCount = panel.editReturnIdx !== null ? panel.editReturnIdx : curIdx;
                      // Partial live stats
                      const partialVals = panel.solves.slice(0, completedCount).map((s, i) => {
                        if (panel.penalties[i] === 'dnf') return -1 as number;
                        const v = parseTime(s);
                        if (v === null) return null;
                        return panel.penalties[i] === '+2' ? (v < 0 ? v : v + 200) : v;
                      });
                      const liveBest = bestOf(partialVals);
                      const liveAo5  = completedCount >= 5 ? calcAo5(partialVals) : null;
                      return (
                        <>
                          <div style={{ display: 'flex', gap: '0.2rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            {panel.solves.slice(0, completedCount).map((sv, i) => {
                              const isSelected = panel.selectedChip === i;
                              const isBeingEdited = panel.editReturnIdx !== null && curIdx === i;
                              return (
                                <div key={i} style={{ flex: 1, minWidth: '44px', position: 'relative' }}>
                                  <div
                                    onClick={() => updatePanel(panel.id, {
                                      selectedChip: isSelected ? null : i,
                                    })}
                                    style={{
                                      textAlign: 'center',
                                      padding: '0.28rem 0.15rem', borderRadius: '6px',
                                      fontSize: '0.65rem', cursor: 'pointer',
                                      background: isBeingEdited
                                        ? 'rgba(124,58,237,0.18)'
                                        : isSelected
                                          ? 'rgba(255,255,255,0.07)'
                                          : 'rgba(255,255,255,0.025)',
                                      border: `1px solid ${
                                        isBeingEdited
                                          ? 'rgba(124,58,237,0.5)'
                                          : isSelected
                                            ? 'rgba(255,255,255,0.2)'
                                            : 'rgba(255,255,255,0.07)'
                                      }`,
                                      transition: 'background 0.12s, border-color 0.12s',
                                    }}
                                  >
                                    <div style={{ color: 'rgba(255,255,255,0.3)', marginBottom: '1px' }}>S{i+1}</div>
                                    <div style={{ color: panel.penalties[i] === 'dnf' ? '#f87171' : 'var(--text)', fontWeight: 600 }}>
                                      {panel.penalties[i] === 'dnf' ? 'DNF' : (sv || '—')}
                                      {panel.penalties[i] === '+2' ? '+' : ''}
                                    </div>
                                  </div>
                                  {isSelected && !isBeingEdited && (
                                    <button
                                      onClick={e => { e.stopPropagation(); startEditPriorSolve(panel.id, i); }}
                                      style={{
                                        position: 'absolute', top: '100%', left: '50%',
                                        transform: 'translateX(-50%)',
                                        marginTop: '2px', zIndex: 10,
                                        padding: '0.18rem 0.45rem', borderRadius: '5px',
                                        fontSize: '0.62rem', fontWeight: 700,
                                        whiteSpace: 'nowrap', cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        background: 'rgba(124,58,237,0.85)',
                                        border: '1px solid rgba(124,58,237,0.9)',
                                        color: '#fff',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                                      }}
                                    >
                                      Edit
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {Array.from({ length: 5 - completedCount }, (_, i) => {
                              const slotIdx = completedCount + i;
                              const isCurrent = slotIdx === curIdx;
                              return (
                                <div key={slotIdx} style={{
                                  flex: 1, minWidth: '44px', textAlign: 'center',
                                  padding: '0.28rem 0.15rem', borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  background: isCurrent ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.015)',
                                  border: `1px solid ${isCurrent ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.04)'}`,
                                }}>
                                  <div style={{ color: isCurrent ? 'rgba(167,139,250,0.6)' : 'rgba(255,255,255,0.2)', marginBottom: '1px' }}>S{slotIdx+1}</div>
                                  <div style={{ color: isCurrent ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.15)' }}>
                                    {isCurrent ? '▸' : '—'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Live Best / Ao5 */}
                          {completedCount > 0 && (
                            <div style={{
                              display: 'flex', justifyContent: 'center', gap: '0.5rem',
                              marginTop: '0.45rem', fontSize: '0.75rem', color: 'var(--muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              <span>Best: <strong style={{ color: liveBest > 0 ? 'var(--text)' : 'var(--muted)' }}>{liveBest > 0 ? fmtTime(liveBest) : '—'}</strong></span>
                              <span style={{ opacity: 0.35 }}>|</span>
                              <span>Ao5: <strong style={{ color: liveAo5 !== null ? (liveAo5 < 0 ? '#f87171' : 'var(--text)') : 'var(--muted)' }}>
                                {liveAo5 !== null ? (liveAo5 < 0 ? 'DNF' : fmtTime(liveAo5)) : '—'}
                              </strong></span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  /* ── All 5 entered — summary + save ─────────────────────── */
                  <div style={{ marginTop: '0.5rem' }}>
                    {/* Solve summary chips — tappable when in postEditMode */}
                    <div style={{ marginBottom: panel.postEditMode ? '0.3rem' : '0.5rem' }}>
                      {panel.postEditMode && (
                        <div style={{
                          fontSize: '0.7rem', fontWeight: 700, color: '#a78bfa',
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                          textAlign: 'center', marginBottom: '0.35rem',
                        }}>
                          Tap a solve to edit
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                        {panel.solves.map((sv, i) => (
                          <div
                            key={i}
                            onClick={() => panel.postEditMode && startEditPriorSolve(panel.id, i, 5)}
                            style={{
                              flex: 1, minWidth: '44px', textAlign: 'center',
                              padding: '0.3rem 0.15rem', borderRadius: '6px',
                              fontSize: '0.68rem',
                              cursor: panel.postEditMode ? 'pointer' : 'default',
                              background: panel.postEditMode ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${panel.postEditMode ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.08)'}`,
                              transition: 'background 0.12s, border-color 0.12s',
                            }}
                          >
                            <div style={{ color: 'var(--muted)', marginBottom: '2px' }}>S{i+1}</div>
                            <div style={{ color: panel.penalties[i] === 'dnf' ? '#f87171' : 'var(--text)', fontWeight: 600 }}>
                              {panel.penalties[i] === 'dnf' ? 'DNF' : (sv || '—')}
                              {panel.penalties[i] === '+2' ? '+' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Single / Ao5 */}
                    <div className="compact-calc-row" style={{ marginBottom: '0.5rem' }}>
                      <div className="calc-item">
                        <div className="calc-label">Single</div>
                        <div className={`calc-value${single < 0 ? ' dnf' : ' accent'}`}>{fmtTime(single)}</div>
                      </div>
                      <div className="calc-item">
                        <div className="calc-label">Ao5</div>
                        <div className={`calc-value${average !== null && average < 0 ? ' dnf' : ' accent'}`}>{fmtTime(average)}</div>
                      </div>
                    </div>

                    {/* Save + Edit buttons (or Cancel when in postEditMode) */}
                    {panel.postEditMode ? (
                      <button
                        onClick={() => updatePanel(panel.id, { postEditMode: false })}
                        style={{
                          width: '100%', minHeight: '48px', borderRadius: '10px',
                          fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                          fontFamily: 'inherit',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: 'var(--muted)',
                        }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          onClick={() => submit(panel.id)}
                          style={{
                            flex: 2, minHeight: '52px', borderRadius: '10px',
                            fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
                            fontFamily: 'inherit',
                            background: 'rgba(34,197,94,0.2)',
                            border: '1px solid rgba(34,197,94,0.5)',
                            color: '#4ade80',
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => updatePanel(panel.id, { postEditMode: true })}
                          style={{
                            flex: 1, minHeight: '52px', borderRadius: '10px',
                            fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                            fontFamily: 'inherit',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            color: 'var(--muted)',
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {panel.msg && (
                  <div className={`msg ${panel.msgType}`} style={{ display: 'block', marginTop: '0.5rem' }}>
                    {panel.msg}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
