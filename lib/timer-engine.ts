// SHARED TIMER ENGINE
//
// This module is used by both the solo timer (/timer) and the
// multiplayer racing screen (/timer/multiplayer).
// Any changes to timer behavior, preferences, or formatting
// should be made here so both pages stay in sync.
//
// What lives here:
//   - useTimer()   the WCA-style state machine (idle/inspecting/armed/running/stopped)
//   - fmtMs()      authoritative time formatter — ALWAYS truncates, never rounds
//   - Solve type + isDnf / finalMs / avgOfN / calcStats stats helpers
//   - Penalty / Precision / TimerPrefs types + DEFAULT_TIMER_PREFS
//
// What does NOT live here:
//   - The session-storage layer (solo's localStorage shape)
//   - The multiplayer room schema (RTDB SolveData, MemberData, etc.)
//   - Bluetooth hooks (those are in app/timer/useGanTimer.ts and useQiyiTimer.ts)
//   - Anything React-rendered (icons, modals)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Solve types + stats ─────────────────────────────────────────────────────

export type Penalty = 'none' | '+2' | 'dnf';

export interface Solve {
  id: string;
  ms: number;          // raw timer ms (excluding +2)
  penalty: Penalty;
  scramble: string;
  event: string;
  ts: number;          // unix ms
}

export const PENALTY_ADD: Record<Penalty, number> = { none: 0, '+2': 2000, dnf: 0 };
export const isDnf = (s: Solve): boolean => s.penalty === 'dnf';
export const finalMs = (s: Solve): number => s.ms + PENALTY_ADD[s.penalty];

// ── Formatting ─────────────────────────────────────────────────────────────

export type Precision = 'cs' | 'ms';

// Format a millisecond duration. ALWAYS truncates (Math.floor) so we never
// show a time that's faster than what was actually achieved — never round.
//   precision='cs' → "0.54"  (centiseconds, 547ms → 0.54)
//   precision='ms' → "0.547" (milliseconds, 547ms → 0.547)
export function fmtMs(
  ms: number | null | undefined,
  dnf = false,
  precision: Precision = 'cs',
): string {
  if (dnf) return 'DNF';
  if (ms == null) return '—';
  const safe = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (precision === 'ms') {
    const sub = safe % 1000;                       // 0..999
    const subStr = String(sub).padStart(3, '0');
    if (m === 0) return `${s}.${subStr}`;
    return `${m}:${String(s).padStart(2, '0')}.${subStr}`;
  }
  const cs = Math.floor((safe % 1000) / 10);       // 0..99
  const csStr = String(cs).padStart(2, '0');
  if (m === 0) return `${s}.${csStr}`;
  return `${m}:${String(s).padStart(2, '0')}.${csStr}`;
}

// ── Stats helpers ───────────────────────────────────────────────────────────

/** Mean of the middle of last n solves (drop best+worst). DNF in middle = DNF. */
export function avgOfN(solves: Solve[], n: number): number | null {
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

export interface Stats {
  best: number | null;
  worst: number | null;
  mean: number | null;
  ao5: number | null;
  ao12: number | null;
  ao100: number | null;
  pbMs: number | null;
  stdDev: number | null;
}

export function calcStats(solves: Solve[]): Stats {
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

// ── Timer preferences ──────────────────────────────────────────────────────

// User-tunable knobs that affect the timer state machine + display.
// Both solo and multiplayer accept the same shape. Storage layout is
// owned by each page (solo: PREFS_KEY, mp: MP_PREFS_KEY) — this type
// is the in-memory contract, not the on-disk one.
export interface TimerPrefs {
  inspectionEnabled: boolean;
  holdToStart: boolean;
  holdTimeMs: number;
  precision: Precision;
}

export const INSPECTION_MS = 15000;
export const DEFAULT_HOLD_TIME_MS = 550;   // WCA Stackmat standard
export const MIN_HOLD_TIME_MS = 200;
export const MAX_HOLD_TIME_MS = 1000;

export const DEFAULT_TIMER_PREFS: TimerPrefs = {
  inspectionEnabled: true,
  holdToStart: true,
  holdTimeMs: DEFAULT_HOLD_TIME_MS,
  precision: 'cs',
};

// Clamp a holdTimeMs value to the supported range. Use whenever loading
// from storage so old / corrupted values can't push the timer into a
// useless state (e.g. 0 ms = no hold, 30 s = unreachable).
export function clampHoldTimeMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HOLD_TIME_MS;
  return Math.max(MIN_HOLD_TIME_MS, Math.min(MAX_HOLD_TIME_MS, Math.round(value)));
}

// ── Timer state machine ────────────────────────────────────────────────────

export type TimerState = 'idle' | 'inspecting' | 'armed' | 'running' | 'stopped';

export interface UseTimerReturn {
  state: TimerState;
  displayMs: number;
  inspectionMs: number;
  /** True once the user has held past `holdTimeMs` while in 'armed' state.
   *  Consumers paint the timer RED while armed-not-ready and GREEN once
   *  this flips true; releasing before this flips bounces fireRunning()
   *  back to inspecting/idle. Always false outside the 'armed' state. */
  armedReady: boolean;
  /** True for ~300 ms after stop() / finishExternal() fires. Consumers
   *  use it to flash the final time green before settling back to white
   *  (or staying green permanently if the result is a PB — that decision
   *  is owned by the consumer, not this hook). */
  stopFlashing: boolean;
  beginInspection: () => void;
  startArming: () => void;
  startRunning: () => void;
  fireRunning: () => void;
  stop: () => void;
  reset: () => void;
  /** Drive the timer to "stopped" with an externally-measured time
   *  (e.g. authoritative ms from a Bluetooth smart timer). */
  finishExternal: (finalMs: number) => void;
}

/** How long the green "stopped" flash lasts before reverting to the
 *  default text color. Tuned to read as a confirmation pulse without
 *  lingering long enough to be confused with a permanent PB highlight. */
export const STOP_FLASH_MS = 300;

// onSolveCommit is fired by stop() and finishExternal() with the final
// ms and a boolean indicating whether inspection ran out (DNF).
//
// holdTimeMs is the user-configured hold-to-arm threshold in ms.
// fireRunning() bounces back to inspecting/idle if released early.
export function useTimer(
  onSolveCommit: (ms: number, dnf: boolean) => void,
  holdTimeMs: number,
): UseTimerReturn {
  const [state, setState] = useState<TimerState>('idle');
  const [displayMs, setDisplayMs] = useState(0);
  const [inspectionMs, setInspectionMs] = useState(INSPECTION_MS);
  // Color cues. armedReady gates the red→green flip while the user is
  // holding. stopFlashing fires for ~300 ms after a stop() / external
  // finish so consumers can paint a confirmation pulse.
  const [armedReady, setArmedReady] = useState(false);
  const [stopFlashing, setStopFlashing] = useState(false);

  const runStartRef = useRef(0);
  const inspStartRef = useRef(0);
  const armStartRef = useRef(0);
  const rafRef = useRef(0);
  const stopFlashTimeoutRef = useRef<number | null>(null);

  const triggerStopFlash = useCallback(() => {
    setStopFlashing(true);
    if (stopFlashTimeoutRef.current != null) {
      window.clearTimeout(stopFlashTimeoutRef.current);
    }
    stopFlashTimeoutRef.current = window.setTimeout(() => {
      setStopFlashing(false);
      stopFlashTimeoutRef.current = null;
    }, STOP_FLASH_MS);
  }, []);

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
      setInspectionMs(INSPECTION_MS);
      triggerStopFlash();
      onSolveCommit(final, dnf);
    }
  }, [state, inspectionMs, onSolveCommit, triggerStopFlash]);

  // Tick loop — rAF while running for smooth display, setInterval at 50ms
  // for inspection countdown (1Hz visual is enough; we only display whole
  // seconds, but the 50ms tick keeps the "+2 / DNF" boundary tight).
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
        setInspectionMs(INSPECTION_MS - elapsed);
      }, 50);
      return () => clearInterval(id);
    }
  }, [state]);

  // Arm-ready watcher — flips armedReady to true once the user has held
  // past holdTimeMs while in 'armed', and back to false on any state
  // change. Single setTimeout (no 50 ms tick) keeps the work cheap.
  useEffect(() => {
    if (state !== 'armed') {
      if (armedReady) setArmedReady(false);
      return;
    }
    setArmedReady(false);
    const id = window.setTimeout(() => setArmedReady(true), holdTimeMs);
    return () => window.clearTimeout(id);
    // armedReady is intentionally excluded — including it would re-arm
    // the timer the moment we set armedReady=true, dropping the flag back
    // to false immediately and producing a flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, holdTimeMs]);

  // Cleanup the stop-flash timer on unmount so it doesn't fire after the
  // component is gone.
  useEffect(() => () => {
    if (stopFlashTimeoutRef.current != null) {
      window.clearTimeout(stopFlashTimeoutRef.current);
    }
  }, []);

  const beginInspection = useCallback(() => {
    inspStartRef.current = Date.now();
    setInspectionMs(INSPECTION_MS);
    setState('inspecting');
  }, []);

  const startArming = useCallback(() => {
    armStartRef.current = Date.now();
    setState('armed');
  }, []);

  // Skip arming entirely (used when "hold to start" preference is off, and
  // also as the entry point for Bluetooth-driven solves via onSolveStart).
  const startRunning = useCallback(() => {
    runStartRef.current = Date.now();
    setDisplayMs(0);
    setState('running');
  }, []);

  const fireRunning = useCallback(() => {
    // Only commits if held long enough. The threshold is user-configurable
    // via Settings → Timer → "Hold time"; default 550 ms matches the WCA
    // Stackmat standard. Releasing early bounces back to inspecting/idle.
    const heldFor = Date.now() - armStartRef.current;
    if (heldFor < holdTimeMs) {
      setState(prev => prev === 'armed'
        ? (inspectionMs > -2000 && inspStartRef.current > 0 ? 'inspecting' : 'idle')
        : prev);
      return;
    }
    runStartRef.current = Date.now();
    setDisplayMs(0);
    setState('running');
  }, [inspectionMs, holdTimeMs]);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setState('idle');
    setDisplayMs(0);
    setInspectionMs(INSPECTION_MS);
    inspStartRef.current = 0;
  }, []);

  // Drive the timer to "stopped" with an externally-measured time
  // (e.g. authoritative time from a GAN bluetooth timer). Bypasses the
  // local Date.now() math so we record the device's exact ms value.
  const finishExternal = useCallback((finalMsArg: number) => {
    cancelAnimationFrame(rafRef.current);
    setDisplayMs(finalMsArg);
    setState('stopped');
    inspStartRef.current = 0;
    setInspectionMs(INSPECTION_MS);
    triggerStopFlash();
    onSolveCommit(finalMsArg, false);
  }, [onSolveCommit, triggerStopFlash]);

  return {
    state, displayMs, inspectionMs,
    armedReady, stopFlashing,
    beginInspection, startArming, startRunning, fireRunning, stop, reset, finishExternal,
  };
}
