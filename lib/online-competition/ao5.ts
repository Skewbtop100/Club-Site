// Shared by the solve flow (app/online-competition/[competitionId]/solve/
// [eventId]) and the season-points recompute
// (lib/online-competition/seasonPoints.ts, server-side) — moved here from
// the solve route's own _lib folder so the recompute logic can genuinely
// reuse it rather than duplicating the WCA Ao5 rule.

export type AttemptTime = number | 'DNF';

export interface Ao5Result {
  /** null represents a DNF average (2+ DNFs among the 5). */
  ao5: number | null;
  /** Index (0-4) of the dropped-best attempt. */
  bestIndex: number;
  /** Index (0-4) of the dropped-worst attempt (a DNF, if exactly one,
   *  always sorts here). */
  worstIndex: number;
}

/** Standard WCA Ao5: drop the best and worst of 5, average the middle 3.
 *  A single DNF counts as the worst attempt and gets dropped; 2+ DNFs
 *  make the whole average a DNF. */
export function computeAo5(times: AttemptTime[]): Ao5Result {
  const withIndex = times.map((v, i) => ({ v: v === 'DNF' ? Infinity : v, i }));
  const sorted = [...withIndex].sort((a, b) => a.v - b.v);
  const bestIndex = sorted[0].i;
  const worstIndex = sorted[sorted.length - 1].i;

  const dnfCount = times.filter((t) => t === 'DNF').length;
  if (dnfCount >= 2) {
    return { ao5: null, bestIndex, worstIndex };
  }

  const middle = sorted.slice(1, 4);
  const sum = middle.reduce((acc, x) => acc + x.v, 0);
  return { ao5: Math.round(sum / 3), bestIndex, worstIndex };
}
