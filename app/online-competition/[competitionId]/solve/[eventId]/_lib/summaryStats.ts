import { computeAo5, type AttemptTime, type Ao5Result } from '@/lib/online-competition/ao5';

/** Real Ao5 math (computeAo5) requires exactly 5 attempts — the WCA-
 *  standard drop-best/drop-worst/average-middle-3 rule only makes sense
 *  at that count, and lib/online-competition/ao5.ts stays exactly that
 *  (it's shared with the season-points recompute, which always operates
 *  on real, 5-attempt competition data — it must never be weakened for a
 *  testing shortcut).
 *
 *  The solve flow always runs exactly 5 attempts, so the guard below is
 *  now unreachable in normal operation — it dates from a
 *  `?__testAttempts=N` URL override, removed with the test-data feature.
 *  It is kept as a defensive fallback so a future change to the attempt
 *  count can never silently feed a non-5 array to computeAo5 and get
 *  nonsense back. In that case the UI shows a plain average of every
 *  non-DNF attempt, with no best/worst exclusion at all — there's no
 *  meaningful "drop 2, average the rest" at e.g. 2 attempts. bestIndex/
 *  worstIndex come back as -1 (never matches a real array index) so the
 *  summary screen's "ХАМГИЙН БАГА"/"ХАМГИЙН ИХ" tags simply don't render,
 *  rather than misleadingly implying an attempt was excluded from the
 *  average when it wasn't. This is explicitly NOT real Ao5 and must never
 *  be reached for a real athlete's attempt count. */
export function computeSummaryStats(times: AttemptTime[]): Ao5Result {
  if (times.length === 5) return computeAo5(times);

  const nonDnf = times.filter((t): t is number => t !== 'DNF');
  const ao5 = nonDnf.length > 0 ? Math.round(nonDnf.reduce((a, b) => a + b, 0) / nonDnf.length) : null;
  return { ao5, bestIndex: -1, worstIndex: -1 };
}
