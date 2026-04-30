'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Scrambow } from 'scrambow';
// Type-only import; runtime is dynamic-imported below to avoid HTMLElement
// access during Next.js server rendering.
import type { TwistyPlayer as TwistyPlayerType } from 'cubing/twisty';

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

// Map our event ids → TwistyPlayer puzzle ids. Events not in this map (e.g.
// 333mbf, 333fm) fall back to their underlying puzzle.
const PUZZLE_MAP: Record<string, string> = {
  '333':    '3x3x3',
  '333oh':  '3x3x3',
  '333bld': '3x3x3',
  '333mbf': '3x3x3',
  '333fm':  '3x3x3',
  '222':    '2x2x2',
  '444':    '4x4x4',
  '444bld': '4x4x4',
  '555':    '5x5x5',
  '555bld': '5x5x5',
  '666':    '6x6x6',
  '777':    '7x7x7',
  'pyram':  'pyraminx',
  'skewb':  'skewb',
  'sq1':    'square1',
  'clock':  'clock',
  'minx':   'megaminx',
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

function fmtMs(ms: number | null | undefined, dnf = false, showMs = true): string {
  if (dnf) return 'DNF';
  if (ms == null) return '—';
  const totalSec = ms / 1000;
  if (showMs) {
    if (totalSec < 60) return totalSec.toFixed(2);
    const m = Math.floor(totalSec / 60);
    const s = (totalSec - m * 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }
  const sec = Math.floor(totalSec);
  if (sec < 60) return sec.toString();
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toString().padStart(2, '0');
  return `${m}:${s}`;
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
      // Auto-return to idle: no confirmation, no penalty UI.
      setDisplayMs(0);
      setState('idle');
      const dnf = inspectionMs <= -2000;
      inspStartRef.current = 0;
      setInspectionMs(15000);
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

  // Skip arming entirely (used when "hold to start" preference is off)
  const startRunning = useCallback(() => {
    runStartRef.current = Date.now();
    setDisplayMs(0);
    setState('running');
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
    beginInspection, startArming, startRunning, fireRunning, stop, reset,
  };
}

// ── Main page ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pv.timer.session.v1';
const PREFS_KEY = 'pv.timer.prefs.v1';

export default function TimerPage() {
  const router = useRouter();
  const [eventId, setEventId] = useState<string>('333');
  const [scramble, setScramble] = useState<string>(() => generateScramble('333'));
  const [solves, setSolves] = useState<Solve[]>([]);
  const [hoveredSolveId, setHoveredSolveId] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedSolveId, setExpandedSolveId] = useState<string | null>(null);
  // Timer preferences
  const [inspectionEnabled, setInspectionEnabled] = useState(true);
  const [showMs, setShowMs] = useState(true);          // ms vs seconds-only
  const [holdToStart, setHoldToStart] = useState(true); // long-press arming
  // Default false to match SSR; updated after mount via matchMedia. Brief flash
  // possible on mobile pageload but no hydration mismatch.
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Swipe-to-delete state for mobile session history
  const swipeStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const [swipe, setSwipe] = useState<{ id: string; dx: number } | null>(null);

  function onSwipeStart(e: React.TouchEvent, id: string) {
    const t = e.touches[0];
    swipeStartRef.current = { id, x: t.clientX, y: t.clientY };
  }
  function onSwipeMove(e: React.TouchEvent) {
    const start = swipeStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Lock to horizontal swipe only; ignore vertical scroll gestures.
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) && dx < 0) {
      setSwipe({ id: start.id, dx: Math.max(dx, -110) });
    }
  }
  function onSwipeEnd() {
    const s = swipe;
    swipeStartRef.current = null;
    if (s && s.dx < -70) {
      deleteSolve(s.id);
    }
    setSwipe(null);
  }

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

  // Load preferences on mount
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { inspectionEnabled?: boolean; showMs?: boolean; holdToStart?: boolean };
        if (typeof parsed.inspectionEnabled === 'boolean') setInspectionEnabled(parsed.inspectionEnabled);
        if (typeof parsed.showMs === 'boolean')            setShowMs(parsed.showMs);
        if (typeof parsed.holdToStart === 'boolean')       setHoldToStart(parsed.holdToStart);
      }
    } catch { /* ignore */ }
    prefsLoadedRef.current = true;
  }, []);

  // Persist preferences (skip the very first render before load completes)
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ inspectionEnabled, showMs, holdToStart }));
    } catch { /* ignore */ }
  }, [inspectionEnabled, showMs, holdToStart]);

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

  // After a solve commits, immediately generate next scramble so the
  // timer drops back to a fresh idle state without any confirmation step.
  const lastCommittedCountRef = useRef(0);
  useEffect(() => {
    if (solves.length > lastCommittedCountRef.current) {
      lastCommittedCountRef.current = solves.length;
      setScramble(generateScramble(eventId));
    }
  }, [solves.length, eventId]);

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
        if (timer.state === 'idle') {
          if (inspectionEnabled) {
            timer.beginInspection();
          } else if (holdToStart) {
            timer.startArming();
          } else {
            timer.startRunning();
          }
          return;
        }
        if (timer.state === 'inspecting') {
          if (holdToStart) timer.startArming();
          else timer.startRunning();
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
  }, [timer, newScramble, inspectionEnabled, holdToStart]);

  // Mobile: tap timer area
  const onTimerTouchStart = useCallback(() => {
    if (timer.state === 'running') { timer.stop(); return; }
    if (timer.state === 'idle') {
      if (inspectionEnabled) {
        timer.beginInspection();
      } else if (holdToStart) {
        timer.startArming();
      } else {
        timer.startRunning();
      }
      return;
    }
    if (timer.state === 'inspecting') {
      if (holdToStart) timer.startArming();
      else timer.startRunning();
    }
  }, [timer, inspectionEnabled, holdToStart]);

  const onTimerTouchEnd = useCallback(() => {
    if (timer.state === 'armed') timer.fireRunning();
  }, [timer]);

  // ── Solve action handlers ────────────────────────────────────────────────
  const deleteSolve = (id: string) => setSolves(prev => prev.filter(s => s.id !== id));
  const setSolvePenalty = (id: string, p: Penalty) =>
    setSolves(prev => prev.map(s => s.id === id ? { ...s, penalty: p } : s));
  const toggleExpand = (id: string) =>
    setExpandedSolveId(prev => prev === id ? null : id);
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
    if (timer.state === 'armed') return showMs ? '0.00' : '0';
    return fmtMs(timer.displayMs, false, showMs);
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: '100vh', overflow: 'hidden',
      background: C.bg, color: C.text,
      display: 'flex',
    }}>
      {/* Subtle grain background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '3px 3px', opacity: 0.7,
      }} />

      {!isMobile && (
      <div className="pv-grid" style={{
        position: 'relative', zIndex: 1,
        display: 'flex',
        gap: '1rem',
        padding: '1rem',
        width: '100%',
        height: '100%',
        maxWidth: '1600px', margin: '0 auto',
      }}>
        {/* ── LEFT SIDEBAR (Settings + Session History) ─────────────────── */}
        <aside style={{
          flex: '0 0 260px',
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16,
          display: 'flex', flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {/* Top: Settings cog + Exit + History header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.85rem 1rem 0.6rem',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: 'transparent', border: `1px solid ${C.border}`,
                  color: C.muted, cursor: 'pointer', fontSize: '0.95rem',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.accentDim; e.currentTarget.style.color = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted; }}
              >⚙</button>
              <button
                onClick={() => router.push('/')}
                aria-label="Exit timer"
                title="Exit to main site"
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: 'transparent', border: `1px solid ${C.border}`,
                  color: C.mutedDim, cursor: 'pointer', fontSize: '0.95rem',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.accentDim; e.currentTarget.style.color = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.mutedDim; }}
              >×</button>
            </div>
            <div style={{ fontSize: '0.66rem', color: C.muted, letterSpacing: '0.05em' }}>
              {solves.length === 0 ? '0 solves' : `${solves.length} solve${solves.length === 1 ? '' : 's'}`}
            </div>
          </div>

          <div style={{ padding: '0.85rem 1rem 0.4rem', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.05em', color: C.text }}>
            Session History
          </div>

          {/* Scrollable solve list */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 0.5rem 0.5rem' }}>
            {solves.length === 0 ? (
              <div style={{ padding: '1.5rem 0.5rem', textAlign: 'center', color: C.mutedDim, fontSize: '0.78rem' }}>
                Press SPACE to start your first solve.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {[...solves].reverse().map((s, i) => {
                  const idx = solves.length - i;
                  const dnf = isDnf(s);
                  const priorSet = solves.slice(0, solves.length - i).slice(0, -1).filter(x => !isDnf(x));
                  const priorBest = priorSet.length ? Math.min(...priorSet.map(finalMs)) : Infinity;
                  const isPB = !dnf && finalMs(s) < priorBest;
                  const expanded = expandedSolveId === s.id;
                  return (
                    <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div
                        onMouseEnter={() => setHoveredSolveId(s.id)}
                        onMouseLeave={() => setHoveredSolveId(prev => prev === s.id ? null : prev)}
                        onClick={() => toggleExpand(s.id)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1.7rem 1fr auto auto',
                          alignItems: 'center', gap: '0.5rem',
                          padding: '0.5rem 0.6rem', borderRadius: 8,
                          background: expanded || hoveredSolveId === s.id ? 'rgba(255,255,255,0.04)' : C.cardAlt,
                          borderLeft: isPB ? `3px solid ${C.success}` : '3px solid transparent',
                          cursor: 'pointer',
                          transition: 'background 0.12s',
                        }}
                      >
                        <div style={{ fontSize: '0.66rem', color: C.mutedDim, fontWeight: 600 }}>
                          {String(idx).padStart(2, '0')}
                        </div>
                        <div style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '0.92rem', fontWeight: 700,
                          color: dnf ? C.danger : isPB ? C.success : C.text,
                        }}>
                          {fmtMs(finalMs(s), dnf, showMs)}
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          {isPB && !dnf && (
                            <span style={{
                              fontSize: '0.55rem', fontWeight: 700, padding: '0.1rem 0.35rem', borderRadius: 4,
                              background: 'rgba(52,211,153,0.15)', color: C.success, letterSpacing: '0.04em',
                            }}>PB</span>
                          )}
                          {s.penalty === '+2' && (
                            <span style={{
                              fontSize: '0.55rem', fontWeight: 700, padding: '0.1rem 0.35rem', borderRadius: 4,
                              background: 'rgba(251,191,36,0.15)', color: C.warn, letterSpacing: '0.04em',
                            }}>+2</span>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSolve(s.id); }}
                          aria-label="Delete solve"
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: C.mutedDim, fontSize: '0.85rem', padding: '0.1rem 0.25rem',
                            opacity: hoveredSolveId === s.id || expanded ? 1 : 0,
                            transition: 'opacity 0.12s',
                          }}
                          title="Delete"
                        >×</button>
                      </div>
                      {expanded && (
                        <PenaltyRow
                          penalty={s.penalty}
                          onSet={(p) => setSolvePenalty(s.id, p)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer: Clear All */}
          {solves.length > 0 && (
            <div style={{ padding: '0.6rem 0.85rem', borderTop: `1px solid ${C.border}` }}>
              <button
                onClick={resetSession}
                style={{
                  width: '100%', padding: '0.45rem 0.7rem', borderRadius: 8,
                  fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.05em',
                  background: 'rgba(239,68,68,0.08)', color: '#f87171',
                  border: '1px solid rgba(239,68,68,0.25)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.18)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
              >
                Clear All
              </button>
            </div>
          )}
        </aside>

        {/* ── CENTER PANEL ─────────────────────────────────────────────── */}
        <main style={{
          flex: '1 1 auto', minWidth: 0,
          display: 'flex', flexDirection: 'column', gap: '1rem',
          height: '100%', overflow: 'hidden',
        }}>
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
              flex: '1 1 auto', minHeight: 0, position: 'relative',
              background: C.card, border: `1px solid ${timer.state === 'armed' ? C.success : C.border}`,
              borderRadius: 16, padding: '2rem 1.5rem',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              userSelect: 'none', cursor: 'pointer', textAlign: 'center',
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
            <div style={{ fontSize: '0.78rem', color: C.muted, marginTop: '1.5rem', letterSpacing: '0.06em', minHeight: '1.2rem' }}>
              {timer.state === 'inspecting' && 'Hold SPACE to arm, release to start'}
              {timer.state === 'armed' && (<span style={{ color: C.success, fontWeight: 700 }}>RELEASE TO START</span>)}
              {timer.state === 'running' && 'Press SPACE / tap to stop'}
            </div>

            {/* Cube preview — fixed-square, bottom-right; visual only (no pointer) */}
            <div style={{
              position: 'absolute', bottom: '1rem', right: '1rem',
              width: 180, height: 180,
              pointerEvents: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CubeViewer eventId={eventId} scramble={scramble} />
            </div>
          </section>

        </main>

        {/* ── RIGHT PANEL ───────────────────────────────────────────────── */}
        <aside style={{
          flex: '0 0 280px', minWidth: 0,
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
          height: '100%', overflow: 'hidden',
        }}>
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

        </aside>
      </div>
      )}

      {isMobile && (() => {
        const lastSolves = [...solves].slice(-5).reverse();
        return (
          <div style={{
            position: 'relative', zIndex: 1,
            height: '100%', width: '100%',
            display: 'flex', flexDirection: 'column',
            background: C.bg, color: C.text,
            overflow: 'hidden',
          }}>
            {/* Header */}
            <header style={{
              flex: '0 0 50px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 0.85rem',
              borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{
                fontSize: '0.95rem', fontWeight: 800, color: C.accent,
                letterSpacing: '-0.01em', fontFamily: 'Inter, system-ui, sans-serif',
              }}>
                Precision Velocity
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Settings"
                  style={{
                    width: 34, height: 34, borderRadius: 8,
                    background: 'transparent', border: `1px solid ${C.border}`,
                    color: C.muted, cursor: 'pointer', fontSize: '1rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >⚙</button>
                <button
                  onClick={() => router.push('/')}
                  aria-label="Exit timer"
                  style={{
                    width: 34, height: 34, borderRadius: 8,
                    background: 'transparent', border: `1px solid ${C.border}`,
                    color: C.mutedDim, cursor: 'pointer', fontSize: '1.05rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >×</button>
              </div>
            </header>

            {/* Top: scramble + event selector + new */}
            <section style={{
              flex: '0 0 auto',
              padding: '0.7rem 0.85rem',
              display: 'flex', flexDirection: 'column', gap: '0.5rem',
              borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <select
                  value={eventId}
                  onChange={e => setEventId(e.target.value)}
                  style={{
                    flex: 1,
                    background: C.cardAlt, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: '0.45rem 0.5rem', fontSize: '16px',  // 16px prevents iOS zoom
                    fontFamily: 'inherit', outline: 'none',
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
                    padding: '0.45rem 0.7rem', fontSize: '0.78rem',
                    fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  New
                </button>
              </div>
              <div style={{
                fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                fontSize: '0.85rem', lineHeight: 1.5,
                color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: '4.2em', overflowY: 'auto',
              }}>
                {scramble}
              </div>
            </section>

            {/* Center: timer (fills remaining space) */}
            <section
              onTouchStart={onTimerTouchStart}
              onTouchEnd={onTimerTouchEnd}
              style={{
                flex: '1 1 auto', minHeight: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                userSelect: 'none', cursor: 'pointer', textAlign: 'center',
                touchAction: 'manipulation',
                padding: '0.5rem 1rem',
                borderBottom: `1px solid ${C.border}`,
                background: timer.state === 'armed' ? `${C.success}10` : 'transparent',
                transition: 'background 0.12s',
              }}
            >
              {timer.state === 'inspecting' && (
                <div style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.warn, marginBottom: '0.6rem', fontWeight: 700 }}>
                  Inspection
                </div>
              )}
              <div style={{
                fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                fontSize: 'clamp(3.5rem, 22vw, 6.5rem)',
                fontWeight: 700, lineHeight: 0.95,
                fontVariantNumeric: 'tabular-nums',
                color: timerColor,
                transition: 'color 0.12s',
                textShadow: timer.state === 'armed' ? `0 0 30px ${C.success}55` : 'none',
              }}>
                {timerDisplay}
              </div>
              <div style={{ fontSize: '0.7rem', color: C.muted, marginTop: '0.9rem', letterSpacing: '0.06em', minHeight: '1rem' }}>
                {timer.state === 'inspecting' && 'Hold to arm, release to start'}
                {timer.state === 'armed' && (<span style={{ color: C.success, fontWeight: 700 }}>RELEASE TO START</span>)}
                {timer.state === 'running' && 'TAP TO STOP'}
              </div>
            </section>

            {/* Bottom: quick stats + history + small cube */}
            <section style={{
              flex: '0 0 auto',
              position: 'relative',
              minHeight: '170px',
            }}>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.4rem', padding: '0.5rem 0.85rem 0.25rem',
              }}>
                <MiniStat label="Best" value={fmtMs(stats.best)} />
                <MiniStat label="Ao5"  value={stats.ao5  == null ? '—' : fmtMs(stats.ao5)}  accent />
                <MiniStat label="Ao12" value={stats.ao12 == null ? '—' : fmtMs(stats.ao12)} accent />
              </div>
              <div style={{
                padding: '0 0.85rem 0.5rem',
                paddingRight: '6.5rem',  // reserve right edge for floating cube
                maxHeight: '110px', overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: '0.25rem',
              }}>
                {lastSolves.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: C.mutedDim, padding: '0.5rem 0' }}>
                    Tap timer above to start your first solve.
                  </div>
                ) : (
                  lastSolves.map((s) => {
                    const idx = solves.indexOf(s) + 1;
                    const dnf = isDnf(s);
                    const swiped = swipe?.id === s.id ? swipe.dx : 0;
                    const expanded = expandedSolveId === s.id;
                    return (
                      <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <div
                          onClick={() => { if (!swipe) toggleExpand(s.id); }}
                          onTouchStart={(e) => onSwipeStart(e, s.id)}
                          onTouchMove={onSwipeMove}
                          onTouchEnd={onSwipeEnd}
                          style={{
                            display: 'grid', gridTemplateColumns: '1.7rem 1fr auto', alignItems: 'center', gap: '0.5rem',
                            padding: '0.4rem 0.55rem', borderRadius: 7,
                            background: expanded ? 'rgba(255,255,255,0.05)' : C.cardAlt,
                            touchAction: 'pan-y',
                            transform: `translateX(${swiped}px)`,
                            transition: swipe?.id === s.id ? 'none' : 'transform 0.18s, background 0.12s',
                          }}
                        >
                          <div style={{ fontSize: '0.65rem', color: C.mutedDim, fontWeight: 600 }}>
                            {String(idx).padStart(2, '0')}
                          </div>
                          <div style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: '0.88rem', fontWeight: 700,
                            color: dnf ? C.danger : C.text,
                          }}>
                            {fmtMs(finalMs(s), dnf, showMs)}
                          </div>
                          <div style={{ display: 'flex', gap: '0.2rem' }}>
                            {s.penalty === '+2' && (
                              <span style={{
                                fontSize: '0.55rem', fontWeight: 700, padding: '0.1rem 0.3rem', borderRadius: 4,
                                background: 'rgba(251,191,36,0.15)', color: C.warn,
                              }}>+2</span>
                            )}
                          </div>
                        </div>
                        {expanded && (
                          <PenaltyRow
                            penalty={s.penalty}
                            onSet={(p) => setSolvePenalty(s.id, p)}
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{
                position: 'absolute', bottom: '0.5rem', right: '0.6rem',
                width: 80, height: 80,
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CubeViewer eventId={eventId} scramble={scramble} />
              </div>
            </section>
          </div>
        );
      })()}

      {/* Settings modal */}
      {settingsOpen && (
        <ModalShell
          title="Settings"
          onClose={() => setSettingsOpen(false)}
          headerAction={(
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: C.mutedDim, fontSize: '0.72rem', fontFamily: 'inherit',
                letterSpacing: '0.04em', padding: '0.1rem 0.25rem',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = C.muted)}
              onMouseLeave={e => (e.currentTarget.style.color = C.mutedDim)}
            >
              ← Exit
            </button>
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <div style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '0.5rem', fontWeight: 600 }}>
                Preferences
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <ToggleRow label="Inspection time"  value={inspectionEnabled} onChange={setInspectionEnabled} />
                <ToggleRow label="Show milliseconds" value={showMs}            onChange={setShowMs} />
                <ToggleRow label="Hold to start"    value={holdToStart}        onChange={setHoldToStart} />
              </div>
            </div>
            <div style={{ height: 1, background: C.border }} />
            <div>
              <div style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '0.5rem', fontWeight: 600 }}>
                Theme
              </div>
              <div style={{ fontSize: '0.82rem', color: C.muted, lineHeight: 1.5 }}>
                Lavender on midnight. Additional themes coming soon.
              </div>
            </div>
            <div style={{ height: 1, background: C.border }} />
            <div>
              <div style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '0.5rem', fontWeight: 600 }}>
                Keyboard Shortcuts
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
                <Row label="Start / stop timer" kbd="SPACE" />
                <Row label="Cancel inspection / reset" kbd="ESC" />
                <Row label="Delete last solve" kbd="D" />
                <Row label="New scramble" kbd="N" />
              </div>
            </div>
            <div style={{ height: 1, background: C.border }} />
            <div>
              <div style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '0.5rem', fontWeight: 600 }}>
                Session
              </div>
              <div style={{ fontSize: '0.82rem', color: C.muted, lineHeight: 1.5 }}>
                Solves are saved to local storage and restored on reload. Switching events generates a new scramble. Clearing the session is permanent.
              </div>
            </div>
          </div>
        </ModalShell>
      )}

      <style>{`
        .pv-grid > main > section { box-sizing: border-box; }
        @media (max-width: 1100px) {
          .pv-grid { flex-direction: column !important; height: auto !important; overflow: auto !important; }
          .pv-grid > aside { flex: 0 0 auto !important; height: auto !important; max-height: 60vh; }
        }
        @media (max-width: 700px) {
          .pv-grid { padding: 0.75rem !important; gap: 0.75rem !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

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

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'linear-gradient(135deg, rgba(167,139,250,0.08), rgba(167,139,250,0.02))' : C.cardAlt,
      border: `1px solid ${accent ? 'rgba(167,139,250,0.2)' : C.border}`,
      borderRadius: 8, padding: '0.45rem 0.55rem',
      display: 'flex', flexDirection: 'column', gap: '0.15rem',
    }}>
      <div style={{ fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.95rem', fontWeight: 700,
        color: accent ? C.accent : C.text,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, headerAction, children }: { title: string; onClose: () => void; headerAction?: React.ReactNode; children: React.ReactNode }) {
  // Close on ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460,
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '1.1rem 1.25rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', gap: '0.5rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: C.text }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {headerAction}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 28, height: 28, borderRadius: 7,
                background: 'transparent', border: `1px solid ${C.border}`,
                color: C.muted, cursor: 'pointer', fontSize: '0.95rem',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
      <span style={{ color: C.text }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        style={{
          position: 'relative',
          width: 40, height: 22, borderRadius: 999,
          background: value ? C.accent : 'rgba(255,255,255,0.1)',
          border: `1px solid ${value ? C.borderHi : C.border}`,
          cursor: 'pointer', padding: 0,
          transition: 'background 0.18s, border-color 0.18s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: value ? 20 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: value ? '#fff' : C.muted,
          transition: 'left 0.18s, background 0.18s',
        }} />
      </button>
    </div>
  );
}

function PenaltyRow({ penalty, onSet }: { penalty: Penalty; onSet: (p: Penalty) => void }) {
  const opts: { label: string; value: Penalty; color: string }[] = [
    { label: 'OK',  value: 'none', color: C.muted   },
    { label: '+2',  value: '+2',   color: C.warn    },
    { label: 'DNF', value: 'dnf',  color: C.danger  },
  ];
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', gap: '0.3rem', padding: '0.1rem 0.6rem 0.3rem 2.7rem' }}
    >
      {opts.map(o => {
        const active = penalty === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onSet(o.value)}
            style={{
              padding: '0.25rem 0.55rem', borderRadius: 6,
              fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
              letterSpacing: '0.04em',
              background: active ? `${o.color}26` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${active ? o.color : 'rgba(255,255,255,0.08)'}`,
              color: active ? o.color : C.muted,
              cursor: 'pointer', transition: 'all 0.12s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, kbd }: { label: string; kbd: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: C.text }}>{label}</span>
      <kbd style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
        padding: '0.2rem 0.55rem', borderRadius: 6,
        background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
        color: C.text,
      }}>{kbd}</kbd>
    </div>
  );
}

// 3D cube preview using @cubing/twisty's TwistyPlayer Web Component. Imported
// dynamically so HTMLElement access doesn't break Next.js server rendering.
function CubeViewer({ eventId, scramble }: { eventId: string; scramble: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TwistyPlayerType | null>(null);
  const puzzleId = PUZZLE_MAP[eventId];

  // Mount: load TwistyPlayer and create the player instance.
  useEffect(() => {
    if (!puzzleId) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('cubing/twisty');
        if (cancelled || !containerRef.current) return;
        // Cast: PuzzleID is a strict literal union; we validated puzzleId via
        // PUZZLE_MAP so the runtime value is a member of that union.
        const config = {
          puzzle: puzzleId,
          experimentalSetupAlg: scramble,
          alg: '',
          background: 'none',
          controlPanel: 'none',
          viewerLink: 'none',
          hintFacelets: 'none',
          backView: 'none',
          visualization: '3D',
        } as unknown as ConstructorParameters<typeof mod.TwistyPlayer>[0];
        const player = new mod.TwistyPlayer(config);
        const el = player as unknown as HTMLElement;
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.background = 'transparent';
        containerRef.current.appendChild(el);
        playerRef.current = player;
      } catch (err) {
        // Silent fall-back: container stays empty if the module fails to load.
        // eslint-disable-next-line no-console
        console.warn('TwistyPlayer load failed', err);
      }
    })();
    return () => {
      cancelled = true;
      const player = playerRef.current as unknown as HTMLElement | null;
      const c = containerRef.current;
      if (player && c && c.contains(player)) c.removeChild(player);
      playerRef.current = null;
    };
    // Mount only — subsequent puzzle/scramble changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update on scramble or puzzle change.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !puzzleId) return;
    try {
      // Type assertion: PuzzleID is a string-literal union; we validated
      // membership via PUZZLE_MAP, so the cast is safe at runtime.
      (player as unknown as { puzzle: string }).puzzle = puzzleId;
      (player as unknown as { experimentalSetupAlg: string }).experimentalSetupAlg = scramble;
      (player as unknown as { alg: string }).alg = '';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('TwistyPlayer update failed', err);
    }
  }, [scramble, puzzleId]);

  if (!puzzleId) {
    return (
      <div style={{
        flex: '1 1 auto', minHeight: 0, width: '100%', fontSize: '0.72rem', color: C.mutedDim,
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 0.5rem',
      }}>
        Preview not available for this puzzle.
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      style={{
        flex: '1 1 auto', minHeight: 0, width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    />
  );
}
