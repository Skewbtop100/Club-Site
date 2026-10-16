// Pure solve types, formatting and stats (AoN / MoN, WCA trimming).
//
// Split out of lib/timer-engine.ts — which is a 'use client' module with
// React hooks — so server routes can share the exact same averaging and
// formatting (the coach challenge scoring in lib/challenge-progress.ts runs
// on both the timer and app/api/challenge/*). timer-engine re-exports all
// of it, so existing imports are unchanged.

// ── Solve types + stats ─────────────────────────────────────────────────────

export type Penalty = 'none' | '+2' | 'dnf';

export interface Solve {
  id: string;
  ms: number;          // raw timer ms (excluding +2)
  penalty: Penalty;
  scramble: string;
  event: string;
  ts: number;          // unix ms
  /** Optional user-authored note about this solve (e.g. "great cross,
   *  bad LL"). Trimmed string when present; absent for solves created
   *  before the field was added. */
  comment?: string;
  /** Shared-scramble code (4 digits) the solve was made under, if any.
   *  Absent for solves made with normal random scrambles. */
  sharedCode?: string;
  /** Scramble number (#1, #2, …) within `sharedCode` for this event. */
  sharedIndex?: number;
  /** Set on a coach-challenge solve (docs/challenge-plan.md, decision 4):
   *  confirmed once, then its time and penalty never change and it can't
   *  be deleted. `seq` is its number in that server session. */
  challenge?: { sessionId: string; seq: number };
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
/** Solves dropped from EACH end of an AoN: 5% (rounded up) for N ≥ 100
 *  — Ao100 drops the 5 best and 5 worst — otherwise 1 (Ao5, Ao12, Ao50). */
export function trimCount(n: number): number {
  return n >= 100 ? Math.ceil(n * 0.05) : 1;
}

/** Trimmed mean of the last `n` solves. DNFs sort as the worst results,
 *  so up to trimCount(n) DNFs are simply trimmed away; one more and the
 *  average is DNF (returned as null, shown as "—"). */
export function avgOfN(solves: Solve[], n: number): number | null {
  if (solves.length < n) return null;
  const last = solves.slice(-n);
  // Sort by finalMs but treat DNF as +Infinity
  const sorted = [...last].sort((a, b) => {
    const aV = isDnf(a) ? Infinity : finalMs(a);
    const bV = isDnf(b) ? Infinity : finalMs(b);
    return aV - bV;
  });
  const trim = trimCount(n);
  const middle = sorted.slice(trim, sorted.length - trim);
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
