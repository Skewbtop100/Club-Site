import type { Result, WcaRecords } from '@/lib/types';
import { betterTime } from '@/lib/time-utils';

import type React from 'react';

export type RecordBadge = 'WR' | 'CR' | 'NR' | 'TR' | 'PR';

export const BADGE_STYLES: Record<RecordBadge, React.CSSProperties> = {
  WR: { background: '#b45309', color: '#fef3c7', border: '1px solid #f59e0b', boxShadow: '0 0 5px rgba(245,158,11,0.55)' },
  CR: { background: '#1d4ed8', color: '#dbeafe', border: '1px solid #60a5fa', boxShadow: '0 0 4px rgba(96,165,250,0.4)' },
  NR: { background: '#166534', color: '#dcfce7', border: '1px solid #4ade80', boxShadow: '0 0 3px rgba(74,222,128,0.3)' },
  TR: { background: '#4c1d95', color: '#ede9fe', border: '1px solid #a78bfa', boxShadow: '0 0 3px rgba(167,139,250,0.3)' },
  PR: { background: '#0e7490', color: '#cffafe', border: '1px solid #22d3ee', boxShadow: '0 0 3px rgba(34,211,238,0.3)' },
};

/** Returns all applicable record badges for a given result value. */
export function getResultRecordBadges(
  eventId: string,
  type: 'single' | 'average',
  value: number,
  athleteId: string | undefined,
  allResults: Result[],
  wcaRecords: WcaRecords,
): RecordBadge[] {
  const badges: RecordBadge[] = [];
  if (!value || value <= 0 || value === -1 || value === -2) return badges;

  // WR / CR / NR — compared against wcaRecords thresholds (stored in seconds)
  const rec = wcaRecords[eventId];
  if (rec && rec[type]) {
    const valueSec = value / 100;
    (['WR', 'CR', 'NR'] as RecordBadge[]).forEach((lvl) => {
      const entry = rec[type]?.[lvl as 'WR' | 'CR' | 'NR'];
      if (entry && entry.value !== null && entry.value !== undefined && valueSec <= entry.value) {
        badges.push(lvl);
      }
    });
  }

  // TR — best result in allResults for this event+type
  let trBest: number | null = null;
  allResults.forEach((r) => {
    const v = r[type];
    if (r.eventId === eventId && v && v > 0 && v !== -1 && v !== -2) {
      if (trBest === null || v < trBest) trBest = v;
    }
  });
  if (trBest !== null && value <= trBest) badges.push('TR');

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
    if (prBest !== null && value <= prBest) badges.push('PR');
  }

  return badges;
}

/** Returns only the most prominent visible badge for rankings (TR or PR only). */
export function getVisibleBadge(badges: RecordBadge[]): RecordBadge | null {
  return badges.find((b) => b === 'TR' || b === 'PR') ?? null;
}

export { betterTime };
