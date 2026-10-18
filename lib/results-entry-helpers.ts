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

/** Mean of 3: plain mean of exactly 3 solves, DNF if any of them is DNF/DNS.
 *  Only used for imported 3-solve rounds — club entry is always Ao5. */
export function calcMo3(solves: (number | null)[]): number | null {
  const vals = solves.filter(v => v !== null) as number[];
  if (vals.length !== 3) return null;
  if (vals.some(v => v < 0)) return -1;
  return Math.round(vals.reduce((s, v) => s + v, 0) / 3);
}

/** Events WCA ranks by best single; their mean is shown but doesn't rank. */
const SINGLE_RANKED_EVENTS = new Set(['444bf', '555bf', '333mbf']);

/** Solve value stored for a Did-Not-Start attempt. */
export const DNS_VALUE = -2;

/** A result marked Did Not Start: the `dns` flag set by "DNS болгох" on Mark
 *  Round Complete, or (older / imported rows) every attempt stored as DNS.
 *  Such a result ranks last, never advances, and never counts toward a
 *  PR, record or club ranking. */
export function isDnsResult(r: { dns?: boolean; solves?: (number | null)[] }): boolean {
  if (r.dns === true) return true;
  const s = r.solves;
  return !!s && s.length > 0 && s.every(v => v === DNS_VALUE);
}

/** WCA round ranking, shared by every round table and by advancement:
 *  average first, then single — or single first, then average, for the
 *  single-ranked events above. DNF/missing sort after every time, and DNS
 *  after everything (behind DNF). Both results must be from the same event. */
export function compareRoundResults(
  a: { eventId?: string; single: number | null; average: number | null; dns?: boolean; solves?: (number | null)[] },
  b: { eventId?: string; single: number | null; average: number | null; dns?: boolean; solves?: (number | null)[] },
): number {
  const da = isDnsResult(a), db = isDnsResult(b);
  if (da !== db) return da ? 1 : -1;
  const key = (r: typeof a): [number, number] => {
    const avg = r.average != null && r.average > 0 ? r.average : Infinity;
    const sng = r.single  != null && r.single  > 0 ? r.single  : Infinity;
    return SINGLE_RANKED_EVENTS.has(r.eventId || '') ? [sng, avg] : [avg, sng];
  };
  const [pa, sa] = key(a), [pb, sb] = key(b);
  return pa !== pb ? pa - pb : sa === sb ? 0 : sa - sb;
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
