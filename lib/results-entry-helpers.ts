// Pure, presentation-agnostic helpers shared by every admin solve-entry UI
// (ResultsEntryTab's competition panels, PracticeEditModal's Daily Practice
// editor). Kept dependency-free so either side can import without pulling
// in the other's component tree.

/** WCA Ao5: drop best+worst of 5, average the middle 3. Two-or-more DNFs → DNF. */
export function calcAo5(solves: (number | null)[]): number | null {
  const vals = solves.filter(v => v !== null) as number[];
  if (vals.length < 5) return null;
  const dnfCount = vals.filter(v => v < 0).length;
  if (dnfCount >= 2) return -1;
  const sorted = [...vals].sort((a, b) => { if (a < 0 && b < 0) return 0; if (a < 0) return 1; if (b < 0) return -1; return a - b; });
  const mid = sorted.slice(1, 4);
  if (mid.some(v => v < 0)) return -1;
  return Math.round(mid.reduce((s, v) => s + v, 0) / 3);
}

/** Best (lowest) valid solve, or -1 (DNF) if none. */
export function bestOf(solves: (number | null)[]): number {
  const v = solves.filter(x => x !== null && Number(x) > 0) as number[];
  return v.length ? Math.min(...v) : -1;
}

/** Strip formatting to get back the raw digit string for re-editing.
 *  "8.11" → "811", "1:11.11" → "11111", "11:11.11" → "111111"
 */
export function timeToRawDigits(timeStr: string): string {
  return timeStr.replace(/[^0-9]/g, '');
}

/** Convert raw digit string to parseable time string.
 *  "11" → "0.11", "111" → "1.11", "1111" → "11.11",
 *  "11111" → "1:11.11", "111111" → "11:11.11"
 */
export function formatRawDigits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  const padded = d.length < 2 ? d.padStart(2, '0') : d;
  const cs = padded.slice(-2);
  const rest = padded.slice(0, -2);
  if (!rest || parseInt(rest, 10) === 0) return `0.${cs}`;
  const secsStr = rest.slice(-2).padStart(2, '0');
  const minsStr = rest.slice(0, -2);
  if (!minsStr || parseInt(minsStr, 10) === 0) return `${parseInt(secsStr, 10)}.${cs}`;
  return `${parseInt(minsStr, 10)}:${secsStr}.${cs}`;
}
