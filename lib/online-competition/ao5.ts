// Shared by the solve flow (app/online-competition/[competitionId]/solve/
// [eventId]) and the season-points recompute
// (lib/online-competition/seasonPoints.ts, server-side) — moved here from
// the solve route's own _lib folder so the recompute logic can genuinely
// reuse it rather than duplicating the WCA Ao5 rule.

export type AttemptTime = number | 'DNF';

/** The judged shape of one attempt, as far as scoring is concerned. */
export interface JudgedAttempt {
  status: 'pending' | 'approved' | 'rejected';
  /** Centiseconds, as the athlete reported them. Only ever trusted on an
   *  APPROVED attempt — see effectiveAttemptTime. */
  reportedTime: number;
  /** Self-reported DNF at time entry. */
  isDnf?: boolean;
  /** Judge-assigned penalty. */
  penalty: '+2' | 'DNF' | null;
}

/** One attempt's contribution to an average, for every scorer.
 *
 *  Lives here, shared, because it is now status-dependent and three
 *  separate scorers (round-results, seasonPoints, athleteStats) each used
 *  to carry their own copy of the old rule. A rule this subtle with three
 *  implementations is the exact shape of the bug this function exists to
 *  fix.
 *
 *  REJECTED IS ALWAYS A DNF, and it is checked FIRST — deliberately not
 *  via `penalty === 'DNF'`. A judge's only rejection action today does set
 *  that penalty (review/route.ts), but keying on the status rather than
 *  the penalty means an athlete's self-reported `reportedTime` on a
 *  rejected attempt can never be read as a real time, whatever else is on
 *  the document. A rejected attempt COUNTS toward a round being complete;
 *  it never counts as a time.
 *
 *  PENDING must never reach here — an unjudged attempt makes a round
 *  incomplete, and callers exclude it before scoring. Treated as a DNF if
 *  it somehow does, which is the conservative answer (it cannot invent a
 *  result), never a trusted time. */
export function effectiveAttemptTime(a: JudgedAttempt): AttemptTime {
  if (a.status !== 'approved') return 'DNF';
  if (a.isDnf === true || a.penalty === 'DNF') return 'DNF';
  return a.reportedTime + (a.penalty === '+2' ? 200 : 0);
}

// ── Result formats ───────────────────────────────────────────────────────
// How a round's attempts collapse into one comparable number.
//
// NOT to be confused with OnlineCompetition.format (Хэлбэр —
// 'online-video': how a competition is DELIVERED, see types.ts). This is
// the scoring format of one event's round. The two are unrelated and are
// deliberately named apart.
//
// Nothing calls computeResult/attemptsForFormat/formatLabel yet. This is
// step A of the format work — the maths only — so that the eight sites
// currently hardcoding "5 attempts" have one correct implementation to
// move to later, instead of each growing its own switch.

export type ResultFormat = 'ao5' | 'mo3' | 'bo3' | 'bo2' | 'bo1';

export const RESULT_FORMATS: ResultFormat[] = ['ao5', 'mo3', 'bo3', 'bo2', 'bo1'];

/** A stored value coerced to a usable ResultFormat.
 *
 *  Every event saved before this field existed has none, so this defaults
 *  to 'ao5' at READ time rather than backfilling the collection — the same
 *  pattern normalizeCompetitionStatus and normalizeEvents already use for
 *  their legacy shapes. 'ao5' is the right default because it is what the
 *  platform has always actually run.
 *
 *  An unrecognised string also lands on 'ao5' rather than throwing: a
 *  competition must stay readable even if a future build writes a format
 *  this one does not know. */
export function resolveResultFormat(raw: unknown): ResultFormat {
  return RESULT_FORMATS.includes(raw as ResultFormat) ? (raw as ResultFormat) : 'ao5';
}

/** How many attempts a format is solved over.
 *
 *  Honoured everywhere. Every site that once hardcoded five attempts now
 *  reads this function or computeResult:
 *    - the solve page (captured once per run as `runShape`)
 *    - the summary screen, via computeResult + excludedIndices
 *    - the admin ReviewGrid's attempt columns
 *    - the TNoodle import (expectedScrambleCountFor in scrambles.ts)
 *    - the scramble route's attempt bound
 *    - round-results.ts: attempt count, completeness, result, tie-break
 *    - seasonPoints.ts and athleteStats.ts
 *
 *  The one remaining Ao5-shaped thing is computeAo5 itself, kept as a
 *  compatibility wrapper (see below), and the STORED field names
 *  `stats[event].ao5` and the registration doc's `results.{event}.ao5` —
 *  those keep their names because renaming them is a data migration, and
 *  they are only ever written from an ao5 round. */
export function attemptsForFormat(format: ResultFormat): number {
  switch (format) {
    case 'ao5':
      return 5;
    case 'mo3':
    case 'bo3':
      return 3;
    case 'bo2':
      return 2;
    case 'bo1':
      return 1;
  }
}

/** Whether this format produces an AVERAGE (a number derived from several
 *  attempts) as opposed to a best single.
 *
 *  Load-bearing for the stats recompute: a bo-N round's `value` is a
 *  single, not an average, so it must never be stored as one. It feeds the
 *  PR (which is format-agnostic — a single is a single) and nothing else. */
export function isAveragingFormat(format: ResultFormat): boolean {
  return format === 'ao5' || format === 'mo3';
}

/** Display label. Standard cubing notation rather than translated words —
 *  "Ao5"/"Mo3" are what the mockup shows and what competitors read, in
 *  Mongolian copy as everywhere else. */
export function formatLabel(format: ResultFormat): string {
  switch (format) {
    case 'ao5':
      return 'Ao5';
    case 'mo3':
      return 'Mo3';
    case 'bo3':
      return 'Bo3';
    case 'bo2':
      return 'Bo2';
    case 'bo1':
      return 'Bo1';
  }
}

export interface FormatResult {
  /** Centiseconds, or null for a DNF result (nothing rankable). */
  value: number | null;
  /** Indices of attempts NOT counted toward the value — what a summary
   *  screen greys out. Only Ao5 excludes anything: a mean counts all
   *  three, and a best-of excludes none (the slower attempts were not
   *  "dropped", they simply were not the best). For Ao5 the order is
   *  [bestIndex, worstIndex], which is what lets computeAo5 project its
   *  own return shape back out of this one. */
  excludedIndices: number[];
}

/** The result of one round's attempts under a given format.
 *
 *  A DNF is the string 'DNF' — the SAME representation computeAo5 has
 *  always used (`AttemptTime = number | 'DNF'`, above). No second sentinel
 *  is introduced.
 *
 *  `times` is expected to be exactly attemptsForFormat(format) long.
 *  Completeness is the caller's job, as it already is for Ao5
 *  (round-results checks bySlot.size before calling).
 *
 *  ROUNDING is Math.round for every averaging format, matching every other
 *  average in this repo — computeAo5 itself, lib/results-entry-helpers.ts,
 *  lib/timer-engine.ts and lib/firebase/services/virtual-competitions.ts
 *  all use Math.round(sum / n). NOTHING in this codebase truncates, so a
 *  mean of 3 rounds exactly as a mean of 5 does.
 *
 *  Ao5 is deliberately NOT length-guarded, unlike the other formats: it
 *  carries computeAo5's existing behaviour verbatim, including on a
 *  malformed input, because computeAo5 is a wrapper over this branch and
 *  must not change for ANY input. The newer formats have no callers and
 *  therefore no such history, so a wrong length there is a caller bug and
 *  yields a DNF result rather than a fabricated number. */
export function computeResult(times: AttemptTime[], format: ResultFormat): FormatResult {
  if (format === 'ao5') {
    // ── verbatim the original computeAo5 body ──
    // Kept literal rather than refactored: this is the one branch with
    // existing callers and stored historical results. `sum / 3` divides by
    // the constant 3, not by middle.length, exactly as before.
    const withIndex = times.map((v, i) => ({ v: v === 'DNF' ? Infinity : v, i }));
    const sorted = [...withIndex].sort((a, b) => a.v - b.v);
    const bestIndex = sorted[0].i;
    const worstIndex = sorted[sorted.length - 1].i;

    // Best and worst are resolved BEFORE the DNF check and returned either
    // way, so a summary screen greys out the same two attempts on a DNF
    // average as it does on a valid one.
    const dnfCount = times.filter((t) => t === 'DNF').length;
    if (dnfCount >= 2) {
      return { value: null, excludedIndices: [bestIndex, worstIndex] };
    }

    const middle = sorted.slice(1, 4);
    const sum = middle.reduce((acc, x) => acc + x.v, 0);
    return { value: Math.round(sum / 3), excludedIndices: [bestIndex, worstIndex] };
  }

  if (times.length !== attemptsForFormat(format)) {
    return { value: null, excludedIndices: [] };
  }

  if (format === 'mo3') {
    // Mean of 3: no trimming, so there is no cushion — ANY DNF makes the
    // whole mean a DNF. This is the rule people get wrong by assuming it
    // behaves like an Ao5 with its one DNF dropped.
    if (times.some((t) => t === 'DNF')) return { value: null, excludedIndices: [] };
    const nums = times as number[];
    return { value: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length), excludedIndices: [] };
  }

  // bo3 / bo2 / bo1 — the best single. There is no average, so nothing is
  // rounded and nothing is excluded. A DNF is simply never the best; only
  // an all-DNF set has no result at all.
  const finished = times.filter((t): t is number => t !== 'DNF');
  if (finished.length === 0) return { value: null, excludedIndices: [] };
  return { value: Math.min(...finished), excludedIndices: [] };
}

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
 *  make the whole average a DNF.
 *
 *  Now a thin projection of computeResult(times, 'ao5') — same maths, same
 *  numbers, different shape. The shape is unchanged on purpose: every
 *  existing caller (summaryStats, round-results, athleteStats,
 *  seasonPoints) keeps calling this and reading .ao5/.bestIndex/
 *  .worstIndex, and SummaryStage greys attempts out by those two indices.
 *  Migrating callers to computeResult is a later step, not this one. */
export function computeAo5(times: AttemptTime[]): Ao5Result {
  const { value, excludedIndices } = computeResult(times, 'ao5');
  const [bestIndex, worstIndex] = excludedIndices;
  return { ao5: value, bestIndex, worstIndex };
}
