import type { Result, WcaRecords } from '@/lib/types';
import { betterTime } from '@/lib/time-utils';

import type React from 'react';

export type RecordBadge = 'WR' | 'CR' | 'NR' | 'TR' | 'PR';

/** Priority order: WR > CR > NR > TR > PR (index 0 = highest) */
export const BADGE_PRIORITY: RecordBadge[] = ['WR', 'CR', 'NR', 'TR', 'PR'];

export const BADGE_STYLES: Record<RecordBadge, React.CSSProperties> = {
  WR: { background: '#b45309', color: '#fef3c7', border: '1px solid #f59e0b', boxShadow: '0 0 5px rgba(245,158,11,0.55)' },
  CR: { background: '#1d4ed8', color: '#dbeafe', border: '1px solid #60a5fa', boxShadow: '0 0 4px rgba(96,165,250,0.4)' },
  NR: { background: '#166534', color: '#dcfce7', border: '1px solid #4ade80', boxShadow: '0 0 3px rgba(74,222,128,0.3)' },
  TR: { background: '#4c1d95', color: '#ede9fe', border: '1px solid #a78bfa', boxShadow: '0 0 3px rgba(167,139,250,0.3)' },
  PR: { background: '#0e7490', color: '#cffafe', border: '1px solid #22d3ee', boxShadow: '0 0 3px rgba(34,211,238,0.3)' },
};

// ── Internal helpers ────────────────────────────────────────────────────────

/** Check if a value is a valid positive time (not null, DNF, DNS, zero). */
function isValidTime(v: unknown): v is number {
  return typeof v === 'number' && v > 0 && v !== -1 && v !== -2;
}

/** Coerce a Firestore Timestamp | Date | string | number into epoch ms.
 *  0 for missing/unparseable — sorts first, a defensive fallback. */
function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (typeof ts === 'number') return ts;
  return 0;
}

/** Local YYYY-MM-DD for an arbitrary timestamp — same local-timezone
 *  convention as lib/time-utils.ts's todayDateStr(), generalized to any
 *  instant instead of just "now". */
function dayKey(ts: unknown): string {
  const d = new Date(toMillis(ts));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeBadges(
  eventId: string,
  type: 'single' | 'average',
  value: number,
  athleteId: string | undefined,
  allResults: Result[],
  wcaRecords: WcaRecords,
): RecordBadge[] {
  if (!isValidTime(value)) return [];

  const valueSec = value / 100;
  const rec = wcaRecords[eventId];

  let isWR = false, isCR = false, isNR = false, isTR = false, isPR = false;

  // WR / CR / NR — compared against wcaRecords thresholds (stored in seconds)
  if (rec && rec[type]) {
    const wr = rec[type]?.WR;
    const cr = rec[type]?.CR;
    const nr = rec[type]?.NR;
    if (wr && wr.value !== null && wr.value !== undefined && valueSec <= wr.value) isWR = true;
    if (cr && cr.value !== null && cr.value !== undefined && valueSec <= cr.value) isCR = true;
    if (nr && nr.value !== null && nr.value !== undefined && valueSec <= nr.value) isNR = true;
  }

  // TR — best result in allResults for this event+type (all athletes)
  let trBest: number | null = null;
  for (const r of allResults) {
    if (r.eventId !== eventId) continue;
    const v = r[type];
    if (isValidTime(v) && (trBest === null || v < trBest)) trBest = v;
  }
  if (trBest !== null && value <= trBest) isTR = true;

  // PR — athlete's best-ever result for this event+type
  // If this value equals their all-time best (or is their only result) → PR
  if (athleteId) {
    let prBest: number | null = null;
    for (const r of allResults) {
      if (r.athleteId !== athleteId || r.eventId !== eventId) continue;
      const v = r[type];
      if (isValidTime(v) && (prBest === null || v < prBest)) prBest = v;
    }
    // PR if: this is the athlete's best ever, OR first ever (prBest === value)
    if (prBest !== null && value <= prBest) isPR = true;
  }

  // Cascading: higher records imply all lower ones
  if (isWR) { isCR = true; isNR = true; isTR = true; isPR = true; }
  else if (isCR) { isNR = true; isTR = true; isPR = true; }
  else if (isNR) { isTR = true; isPR = true; }
  else if (isTR) { isPR = true; }

  const badges: RecordBadge[] = [];
  if (isWR) badges.push('WR');
  if (isCR) badges.push('CR');
  if (isNR) badges.push('NR');
  if (isTR) badges.push('TR');
  if (isPR) badges.push('PR');

  return badges;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns all applicable record badges for a single value (single OR average).
 * Used by RankingsSection, CompetitionHistory where only one type is checked at a time.
 */
export function getResultRecordBadges(
  eventId: string,
  type: 'single' | 'average',
  value: number,
  athleteId: string | undefined,
  allResults: Result[],
  wcaRecords: WcaRecords,
): RecordBadge[] {
  return computeBadges(eventId, type, value, athleteId, allResults, wcaRecords);
}

/**
 * Returns record badges for BOTH single and average of a Result, independently.
 * Single and average badges are computed separately — a result can have PR on
 * average but not single, or both, or neither.
 */
export function getResultBadgesPair(
  result: Result,
  allResults: Result[],
  wcaRecords: WcaRecords,
): { single: RecordBadge[]; average: RecordBadge[] } {
  const single = isValidTime(result.single)
    ? computeBadges(result.eventId, 'single', result.single, result.athleteId, allResults, wcaRecords)
    : [];
  const average = isValidTime(result.average)
    ? computeBadges(result.eventId, 'average', result.average, result.athleteId, allResults, wcaRecords)
    : [];
  return { single, average };
}

// ── Point-in-time (Rule 1) ───────────────────────────────────────────────────
//
// computeBadges/getResultBadgesPair/getResultRecordBadges above always
// compare against whatever pool they're handed "as of now" — fine for a
// live leaderboard, but wrong for a feed/history that's supposed to show
// what was true AT THE TIME a result was submitted. A result that WAS the
// club record when set shouldn't silently downgrade from TR to PR later
// just because someone else beat it afterward and the pool now includes
// that later result too.

/** Restricts `pool` to results submitted at or before `result`'s own
 *  submittedAt. `<=` (not `<`) so `result` is compared against itself too —
 *  the same "pool includes the candidate" idiom computeBadges already uses. */
export function poolAsOf(pool: Result[], result: Result): Result[] {
  const cutoff = toMillis(result.submittedAt);
  return pool.filter(r => toMillis(r.submittedAt) <= cutoff);
}

/** Point-in-time version of getResultBadgesPair — scopes `pool` to what
 *  existed at `result.submittedAt` before computing badges, so a badge
 *  reflects what was true when the result was submitted instead of
 *  fluctuating later based on whatever else has since been submitted. */
export function getResultBadgesPairAtTime(
  result: Result,
  pool: Result[],
  wcaRecords: WcaRecords,
): { single: RecordBadge[]; average: RecordBadge[] } {
  return getResultBadgesPair(result, poolAsOf(pool, result), wcaRecords);
}

// ── Day survival (Rule 2) ────────────────────────────────────────────────────

/** True unless some OTHER result in `pool` — same eventId, same local
 *  calendar day as `result`, submitted STRICTLY LATER — beats `result`'s
 *  value for `type`. Used to decide whether a badge a result earned (per
 *  getResultBadgesPairAtTime above) should count toward a summary total:
 *  a record that got broken later the same day it was set doesn't count,
 *  one that held up for the rest of that day does. Pass a club-wide pool
 *  for WR/CR/NR/TR scope, or just the athlete's own results for PR scope.
 *  This is a plain value comparison — it does NOT re-run badge computation
 *  on the candidates, so it's cheap and independent of Rule 1 above. */
export function survivesDay(
  result: Result,
  type: 'single' | 'average',
  pool: Result[],
): boolean {
  const value = result[type];
  if (!isValidTime(value)) return false;
  const day = dayKey(result.submittedAt);
  const cutoff = toMillis(result.submittedAt);
  return !pool.some(other => {
    if (other.id === result.id) return false;
    if (other.eventId !== result.eventId) return false;
    if (toMillis(other.submittedAt) <= cutoff) return false; // must be strictly later
    if (dayKey(other.submittedAt) !== day) return false;
    const v = other[type];
    return isValidTime(v) && v < value;
  });
}

/** Returns only the highest (most prominent) badge for display. */
export function getHighestBadge(badges: RecordBadge[]): RecordBadge | null {
  if (badges.length === 0) return null;
  for (const b of BADGE_PRIORITY) {
    if (badges.includes(b)) return b;
  }
  return null;
}

/** @deprecated Use getHighestBadge instead. */
export function getVisibleBadge(badges: RecordBadge[]): RecordBadge | null {
  return getHighestBadge(badges);
}

export { betterTime };
