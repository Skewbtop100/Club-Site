import type { Result, WcaRecords } from '@/lib/types';
import { betterTime } from '@/lib/time-utils';

import type React from 'react';

export type RecordBadge = 'WR' | 'CR' | 'NR' | 'TR' | 'PR';

/** Priority order: WR > CR > NR > TR > PR (index 0 = highest) */
const BADGE_PRIORITY: RecordBadge[] = ['WR', 'CR', 'NR', 'TR', 'PR'];

export const BADGE_STYLES: Record<RecordBadge, React.CSSProperties> = {
  WR: { background: '#b45309', color: '#fef3c7', border: '1px solid #f59e0b', boxShadow: '0 0 5px rgba(245,158,11,0.55)' },
  CR: { background: '#1d4ed8', color: '#dbeafe', border: '1px solid #60a5fa', boxShadow: '0 0 4px rgba(96,165,250,0.4)' },
  NR: { background: '#166534', color: '#dcfce7', border: '1px solid #4ade80', boxShadow: '0 0 3px rgba(74,222,128,0.3)' },
  TR: { background: '#4c1d95', color: '#ede9fe', border: '1px solid #a78bfa', boxShadow: '0 0 3px rgba(167,139,250,0.3)' },
  PR: { background: '#0e7490', color: '#cffafe', border: '1px solid #22d3ee', boxShadow: '0 0 3px rgba(34,211,238,0.3)' },
};

// ── Internal helper ─────────────────────────────────────────────────────────

/** Check if a value is a valid positive time (not null, DNF, DNS, zero). */
function isValidTime(v: unknown): v is number {
  return typeof v === 'number' && v > 0 && v !== -1 && v !== -2;
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
