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
      // Keep the final time on display so the user sees their result.
      // The next start press resets to 0 and begins inspection.
      setDisplayMs(final);
      setState('stopped');
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
const SESSIONS_KEY = 'pv.timer.sessions.v2';

// Alt+key → event id. Uses KeyboardEvent.code so the mapping is layout-stable.
const ALT_EVENT_KEYS: Record<string, string> = {
  Digit1: 'sq1',
  Digit2: '222',
  Digit3: '333',
  Digit4: '444',
  Digit5: '555',
  Digit6: '666',
  Digit7: '777',
  KeyS:   'skewb',
  KeyM:   'minx',
  KeyC:   'clock',
  KeyP:   'pyram',
};

interface Session {
  id: string;
  name: string;
  createdAt: number;
  solves: Solve[];
}
type SessionStore = Record<string /* eventId */, { sessions: Session[]; currentId: string }>;

const newSessionId = () => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
function makeDefaultSession(solves: Solve[] = []): Session {
  return { id: newSessionId(), name: 'Default', createdAt: Date.now(), solves };
}

export default function TimerPage() {
  const router = useRouter();
  const [eventId, setEventId] = useState<string>('333');
  const [scramble, setScramble] = useState<string>(() => generateScramble('333'));
  // Sessions store: per-event list of sessions, plus the active session id.
  // `solves` derives from the active session.
  const [sessions, setSessions] = useState<SessionStore>({});
  const [hoveredSolveId, setHoveredSolveId] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailSolveId, setDetailSolveId] = useState<string | null>(null);
  // Timer preferences
  const [inspectionEnabled, setInspectionEnabled] = useState(true);
  const [showMs, setShowMs] = useState(true);          // ms vs seconds-only
  const [holdToStart, setHoldToStart] = useState(true); // long-press arming
  const [scrambleFontSize, setScrambleFontSize] = useState<'sm' | 'md' | 'lg'>('md');
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

  // Mobile tab navigation + entry modals
  const [mobileTab, setMobileTab] = useState<'timer' | 'solves' | 'stats'>('timer');
  const [mobileSearch, setMobileSearch] = useState('');
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualEntryValue, setManualEntryValue] = useState('');
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [cubeFullscreenOpen, setCubeFullscreenOpen] = useState(false);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  // Two-step Alt+D confirmation for clearing the session.
  const [clearPending, setClearPending] = useState(false);
  const clearTimeoutRef = useRef<number | null>(null);
  // Mobile Solves tab — long-press to enter multi-select.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSolveIds, setSelectedSolveIds] = useState<Set<string>>(() => new Set());
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);

  // ── Derived solves + setSolves wrapper ──
  // Source of truth is `sessions`. `solves` is the active session's array.
  const currentSession = useMemo<Session | null>(() => {
    const ev = sessions[eventId];
    if (!ev) return null;
    return ev.sessions.find(s => s.id === ev.currentId) ?? ev.sessions[0] ?? null;
  }, [sessions, eventId]);
  const solves: Solve[] = currentSession?.solves ?? [];

  const setSolves = useCallback(
    (updater: Solve[] | ((prev: Solve[]) => Solve[])) => {
      setSessions(prev => {
        const ev = prev[eventId];
        if (!ev) return prev;
        const cur = ev.sessions.find(s => s.id === ev.currentId) ?? ev.sessions[0];
        if (!cur) return prev;
        const next = typeof updater === 'function'
          ? (updater as (p: Solve[]) => Solve[])(cur.solves)
          : updater;
        const list = ev.sessions.map(s => s.id === cur.id ? { ...s, solves: next } : s);
        return { ...prev, [eventId]: { sessions: list, currentId: cur.id } };
      });
    },
    [eventId],
  );

  // Ensure the active event always has at least one session.
  useEffect(() => {
    setSessions(prev => {
      const ev = prev[eventId];
      if (ev && ev.sessions.length > 0) return prev;
      const ds = makeDefaultSession();
      return { ...prev, [eventId]: { sessions: [ds], currentId: ds.id } };
    });
  }, [eventId]);

  const switchSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const ev = prev[eventId];
      if (!ev) return prev;
      if (!ev.sessions.some(s => s.id === sessionId)) return prev;
      return { ...prev, [eventId]: { ...ev, currentId: sessionId } };
    });
  }, [eventId]);

  const createSession = useCallback((rawName: string) => {
    const name = rawName.trim() || `Session ${Date.now().toString(36).slice(-4)}`;
    const ds = makeDefaultSession();
    ds.name = name;
    setSessions(prev => {
      const ev = prev[eventId];
      const list = ev ? [...ev.sessions, ds] : [ds];
      return { ...prev, [eventId]: { sessions: list, currentId: ds.id } };
    });
  }, [eventId]);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const ev = prev[eventId];
      if (!ev) return prev;
      // Refuse to delete the last remaining session.
      if (ev.sessions.length <= 1) return prev;
      const list = ev.sessions.filter(s => s.id !== sessionId);
      const currentId = ev.currentId === sessionId ? list[0].id : ev.currentId;
      return { ...prev, [eventId]: { sessions: list, currentId } };
    });
  }, [eventId]);

  // Refresh "X mins ago" labels every 30s
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load session from localStorage on mount
  // Load sessions store on mount, with one-time migration from v1 storage.
  const sessionsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { store?: SessionStore; currentEventId?: string };
        if (parsed?.store && typeof parsed.store === 'object') setSessions(parsed.store);
        if (parsed?.currentEventId && EVENTS.some(e => e.id === parsed.currentEventId)) {
          setEventId(parsed.currentEventId);
          setScramble(generateScramble(parsed.currentEventId));
        }
      } else {
        // Migrate from the old single-session format.
        const old = localStorage.getItem(STORAGE_KEY);
        if (old) {
          const parsedOld = JSON.parse(old) as { solves?: Solve[]; eventId?: string };
          const oldEvent = parsedOld.eventId && EVENTS.some(e => e.id === parsedOld.eventId)
            ? parsedOld.eventId : '333';
          const oldSolves = Array.isArray(parsedOld.solves) ? parsedOld.solves : [];
          const ds = makeDefaultSession(oldSolves);
          setSessions({ [oldEvent]: { sessions: [ds], currentId: ds.id } });
          setEventId(oldEvent);
          setScramble(generateScramble(oldEvent));
        }
      }
    } catch { /* ignore */ }
    sessionsLoadedRef.current = true;
  }, []);

  // Persist sessions store + active event whenever they change.
  useEffect(() => {
    if (!sessionsLoadedRef.current) return;
    try {
      localStorage.setItem(
        SESSIONS_KEY,
        JSON.stringify({ store: sessions, currentEventId: eventId }),
      );
    } catch { /* ignore */ }
  }, [sessions, eventId]);

  // Load preferences on mount
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          inspectionEnabled?: boolean;
          showMs?: boolean;
          holdToStart?: boolean;
          scrambleFontSize?: 'sm' | 'md' | 'lg';
        };
        if (typeof parsed.inspectionEnabled === 'boolean') setInspectionEnabled(parsed.inspectionEnabled);
        if (typeof parsed.showMs === 'boolean')            setShowMs(parsed.showMs);
        if (typeof parsed.holdToStart === 'boolean')       setHoldToStart(parsed.holdToStart);
        if (parsed.scrambleFontSize === 'sm' || parsed.scrambleFontSize === 'md' || parsed.scrambleFontSize === 'lg') {
          setScrambleFontSize(parsed.scrambleFontSize);
        }
      }
    } catch { /* ignore */ }
    prefsLoadedRef.current = true;
  }, []);

  // Persist preferences (skip the very first render before load completes)
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ inspectionEnabled, showMs, holdToStart, scrambleFontSize }));
    } catch { /* ignore */ }
  }, [inspectionEnabled, showMs, holdToStart, scrambleFontSize]);

  // Stats — recomputed on every solves change
  const stats = useMemo(() => calcStats(solves), [solves]);
  const sessionEvent = useMemo(() => EVENTS.find(e => e.id === eventId) ?? EVENTS[0], [eventId]);

  // Commit a solve to the active session and immediately roll a new scramble
  // so the timer is ready for the next attempt. Inline scramble generation
  // here is more reliable than a length-comparison effect, which got out of
  // sync when switching events/sessions changed `solves.length` without a
  // new solve actually being added.
  const onSolveCommit = useCallback((ms: number, dnf: boolean) => {
    setSolves(prev => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ms, penalty: dnf ? 'dnf' : 'none',
        scramble, event: eventId, ts: Date.now(),
      },
    ]);
    setScramble(generateScramble(eventId));
  }, [scramble, eventId]);

  const timer = useTimer(onSolveCommit);

  const newScramble = useCallback(() => {
    setScramble(generateScramble(eventId));
  }, [eventId]);

  // When event changes (dropdown, Alt+key, etc.), regenerate scramble.
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
      // Alt+key combinations: event switching + session clear.
      // Only handle when timer isn't running to avoid disrupting an active solve.
      if (e.altKey && !e.metaKey && !e.ctrlKey && (timer.state === 'idle' || timer.state === 'stopped')) {
        // Alt+D — two-step clear current session
        if (e.code === 'KeyD') {
          e.preventDefault();
          if (clearPending) {
            setSolves([]);
            setClearPending(false);
            if (clearTimeoutRef.current != null) {
              window.clearTimeout(clearTimeoutRef.current);
              clearTimeoutRef.current = null;
            }
          } else {
            setClearPending(true);
            if (clearTimeoutRef.current != null) {
              window.clearTimeout(clearTimeoutRef.current);
            }
            clearTimeoutRef.current = window.setTimeout(() => {
              setClearPending(false);
              clearTimeoutRef.current = null;
            }, 3000);
          }
          return;
        }
        // Alt+1..7 / S / M / C / P — switch event
        const target = ALT_EVENT_KEYS[e.code];
        if (target) {
          e.preventDefault();
          setEventId(target);
          return;
        }
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
  }, [timer, inspectionEnabled, holdToStart, clearPending, setSolves]);

  // Clear any pending Alt+D timeout on unmount.
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current != null) {
        window.clearTimeout(clearTimeoutRef.current);
        clearTimeoutRef.current = null;
      }
    };
  }, []);

  // Mobile: tap timer area
  const onTimerTouchStart = useCallback(() => {
    if (timer.state === 'running') { timer.stop(); return; }
    if (timer.state === 'idle' || timer.state === 'stopped') {
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

  // ── Mobile multi-select (Solves tab) ─────────────────────────────────────
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedSolveIds(new Set());
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressFiredRef.current = false;
  }, []);

  const startSolveLongPress = (id: string, e: React.TouchEvent) => {
    const t = e.touches[0];
    longPressOriginRef.current = { x: t.clientX, y: t.clientY };
    longPressFiredRef.current = false;
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      setSelectMode(true);
      setSelectedSolveIds(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      longPressTimerRef.current = null;
    }, 500);
  };

  const moveSolveLongPress = (e: React.TouchEvent) => {
    const origin = longPressOriginRef.current;
    if (!origin || longPressTimerRef.current == null) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - origin.x) > 8 || Math.abs(t.clientY - origin.y) > 8) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const endSolveLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  const handleSolveCardClick = (id: string) => {
    if (longPressFiredRef.current) {
      // Long-press already added this card to selection — swallow the click.
      longPressFiredRef.current = false;
      return;
    }
    if (selectMode) {
      setSelectedSolveIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
    setDetailSolveId(id);
  };

  const selectAllVisible = (ids: string[]) => {
    setSelectedSolveIds(new Set(ids));
  };

  const confirmDeleteSelected = () => {
    const count = selectedSolveIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} solve${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setSolves(prev => prev.filter(s => !selectedSolveIds.has(s.id)));
    exitSelectMode();
  };

  // Leave select-mode when navigating away from the Solves tab.
  useEffect(() => {
    if (mobileTab !== 'solves' && (selectMode || selectedSolveIds.size > 0)) {
      exitSelectMode();
    }
    // exitSelectMode is stable; selectedSolveIds + selectMode read in body
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileTab]);

  // Smart digit-only parser: last 2 digits = centiseconds, next 2 = seconds,
  // remaining = minutes. Examples:
  //   "1221"   → 12.21s   (12s 21cs)
  //   "122"    → 1.22s    (1s 22cs)
  //   "12211"  → 1:22.11
  //   "122111" → 12:21.11
  function parseManualTime(raw: string): number | null {
    const d = (raw || '').replace(/\D/g, '');
    if (!d) return null;
    let s = d;
    const csStr  = s.length >= 2 ? s.slice(-2) : s.padStart(2, '0');
    s = s.length >= 2 ? s.slice(0, -2) : '';
    const secStr = s.length >= 2 ? s.slice(-2) : s;
    s = s.length >= 2 ? s.slice(0, -2) : '';
    const minStr = s;
    const cs  = parseInt(csStr, 10) || 0;
    const sec = parseInt(secStr || '0', 10) || 0;
    const min = parseInt(minStr || '0', 10) || 0;
    return (min * 60 + sec) * 1000 + cs * 10;
  }

  function commitManualEntry() {
    const ms = parseManualTime(manualEntryValue);
    if (ms == null) return;
    setSolves(prev => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ms, penalty: 'none',
        scramble, event: eventId, ts: Date.now(),
      },
    ]);
    setManualEntryOpen(false);
    setManualEntryValue('');
  }


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
          {/* Top: Settings cog only — exit lives in the Settings panel,
              solve count moved to the Performance panel on the right. */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '0.85rem 1rem 0.6rem',
            borderBottom: `1px solid ${C.border}`,
          }}>
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
          </div>

          {/* Session selector — clickable name with dropdown panel */}
          <div style={{ position: 'relative', padding: '0.7rem 0.7rem 0.4rem' }}>
            <button
              onClick={() => setSessionDropdownOpen(o => !o)}
              aria-expanded={sessionDropdownOpen}
              aria-haspopup="listbox"
              style={{
                width: '100%',
                background: sessionDropdownOpen ? C.accentDim : C.cardAlt,
                border: `1px solid ${sessionDropdownOpen ? C.borderHi : C.border}`,
                borderRadius: 8,
                padding: '0.45rem 0.6rem',
                display: 'grid', gridTemplateColumns: '1fr auto',
                alignItems: 'center', gap: '0.35rem',
                cursor: 'pointer', fontFamily: 'inherit',
                color: C.text, textAlign: 'left',
                transition: 'background 0.12s, border-color 0.12s',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
                <span style={{ fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>
                  Session
                </span>
                <span style={{
                  fontSize: '0.85rem', fontWeight: 700,
                  color: sessionDropdownOpen ? C.accent : C.text,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {currentSession?.name ?? 'Default'}
                </span>
              </div>
              <span style={{
                color: sessionDropdownOpen ? C.accent : C.muted,
                fontSize: '0.7rem',
                transform: sessionDropdownOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s',
              }}>▾</span>
            </button>

            {sessionDropdownOpen && (() => {
              const ev = sessions[eventId];
              const list = ev?.sessions ?? [];
              const currentId = ev?.currentId;
              return (
                <>
                  {/* Click-outside catcher */}
                  <div
                    onClick={() => setSessionDropdownOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }}
                  />
                  <div
                    role="listbox"
                    style={{
                      position: 'absolute', top: '100%', left: '0.7rem', right: '0.7rem',
                      marginTop: '0.3rem', zIndex: 51,
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: '0.4rem',
                      boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
                      display: 'flex', flexDirection: 'column', gap: '0.25rem',
                      maxHeight: '60vh', overflowY: 'auto',
                    }}
                  >
                    {list.length === 0 && (
                      <div style={{ fontSize: '0.78rem', color: C.mutedDim, padding: '0.4rem' }}>
                        No sessions yet.
                      </div>
                    )}
                    {list.map(s => {
                      const valid = s.solves.filter(x => !isDnf(x));
                      const sessBest = valid.length ? Math.min(...valid.map(finalMs)) : null;
                      const isCurrent = s.id === currentId;
                      return (
                        <div
                          key={s.id}
                          style={{
                            display: 'grid', gridTemplateColumns: '1fr auto auto',
                            alignItems: 'center', gap: '0.35rem',
                            padding: '0.45rem 0.55rem', borderRadius: 7,
                            background: isCurrent ? C.accentDim : 'transparent',
                            border: `1px solid ${isCurrent ? C.borderHi : 'transparent'}`,
                          }}
                        >
                          <button
                            onClick={() => { switchSession(s.id); setSessionDropdownOpen(false); }}
                            style={{
                              background: 'transparent', border: 'none', cursor: 'pointer',
                              fontFamily: 'inherit', color: 'inherit', padding: 0, textAlign: 'left',
                              display: 'flex', flexDirection: 'column', gap: '0.1rem',
                              minWidth: 0,
                            }}
                          >
                            <span style={{
                              fontSize: '0.82rem', fontWeight: 700,
                              color: isCurrent ? C.accent : C.text,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {s.name}
                            </span>
                            <span style={{ fontSize: '0.62rem', color: C.muted }}>
                              {s.solves.length} solve{s.solves.length === 1 ? '' : 's'}
                              {sessBest != null && (
                                <> · best <span style={{ fontFamily: '"JetBrains Mono", monospace', color: C.success }}>{fmtMs(sessBest, false, showMs)}</span></>
                              )}
                            </span>
                          </button>
                          {isCurrent
                            ? <span style={{ color: C.accent, display: 'inline-flex' }}><IconCheck size={14} /></span>
                            : <span aria-hidden style={{ width: 14, height: 14 }} />}
                          <button
                            onClick={() => deleteSession(s.id)}
                            aria-label="Delete session"
                            disabled={list.length <= 1}
                            title={list.length > 1 ? 'Delete session' : 'At least one session is required'}
                            style={{
                              background: 'transparent', border: 'none',
                              cursor: list.length > 1 ? 'pointer' : 'not-allowed',
                              color: list.length > 1 ? C.mutedDim : 'rgba(255,255,255,0.1)',
                              padding: '0.15rem',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          ><IconTrash size={13} /></button>
                        </div>
                      );
                    })}

                    {/* Divider + new session row */}
                    <div style={{ height: 1, background: C.border, margin: '0.25rem 0' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.3rem' }}>
                      <input
                        value={newSessionName}
                        onChange={e => setNewSessionName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            createSession(newSessionName);
                            setNewSessionName('');
                            setSessionDropdownOpen(false);
                          }
                        }}
                        placeholder="New session name"
                        style={{
                          background: C.cardAlt, color: C.text,
                          border: `1px solid ${C.border}`, borderRadius: 7,
                          padding: '0.4rem 0.55rem', fontSize: '0.78rem',
                          fontFamily: 'inherit', outline: 'none', minWidth: 0,
                        }}
                      />
                      <button
                        onClick={() => {
                          createSession(newSessionName);
                          setNewSessionName('');
                          setSessionDropdownOpen(false);
                        }}
                        style={{
                          padding: '0.4rem 0.55rem', borderRadius: 7,
                          fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
                          background: C.accentDim, color: C.accent,
                          border: `1px solid ${C.borderHi}`, cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        }}
                      >
                        <IconPlus size={12} />New
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
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
                  return (
                    <div
                      key={s.id}
                      onMouseEnter={() => setHoveredSolveId(s.id)}
                      onMouseLeave={() => setHoveredSolveId(prev => prev === s.id ? null : prev)}
                      onClick={() => setDetailSolveId(s.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.7rem 1fr auto auto',
                        alignItems: 'center', gap: '0.5rem',
                        padding: '0.5rem 0.6rem', borderRadius: 8,
                        background: hoveredSolveId === s.id ? 'rgba(255,255,255,0.04)' : C.cardAlt,
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
                          opacity: hoveredSolveId === s.id ? 1 : 0,
                          transition: 'opacity 0.12s',
                        }}
                        title="Delete"
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
              flex: '1 1 auto', minHeight: 0,
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

          {/* Stats grid 2x2 + total solves spanning both columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <StatTile label="Average" value={fmtMs(stats.mean)} />
            <StatTile label="Worst"   value={fmtMs(stats.worst)} />
            <StatTile label="Ao5"     value={stats.ao5  == null ? '—' : fmtMs(stats.ao5)}  accent />
            <StatTile label="Ao12"    value={stats.ao12 == null ? '—' : fmtMs(stats.ao12)} accent />
            <div style={{ gridColumn: 'span 2' }}>
              <StatTile
                label="Total Solves"
                value={String(solves.filter(s => !isDnf(s)).length)}
              />
            </div>
          </div>

          {/* Scramble preview — pinned to the bottom of the right panel.
              marginTop: auto pushes it past the stat cards; aspect-ratio
              keeps it square between the 180–280px size bounds. */}
          <div style={{
            marginTop: 'auto',
            width: '100%',
            maxWidth: 280,
            aspectRatio: '1 / 1',
            minHeight: 180,
            maxHeight: 280,
            alignSelf: 'center',
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: '0.5rem',
            display: 'flex', flexDirection: 'column',
            flexShrink: 0,
          }}>
            <div style={{
              fontSize: '0.62rem', letterSpacing: '0.12em',
              textTransform: 'uppercase', color: C.muted, fontWeight: 600,
              padding: '0.2rem 0.45rem 0.4rem',
            }}>
              Scramble Preview
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <CubeViewer eventId={eventId} scramble={scramble} />
            </div>
          </div>

        </aside>
      </div>
      )}

      {isMobile && (() => {
        // Solves sorted newest-first (used by Solves and Stats tabs)
        const solvesNewest = [...solves].slice().reverse();

        // Filter for the Solves tab search box
        const q = mobileSearch.trim().toLowerCase();
        const solvesFiltered = !q ? solvesNewest : solvesNewest.filter(s => {
          const time = fmtMs(finalMs(s), isDnf(s), showMs).toLowerCase();
          const date = new Date(s.ts).toLocaleString().toLowerCase();
          return time.includes(q) || date.includes(q) || s.scramble.toLowerCase().includes(q);
        });

        // Identify best/worst solve ids for grid styling
        const validSolves = solves.filter(s => !isDnf(s));
        const bestId = validSolves.length
          ? validSolves.reduce((a, b) => finalMs(a) <= finalMs(b) ? a : b).id : null;
        const worstId = validSolves.length
          ? validSolves.reduce((a, b) => finalMs(a) >= finalMs(b) ? a : b).id : null;

        // Extra averages for the Stats tab
        const ao50 = avgOfN(solves, 50);
        const ao100 = avgOfN(solves, 100);
        const validCount = validSolves.length;

        // Chart series for Stats tab
        const chartSolves = solves;
        const chartSeries = (() => {
          const all: (number | null)[] = [];
          const best: (number | null)[] = [];
          const ao5s: (number | null)[] = [];
          const ao12s: (number | null)[] = [];
          const pbIndices: number[] = [];
          let runningBest: number | null = null;
          chartSolves.forEach((s, i) => {
            if (isDnf(s)) {
              all.push(null);
            } else {
              const v = finalMs(s);
              all.push(v);
              if (runningBest == null || v < runningBest) {
                runningBest = v;
                pbIndices.push(i);
              }
            }
            best.push(runningBest);
            ao5s.push(avgOfN(chartSolves.slice(0, i + 1), 5));
            ao12s.push(avgOfN(chartSolves.slice(0, i + 1), 12));
          });
          return { all, best, ao5s, ao12s, pbIndices };
        })();

        return (
          <div style={{
            position: 'relative', zIndex: 1,
            // Root is exactly the viewport, with a flex-column children
            // arrangement so the footer (stats + nav) sits in normal flow
            // below a scrollable main content area — no fixed positioning,
            // no padding hacks, no z-index stacking. The top safe-area
            // inset keeps content clear of the iOS notch when running
            // standalone with viewport-fit: cover.
            height: '100vh',
            width: '100%',
            display: 'flex', flexDirection: 'column',
            background: C.bg, color: C.text,
            overflow: 'hidden',
            paddingTop: 'env(safe-area-inset-top)',
          }}>
            {/* ── MAIN: scrollable content area (one tab at a time) ─────── */}
            <main style={{
              flex: 1, minHeight: 0,
              overflowY: 'auto',
              display: 'flex', flexDirection: 'column',
            }}>
            {/* ── TIMER TAB ─────────────────────────────────────────────── */}
            {mobileTab === 'timer' && (
              <div style={{
                flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',
              }}>
                {/* Header capsule */}
                <div style={{
                  margin: '0.7rem 0.7rem 0.5rem',
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 999, padding: '0.35rem 0.45rem',
                  display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '0.4rem',
                }}>
                  <button
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Settings"
                    style={{
                      width: 34, height: 34, borderRadius: 999,
                      background: 'transparent', border: 'none',
                      color: C.muted, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  ><IconSettings size={18} /></button>
                  <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <select
                      value={eventId}
                      onChange={e => setEventId(e.target.value)}
                      aria-label="Puzzle event"
                      style={{
                        width: '100%', appearance: 'none', WebkitAppearance: 'none',
                        background: 'transparent', color: C.text,
                        border: 'none', borderRadius: 999,
                        padding: '0.15rem 1.2rem 0 0.7rem',
                        fontSize: '0.92rem', fontWeight: 600, fontFamily: 'inherit',
                        outline: 'none', textAlign: 'center', textAlignLast: 'center',
                      }}
                    >
                      {EVENTS.map(ev => (
                        <option key={ev.id} value={ev.id}>{ev.name}</option>
                      ))}
                    </select>
                    <span style={{
                      position: 'absolute', right: '0.4rem', top: '0.45rem',
                      color: C.muted,
                      fontSize: '0.7rem', pointerEvents: 'none',
                    }}>▾</span>
                    <div style={{
                      fontSize: '0.6rem', color: C.mutedDim,
                      letterSpacing: '0.05em', fontWeight: 600,
                      lineHeight: 1, paddingBottom: '0.2rem',
                    }}>
                      {currentSession?.name ?? 'Default'}
                    </div>
                  </div>
                  <button
                    onClick={() => { setNewSessionName(''); setSessionPanelOpen(true); }}
                    aria-label="Sessions"
                    title="Sessions"
                    style={{
                      width: 34, height: 34, borderRadius: 999,
                      background: 'transparent', border: `1px solid ${C.border}`,
                      color: C.muted, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  ><IconPlus size={16} /></button>
                </div>

                {/* Scramble row + refresh */}
                <div style={{
                  margin: '0 0.7rem 0.5rem',
                  display: 'flex', justifyContent: 'center',
                }}>
                  <div style={{
                    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                    fontSize: scrambleFontSize === 'sm' ? 14 : scrambleFontSize === 'lg' ? 22 : 18,
                    lineHeight: 1.45,
                    color: C.text,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    textAlign: 'center',
                    maxWidth: '100%',
                  }}>
                    {scramble}
                  </div>
                </div>

                {/* Action row: refresh (purple) + add time */}
                <div style={{
                  margin: '0 0.7rem 0.4rem',
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem',
                }}>
                  <button
                    onClick={newScramble}
                    aria-label="New scramble"
                    style={{
                      height: 40, borderRadius: 10,
                      background: C.accentDim, color: C.accent,
                      border: `1px solid ${C.borderHi}`, cursor: 'pointer',
                      fontFamily: 'inherit', fontWeight: 600,
                      letterSpacing: '0.04em', fontSize: '0.78rem',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    }}
                  >
                    <IconRefresh size={16} /> New scramble
                  </button>
                  <button
                    onClick={() => { setManualEntryValue(''); setManualEntryOpen(true); }}
                    aria-label="Add time"
                    style={{
                      height: 40, borderRadius: 10,
                      background: C.card, color: C.text,
                      border: `1px solid ${C.border}`, cursor: 'pointer',
                      fontFamily: 'inherit', fontWeight: 600,
                      letterSpacing: '0.04em', fontSize: '0.78rem',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    }}
                  >
                    <IconPlus size={16} /> Add time
                  </button>
                </div>

                {/* Big timer area */}
                <section
                  onTouchStart={onTimerTouchStart}
                  onTouchEnd={onTimerTouchEnd}
                  style={{
                    flex: '1 1 auto', minHeight: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    userSelect: 'none', cursor: 'pointer', textAlign: 'center',
                    touchAction: 'manipulation',
                    margin: '0 0.7rem',
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
                    fontSize: 'clamp(3.5rem, 22vw, 7rem)',
                    fontWeight: 700, lineHeight: 0.95,
                    fontVariantNumeric: 'tabular-nums',
                    color: timerColor,
                    transition: 'color 0.12s',
                    textShadow: timer.state === 'armed' ? `0 0 30px ${C.success}55` : 'none',
                  }}>
                    {timerDisplay}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: C.muted, marginTop: '0.7rem', letterSpacing: '0.06em', minHeight: '1rem' }}>
                    {timer.state === 'inspecting' && 'Hold to arm, release to start'}
                    {timer.state === 'armed' && (<span style={{ color: C.success, fontWeight: 700 }}>RELEASE TO START</span>)}
                    {timer.state === 'running' && 'TAP TO STOP'}
                  </div>
                </section>
              </div>
            )}

            {/* ── SOLVES TAB ────────────────────────────────────────────── */}
            {mobileTab === 'solves' && (
              <div style={{
                flex: '1 1 auto', minHeight: 0,
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Header — switches to a select-mode action bar when active */}
                {selectMode ? (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto auto',
                    alignItems: 'center', gap: '0.4rem',
                    padding: '0.5rem 0.7rem 0.4rem',
                    background: C.accentDim,
                    borderBottom: `1px solid ${C.borderHi}`,
                  }}>
                    <button
                      onClick={exitSelectMode}
                      aria-label="Cancel select"
                      style={{
                        width: 34, height: 34, borderRadius: 8,
                        background: 'transparent', border: `1px solid ${C.border}`,
                        color: C.text, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    ><IconClose size={16} /></button>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: C.accent }}>
                      {selectedSolveIds.size} selected
                    </div>
                    <button
                      onClick={() => selectAllVisible(solvesFiltered.map(x => x.id))}
                      style={{
                        padding: '0.4rem 0.7rem', borderRadius: 8,
                        fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit',
                        letterSpacing: '0.04em',
                        background: 'transparent', color: C.accent,
                        border: `1px solid ${C.borderHi}`, cursor: 'pointer',
                      }}
                    >Select all</button>
                    <button
                      onClick={confirmDeleteSelected}
                      disabled={selectedSolveIds.size === 0}
                      aria-label="Delete selected"
                      style={{
                        padding: '0.4rem 0.6rem', borderRadius: 8,
                        fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit',
                        letterSpacing: '0.04em',
                        background: 'rgba(239,68,68,0.12)',
                        color: selectedSolveIds.size === 0 ? 'rgba(248,113,113,0.4)' : '#f87171',
                        border: '1px solid rgba(239,68,68,0.3)',
                        cursor: selectedSolveIds.size === 0 ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      }}
                    ><IconTrash size={14} />Delete</button>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.7rem 0.85rem 0.4rem',
                  }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700 }}>Solves</div>
                    <button
                      onClick={() => router.push('/')}
                      aria-label="Exit timer"
                      style={{
                        width: 34, height: 34, borderRadius: 8,
                        background: 'transparent', border: `1px solid ${C.border}`,
                        color: C.mutedDim, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    ><IconClose size={16} /></button>
                  </div>
                )}

                {/* Search bar — hidden in select mode */}
                {!selectMode && (
                  <div style={{ padding: '0 0.85rem 0.6rem' }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'auto 1fr',
                      gap: '0.4rem', alignItems: 'center',
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 999, padding: '0.4rem 0.85rem',
                    }}>
                      <span style={{ color: C.muted, display: 'inline-flex' }}><IconSearch size={16} /></span>
                      <input
                        value={mobileSearch}
                        onChange={e => setMobileSearch(e.target.value)}
                        placeholder="Search solves..."
                        style={{
                          background: 'transparent', border: 'none', outline: 'none',
                          color: C.text, fontFamily: 'inherit', fontSize: '16px',
                          width: '100%',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Solves grid (3 columns) */}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 0.85rem 1rem' }}>
                  {solvesFiltered.length === 0 ? (
                    <div style={{
                      fontSize: '0.85rem', color: C.mutedDim, textAlign: 'center',
                      padding: '2rem 0',
                    }}>
                      {q ? 'No solves match your search.' : 'Tap the Timer tab to start your first solve.'}
                    </div>
                  ) : (
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '0.5rem',
                    }}>
                      {solvesFiltered.map(s => {
                        const dnf = isDnf(s);
                        const isBest  = !dnf && s.id === bestId  && validSolves.length > 1;
                        const isWorst = !dnf && s.id === worstId && validSolves.length > 1;
                        const dateStr = new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                        const selected = selectedSolveIds.has(s.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => handleSolveCardClick(s.id)}
                            onTouchStart={(e) => startSolveLongPress(s.id, e)}
                            onTouchMove={moveSolveLongPress}
                            onTouchEnd={endSolveLongPress}
                            onTouchCancel={endSolveLongPress}
                            style={{
                              position: 'relative',
                              textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                              background: selected
                                ? C.accentDim
                                : isWorst ? 'rgba(239,68,68,0.08)' : C.card,
                              border: `1px solid ${
                                selected ? C.borderHi
                                : isWorst ? 'rgba(239,68,68,0.25)'
                                : C.border
                              }`,
                              borderLeft: selected
                                ? `3px solid ${C.accent}`
                                : isBest ? `3px solid ${C.success}`
                                : `1px solid ${isWorst ? 'rgba(239,68,68,0.25)' : C.border}`,
                              borderRadius: 10, padding: '0.5rem 0.55rem',
                              display: 'flex', flexDirection: 'column', gap: '0.3rem',
                              minHeight: 64,
                              transition: 'background 0.12s, border-color 0.12s',
                            }}
                          >
                            {selectMode && (
                              <span style={{
                                position: 'absolute', top: 4, right: 4,
                                width: 18, height: 18, borderRadius: 999,
                                background: selected ? C.accent : 'rgba(255,255,255,0.06)',
                                border: `1px solid ${selected ? C.accent : C.border}`,
                                color: selected ? '#0a0a0a' : 'transparent',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                {selected && <IconCheck size={12} />}
                              </span>
                            )}
                            <div style={{
                              fontSize: '0.6rem', color: C.mutedDim, fontWeight: 600,
                              letterSpacing: '0.04em',
                            }}>
                              {dateStr}
                            </div>
                            <div style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: '0.95rem', fontWeight: 700,
                              color: dnf ? C.danger : isBest ? C.success : C.text,
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              {fmtMs(finalMs(s), dnf, showMs)}
                            </div>
                            {s.penalty === '+2' && !dnf && (
                              <div style={{
                                fontSize: '0.5rem', fontWeight: 700, color: C.warn,
                                letterSpacing: '0.05em',
                              }}>+2</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── STATS TAB ─────────────────────────────────────────────── */}
            {mobileTab === 'stats' && (
              <div style={{
                flex: '1 1 auto', minHeight: 0,
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Header with exit */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.7rem 0.85rem 0.4rem',
                }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>Stats</div>
                  <button
                    onClick={() => router.push('/')}
                    aria-label="Exit timer"
                    style={{
                      width: 34, height: 34, borderRadius: 8,
                      background: 'transparent', border: `1px solid ${C.border}`,
                      color: C.mutedDim, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  ><IconClose size={16} /></button>
                </div>

                {/* Chart card */}
                <div style={{ padding: '0 0.7rem 0.5rem', flex: '1 1 50%', minHeight: 0, display: 'flex' }}>
                  <div style={{
                    flex: 1,
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 12, padding: '0.6rem',
                    display: 'flex', flexDirection: 'column', gap: '0.4rem',
                    minHeight: 0,
                  }}>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <MobileLineChart
                        all={chartSeries.all}
                        best={chartSeries.best}
                        ao5={chartSeries.ao5s}
                        ao12={chartSeries.ao12s}
                        pbIndices={chartSeries.pbIndices}
                        C={C}
                      />
                    </div>
                    <div style={{
                      display: 'flex', flexWrap: 'wrap', gap: '0.6rem',
                      fontSize: '0.62rem', color: C.muted, letterSpacing: '0.04em',
                      paddingTop: '0.2rem', borderTop: `1px solid ${C.border}`,
                    }}>
                      <ChartLegendDot color="#9ca3af" label="Everything" />
                      <ChartLegendDot color="#fbbf24" label="Best" />
                      <ChartLegendDot color={C.accent}  label="Ao5" />
                      <ChartLegendDot color={C.success} label="Ao12" />
                    </div>
                  </div>
                </div>

                {/* Stats table */}
                <div style={{ padding: '0 0.7rem 0.6rem', flex: '0 0 auto' }}>
                  <div style={{
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 12, overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                      padding: '0.5rem 0.7rem',
                      fontSize: '0.6rem', letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: C.muted, fontWeight: 600,
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      <div>Stat</div><div>Global</div><div>Session</div>
                    </div>
                    <StatTableRow zebra={false} label="Best"      global={fmtMs(stats.best, false, showMs)}  session={fmtMs(stats.best, false, showMs)} highlight />
                    <StatTableRow zebra={true}  label="Deviation" global={stats.stdDev == null ? '—' : (stats.stdDev / 1000).toFixed(2)} session={stats.stdDev == null ? '—' : (stats.stdDev / 1000).toFixed(2)} />
                    <StatTableRow zebra={false} label="Ao12"      global={fmtMs(stats.ao12, false, showMs)}  session={fmtMs(stats.ao12, false, showMs)} />
                    <StatTableRow zebra={true}  label="Ao50"      global={fmtMs(ao50,       false, showMs)}  session={fmtMs(ao50,       false, showMs)} />
                    <StatTableRow zebra={false} label="Ao100"     global={fmtMs(ao100,      false, showMs)}  session={fmtMs(ao100,      false, showMs)} />
                    <StatTableRow zebra={true}  label="Count"     global={String(validCount)}                session={String(validCount)} />
                  </div>
                </div>
              </div>
            )}

            </main>

            {/* ── FOOTER: stats bar (timer tab only) + bottom nav.
                Both live in normal flow at the column tail with flex-shrink: 0
                so they never get clipped or covered. */}
            <div style={{ flexShrink: 0 }}>
              {mobileTab === 'timer' && (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr auto 1fr',
                  gap: '0.5rem', padding: '0.4rem 0.7rem 0.6rem',
                  alignItems: 'center',
                  background: C.card,
                  borderTop: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <MobileMicroStat label="Dev"   value={stats.stdDev == null ? '—' : (stats.stdDev / 1000).toFixed(2)} />
                    <MobileMicroStat label="Mean"  value={fmtMs(stats.mean, false, showMs)} />
                    <MobileMicroStat label="Best"  value={fmtMs(stats.best, false, showMs)} accent />
                    <MobileMicroStat label="Count" value={String(validCount)} />
                  </div>
                  <button
                    onClick={() => setCubeFullscreenOpen(true)}
                    aria-label="Enlarge cube"
                    style={{
                      width: 92, height: 92,
                      background: C.cardAlt, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: 4,
                      display: 'flex', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <CubeViewer eventId={eventId} scramble={scramble} />
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <MobileMicroStat label="Ao5"   value={fmtMs(stats.ao5,  false, showMs)} accent={stats.ao5 != null} />
                    <MobileMicroStat label="Ao12"  value={fmtMs(stats.ao12, false, showMs)} accent={stats.ao12 != null} />
                    <MobileMicroStat label="Ao50"  value={fmtMs(ao50,       false, showMs)} accent={ao50 != null} />
                    <MobileMicroStat label="Ao100" value={fmtMs(ao100,      false, showMs)} accent={ao100 != null} />
                  </div>
                </div>
              )}

              <nav style={{
                // 56px of tab content + the iOS bottom safe-area inset
                // (home indicator) below it, so the buttons sit above
                // the indicator and the bg color extends to the edge.
                height: 'calc(56px + env(safe-area-inset-bottom))',
                paddingBottom: 'env(safe-area-inset-bottom)',
                boxSizing: 'border-box',
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                background: C.card, borderTop: `1px solid ${C.border}`,
              }}>
                <BottomTab label="Timer"  icon={<IconStopwatch size={20} />} active={mobileTab === 'timer'}  onClick={() => setMobileTab('timer')} C={C} />
                <BottomTab label="Solves" icon={<IconList size={20} />}      active={mobileTab === 'solves'} onClick={() => setMobileTab('solves')} C={C} />
                <BottomTab label="Stats"  icon={<IconChart size={20} />}     active={mobileTab === 'stats'}  onClick={() => setMobileTab('stats')} C={C} />
              </nav>
            </div>
          </div>
        );
      })()}

      {/* Alt+D confirmation toast — shown for ~3s after the first press. */}
      {clearPending && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)',
            zIndex: 9700,
            background: C.card, border: `1px solid ${C.borderHi}`,
            color: C.text,
            borderRadius: 999,
            padding: '0.55rem 1rem',
            fontSize: '0.82rem', fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}
        >
          Clear session?
          <kbd style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
            padding: '0.15rem 0.45rem', borderRadius: 5,
            background: C.accentDim, color: C.accent,
            border: `1px solid ${C.borderHi}`,
          }}>Alt+D</kbd>
          <span style={{ color: C.muted }}>again to confirm</span>
        </div>
      )}

      {/* Cube fullscreen modal (mobile — tap on the cube preview) */}
      {cubeFullscreenOpen && (
        <div
          onClick={() => setCubeFullscreenOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9500,
            background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.5rem',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setCubeFullscreenOpen(false); }}
            aria-label="Close"
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              width: 38, height: 38, borderRadius: 999,
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
              color: C.text, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><IconClose size={18} /></button>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(86vw, 86vh, 480px)',
              height: 'min(86vw, 86vh, 480px)',
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 16, padding: '0.75rem',
              display: 'flex',
            }}
          >
            <CubeViewer eventId={eventId} scramble={scramble} />
          </div>
        </div>
      )}

      {/* Sessions panel modal (mobile + button in header) */}
      {sessionPanelOpen && (() => {
        const ev = sessions[eventId];
        const list = ev?.sessions ?? [];
        const currentId = ev?.currentId;
        return (
          <ModalShell title={`${sessionEvent.short.toUpperCase()} Sessions`} onClose={() => setSessionPanelOpen(false)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Session list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '50vh', overflowY: 'auto' }}>
                {list.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: C.mutedDim, padding: '0.5rem' }}>
                    No sessions yet.
                  </div>
                ) : list.map(s => {
                  const valid = s.solves.filter(x => !isDnf(x));
                  const sessBest = valid.length ? Math.min(...valid.map(finalMs)) : null;
                  const isCurrent = s.id === currentId;
                  return (
                    <div
                      key={s.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto auto',
                        gap: '0.5rem', alignItems: 'center',
                        padding: '0.5rem 0.6rem', borderRadius: 8,
                        background: isCurrent ? C.accentDim : C.cardAlt,
                        border: `1px solid ${isCurrent ? C.borderHi : C.border}`,
                      }}
                    >
                      <button
                        onClick={() => { switchSession(s.id); setSessionPanelOpen(false); }}
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          fontFamily: 'inherit', color: 'inherit', padding: 0, textAlign: 'left',
                          display: 'flex', flexDirection: 'column', gap: '0.15rem',
                        }}
                      >
                        <span style={{ fontSize: '0.88rem', fontWeight: 700, color: isCurrent ? C.accent : C.text }}>
                          {s.name}
                        </span>
                        <span style={{ fontSize: '0.66rem', color: C.muted }}>
                          {s.solves.length} solve{s.solves.length === 1 ? '' : 's'}
                          {sessBest != null && (
                            <> · best <span style={{ fontFamily: '"JetBrains Mono", monospace', color: C.success }}>{fmtMs(sessBest, false, showMs)}</span></>
                          )}
                        </span>
                      </button>
                      {isCurrent && (
                        <span style={{ color: C.accent, display: 'inline-flex' }}><IconCheck size={16} /></span>
                      )}
                      {!isCurrent && (
                        <span aria-hidden style={{ width: 16, height: 16 }} />
                      )}
                      <button
                        onClick={() => deleteSession(s.id)}
                        aria-label="Delete session"
                        title={list.length > 1 ? 'Delete session' : 'At least one session is required'}
                        disabled={list.length <= 1}
                        style={{
                          background: 'transparent', border: 'none', cursor: list.length > 1 ? 'pointer' : 'not-allowed',
                          color: list.length > 1 ? C.mutedDim : 'rgba(255,255,255,0.1)',
                          padding: '0.25rem',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      ><IconTrash size={15} /></button>
                    </div>
                  );
                })}
              </div>

              {/* New session input */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.4rem',
                paddingTop: '0.6rem', borderTop: `1px solid ${C.border}`,
              }}>
                <input
                  value={newSessionName}
                  onChange={e => setNewSessionName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      createSession(newSessionName);
                      setNewSessionName('');
                      setSessionPanelOpen(false);
                    }
                  }}
                  placeholder="New session name"
                  style={{
                    background: C.cardAlt, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: '0.5rem 0.7rem', fontSize: '16px',
                    fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <button
                  onClick={() => {
                    createSession(newSessionName);
                    setNewSessionName('');
                    setSessionPanelOpen(false);
                  }}
                  style={{
                    padding: '0.5rem 0.85rem', borderRadius: 8,
                    fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit',
                    background: C.accentDim, color: C.accent,
                    border: `1px solid ${C.borderHi}`, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  }}
                >
                  <IconPlus size={14} />New Session
                </button>
              </div>
            </div>
          </ModalShell>
        );
      })()}

      {/* Manual time entry modal (mobile Add Time button) */}
      {manualEntryOpen && (() => {
        const parsedMs = parseManualTime(manualEntryValue);
        const previewStr = parsedMs == null ? '0.00' : fmtMs(parsedMs);
        return (
        <ModalShell title="Add Time" onClose={() => setManualEntryOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ fontSize: '0.78rem', color: C.muted, lineHeight: 1.5 }}>
              Type digits — last 2 are centiseconds.
              <br />
              <span style={{ fontFamily: '"JetBrains Mono", monospace', color: C.text }}>1221</span>
              <span> → 12.21s · </span>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', color: C.text }}>12211</span>
              <span> → 1:22.11</span>
            </div>
            <input
              autoFocus
              value={manualEntryValue}
              onChange={e => setManualEntryValue(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitManualEntry(); }
              }}
              placeholder="1221"
              inputMode="numeric"
              pattern="[0-9]*"
              style={{
                background: C.cardAlt, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '0.6rem 0.75rem',
                fontSize: '1.2rem', fontFamily: '"JetBrains Mono", monospace',
                fontVariantNumeric: 'tabular-nums', outline: 'none',
                letterSpacing: '0.05em',
              }}
            />
            {/* Live preview */}
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              padding: '0.6rem 0.85rem',
              background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 8,
            }}>
              <span style={{ fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>
                Preview
              </span>
              <span style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '1.4rem', fontWeight: 700,
                color: parsedMs == null ? C.mutedDim : C.success,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {previewStr}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                onClick={() => setManualEntryOpen(false)}
                style={{
                  padding: '0.5rem 0.9rem', borderRadius: 8,
                  fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit',
                  background: 'transparent', color: C.muted,
                  border: `1px solid ${C.border}`, cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={commitManualEntry}
                disabled={parseManualTime(manualEntryValue) == null}
                style={{
                  padding: '0.5rem 0.9rem', borderRadius: 8,
                  fontSize: '0.82rem', fontWeight: 700, fontFamily: 'inherit',
                  background: parseManualTime(manualEntryValue) == null ? 'rgba(167,139,250,0.08)' : C.accentDim,
                  color: C.accent,
                  border: `1px solid ${C.borderHi}`,
                  cursor: parseManualTime(manualEntryValue) == null ? 'not-allowed' : 'pointer',
                  opacity: parseManualTime(manualEntryValue) == null ? 0.5 : 1,
                }}
              >Add</button>
            </div>
          </div>
        </ModalShell>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: C.text }}>Scramble size</span>
                  <div style={{
                    display: 'inline-flex',
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: 2, gap: 2,
                  }}>
                    {(['sm','md','lg'] as const).map(sz => {
                      const label = sz === 'sm' ? 'Small' : sz === 'md' ? 'Medium' : 'Large';
                      const active = scrambleFontSize === sz;
                      return (
                        <button
                          key={sz}
                          onClick={() => setScrambleFontSize(sz)}
                          style={{
                            padding: '0.3rem 0.65rem', borderRadius: 6,
                            fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600,
                            background: active ? C.accentDim : 'transparent',
                            color: active ? C.accent : C.muted,
                            border: `1px solid ${active ? C.borderHi : 'transparent'}`,
                            cursor: 'pointer', transition: 'all 0.12s',
                          }}
                        >{label}</button>
                      );
                    })}
                  </div>
                </div>
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
                <Row label="Start / stop timer"  kbd="SPACE" />
                <Row label="Clear session (press twice)" kbd="Alt+D" />
                <Row label="Square-1"            kbd="Alt+1" />
                <Row label="2x2x2 Cube"          kbd="Alt+2" />
                <Row label="3x3x3 Cube"          kbd="Alt+3" />
                <Row label="4x4x4 Cube"          kbd="Alt+4" />
                <Row label="5x5x5 Cube"          kbd="Alt+5" />
                <Row label="6x6x6 Cube"          kbd="Alt+6" />
                <Row label="7x7x7 Cube"          kbd="Alt+7" />
                <Row label="Skewb"               kbd="Alt+S" />
                <Row label="Megaminx"            kbd="Alt+M" />
                <Row label="Clock"               kbd="Alt+C" />
                <Row label="Pyraminx"            kbd="Alt+P" />
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

      {/* Solve detail modal — shows time, full scramble, and penalty editor */}
      {detailSolveId && (() => {
        const s = solves.find(x => x.id === detailSolveId);
        if (!s) return null;
        const dnf = isDnf(s);
        const ev = EVENTS.find(e => e.id === s.event);
        return (
          <ModalShell title="Solve Detail" onClose={() => setDetailSolveId(null)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '0.4rem', fontWeight: 600 }}>
                  Time {ev ? `· ${ev.short}` : ''}
                </div>
                <div style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '2.5rem', fontWeight: 800,
                  color: dnf ? C.danger : C.text,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.1,
                }}>
                  {fmtMs(finalMs(s), dnf, showMs)}
                </div>
                {s.penalty === '+2' && !dnf && (
                  <div style={{ fontSize: '0.75rem', color: C.warn, marginTop: '0.25rem' }}>+2 penalty applied</div>
                )}
              </div>

              <div>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '0.4rem', fontWeight: 600 }}>
                  Penalty
                </div>
                <PenaltyRow
                  penalty={s.penalty}
                  onSet={(p) => setSolvePenalty(s.id, p)}
                />
              </div>

              <div>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '0.4rem', fontWeight: 600 }}>
                  Scramble
                </div>
                <div style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '0.92rem', lineHeight: 1.6,
                  color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: C.cardAlt, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '0.75rem 0.85rem',
                }}>
                  {s.scramble}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  onClick={() => { deleteSolve(s.id); setDetailSolveId(null); }}
                  style={{
                    padding: '0.5rem 0.9rem', borderRadius: 8,
                    fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit',
                    background: 'rgba(239,68,68,0.1)', color: '#f87171',
                    border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
                <button
                  onClick={() => setDetailSolveId(null)}
                  style={{
                    padding: '0.5rem 0.9rem', borderRadius: 8,
                    fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit',
                    background: C.accentDim, color: C.accent,
                    border: `1px solid ${C.borderHi}`, cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </ModalShell>
        );
      })()}

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

// ── Mobile-only sub-components ──────────────────────────────────────────────

function MobileActionIcon({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        flex: 1, height: 38, borderRadius: 10,
        background: C.card, border: `1px solid ${C.border}`,
        color: C.muted, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{icon}</button>
  );
}

function MobileMicroStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '2.6rem 1fr',
      alignItems: 'baseline', gap: '0.4rem',
    }}>
      <div style={{
        fontSize: '0.55rem', letterSpacing: '0.1em',
        textTransform: 'uppercase', color: C.muted, fontWeight: 600,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '0.85rem', fontWeight: 700,
        color: accent ? C.accent : C.text,
        fontVariantNumeric: 'tabular-nums',
        textAlign: 'right',
      }}>
        {value}
      </div>
    </div>
  );
}

function BottomTab({ label, icon, active, onClick, C: c }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void; C: typeof C }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '0.2rem',
        padding: '0.4rem 0',
        position: 'relative',
        color: active ? c.accent : c.muted,
        transition: 'color 0.12s',
      }}
    >
      <span style={{ display: 'inline-flex', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.04em' }}>{label}</span>
      {active && (
        <span style={{
          position: 'absolute', bottom: 0, left: '30%', right: '30%',
          height: 2, background: c.accent, borderRadius: 2,
        }} />
      )}
    </button>
  );
}

function ChartLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block' }} />
      <span style={{ color: C.muted }}>{label}</span>
    </span>
  );
}

function StatTableRow({ label, global, session, zebra, highlight }: { label: string; global: string; session: string; zebra: boolean; highlight?: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
      padding: '0.5rem 0.7rem',
      fontSize: '0.78rem',
      background: zebra ? 'rgba(255,255,255,0.02)' : 'transparent',
      color: highlight ? C.success : C.text,
      fontWeight: highlight ? 700 : 500,
    }}>
      <div style={{ color: highlight ? C.success : C.muted, fontSize: '0.72rem', letterSpacing: '0.05em', alignSelf: 'center' }}>
        {label}
      </div>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
        {global}
      </div>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' }}>
        {session}
      </div>
    </div>
  );
}

function MobileLineChart({
  all, best, ao5, ao12, pbIndices, C: c,
}: {
  all: (number | null)[];
  best: (number | null)[];
  ao5:  (number | null)[];
  ao12: (number | null)[];
  pbIndices: number[];
  C: typeof C;
}) {
  const n = all.length;
  if (n < 2) {
    return (
      <div style={{
        height: '100%', minHeight: 160,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.mutedDim, fontSize: '0.78rem', textAlign: 'center',
      }}>
        Need at least 2 solves to chart progress.
      </div>
    );
  }

  // Find global y range (ms, lower = faster).
  const allValues: number[] = [];
  [all, ao5, ao12, best].forEach(arr => arr.forEach(v => { if (v != null) allValues.push(v); }));
  const minMs = Math.min(...allValues);
  const maxMs = Math.max(...allValues);
  const pad = (maxMs - minMs) * 0.08 || 100;
  const yMin = Math.max(0, minMs - pad);
  const yMax = maxMs + pad;

  // viewBox scaled units; React renders responsive via SVG preserveAspectRatio.
  const W = 320, H = 160, padL = 26, padR = 6, padT = 6, padB = 16;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xAt = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (ms: number) => padT + (yMax === yMin ? innerH / 2 : (1 - (ms - yMin) / (yMax - yMin)) * innerH);

  const pathFor = (arr: (number | null)[]) => {
    let d = '';
    let started = false;
    arr.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const x = xAt(i).toFixed(1);
      const y = yAt(v).toFixed(1);
      d += (started ? ' L ' : 'M ') + x + ' ' + y;
      started = true;
    });
    return d;
  };

  // Y-axis ticks (3 levels)
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const fmtTick = (ms: number) => (ms / 1000).toFixed(1) + 's';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      {/* horizontal gridlines + tick labels */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL} x2={W - padR}
            y1={yAt(t)} y2={yAt(t)}
            stroke={c.border} strokeWidth={1}
          />
          <text x={4} y={yAt(t) + 3} fontSize={9} fill={c.mutedDim} fontFamily="monospace">
            {fmtTick(t)}
          </text>
        </g>
      ))}

      {/* Series — order: everything (back), ao12, ao5, best (front) */}
      <path d={pathFor(all)}  fill="none" stroke="#9ca3af" strokeWidth={1}   strokeLinejoin="round" strokeLinecap="round" opacity={0.55} />
      <path d={pathFor(ao12)} fill="none" stroke={c.success} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <path d={pathFor(ao5)}  fill="none" stroke={c.accent}  strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <path d={pathFor(best)} fill="none" stroke="#fbbf24"  strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

      {/* PB markers — gold dots */}
      {pbIndices.map(i => {
        const v = all[i];
        if (v == null) return null;
        return <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.4} fill="#fbbf24" />;
      })}
    </svg>
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
                color: C.muted, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            ><IconClose size={14} /></button>
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
      style={{ display: 'flex', gap: '0.4rem' }}
    >
      {opts.map(o => {
        const active = penalty === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onSet(o.value)}
            style={{
              padding: '0.4rem 0.85rem', borderRadius: 7,
              fontSize: '0.78rem', fontWeight: 700, fontFamily: 'inherit',
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

// ── SVG icons (mobile UI) ───────────────────────────────────────────────────
type IconProps = { size?: number; strokeWidth?: number };
function IconBase({ size = 18, strokeWidth = 1.8, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }}
    >{children}</svg>
  );
}
function IconStopwatch(p: IconProps)  { return <IconBase {...p}><circle cx={12} cy={14} r={7}/><path d="M12 14v-3"/><path d="M9 2h6"/><path d="M12 4v3"/><path d="M19 6l-1.5 1.5"/></IconBase>; }
function IconList(p: IconProps)       { return <IconBase {...p}><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><circle cx={4} cy={6}  r={1}/><circle cx={4} cy={12} r={1}/><circle cx={4} cy={18} r={1}/></IconBase>; }
function IconChart(p: IconProps)      { return <IconBase {...p}><path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 14l3-3 3 3 4-6"/></IconBase>; }
function IconRefresh(p: IconProps)    { return <IconBase {...p}><path d="M21 12a9 9 0 0 0-15.5-6.3L3 8"/><path d="M3 4v4h4"/><path d="M3 12a9 9 0 0 0 15.5 6.3L21 16"/><path d="M21 20v-4h-4"/></IconBase>; }
function IconPencil(p: IconProps)     { return <IconBase {...p}><path d="M14.5 4.5l4 4-9.5 9.5H5v-4z"/><path d="M13 6l5 5"/></IconBase>; }
function IconPlus(p: IconProps)       { return <IconBase {...p}><path d="M12 5v14"/><path d="M5 12h14"/></IconBase>; }
function IconClose(p: IconProps)      { return <IconBase {...p}><path d="M6 6l12 12"/><path d="M18 6l-12 12"/></IconBase>; }
function IconSearch(p: IconProps)     { return <IconBase {...p}><circle cx={11} cy={11} r={6}/><path d="M20 20l-4.3-4.3"/></IconBase>; }
function IconSettings(p: IconProps)   { return <IconBase {...p}><circle cx={12} cy={12} r={3}/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></IconBase>; }
function IconCheck(p: IconProps)      { return <IconBase {...p}><path d="M5 12l5 5L20 7"/></IconBase>; }
function IconTrash(p: IconProps)      { return <IconBase {...p}><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></IconBase>; }
function IconCube(p: IconProps)       { return <IconBase {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5"/><path d="M12 12L4 7.5"/><path d="M12 12v9"/></IconBase>; }
