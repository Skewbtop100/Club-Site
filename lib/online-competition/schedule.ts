// ── Competition schedule ────────────────────────────────────────────────
// Clock maths for the Хуваарь tab: what time each row starts and ends, how
// long the whole thing runs, and whether it overruns the competition's own
// window. Pure — no React, no Firestore, no `new Date()` of its own — so
// it is unit-tested directly and reused verbatim by the public timeline
// when that lands.
//
// THE SCHEDULE IS DISPLAY ONLY. Nothing here opens or closes a round;
// round control is roundState and the admin Раунд удирдах screen, and this
// module cannot reach either.
//
// ── Why minutes from midnight, and what that costs ────────────────────
// A schedule describes the SHAPE OF A DAY — "registration at 10:00, first
// round at 10:30" — not a set of absolute instants. Storing timestamps
// would mean every row had to be rewritten when the competition's start
// date moved by a day, and a timezone change would silently shift the
// programme. Minutes from midnight, anchored to the competition's own
// startAt, moves the whole day together for free.
//
// The cost is multi-day. `startMin` is measured from midnight of the FIRST
// day and is deliberately NOT wrapped at 1440: a schedule that runs past
// midnight keeps counting, so 1830 is 06:30 on day 2, and dayOffsetOf /
// fmtClock render it as such. That makes a CONTINUOUS overnight
// competition correct. What it cannot express is a DISCONTINUOUS one —
// day 1 ending at 18:00 and day 2 opening fresh at 10:00 — because the
// rows are one unbroken accumulation with no gaps. Today an admin spells
// that overnight gap as an 'other' row ("Завсарлага", 960 minutes), which
// works and reads correctly, but is clumsy. If multi-day competitions
// become common the fix is a `dayOffset` on the entry, or a 'break' kind
// that renders as a divider rather than a programme item; either is an
// additive field on the same array, so neither needs a migration.

import type { OnlineCompetitionScheduleEntry } from './types';

/** The durations the ХУГАЦАА select offers. A UI list, deliberately NOT
 *  enforced by validateCompetitionInput — the server refuses a nonsense
 *  duration (zero, negative, longer than a day) but does not enshrine
 *  this particular set of options, which is a design choice that will
 *  change without a schema change. */
export const SCHEDULE_DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120];

export const MINUTES_PER_DAY = 1440;

/** Time of day of a timestamp, in minutes from local midnight. null in,
 *  null out — an unset startAt has no anchor, which is what makes every
 *  computed clock cell read "—" rather than a wrong time. */
export function minutesOfDay(ms: number | null): number | null {
  if (ms === null) return null;
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** How many whole days past the anchor day a minute count falls on. 0 for
 *  everything inside the first day. */
export function dayOffsetOf(minutes: number): number {
  return Math.floor(minutes / MINUTES_PER_DAY);
}

/** "10:00", or "06:30 (+1)" once the schedule has run past midnight. The
 *  day marker is not decoration: without it a 30-hour schedule shows two
 *  rows both reading 06:30. */
export function fmtClock(minutes: number): string {
  const day = dayOffsetOf(minutes);
  const withinDay = minutes - day * MINUTES_PER_DAY;
  const hh = String(Math.floor(withinDay / 60)).padStart(2, '0');
  const mm = String(withinDay % 60).padStart(2, '0');
  return day > 0 ? `${hh}:${mm} (+${day})` : `${hh}:${mm}`;
}

/** "2ц 40м" / "45м" / "3ц". Hours are dropped when zero and minutes when
 *  zero, so a round two hours long does not read "2ц 0м". */
export function fmtDurationMn(minutes: number): string {
  const total = Math.max(0, Math.trunc(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}м`;
  if (m === 0) return `${h}ц`;
  return `${h}ц ${m}м`;
}

export interface ScheduleTiming {
  /** Minutes from midnight of the FIRST day; may exceed 1440. */
  startMin: number;
  endMin: number;
}

/** Each row's start and end, accumulated from the anchor.
 *
 *  THE ROWS' TIMES ARE POSITIONAL, not stored per row: row 1 starts at the
 *  competition's start time, and every other row starts when the one
 *  before it ends. That is why ЭХЛЭХ and ДУУСАХ are read-only, why
 *  reordering re-times everything for free, and why the stored `startMin`
 *  is a derived value written at save (see toScheduleEntries in the
 *  editor) rather than something the admin types — two sources for one
 *  fact would eventually disagree.
 *
 *  A null anchor still produces timings, measured from midnight, so the
 *  editor can compute DURATIONS and totals before a start time exists.
 *  The caller is what decides to render "—" instead of 00:00. */
export function scheduleTimings(anchorMin: number | null, durations: number[]): ScheduleTiming[] {
  let cursor = anchorMin ?? 0;
  return durations.map((duration) => {
    const startMin = cursor;
    cursor += Math.max(0, Math.trunc(duration));
    return { startMin, endMin: cursor };
  });
}

export interface ScheduleSummary {
  /** Sum of every row's duration. 0 for an empty schedule. */
  totalMin: number;
  /** First row's start and last row's end, or null when there are no rows
   *  or no anchor to place them against. */
  firstMin: number | null;
  lastEndMin: number | null;
  /** How far the schedule runs past the competition's own end time, in
   *  minutes. null when there is nothing to compare against (either
   *  bound unset, or no rows); 0 or less is reported as null too — an
   *  underrun is not a finding. */
  overflowMin: number | null;
}

/** The header summary.
 *
 *  The overrun is measured against the REAL window (endAt - startAt in
 *  milliseconds), not against the two times of day. A competition running
 *  20:00 → 02:00 has a six-hour window; comparing 1200 to 120 as
 *  minutes-of-day would call that a fourteen-hour overrun. */
export function scheduleSummary(
  startAtMs: number | null,
  endAtMs: number | null,
  durations: number[],
): ScheduleSummary {
  const totalMin = durations.reduce((sum, d) => sum + Math.max(0, Math.trunc(d)), 0);
  const anchorMin = minutesOfDay(startAtMs);
  const hasRows = durations.length > 0;

  const firstMin = hasRows && anchorMin !== null ? anchorMin : null;
  const lastEndMin = firstMin !== null ? firstMin + totalMin : null;

  let overflowMin: number | null = null;
  if (hasRows && startAtMs !== null && endAtMs !== null && endAtMs > startAtMs) {
    const windowMin = Math.round((endAtMs - startAtMs) / 60000);
    const over = totalMin - windowMin;
    overflowMin = over > 0 ? over : null;
  }

  return { totalMin, firstMin, lastEndMin, overflowMin };
}

/** The durations of a stored schedule, in array order — the input every
 *  function above wants. Guards a hand-edited document rather than
 *  trusting the stored number. */
export function durationsOf(entries: Pick<OnlineCompetitionScheduleEntry, 'durationMin'>[]): number[] {
  return entries.map((e) => (typeof e.durationMin === 'number' && e.durationMin > 0 ? Math.trunc(e.durationMin) : 0));
}
