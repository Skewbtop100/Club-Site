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
  id: number; athleteId: string; eventId: string; round: number;
  solves: string[]; penalties: ('none' | '+2' | 'dnf')[];
  msg: string; msgType: string;
}
function emptyPanel(id: number): PanelState {
  return { id, athleteId: '', eventId: '', round: 1, solves: ['','','','',''], penalties: ['none','none','none','none','none'], msg: '', msgType: '' };
}

export default function ResultsEntryTab() {
  const [athletes, setAthletes]   = useState<Athlete[]>([]);
  const [comps, setComps]         = useState<Competition[]>([]);
  const [compId, setCompId]       = useState('');
  const [panels, setPanels]       = useState<PanelState[]>([emptyPanel(0)]);

  // Inspection timer state
  const [timerOpen, setTimerOpen]       = useState(false);
  const [timerMs, setTimerMs]           = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
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
  function setSolve(panelId: number, i: number, val: string) {
    setPanels(prev => prev.map(p => { if (p.id !== panelId) return p; const s = [...p.solves]; s[i] = val; return { ...p, solves: s }; }));
  }
  function setPenalty(panelId: number, i: number, pen: 'none' | '+2' | 'dnf') {
    setPanels(prev => prev.map(p => { if (p.id !== panelId) return p; const ps = [...p.penalties]; ps[i] = ps[i] === pen ? 'none' : pen; return { ...p, penalties: ps }; }));
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

  // ── Inspection timer helpers ─────────────────────────────────────────────────

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

  function startTimer() {
    if (timerIntervalRef.current) return;
    timerStartRef.current = Date.now() - timerAccRef.current;
    setTimerRunning(true);
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
      }
    }, 30);
  }

  function stopTimer() {
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    setTimerRunning(false);
  }

  function resetTimer() {
    stopTimer();
    timerAccRef.current    = 0;
    lastMilestoneRef.current = 0;
    setTimerMs(0);
  }

  function closeTimerModal() { resetTimer(); setTimerOpen(false); }

  function fmtInspection(ms: number) {
    const s  = Math.floor(ms / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${s}.${String(cs).padStart(2, '0')}`;
  }

  function timerColor(ms: number) {
    const s = ms / 1000;
    if (s >= 17) return '#7f1d1d';
    if (s >= 15) return '#ef4444';
    if (s >= 12) return '#f97316';
    if (s >= 8)  return '#fbbf24';
    return '#f8fafc';
  }

  function timerStatus(ms: number) {
    const s = ms / 1000;
    if (s >= 17) return 'DNF!';
    if (s >= 15) return '+2 Penalty!';
    if (s >= 12) return '12 seconds';
    if (s >= 8)  return '8 seconds';
    return '';
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const selComp = comps.find(c => c.id === compId);
  const evList = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : WCA_EVENTS;
  const liveComps = comps.filter(c => c.status === 'live' || c.status === 'upcoming');
  const compAthletes = selComp?.athletes;

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />Results Entry</div>

      {/* Competition selector + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ maxWidth: '340px', marginBottom: 0, flex: 1 }}>
          <label>Competition</label>
          <select value={compId} onChange={e => { setCompId(e.target.value); setPanels([emptyPanel(0)]); }}>
            <option value="">— Select competition —</option>
            {liveComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', paddingTop: compId ? '1.5rem' : 0, flexWrap: 'wrap' }}>
          {compId && (
            <>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Panels: <strong>{panels.length}</strong></span>
              <button className="btn-xs" onClick={() => setPanels(p => [...p, emptyPanel(p.length)])}>+ Add Panel</button>
              <button className="btn-xs" onClick={() => { if (panels.length <= 1) return; setPanels(p => p.slice(0, -1)); }}>− Remove</button>
            </>
          )}
          <button
            className="btn-xs"
            onClick={() => setTimerOpen(true)}
            style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)', color: '#34d399' }}
          >
            ⏱ Inspection Timer
          </button>
        </div>
      </div>

      {!compId && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
          Select a competition to start entering results.
        </div>
      )}

      {/* Inspection timer modal */}
      {timerOpen && (() => {
        const color  = timerColor(timerMs);
        const status = timerStatus(timerMs);
        const isDnf  = timerMs / 1000 >= 17;
        return (
          <div
            onClick={closeTimerModal}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.82)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '1rem',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--card, #1a1730)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '18px',
                padding: '2.5rem 2rem 2rem',
                minWidth: '320px',
                maxWidth: '420px',
                width: '100%',
                boxShadow: '0 28px 70px rgba(0,0,0,0.75)',
                textAlign: 'center',
              }}
            >
              {/* Title */}
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1.5rem' }}>
                WCA Inspection Timer
              </div>

              {/* Timer display */}
              <div style={{
                fontSize: '5rem', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em',
                color, transition: 'color 0.3s',
                fontVariantNumeric: 'tabular-nums',
                marginBottom: '0.6rem',
              }}>
                {fmtInspection(timerMs)}
              </div>

              {/* Status text */}
              <div style={{
                fontSize: '1.1rem', fontWeight: 700, color,
                minHeight: '1.6rem', transition: 'color 0.3s',
                marginBottom: '2rem',
              }}>
                {status}
              </div>

              {/* Milestone markers */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
                {[
                  { s: 8,  label: '8s',  active: timerMs / 1000 >= 8,  col: '#fbbf24' },
                  { s: 12, label: '12s', active: timerMs / 1000 >= 12, col: '#f97316' },
                  { s: 15, label: '+2',  active: timerMs / 1000 >= 15, col: '#ef4444' },
                  { s: 17, label: 'DNF', active: isDnf,                col: '#7f1d1d' },
                ].map(m => (
                  <div key={m.s} style={{
                    padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
                    border: `1px solid ${m.active ? m.col : 'rgba(255,255,255,0.1)'}`,
                    background: m.active ? `${m.col}22` : 'transparent',
                    color: m.active ? m.col : 'rgba(255,255,255,0.25)',
                    transition: 'all 0.2s',
                  }}>
                    {m.label}
                  </div>
                ))}
              </div>

              {/* Buttons: Start | Stop | Reset */}
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center' }}>
                <button
                  onClick={startTimer}
                  disabled={timerRunning || isDnf}
                  style={{
                    padding: '0.55rem 1.3rem', borderRadius: '9px', fontSize: '0.9rem',
                    fontFamily: 'inherit', fontWeight: 600, cursor: timerRunning || isDnf ? 'not-allowed' : 'pointer',
                    background: timerRunning || isDnf ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.25)',
                    border: `1px solid ${timerRunning || isDnf ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.55)'}`,
                    color: timerRunning || isDnf ? 'rgba(52,211,153,0.35)' : '#34d399',
                    transition: 'all 0.15s',
                  }}
                >
                  Start
                </button>
                <button
                  onClick={stopTimer}
                  disabled={!timerRunning}
                  style={{
                    padding: '0.55rem 1.3rem', borderRadius: '9px', fontSize: '0.9rem',
                    fontFamily: 'inherit', fontWeight: 600, cursor: !timerRunning ? 'not-allowed' : 'pointer',
                    background: !timerRunning ? 'rgba(251,191,36,0.07)' : 'rgba(251,191,36,0.18)',
                    border: `1px solid ${!timerRunning ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.5)'}`,
                    color: !timerRunning ? 'rgba(251,191,36,0.3)' : '#fbbf24',
                    transition: 'all 0.15s',
                  }}
                >
                  Stop
                </button>
                <button
                  onClick={resetTimer}
                  style={{
                    padding: '0.55rem 1.3rem', borderRadius: '9px', fontSize: '0.9rem',
                    fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'var(--muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  Reset
                </button>
              </div>

              {/* Close hint */}
              <div style={{ marginTop: '1.5rem', fontSize: '0.72rem', color: 'rgba(255,255,255,0.2)' }}>
                Click outside to close
              </div>
            </div>
          </div>
        );
      })()}

      {compId && (
        <div className="multi-entry-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {panels.map(panel => {
            const { single, average } = computeResult(panel);
            const panelAthletes = compAthletes
              ? athletes.filter(a => {
                  const ca = compAthletes.find(x => x.id === a.id);
                  if (!ca) return false;
                  if (!panel.eventId) return true;
                  return ca.events.includes(panel.eventId);
                })
              : athletes;
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

                {/* Event + Round */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem', marginBottom: '0.3rem' }}>
                  <select className="compact-select" value={panel.eventId} style={{ marginBottom: 0 }}
                    onChange={e => updatePanel(panel.id, { eventId: e.target.value })}>
                    <option value="">— Event —</option>
                    {evList.map(e => <option key={e.id} value={e.id}>{e.short}</option>)}
                  </select>
                  <select className="compact-select" value={panel.round} style={{ marginBottom: 0 }}
                    onChange={e => updatePanel(panel.id, { round: Number(e.target.value) })}>
                    {[1,2,3,4].map(r => <option key={r} value={r}>R{r}</option>)}
                  </select>
                </div>

                {/* Solves */}
                <div className="compact-solves-row">
                  {panel.solves.map((sv, i) => (
                    <div className="solve-group" key={i}>
                      <div className="solve-label">S{i+1}</div>
                      <input
                        className={`solve-input${panel.penalties[i] === 'dnf' ? ' dnf-val' : ''}`}
                        value={panel.penalties[i] === 'dnf' ? 'DNF' : sv}
                        readOnly={panel.penalties[i] === 'dnf'}
                        onChange={e => setSolve(panel.id, i, e.target.value)}
                        style={{ width: '100%', padding: '0.5rem 0.15rem', fontSize: '0.82rem' }}
                      />
                      <div className="solve-btns">
                        <button className={`solve-btn solve-btn-plus2${panel.penalties[i] === '+2' ? ' active' : ''}`}
                          style={{ fontSize: '0.58rem', padding: '0.15rem 0.1rem' }}
                          onClick={() => setPenalty(panel.id, i, '+2')}>+2</button>
                        <button className={`solve-btn solve-btn-dnf${panel.penalties[i] === 'dnf' ? ' active' : ''}`}
                          style={{ fontSize: '0.58rem', padding: '0.15rem 0.1rem' }}
                          onClick={() => setPenalty(panel.id, i, 'dnf')}>DNF</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Calculated */}
                <div className="compact-calc-row">
                  <div className="calc-item">
                    <div className="calc-label">Single</div>
                    <div className={`calc-value${single < 0 ? ' dnf' : ' accent'}`}>{fmtTime(single < 0 ? single : single)}</div>
                  </div>
                  <div className="calc-item">
                    <div className="calc-label">Ao5</div>
                    <div className={`calc-value${average !== null && average < 0 ? ' dnf' : ' accent'}`}>{fmtTime(average)}</div>
                  </div>
                </div>

                <button className="btn-sm-primary" style={{ width: '100%' }} onClick={() => submit(panel.id)}>
                  Submit Result
                </button>
                {panel.msg && <div className={`msg ${panel.msgType}`} style={{ display: 'block', marginTop: '0.5rem' }}>{panel.msg}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
