// Coach challenge scoring (docs/challenge-plan.md, A4 / A8 / B4) — ONE pure
// function used by the server (app/api/challenge/solve, the authority) and
// by the timer (instant feedback), so both always agree.
//
//   • Blocks are separate, not rolling: solves 1–5 = block 1, 6–10 = block 2…
//     Single → every solve is a block.
//   • AoN / MoN use the timer's own avgOfN / trimCount (WCA trimming: Ao5–
//     Ao50 drop 1 each end, Ao100 drops 5); Mo3 = mean of 3, any DNF → DNF.
//   • Pass = not DNF and the DISPLAYED time (truncated to centiseconds) is
//     strictly below the target (decision 6): 1.99 passes "< 2.00", 2.00 and
//     2.009 do not.
//   • A failed block resets the streak to 0. Completed when the streak
//     reaches M. Only complete blocks count (decision 5): a trailing partial
//     block is reported as `inBlock` but never scored.
//
// Also: UB calendar dates (UTC+8, no DST), days taken (N1), and the coach's
// end-time rule (N2). No firebase / React imports.
import { avgOfN, finalMs, isDnf, type Penalty, type Solve } from './solve-stats';
import { METRIC_N } from './challenge';
import type { ChallengeMetric } from './types/challenge';

export interface ScoredSolve { ms: number; penalty: Penalty }
export interface BlockResult {
  /** Block result in ms (single / mean / trimmed average); null = DNF. */
  resultMs: number | null;
  /** What the timer shows, in centiseconds (truncated); null = DNF. */
  displayCs: number | null;
  pass: boolean;
}
export interface Progress {
  blocks: BlockResult[];
  currentStreak: number;
  bestStreak: number;
  /** Complete blocks only. */
  blocksAttempted: number;
  completed: boolean;
  /** Solves in the current, unfinished block (0 … N−1). */
  inBlock: number;
  /** Solves per block. */
  blockSize: number;
}

const asSolve = (s: ScoredSolve, i: number): Solve =>
  ({ id: String(i), ms: s.ms, penalty: s.penalty, scramble: '', event: '', ts: 0 });

/** One complete block's result: single, mean of 3, or WCA AoN. */
export function blockResult(metric: ChallengeMetric, block: ScoredSolve[]): number | null {
  const solves = block.map(asSolve);
  if (metric === 'single') return isDnf(solves[0]) ? null : finalMs(solves[0]);
  if (metric === 'mo3') {
    if (solves.some(isDnf)) return null;
    return Math.round(solves.reduce((a, s) => a + finalMs(s), 0) / solves.length);
  }
  return avgOfN(solves, solves.length);
}

/** Strict "<" on the displayed (truncated) centiseconds. */
export const passesTarget = (resultMs: number | null, targetMs: number) =>
  resultMs !== null && Math.floor(resultMs / 10) < targetMs / 10;

export function computeProgress(
  template: { metric: ChallengeMetric; targetMs: number; streak: number },
  solves: readonly ScoredSolve[],
): Progress {
  const n = METRIC_N[template.metric];
  const blocks: BlockResult[] = [];
  let currentStreak = 0;
  let bestStreak = 0;
  let completed = false;
  const full = Math.floor(solves.length / n);
  for (let b = 0; b < full && !completed; b++) {
    const resultMs = blockResult(template.metric, solves.slice(b * n, (b + 1) * n));
    const pass = passesTarget(resultMs, template.targetMs);
    blocks.push({ resultMs, displayCs: resultMs === null ? null : Math.floor(resultMs / 10), pass });
    currentStreak = pass ? currentStreak + 1 : 0;
    bestStreak = Math.max(bestStreak, currentStreak);
    if (currentStreak >= template.streak) completed = true;
  }
  return {
    blocks, currentStreak, bestStreak, blocksAttempted: blocks.length, completed,
    inBlock: completed ? 0 : solves.length - full * n, blockSize: n,
  };
}

// ── Ulaanbaatar dates (UTC+8, no DST) ─────────────────────────────────────

export const UB_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' in Ulaanbaatar time. */
export function ubDate(ms: number): string {
  return new Date(ms + UB_OFFSET_MS).toISOString().slice(0, 10);
}
/** Epoch ms of 00:00 UB on the UB day containing `ms`. */
export function ubDayStart(ms: number): number {
  return Math.floor((ms + UB_OFFSET_MS) / DAY_MS) * DAY_MS - UB_OFFSET_MS;
}
/** Epoch ms of HH:MM UB on the UB day containing `nowMs`. */
export function ubTimeToday(nowMs: number, hh: number, mm: number): number {
  return ubDayStart(nowMs) + (hh * 60 + mm) * 60_000;
}
/** HH:MM (UB) of an epoch ms. */
export function ubClock(ms: number): string {
  return new Date(ms + UB_OFFSET_MS).toISOString().slice(11, 16);
}
/** Days taken (decision 14 / N1): inclusive UB calendar days, same day = 1. */
export function daysTaken(firstUbDate: string, doneUbDate: string): number {
  return Math.round((Date.parse(doneUbDate) - Date.parse(firstUbDate)) / DAY_MS) + 1;
}

// ── Session end time (decision 16 / N2) ───────────────────────────────────

export const END_MIN_LEAD_MS = 10 * 60_000;
/** Latest end time: 23:59 UB on the same day. */
export const END_LATEST_MIN = 23 * 60 + 59;
export type EndTimeError = 'bad-end-time' | 'end-other-day' | 'end-too-late' | 'end-too-soon';

/**
 * The coach's end time: on today's UB date, no later than 23:59, and at
 * least 10 minutes from now. Omitted → 23:59 today (refused too, when it is
 * already later than 23:49).
 */
export function validateEndsAt(nowMs: number, endsAt: unknown):
  { ok: true; endsAtMs: number } | { ok: false; error: EndTimeError } {
  const latest = ubTimeToday(nowMs, 23, 59);
  const ms = endsAt === undefined || endsAt === null ? latest : endsAt;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return { ok: false, error: 'bad-end-time' };
  if (ubDate(ms) !== ubDate(nowMs)) return { ok: false, error: 'end-other-day' };
  if (ms > latest) return { ok: false, error: 'end-too-late' };
  if (ms < nowMs + END_MIN_LEAD_MS) return { ok: false, error: 'end-too-soon' };
  return { ok: true, endsAtMs: ms };
}
