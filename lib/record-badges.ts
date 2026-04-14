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

/**
 * Returns all applicable record badges for a given result value.
 *
 * Cascading rules:
 *   WR → includes CR + NR + TR + PR
 *   CR → includes NR + TR + PR
 *   NR → includes TR + PR
 *   TR → includes PR
 *
 * The returned array is sorted by priority (highest first).
 * For display, use getHighestBadge() to show only the most prominent.
 * For counting, use the full array.
 */
export function getResultRecordBadges(
  eventId: string,
  type: 'single' | 'average',
  value: number,
  athleteId: string | undefined,
  allResults: Result[],
  wcaRecords: WcaRecords,
): RecordBadge[] {
  if (!value || value <= 0 || value === -1 || value === -2) return [];

  const valueSec = value / 100;
  const rec = wcaRecords[eventId];

  // Check each level independently first
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

  // TR — best result in allResults for this event+type (all athletes in the system)
  let trBest: number | null = null;
  allResults.forEach((r) => {
    const v = r[type];
    if (r.eventId === eventId && v && v > 0 && v !== -1 && v !== -2) {
      if (trBest === null || v < trBest) trBest = v;
    }
  });
  if (trBest !== null && value <= trBest) isTR = true;

  // PR — best result this athlete has achieved for this event+type
  if (athleteId) {
    let prBest: number | null = null;
    allResults.forEach((r) => {
      if (r.athleteId !== athleteId || r.eventId !== eventId) return;
      const v = r[type];
      if (v && v > 0 && v !== -1 && v !== -2) {
        if (prBest === null || v < prBest) prBest = v;
      }
    });
    if (prBest !== null && value <= prBest) isPR = true;
  }

  // Apply cascading: higher records imply all lower ones
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

/** Returns only the highest (most prominent) badge for display. */
export function getHighestBadge(badges: RecordBadge[]): RecordBadge | null {
  if (badges.length === 0) return null;
  for (const b of BADGE_PRIORITY) {
    if (badges.includes(b)) return b;
  }
  return null;
}

/** @deprecated Use getHighestBadge instead. Kept for backwards compat. */
export function getVisibleBadge(badges: RecordBadge[]): RecordBadge | null {
  return getHighestBadge(badges);
}

export { betterTime };
