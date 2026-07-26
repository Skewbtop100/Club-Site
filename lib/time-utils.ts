/** Practical floor for a single WCA solve, in centiseconds, for 3x3x3-scale
 * events (3x3x3 and up, OH, BLD, FMC) — anything positive but below this is
 * almost certainly a data-entry error (dropped digit), not a real solve.
 * The fastest official WR single on record for this group is 276cs (2.76s).
 * Used as the fallback for any event not listed in
 * MIN_PLAUSIBLE_SOLVE_CS_BY_EVENT below. */
export const MIN_PLAUSIBLE_SOLVE_CS = 300;

/** Per-event floors, in centiseconds, for events fast enough that the flat
 * MIN_PLAUSIBLE_SOLVE_CS above would reject genuine results. Each floor
 * sits a bit below that event's current WCA WR single, leaving headroom
 * for future record breaks while still catching obvious typos. WRs as of
 * mid-2026:
 *   2x2x2    WR 39cs  (0.39s, Ziyu Ye)         -> floor 30cs
 *   Pyraminx WR 73cs  (0.73s, Simon Kellum)    -> floor 50cs
 *   Skewb    WR 73cs  (0.73s, Vojtěch Grohmann) -> floor 50cs
 *   Square-1 WR 285cs (2.85s, Brian Johnson)   -> floor 200cs (wider margin — parity-dependent variance)
 *   Clock    WR 153cs (1.53s, Lachlan Gibson)  -> floor 100cs
 * Every other event (Megaminx, 4BLD, 5BLD, MBLD included) falls back to
 * MIN_PLAUSIBLE_SOLVE_CS via getMinPlausibleSolveCs() — none of them have
 * a WR anywhere near fast enough for 300cs to be wrong. */
export const MIN_PLAUSIBLE_SOLVE_CS_BY_EVENT: Record<string, number> = {
  '222':   30,
  'pyram': 50,
  'skewb': 50,
  'sq1':   200,
  'clock': 100,
};

/** Practical per-solve floor for a given event, in centiseconds. */
export function getMinPlausibleSolveCs(eventId: string): number {
  return MIN_PLAUSIBLE_SOLVE_CS_BY_EVENT[eventId] ?? MIN_PLAUSIBLE_SOLVE_CS;
}

/** Format centiseconds to display string. -1=DNF, -2=DNS, null/undefined=— */
export function fmtTime(cs: number | null | undefined): string {
  if (cs === -1) return 'DNF';
  if (cs === -2) return 'DNS';
  if (cs === null || cs === undefined) return '—';
  if (cs >= 6000) {
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }
  const s = Math.floor(cs / 100);
  const c = cs % 100;
  return `${s}.${String(c).padStart(2, '0')}`;
}

/** Returns true if time `a` is better (lower) than `b`. DNS < DNF < any valid time */
export function betterTime(a: number | null, b: number | null): boolean {
  if (a === -2) return false;
  if (b === -2) return true;
  if (a === -1) return false;
  if (b === -1) return true;
  if (a === null) return false;
  if (b === null) return true;
  return a < b;
}

/** Sort comparator: lower is better. DNS worst, then DNF, then valid ascending. */
export function compareTime(a: number | null | undefined, b: number | null | undefined): number {
  const aa = a ?? null;
  const bb = b ?? null;
  if (aa === -2 && bb === -2) return 0;
  if (aa === -2) return 1;
  if (bb === -2) return -1;
  if (aa === -1 && bb === -1) return 0;
  if (aa === -1) return 1;
  if (bb === -1) return -1;
  if (aa === null && bb === null) return 0;
  if (aa === null) return 1;
  if (bb === null) return -1;
  return aa - bb;
}

/**
 * Parse a time string like "9.45", "1:23.45", "DNF", "DNS", "9.45+" into centiseconds.
 * Returns -1 for DNF, -2 for DNS, null for empty/invalid.
 */
export function parseTime(str: string | null | undefined): number | null {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().toUpperCase().replace(/\s*(PR|TR|NR|CR|WR)$/, '');
  if (s === 'DNF') return -1;
  if (s === 'DNS') return -2;
  if (!s || s === '—') return null;
  let plus2 = false;
  let core = s;
  if (core.endsWith('+')) { plus2 = true; core = core.slice(0, -1); }
  const colonIdx = core.indexOf(':');
  let cs: number;
  if (colonIdx !== -1) {
    const m = parseInt(core.slice(0, colonIdx), 10);
    const rest = parseFloat(core.slice(colonIdx + 1));
    if (isNaN(m) || isNaN(rest)) return null;
    cs = Math.round(m * 6000 + rest * 100);
  } else {
    const n = parseFloat(core);
    if (isNaN(n)) return null;
    cs = Math.round(n * 100);
  }
  return plus2 ? cs + 200 : cs;
}

export function formatDate(ts: unknown): string {
  if (!ts) return '—';
  let d: Date;
  if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    d = (ts as { toDate: () => Date }).toDate();
  } else if (typeof ts === 'string') {
    d = new Date(ts);
  } else {
    d = new Date(ts as number);
  }
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
