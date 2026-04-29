'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Scrambow } from 'scrambow';

// ── Theme constants (lavender + mint, matches the screenshot) ───────────────
const C = {
  bg:        '#0a0a0a',
  card:      '#141414',
  cardAlt:   '#1a1a1a',
  border:    'rgba(255,255,255,0.06)',
  borderHi:  'rgba(167,139,250,0.4)',
  text:      '#e8e8ed',
  muted:     '#8b8d98',
  mutedDim:  '#5a5d68',
  accent:    '#a78bfa',  // lavender
  accentDim: 'rgba(167,139,250,0.15)',
  success:   '#34d399',  // mint green for PBs
  warn:      '#fbbf24',  // 8s inspection warning
  orange:    '#f97316',  // 12s warning
  danger:    '#ef4444',  // 15s+ / DNF
} as const;

// ── Events ──────────────────────────────────────────────────────────────────
interface EventDef { id: string; name: string; short: string }
const EVENTS: EventDef[] = [
  { id: '333',     name: '3x3x3 Cube',       short: '3x3'   },
  { id: '222',     name: '2x2x2 Cube',       short: '2x2'   },
  { id: '444',     name: '4x4x4 Cube',       short: '4x4'   },
  { id: '555',     name: '5x5x5 Cube',       short: '5x5'   },
  { id: '666',     name: '6x6x6 Cube',       short: '6x6'   },
  { id: '777',     name: '7x7x7 Cube',       short: '7x7'   },
  { id: '333oh',   name: '3x3 One-Handed',   short: '3OH'   },
  { id: '333bld',  name: '3x3 Blindfolded',  short: '3BLD'  },
  { id: '444bld',  name: '4x4 Blindfolded',  short: '4BLD'  },
  { id: '555bld',  name: '5x5 Blindfolded',  short: '5BLD'  },
  { id: '333mbf',  name: '3x3 Multi-Blind',  short: 'MBF'   },
  { id: '333fm',   name: '3x3 Fewest Moves', short: 'FMC'   },
  { id: 'pyram',   name: 'Pyraminx',         short: 'Pyra'  },
  { id: 'skewb',   name: 'Skewb',            short: 'Skewb' },
  { id: 'sq1',     name: 'Square-1',         short: 'Sq-1'  },
  { id: 'clock',   name: 'Clock',            short: 'Clock' },
  { id: 'minx',    name: 'Megaminx',         short: 'Mega'  },
];

// ── Scramble generation (via scrambow) ───────────────────────────────────────
// scrambow supports: 222, 333, 444, 555, 666, 777, 333fm, pyram, skewb, sq1,
// clock, minx. OH/BLD/MBF use the same scramble as their base puzzle.
const SCRAMBOW_TYPE: Record<string, string> = {
  '333':    '333',
  '222':    '222',
  '444':    '444',
  '555':    '555',
  '666':    '666',
  '777':    '777',
  '333oh':  '333',
  '333bld': '333',
  '444bld': '444',
  '555bld': '555',
  '333mbf': '333',
  '333fm':  '333fm',
  'pyram':  'pyram',
  'skewb':  'skewb',
  'sq1':    'sq1',
  'clock':  'clock',
  'minx':   'minx',
};

function generateScramble(eventId: string): string {
  const type = SCRAMBOW_TYPE[eventId] ?? '333';
  try {
    const result = new Scrambow().setType(type).get(1);
    const s = result[0]?.scramble_string ?? '';
    // Collapse runs of whitespace and trim — scrambow pads cells in NxN output.
    return s.replace(/[ \t]+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ── Solve types + stats ─────────────────────────────────────────────────────
type Penalty = 'none' | '+2' | 'dnf';
interface Solve {
  id: string;
  ms: number;          // raw timer ms (excluding +2)
  penalty: Penalty;
  scramble: string;
  event: string;
  ts: number;          // unix ms
}

const PENALTY_ADD: Record<Penalty, number> = { none: 0, '+2': 2000, dnf: 0 };
const isDnf = (s: Solve) => s.penalty === 'dnf';
const finalMs = (s: Solve) => s.ms + PENALTY_ADD[s.penalty];

function fmtMs(ms: number | null | undefined, dnf = false): string {
  if (dnf) return 'DNF';
  if (ms == null) return '—';
  const totalSec = ms / 1000;
  if (totalSec < 60) return totalSec.toFixed(2);
  const m = Math.floor(totalSec / 60);
  const s = (totalSec - m * 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

function ago(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60)  return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min} min${min === 1 ? '' : 's'} ago`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Mean of the middle of last n solves (drop best+worst). DNF in middle = DNF. */
function avgOfN(solves: Solve[], n: number): number | null {
  if (solves.length < n) return null;
  const last = solves.slice(-n);
  // Sort by finalMs but treat DNF as +Infinity
  const sorted = [...last].sort((a, b) => {
    const aV = isDnf(a) ? Infinity : finalMs(a);
    const bV = isDnf(b) ? Infinity : finalMs(b);
    return aV - bV;
  });
  const middle = sorted.slice(1, -1);
  if (middle.some(isDnf)) return null;  // DNF in the middle → no average
  const sum = middle.reduce((acc, s) => acc + finalMs(s), 0);
  return Math.round(sum / middle.length);
}

interface Stats {
  best: number | null;
  worst: number | null;
  mean: number | null;
  ao5: number | null;
  ao12: number | null;
  ao100: number | null;
  pbMs: number | null;
  stdDev: number | null;
}

function calcStats(solves: Solve[]): Stats {
  const valid = solves.filter(s => !isDnf(s)).map(finalMs);
  const best = valid.length ? Math.min(...valid) : null;
  const worst = valid.length ? Math.max(...valid) : null;
  const mean = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  const ao5 = avgOfN(solves, 5);
  const ao12 = avgOfN(solves, 12);
  const ao100 = avgOfN(solves, 100);
  const pbMs = best;
  let stdDev: number | null = null;
  if (valid.length >= 5 && mean != null) {
    const variance = valid.reduce((acc, v) => acc + (v - mean) ** 2, 0) / valid.length;
    stdDev = Math.sqrt(variance);
  }
  return { best, worst, mean, ao5, ao12, ao100, pbMs, stdDev };
}

function consistencyLabel(stdDevMs: number | null, meanMs: number | null): { label: string; ratio: number } {
  if (stdDevMs == null || meanMs == null || meanMs === 0) return { label: '—', ratio: 0 };
  const cv = stdDevMs / meanMs;  // coefficient of variation
  if (cv < 0.08) return { label: 'High', ratio: 0.92 };
  if (cv < 0.18) return { label: 'Medium', ratio: 0.6 };
  return { label: 'Low', ratio: 0.3 };
}

// ── Custom hook: timer state machine ────────────────────────────────────────
type TimerState = 'idle' | 'inspecting' | 'armed' | 'running' | 'stopped';

function useTimer(onSolveCommit: (ms: number, dnf: boolean) => void) {
  const [state, setState] = useState<TimerState>('idle');
  const [displayMs, setDisplayMs] = useState(0);
  const [inspectionMs, setInspectionMs] = useState(15000);

  const runStartRef = useRef(0);
  const inspStartRef = useRef(0);
  const armStartRef = useRef(0);
  const rafRef = useRef(0);

  const stop = useCallback(() => {
    if (state === 'running') {
      const final = Date.now() - runStartRef.current;
      cancelAnimationFrame(rafRef.current);
      setDisplayMs(final);
      setState('stopped');
      // DNF if inspection >= 17s
      const dnf = inspectionMs <= -2000;
      // +2 handled separately by penalty UI
      onSolveCommit(final, dnf);
    }
  }, [state, inspectionMs, onSolveCommit]);

  // Tick loop
  useEffect(() => {
    if (state === 'running') {
      const tick = () => {
        setDisplayMs(Date.now() - runStartRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }
    if (state === 'inspecting') {
      const id = setInterval(() => {
        const elapsed = Date.now() - inspStartRef.current;
        setInspectionMs(15000 - elapsed);
      }, 50);
      return () => clearInterval(id);
    }
  }, [state]);

  // Public actions
  const beginInspection = useCallback(() => {
    inspStartRef.current = Date.now();
    setInspectionMs(15000);
    setState('inspecting');
  }, []);

  const startArming = useCallback(() => {
    armStartRef.current = Date.now();
    setState('armed');
  }, []);

  const fireRunning = useCallback(() => {
    // Only commits if held long enough
    const heldFor = Date.now() - armStartRef.current;
    if (heldFor < 350) {
      // Released too early — return to inspecting (or idle)
      setState(prev => prev === 'armed' ? (inspectionMs > -2000 && inspStartRef.current > 0 ? 'inspecting' : 'idle') : prev);
      return;
    }
    runStartRef.current = Date.now();
    setDisplayMs(0);
    setState('running');
  }, [inspectionMs]);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setState('idle');
    setDisplayMs(0);
    setInspectionMs(15000);
    inspStartRef.current = 0;
  }, []);

  return {
    state, displayMs, inspectionMs,
    beginInspection, startArming, fireRunning, stop, reset,
  };
}

// ── Main page ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pv.timer.session.v1';

export default function TimerPage() {
  const [eventId, setEventId] = useState<string>('333');
  const [scramble, setScramble] = useState<string>(() => generateScramble('333'));
  const [solves, setSolves] = useState<Solve[]>([]);
  const [hoveredSolveId, setHoveredSolveId] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  // Refresh "X mins ago" labels every 30s
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load session from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { solves?: Solve[]; eventId?: string };
      if (Array.isArray(parsed.solves)) setSolves(parsed.solves);
      if (parsed.eventId && EVENTS.some(e => e.id === parsed.eventId)) {
        setEventId(parsed.eventId);
        setScramble(generateScramble(parsed.eventId));
      }
    } catch { /* ignore */ }
  }, []);

  // Persist session whenever it changes
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ solves, eventId })); } catch { /* ignore */ }
  }, [solves, eventId]);

  // Stats — recomputed on every solves change
  const stats = useMemo(() => calcStats(solves), [solves]);
  const sessionEvent = useMemo(() => EVENTS.find(e => e.id === eventId) ?? EVENTS[0], [eventId]);

  // Timer
  const onSolveCommit = useCallback((ms: number, dnf: boolean) => {
    setSolves(prev => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ms, penalty: dnf ? 'dnf' : 'none',
        scramble, event: eventId, ts: Date.now(),
      },
    ]);
  }, [scramble, eventId]);

  const timer = useTimer(onSolveCommit);

  // After a solve commits, generate next scramble (delay so user sees the time)
  const lastCommittedCountRef = useRef(0);
  useEffect(() => {
    if (solves.length > lastCommittedCountRef.current) {
      lastCommittedCountRef.current = solves.length;
      // Don't auto-rescramble — wait for user space-press to start next
    }
  }, [solves.length]);

  const newScramble = useCallback(() => {
    setScramble(generateScramble(eventId));
  }, [eventId]);

  // When event changes, regenerate scramble
  useEffect(() => {
    setScramble(generateScramble(eventId));
  }, [eventId]);

  // ── Keyboard handlers ────────────────────────────────────────────────────
  // SPACE: state machine driver
  // ESC: cancel/reset current attempt
  // D:   delete last solve
  // N:   new scramble (when idle)
  const spaceHeldRef = useRef(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (spaceHeldRef.current) return;
        spaceHeldRef.current = true;
        if (timer.state === 'running') {
          timer.stop();
          return;
        }
        if (timer.state === 'idle' || timer.state === 'stopped') {
          if (timer.state === 'stopped') newScramble();
          timer.beginInspection();
          return;
        }
        if (timer.state === 'inspecting') {
          timer.startArming();
          return;
        }
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        timer.reset();
      }
      if (e.code === 'KeyD' && timer.state === 'idle' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setSolves(prev => prev.slice(0, -1));
      }
      if (e.code === 'KeyN' && timer.state === 'idle' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        newScramble();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        spaceHeldRef.current = false;
        if (timer.state === 'armed') {
          timer.fireRunning();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [timer, newScramble]);

  // Mobile: tap timer area
  const onTimerTouchStart = useCallback(() => {
    if (timer.state === 'running') { timer.stop(); return; }
    if (timer.state === 'idle' || timer.state === 'stopped') {
      if (timer.state === 'stopped') newScramble();
      timer.beginInspection();
      return;
    }
    if (timer.state === 'inspecting') timer.startArming();
  }, [timer, newScramble]);

  const onTimerTouchEnd = useCallback(() => {
    if (timer.state === 'armed') timer.fireRunning();
  }, [timer]);

  // ── Solve action handlers ────────────────────────────────────────────────
  const setLastPenalty = (p: Penalty) => {
    setSolves(prev => prev.length === 0 ? prev : prev.map((s, i) => i === prev.length - 1 ? { ...s, penalty: p } : s));
  };
  const deleteSolve = (id: string) => setSolves(prev => prev.filter(s => s.id !== id));
  const resetSession = () => {
    if (confirm('Reset current session? All solves will be cleared.')) setSolves([]);
  };

  // ── PB detection (for the most recent solve) ─────────────────────────────
  const lastSolveIsPB = useMemo(() => {
    if (solves.length < 2) return solves.length === 1 && !isDnf(solves[0]);
    const last = solves[solves.length - 1];
    if (isDnf(last)) return false;
    const prevBest = Math.min(...solves.slice(0, -1).filter(s => !isDnf(s)).map(finalMs));
    return finalMs(last) < prevBest;
  }, [solves]);

  // Display string for the big timer
  const timerDisplay = (() => {
    if (timer.state === 'inspecting') {
      const sec = Math.max(-2, timer.inspectionMs / 1000);
      if (sec >= 0) return Math.ceil(sec).toString();
      return sec <= -2 ? 'DNF' : '+2';
    }
    if (timer.state === 'armed') return '0.00';
    return fmtMs(timer.displayMs);
  })();

  // Color of the big timer
  const timerColor = (() => {
    if (timer.state === 'inspecting') {
      const s = timer.inspectionMs / 1000;
      if (s <= -2) return C.danger;
      if (s <= 0)  return C.danger;
      if (s <= 3)  return C.orange;
      if (s <= 7)  return C.warn;
      return C.text;
    }
    if (timer.state === 'armed')   return C.success;
    if (timer.state === 'stopped' && lastSolveIsPB) return C.success;
    return C.text;
  })();

  const consistency = consistencyLabel(stats.stdDev, stats.mean);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      paddingTop: '60px',  // clear the site-wide navbar
    }}>
      {/* Subtle grain background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '3px 3px', opacity: 0.7,
      }} />

      <div className="pv-grid" style={{
        position: 'relative', zIndex: 1,
        display: 'grid',
        gridTemplateColumns: '280px 1fr 320px',
        gap: '1.25rem',
        padding: '1.25rem',
        maxWidth: '1600px', margin: '0 auto',
        minHeight: 'calc(100vh - 60px)',
      }}>
        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
        <aside style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16, padding: '1.5rem 1rem',
          display: 'flex', flexDirection: 'column', gap: '1rem',
          height: 'fit-content', minHeight: '500px',
        }}>
          <div>
            <div style={{
              fontSize: '1.25rem', fontWeight: 800, color: C.accent,
              letterSpacing: '-0.01em', fontFamily: 'Inter, system-ui, sans-serif',
            }}>
              Precision Velocity
            </div>
            <div style={{ fontSize: '0.72rem', color: C.muted, marginTop: 2 }}>
              The Kinetic Monolith
            </div>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
            <SidebarItem icon="⏱" label="Timer" active />
            <SidebarItem icon="🏆" label="Competition" href="/competition" />
            <SidebarItem icon="📊" label="Stats" />
            <SidebarItem icon="👤" label="Profile" />
            <SidebarItem icon="⚙" label="Settings" />
          </nav>

          <div style={{ flex: 1 }} />

          <div style={{
            background: C.cardAlt, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: '0.75rem',
            display: 'flex', alignItems: 'center', gap: '0.7rem',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 9,
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.95rem', color: '#fff',
            }}>
              CB
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 700 }}>Cuber</div>
              <div style={{ fontSize: '0.66rem', color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 1 }}>
                Speedcuber
              </div>
            </div>
          </div>
        </aside>

        {/* ── CENTER PANEL ─────────────────────────────────────────────── */}
        <main style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0 }}>
          {/* Scramble box */}
          <section style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 16, padding: '1.25rem 1.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{
                fontSize: '0.72rem', letterSpacing: '0.12em',
                textTransform: 'uppercase', color: C.muted, fontWeight: 600,
              }}>
                {sessionEvent.short.toUpperCase()} Competition Scramble
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={eventId}
                  onChange={e => setEventId(e.target.value)}
                  style={{
                    background: C.cardAlt, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: '0.32rem 0.5rem', fontSize: '0.78rem',
                    fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
                  }}
                >
                  {EVENTS.map(ev => (
                    <option key={ev.id} value={ev.id}>{ev.name}</option>
                  ))}
                </select>
                <button
                  onClick={newScramble}
                  style={{
                    background: 'transparent', color: C.accent,
                    border: `1px solid ${C.borderHi}`, borderRadius: 8,
                    padding: '0.32rem 0.7rem', fontSize: '0.78rem',
                    fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.accentDim)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  title="Press N for new scramble"
                >
                  New Scramble
                </button>
              </div>
            </div>

            <div style={{
              fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
              fontSize: 'clamp(1rem, 2.4vw, 1.7rem)',
              fontWeight: 500, lineHeight: 1.6,
              letterSpacing: '0.04em', color: C.text,
              textAlign: 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              minHeight: '5rem',
            }}>
              {scramble}
            </div>
          </section>

          {/* Main timer */}
          <section
            onTouchStart={onTimerTouchStart}
            onTouchEnd={onTimerTouchEnd}
            style={{
              background: C.card, border: `1px solid ${timer.state === 'armed' ? C.success : C.border}`,
              borderRadius: 16, padding: '3rem 1.5rem 2.5rem',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              userSelect: 'none', cursor: 'pointer', textAlign: 'center',
              minHeight: '320px',
              transition: 'border-color 0.15s',
            }}
          >
            {timer.state === 'inspecting' && (
              <div style={{ fontSize: '0.72rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.warn, marginBottom: '1rem', fontWeight: 700 }}>
                Inspection
              </div>
            )}
            <div style={{
              fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
              fontSize: 'clamp(4rem, 16vw, 11rem)',
              fontWeight: 700, lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
              color: timerColor,
              transition: 'color 0.12s',
              textShadow: timer.state === 'armed' ? `0 0 30px ${C.success}55` : 'none',
            }}>
              {timerDisplay}
            </div>
            <div style={{ fontSize: '0.78rem', color: C.muted, marginTop: '1.5rem', letterSpacing: '0.06em' }}>
              {timer.state === 'idle' && (<>PRESS <span style={{ color: C.accent, fontWeight: 700 }}>SPACE</span> TO START / TAP TO START</>)}
              {timer.state === 'inspecting' && 'Hold SPACE to arm, release to start'}
              {timer.state === 'armed' && (<span style={{ color: C.success, fontWeight: 700 }}>RELEASE TO START</span>)}
              {timer.state === 'running' && 'Press SPACE / tap to stop'}
              {timer.state === 'stopped' && (<>PRESS <span style={{ color: C.accent, fontWeight: 700 }}>SPACE</span> TO START / TAP TO START</>)}
            </div>

            {timer.state === 'stopped' && solves.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <PenaltyButton label="OK"  active={solves[solves.length - 1].penalty === 'none'} onClick={() => setLastPenalty('none')} color={C.muted} />
                <PenaltyButton label="+2"  active={solves[solves.length - 1].penalty === '+2'}   onClick={() => setLastPenalty('+2')}   color={C.warn} />
                <PenaltyButton label="DNF" active={solves[solves.length - 1].penalty === 'dnf'}  onClick={() => setLastPenalty('dnf')}  color={C.danger} />
              </div>
            )}
          </section>

          {/* Session history */}
          <section style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 16, padding: '1.25rem 1.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>Session History</div>
              <div style={{ fontSize: '0.74rem', color: C.muted }}>
                {solves.length === 0 ? 'No solves yet' : `${solves.length} solve${solves.length === 1 ? '' : 's'}`}
              </div>
            </div>
            {solves.length === 0 ? (
              <div style={{ padding: '1.5rem 0', textAlign: 'center', color: C.mutedDim, fontSize: '0.85rem' }}>
                Press SPACE to start your first solve.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {[...solves].reverse().map((s, i) => {
                  const idx = solves.length - i;
                  const dnf = isDnf(s);
                  // Was this a PB at the time?
                  const priorBest = Math.min(
                    ...solves.slice(0, solves.length - i).slice(0, -1).filter(x => !isDnf(x)).map(finalMs)
                  );
                  const isPB = !dnf && (
                    solves.slice(0, solves.length - i).filter(x => !isDnf(x)).length === 1 ||
                    finalMs(s) < priorBest
                  );
                  return (
                    <div
                      key={s.id}
                      onMouseEnter={() => setHoveredSolveId(s.id)}
                      onMouseLeave={() => setHoveredSolveId(prev => prev === s.id ? null : prev)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2.5rem 1fr auto auto',
                        alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.85rem', borderRadius: 10,
                        background: hoveredSolveId === s.id ? 'rgba(255,255,255,0.03)' : C.cardAlt,
                        borderLeft: isPB ? `3px solid ${C.success}` : '3px solid transparent',
                        transition: 'background 0.12s',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', color: C.mutedDim, fontWeight: 600 }}>
                        {String(idx).padStart(2, '0')}
                      </div>
                      <div style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: '1.05rem', fontWeight: 700,
                        color: dnf ? C.danger : isPB ? C.success : C.text,
                      }}>
                        {fmtMs(finalMs(s), dnf)}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        {s.event !== '333' && (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: 4,
                            background: 'rgba(255,255,255,0.06)', color: C.muted, letterSpacing: '0.04em',
                          }}>
                            {EVENTS.find(e => e.id === s.event)?.short || s.event}
                          </span>
                        )}
                        {isPB && !dnf && (
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: 4,
                            background: 'rgba(52,211,153,0.15)', color: C.success, letterSpacing: '0.05em',
                          }}>NEW PB!</span>
                        )}
                        {s.penalty === '+2' && (
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: 4,
                            background: 'rgba(251,191,36,0.15)', color: C.warn, letterSpacing: '0.05em',
                          }}>+2</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.72rem', color: C.mutedDim }}>{ago(s.ts)}</span>
                        <button
                          onClick={() => deleteSolve(s.id)}
                          aria-label="Delete solve"
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: C.mutedDim, fontSize: '0.85rem', padding: '0.15rem 0.3rem',
                            opacity: hoveredSolveId === s.id ? 1 : 0,
                            transition: 'opacity 0.12s',
                          }}
                          title="Delete"
                        >×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        {/* ── RIGHT PANEL ───────────────────────────────────────────────── */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '-0.25rem' }}>Performance</div>

          {/* Personal Best card */}
          <div style={{
            background: `linear-gradient(135deg, ${C.cardAlt}, ${C.card})`,
            border: `1px solid ${C.border}`, borderRadius: 14, padding: '1rem 1.1rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: '0.66rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>
                Personal Best
              </div>
              <span style={{ fontSize: '1.1rem', opacity: 0.6 }}>🏆</span>
            </div>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '2.4rem', fontWeight: 800, color: C.success,
              marginTop: '0.4rem', fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtMs(stats.pbMs)}
            </div>
            <div style={{ marginTop: '0.6rem', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                width: stats.pbMs ? '70%' : '0%', height: '100%',
                background: `linear-gradient(90deg, ${C.success}, ${C.accent})`,
                transition: 'width 0.5s',
              }} />
            </div>
            <div style={{ fontSize: '0.66rem', color: C.muted, marginTop: '0.4rem', textAlign: 'right' }}>
              {stats.pbMs ? 'Personal record' : 'No solves yet'}
            </div>
          </div>

          {/* Stats grid 2x2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <StatTile label="Average" value={fmtMs(stats.mean)} />
            <StatTile label="Worst"   value={fmtMs(stats.worst)} />
            <StatTile label="Ao5"     value={stats.ao5  == null ? '—' : fmtMs(stats.ao5)}  accent />
            <StatTile label="Ao12"    value={stats.ao12 == null ? '—' : fmtMs(stats.ao12)} accent />
          </div>

          {/* Current Session */}
          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: '1rem 1.1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '0.66rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>
                Current Session
              </div>
              <button
                onClick={resetSession}
                style={{
                  fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em',
                  background: 'rgba(255,255,255,0.06)', color: C.muted,
                  border: 'none', borderRadius: 6, padding: '0.18rem 0.55rem',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                RESET
              </button>
            </div>
            <div style={{ marginTop: '0.6rem', textAlign: 'center', padding: '0.5rem 0' }}>
              <div style={{ fontSize: '0.7rem', color: C.muted }}>Total Solves</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', marginTop: '0.1rem' }}>
                {solves.length}
              </div>
              <div style={{ fontSize: '0.68rem', color: C.success, marginTop: '0.15rem' }}>
                {stats.ao5 != null ? `Ao5 unlocked` : `${Math.max(0, 5 - solves.length)} until Ao5`}
              </div>
            </div>
          </div>

          {/* Consistency */}
          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: '1rem 1.1rem',
          }}>
            <div style={{ fontSize: '0.66rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 600, marginBottom: '0.6rem' }}>
              Consistency Meter
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
              <span style={{ color: C.text }}>Execution</span>
              <span style={{ color: consistency.label === 'High' ? C.success : consistency.label === 'Medium' ? C.warn : C.muted, fontWeight: 700 }}>
                {consistency.label}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '0.7rem' }}>
              <div style={{
                width: `${consistency.ratio * 100}%`, height: '100%',
                background: C.accent, transition: 'width 0.4s',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
              <span style={{ color: C.text }}>Flow State</span>
              <span style={{ color: consistency.label === 'High' ? C.success : C.muted, fontWeight: 600 }}>
                {consistency.label === 'High' ? 'Optimal' : consistency.label === 'Medium' ? 'Steady' : 'Building'}
              </span>
            </div>
          </div>

          {/* Footer hint */}
          <div style={{ fontSize: '0.66rem', color: C.mutedDim, textAlign: 'center', lineHeight: 1.6, marginTop: '0.25rem' }}>
            <div>SPACE: timer · ESC: reset · D: delete last · N: new scramble</div>
            <Link href="/" style={{ color: C.muted, textDecoration: 'none', display: 'inline-block', marginTop: '0.5rem' }}>← Back to home</Link>
          </div>
        </aside>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .pv-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 700px) {
          .pv-grid { padding: 0.75rem !important; gap: 0.75rem !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SidebarItem({ icon, label, active, href }: { icon: string; label: string; active?: boolean; href?: string }) {
  const inner = (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: '0.7rem',
      padding: '0.6rem 0.7rem', borderRadius: 9,
      background: active ? C.accentDim : 'transparent',
      color: active ? C.accent : C.text,
      fontSize: '0.86rem', fontWeight: active ? 700 : 500,
      cursor: 'pointer', transition: 'background 0.15s',
    }}>
      <span style={{ width: 18, fontSize: '0.95rem', textAlign: 'center', opacity: active ? 1 : 0.7 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {active && (
        <span style={{ position: 'absolute', right: -1, top: 8, bottom: 8, width: 3, borderRadius: 2, background: C.accent }} />
      )}
    </div>
  );
  if (href) return <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>;
  return inner;
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'linear-gradient(135deg, rgba(167,139,250,0.08), rgba(167,139,250,0.02))' : C.card,
      border: `1px solid ${accent ? 'rgba(167,139,250,0.2)' : C.border}`,
      borderRadius: 12, padding: '0.85rem 0.9rem',
    }}>
      <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '1.35rem', fontWeight: 700,
        color: accent ? C.accent : C.text,
        marginTop: '0.3rem', fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  );
}

function PenaltyButton({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.42rem 0.95rem', borderRadius: 8,
        fontSize: '0.78rem', fontWeight: 700, fontFamily: 'inherit',
        background: active ? `${color}26` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.08)'}`,
        color: active ? color : C.muted,
        cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}
