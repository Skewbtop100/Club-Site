import {
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { practiceSessionDoc, practiceSessionsCol } from '@/lib/firebase/collections';
import type { PracticeSession } from '@/lib/types/practice';

// ── Date helpers (Ulaanbaatar club timezone, YYYY-MM-DD) ───────────────────
//
// Asia/Ulaanbaatar has no DST, so a plain Intl formatter is enough — no
// need for a timezone library. 'en-CA' formats as YYYY-MM-DD directly.

export function todayInClubTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** YYYY-MM-DD `days` days before today, in the club timezone. */
function daysAgoInClubTz(days: number): string {
  const [y, m, d] = todayInClubTz().split('-').map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d));
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

/** Whole calendar days from date `a` to date `b` (both YYYY-MM-DD), b - a. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((bUtc - aUtc) / 86400000);
}

// ── Reads ────────────────────────────────────────────────────────────────

/** Athlete's practice session for today, for one event — null if none yet. */
export async function getTodaysSessionForAthleteEvent(
  athleteId: string,
  event: string,
): Promise<PracticeSession | null> {
  const q = query(
    practiceSessionsCol,
    where('athleteId', '==', athleteId),
    where('event', '==', event),
    where('date', '==', todayInClubTz()),
    fsLimit(1),
  );
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].data();
}

/** Practice history for one athlete + event, newest first. */
export async function getPracticeHistoryForAthleteEvent(
  athleteId: string,
  event: string,
  limitCount = 50,
): Promise<PracticeSession[]> {
  const q = query(
    practiceSessionsCol,
    where('athleteId', '==', athleteId),
    where('event', '==', event),
    orderBy('date', 'desc'),
    fsLimit(limitCount),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

/** Full practice history for an athlete, across all events, newest first. */
export async function getPracticeHistoryForAthlete(
  athleteId: string,
): Promise<PracticeSession[]> {
  const q = query(
    practiceSessionsCol,
    where('athleteId', '==', athleteId),
    orderBy('date', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

/** Best Ao5 per athlete for an event, within the last `days` days, ascending. */
export async function getPracticeLeaderboard(
  event: string,
  days: number,
): Promise<{ athleteId: string; athleteName: string; bestAo5: number; date: string; isPR: boolean }[]> {
  const ATHLETE_CHUNK = 10;
  const windowStart = daysAgoInClubTz(days);
  const q = query(
    practiceSessionsCol,
    where('event', '==', event),
    where('date', '>=', windowStart),
  );
  const snap = await getDocs(q);

  const bestByAthlete = new Map<string, { athleteName: string; bestAo5: number; date: string }>();
  for (const doc of snap.docs) {
    const s = doc.data();
    if (s.ao5 === null) continue;
    const existing = bestByAthlete.get(s.athleteId);
    if (!existing || s.ao5 < existing.bestAo5) {
      bestByAthlete.set(s.athleteId, { athleteName: s.athleteName, bestAo5: s.ao5, date: s.date });
    }
  }

  // Pre-window "best ao5" baseline, scoped to just the athletes who made
  // this leaderboard — same chunked athleteId-in pattern getMonthlyEventStats
  // uses for its PR baseline, reusing the same (event, athleteId, date)
  // composite index. bestAo5 above is only "best within the window" — an
  // athlete's true all-time PR could sit just outside it, so this is what
  // actually confirms an all-time PR.
  const athleteIds = Array.from(bestByAthlete.keys());
  const baseline = new Map<string, number | null>();
  for (let i = 0; i < athleteIds.length; i += ATHLETE_CHUNK) {
    const idsChunk = athleteIds.slice(i, i + ATHLETE_CHUNK);
    idsChunk.forEach((id) => baseline.set(id, null));
    const priorSnap = await getDocs(query(
      practiceSessionsCol,
      where('event', '==', event),
      where('athleteId', 'in', idsChunk),
      where('date', '<', windowStart),
    ));
    for (const d of priorSnap.docs) {
      const s = d.data();
      if (s.ao5 === null) continue;
      const cur = baseline.get(s.athleteId) ?? null;
      if (cur === null || s.ao5 < cur) baseline.set(s.athleteId, s.ao5);
    }
  }

  return Array.from(bestByAthlete.entries())
    .map(([athleteId, v]) => {
      const baselineVal = baseline.get(athleteId) ?? null;
      const isPR = baselineVal === null || v.bestAo5 < baselineVal;
      return { athleteId, athleteName: v.athleteName, bestAo5: v.bestAo5, date: v.date, isPR };
    })
    .sort((a, b) => a.bestAo5 - b.bestAo5);
}

interface MonthlyLeaderboardRow { athleteId: string; athleteName: string }

/**
 * Club-wide monthly overview for /practice's event grid — 3 small
 * leaderboards (most improved / most active / most PRs) per WCA event,
 * for one calendar month.
 *
 * QUERY STRATEGY (read this before changing the implementation):
 *   1. ONE query fetches every practiceSessions doc in the month
 *      (date >= monthStart, date < nextMonthStart), ordered by date asc.
 *      This is the only query that scales with total sessions; it does NOT
 *      fan out per event or per athlete.
 *   2. "Most PRs" needs to know whether each session was a new all-time
 *      best, which requires each athlete's best ao5 from BEFORE this month
 *      — data the month query doesn't have. Rather than a second
 *      full-collection query (or one query per athlete, which would be
 *      N reads), we only ask for history on the (event, athleteId) pairs
 *      that actually appear in this month's data: group step 1's results
 *      by event, then for each event issue `where('athleteId','in', chunk)`
 *      queries in chunks of 10 athleteIds (Firestore's `in` cap) with
 *      `where('date','<', monthStart)`. Worst case is
 *      ceil(athletesForEvent / 10) queries per event that had activity —
 *      for a ~25-athlete club practicing most events, that's roughly
 *      17 events × ~3 chunks ≈ 50 small queries, each returning only one
 *      athlete's pre-month history for one event (typically a handful of
 *      docs). This is still far cheaper than a full-collection scan and
 *      scales with (active events × athletes), not total historical rows.
 *   3. Everything else (grouping, first/best/PR-at-the-time, sort, top 3)
 *      is done in memory over what's already fetched.
 *
 * Required composite index: practiceSessions: event (asc) + athleteId (asc) + date (asc)
 */
export async function getMonthlyEventStats(
  monthStr: string,
): Promise<Record<string, {
  improvement: (MonthlyLeaderboardRow & { improvementSeconds: number; isPR: boolean })[];
  participation: (MonthlyLeaderboardRow & { count: number; isPR: boolean })[];
  prCount: (MonthlyLeaderboardRow & { count: number; isPR: boolean })[];
}>> {
  const ATHLETE_CHUNK = 10;
  const [y, m] = monthStr.split('-').map(Number);
  const monthStart = `${monthStr}-01`;
  const nextMonthStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // m is 1-indexed → Date.UTC's 0-indexed month arg lands on the 1st of the *next* month

  // ── 1. One query for the whole month ──────────────────────────────────
  const monthSnap = await getDocs(query(
    practiceSessionsCol,
    where('date', '>=', monthStart),
    where('date', '<', nextMonthStart),
    orderBy('date', 'asc'),
  ));
  const monthSessions = monthSnap.docs.map((d) => d.data());
  if (monthSessions.length === 0) return {};

  // event -> athleteId -> that athlete's sessions this month, date-ascending
  // (order inherited from the query above).
  const byEvent = new Map<string, Map<string, PracticeSession[]>>();
  for (const s of monthSessions) {
    let byAthlete = byEvent.get(s.event);
    if (!byAthlete) { byAthlete = new Map(); byEvent.set(s.event, byAthlete); }
    const list = byAthlete.get(s.athleteId);
    if (list) list.push(s); else byAthlete.set(s.athleteId, [s]);
  }

  // ── 2. Pre-month "best ao5" baseline, scoped to (event, athlete) pairs
  //      that appear this month only — see strategy comment above.
  const baseline = new Map<string, number | null>(); // `${event}|${athleteId}` -> best ao5 before monthStart, or null
  for (const [eventId, byAthlete] of byEvent) {
    const athleteIds = Array.from(byAthlete.keys());
    for (let i = 0; i < athleteIds.length; i += ATHLETE_CHUNK) {
      const idsChunk = athleteIds.slice(i, i + ATHLETE_CHUNK);
      idsChunk.forEach((id) => baseline.set(`${eventId}|${id}`, null)); // explicit "no prior history" until proven otherwise
      const priorSnap = await getDocs(query(
        practiceSessionsCol,
        where('event', '==', eventId),
        where('athleteId', 'in', idsChunk),
        where('date', '<', monthStart),
      ));
      for (const d of priorSnap.docs) {
        const s = d.data();
        if (s.ao5 === null) continue;
        const key = `${eventId}|${s.athleteId}`;
        const cur = baseline.get(key) ?? null;
        if (cur === null || s.ao5 < cur) baseline.set(key, s.ao5);
      }
    }
  }

  // ── 3. Compute the 3 leaderboards per event, in memory ────────────────
  const result: Record<string, {
    improvement: (MonthlyLeaderboardRow & { improvementSeconds: number; isPR: boolean })[];
    participation: (MonthlyLeaderboardRow & { count: number; isPR: boolean })[];
    prCount: (MonthlyLeaderboardRow & { count: number; isPR: boolean })[];
  }> = {};

  for (const [eventId, byAthlete] of byEvent) {
    const improvement: (MonthlyLeaderboardRow & { improvementSeconds: number; isPR: boolean })[] = [];
    const participation: (MonthlyLeaderboardRow & { count: number; isPR: boolean })[] = [];
    const prCount: (MonthlyLeaderboardRow & { count: number; isPR: boolean })[] = [];

    for (const [athleteId, sessions] of byAthlete) {
      const athleteName = sessions[0].athleteName;

      // "Хамгийн олон PR" — walk chronologically from the pre-month
      // baseline, counting every session that beat the running best.
      // isPR (== prs > 0) is reused below for improvement/participation
      // too — "beat pre-month baseline at least once this month" is the
      // same fact whichever list the athlete shows up in.
      let running = baseline.get(`${eventId}|${athleteId}`) ?? null;
      let prs = 0;
      for (const s of sessions) {
        if (s.ao5 === null) continue;
        if (running === null || s.ao5 < running) { running = s.ao5; prs += 1; }
      }
      const isPR = prs > 0;

      // "Хамгийн олон удаа оролцсон" — every session this month counts as
      // a day practiced, regardless of whether ao5 came out null.
      participation.push({ athleteId, athleteName, count: sessions.length, isPR });

      // "Сарын шилдэг ахиц" — first vs best ao5 this month; needs 2+
      // ao5-bearing sessions to mean anything (a single sitting can't show
      // improvement). best <= first always, so this is never negative.
      const withAo5 = sessions.filter((s): s is PracticeSession & { ao5: number } => s.ao5 !== null);
      if (withAo5.length >= 2) {
        const first = withAo5[0].ao5;
        const best = Math.min(...withAo5.map((s) => s.ao5));
        improvement.push({ athleteId, athleteName, improvementSeconds: (first - best) / 1000, isPR });
      }

      if (prs > 0) prCount.push({ athleteId, athleteName, count: prs, isPR });
    }

    improvement.sort((a, b) => b.improvementSeconds - a.improvementSeconds);
    participation.sort((a, b) => b.count - a.count);
    prCount.sort((a, b) => b.count - a.count);

    result[eventId] = {
      improvement: improvement.slice(0, 3),
      participation: participation.slice(0, 3),
      prCount: prCount.slice(0, 3),
    };
  }

  return result;
}

/**
 * Club-wide day-by-day session counts for one calendar month, optionally
 * scoped to a single event — same date-range query shape as
 * getMonthlyEventStats' step 1, just re-aggregated by day instead of by
 * athlete, and with no PR-baseline fan-out since this doesn't need one.
 *
 * Every day in the month gets an entry (0 if nothing was logged) so gaps
 * in practice show as a dip to zero rather than a skipped point. For the
 * current month, stops at today rather than padding out future days.
 *
 * The `event` filter reuses the existing (event asc, date asc) composite
 * index — see firestore.indexes.json — so no new index is required.
 */
export async function getMonthlyActivityTrend(
  monthStr: string,
  event?: string,
): Promise<{ date: string; count: number }[]> {
  const [y, m] = monthStr.split('-').map(Number);
  const monthStart = `${monthStr}-01`;
  const nextMonthStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const snap = await getDocs(event
    ? query(
        practiceSessionsCol,
        where('event', '==', event),
        where('date', '>=', monthStart),
        where('date', '<', nextMonthStart),
        orderBy('date', 'asc'),
      )
    : query(
        practiceSessionsCol,
        where('date', '>=', monthStart),
        where('date', '<', nextMonthStart),
        orderBy('date', 'asc'),
      ));

  const counts = new Map<string, number>();
  for (const doc of snap.docs) {
    const date = doc.data().date;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isCurrentMonth = todayInClubTz().slice(0, 7) === monthStr;
  const lastDay = isCurrentMonth ? Number(todayInClubTz().slice(8, 10)) : daysInMonth;

  const series: { date: string; count: number }[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const date = `${monthStr}-${String(d).padStart(2, '0')}`;
    series.push({ date, count: counts.get(date) ?? 0 });
  }
  return series;
}

/**
 * All sessions for one event on today's date, across every athlete — the
 * flat "who practiced this today" roster for /practice's Today's Practice
 * card. Each athlete has at most one session per event per day (enforced
 * in createPracticeSession), so this is a plain roster, not an
 * aggregation like getPracticeLeaderboard's "best across N days".
 *
 * isPR uses the exact same chunked athleteId-in baseline pattern as
 * getPracticeLeaderboard, just with "today" as the cutoff instead of a
 * rolling window start — reuses the same (event, athleteId, date)
 * composite index, no new index required.
 */
export async function getTodaysSessionsForEvent(
  event: string,
): Promise<(PracticeSession & { isPR: boolean })[]> {
  const ATHLETE_CHUNK = 10;
  const today = todayInClubTz();
  const snap = await getDocs(query(
    practiceSessionsCol,
    where('event', '==', event),
    where('date', '==', today),
  ));
  const sessions = snap.docs.map((d) => d.data());
  if (sessions.length === 0) return [];

  const athleteIds = Array.from(new Set(sessions.map((s) => s.athleteId)));
  const baseline = new Map<string, number | null>();
  for (let i = 0; i < athleteIds.length; i += ATHLETE_CHUNK) {
    const idsChunk = athleteIds.slice(i, i + ATHLETE_CHUNK);
    idsChunk.forEach((id) => baseline.set(id, null));
    const priorSnap = await getDocs(query(
      practiceSessionsCol,
      where('event', '==', event),
      where('athleteId', 'in', idsChunk),
      where('date', '<', today),
    ));
    for (const d of priorSnap.docs) {
      const s = d.data();
      if (s.ao5 === null) continue;
      const cur = baseline.get(s.athleteId) ?? null;
      if (cur === null || s.ao5 < cur) baseline.set(s.athleteId, s.ao5);
    }
  }

  return sessions
    .map((s) => {
      const baselineVal = baseline.get(s.athleteId) ?? null;
      const isPR = s.ao5 !== null && (baselineVal === null || s.ao5 < baselineVal);
      return { ...s, isPR };
    })
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

/**
 * Most recent session for one athlete+event with date <= targetDate.
 * Backing helper for getPracticeComparison's fixed reference points —
 * athletes don't practice every single day, so an exact-date match on
 * "7 days ago" would almost always come back empty. This intentionally
 * looks backward for the closest prior session instead.
 */
async function mostRecentOnOrBefore(
  athleteId: string,
  event: string,
  targetDate: string,
): Promise<PracticeSession | null> {
  const q = query(
    practiceSessionsCol,
    where('athleteId', '==', athleteId),
    where('event', '==', event),
    where('date', '<=', targetDate),
    orderBy('date', 'desc'),
    fsLimit(1),
  );
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].data();
}

/**
 * Athlete's best-ever ao5 for one event — no date bound, so this is a true
 * all-time best, not just "best within the trend window". Two plain
 * equality filters (athleteId, event) with no orderBy/range, so it needs
 * no composite index beyond Firestore's automatic single-field indexes —
 * same reason getTodaysSessionForAthleteEvent's 3-equality query has never
 * needed one either.
 */
async function bestAo5ForAthleteEvent(athleteId: string, event: string): Promise<number | null> {
  const snap = await getDocs(query(
    practiceSessionsCol,
    where('athleteId', '==', athleteId),
    where('event', '==', event),
  ));
  let best: number | null = null;
  for (const d of snap.docs) {
    const ao5 = d.data().ao5;
    if (ao5 !== null && (best === null || ao5 < best)) best = ao5;
  }
  return best;
}

/**
 * Progress comparison for one athlete+event: today's session plus the
 * closest prior session on or before yesterday / 7 days ago / 30 days ago
 * (NOT exact-date matches — see mostRecentOnOrBefore), the athlete's
 * all-time best ao5 for this event, plus up to the last 30 days of
 * sessions ascending by date for charting.
 */
export async function getPracticeComparison(
  athleteId: string,
  event: string,
): Promise<{
  today: PracticeSession | null;
  yesterday: PracticeSession | null;
  sevenDaysAgo: PracticeSession | null;
  thirtyDaysAgo: PracticeSession | null;
  allTimeBest: number | null;
  trend: PracticeSession[];
}> {
  const trendQuery = query(
    practiceSessionsCol,
    where('athleteId', '==', athleteId),
    where('event', '==', event),
    where('date', '>=', daysAgoInClubTz(30)),
    orderBy('date', 'asc'),
  );

  const [today, yesterday, sevenDaysAgo, thirtyDaysAgo, allTimeBest, trendSnap] = await Promise.all([
    getTodaysSessionForAthleteEvent(athleteId, event),
    mostRecentOnOrBefore(athleteId, event, daysAgoInClubTz(1)),
    mostRecentOnOrBefore(athleteId, event, daysAgoInClubTz(7)),
    mostRecentOnOrBefore(athleteId, event, daysAgoInClubTz(30)),
    bestAo5ForAthleteEvent(athleteId, event),
    getDocs(trendQuery),
  ]);

  return {
    today,
    yesterday,
    sevenDaysAgo,
    thirtyDaysAgo,
    allTimeBest,
    trend: trendSnap.docs.map((d) => d.data()),
  };
}

/**
 * Consecutive-calendar-days practice streak, across ALL events — any event
 * practiced on a given day keeps the streak alive (3x3 today + Skewb
 * tomorrow is 2 consecutive days). Reuses getPracticeHistoryForAthlete
 * rather than a dedicated query, then dedupes by date and walks the run.
 *
 * currentStreak is 0 if the most recent practiced date is more than 1 day
 * before today (i.e. they skipped both today AND yesterday) — practicing
 * yesterday but not yet today still counts, since today isn't over.
 */
export async function getPracticeStreak(
  athleteId: string,
): Promise<{ currentStreak: number; longestStreak: number; lastPracticeDate: string | null }> {
  const sessions = await getPracticeHistoryForAthlete(athleteId);
  const uniqueDates = Array.from(new Set(sessions.map((s) => s.date))).sort(); // ascending, YYYY-MM-DD sorts lexicographically

  if (uniqueDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastPracticeDate: null };
  }

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < uniqueDates.length; i++) {
    run = daysBetween(uniqueDates[i - 1], uniqueDates[i]) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }

  const lastPracticeDate = uniqueDates[uniqueDates.length - 1];
  let currentStreak = 0;
  if (daysBetween(lastPracticeDate, todayInClubTz()) <= 1) {
    currentStreak = 1;
    for (let i = uniqueDates.length - 1; i > 0; i--) {
      if (daysBetween(uniqueDates[i - 1], uniqueDates[i]) === 1) currentStreak += 1;
      else break;
    }
  }

  return { currentStreak, longestStreak, lastPracticeDate };
}

/**
 * Current cross-event practice streak per athlete, club-wide, ranked
 * descending — the "who's most consistent" leaderboard for /practice.
 * Ignores selectedEvent entirely (same semantics as getPracticeStreak:
 * any event practiced on a given day keeps the streak alive).
 *
 * One bounded-window query across the whole collection (no athleteId
 * filter) instead of one getPracticeStreak() call per roster athlete —
 * same "single query, group in memory" strategy as getMonthlyEventStats/
 * getMonthlyActivityTrend, avoiding N unbounded per-athlete history
 * fetches. Trade-off: a streak longer than `days` reads as truncated to
 * `days` — 90 is generous given how little history this feature has so
 * far; revisit if the club ever produces a longer unbroken streak.
 * currentStreak-only (no longestStreak-ever) is intentional — that field
 * genuinely needs unbounded history and isn't cheap to compute in bulk.
 */
export async function getStreakLeaderboard(
  days = 90,
): Promise<{ athleteId: string; athleteName: string; currentStreak: number; lastPracticeDate: string }[]> {
  const today = todayInClubTz();
  const snap = await getDocs(query(
    practiceSessionsCol,
    where('date', '>=', daysAgoInClubTz(days)),
  ));

  // athleteId -> { athleteName, dates } — any event on a given day counts,
  // so dedupe by date only, not date+event.
  const byAthlete = new Map<string, { athleteName: string; dates: Set<string> }>();
  for (const doc of snap.docs) {
    const s = doc.data();
    let entry = byAthlete.get(s.athleteId);
    if (!entry) { entry = { athleteName: s.athleteName, dates: new Set() }; byAthlete.set(s.athleteId, entry); }
    entry.dates.add(s.date);
  }

  const rows: { athleteId: string; athleteName: string; currentStreak: number; lastPracticeDate: string }[] = [];
  for (const [athleteId, { athleteName, dates }] of byAthlete) {
    const uniqueDates = Array.from(dates).sort();
    const lastPracticeDate = uniqueDates[uniqueDates.length - 1];
    if (daysBetween(lastPracticeDate, today) > 1) continue; // streak already broken

    let currentStreak = 1;
    for (let i = uniqueDates.length - 1; i > 0; i--) {
      if (daysBetween(uniqueDates[i - 1], uniqueDates[i]) === 1) currentStreak += 1;
      else break;
    }
    rows.push({ athleteId, athleteName, currentStreak, lastPracticeDate });
  }

  return rows.sort((a, b) => b.currentStreak - a.currentStreak);
}

// ── Ao5 computation ──────────────────────────────────────────────────────

/**
 * Standard WCA Ao5: drop best + worst, average the middle 3, truncate.
 * `-1` entries are DNF. Returns null if 2+ of the 5 solves are DNF.
 */
export function computeAo5(solves: number[]): number | null {
  if (solves.length !== 5) return null;
  const dnfCount = solves.filter((s) => s === -1).length;
  if (dnfCount >= 2) return null;

  const sorted = [...solves].sort((a, b) => {
    const av = a === -1 ? Infinity : a;
    const bv = b === -1 ? Infinity : b;
    return av - bv;
  });
  const middle = sorted.slice(1, 4); // DNF, if any, sorts to index 4 and is dropped here
  return Math.floor(middle.reduce((sum, v) => sum + v, 0) / 3);
}

// ── Write ────────────────────────────────────────────────────────────────

/**
 * Create a practice session. Enforces "1 attempt per athlete per event per
 * day" here in the service layer (not just via Firestore rules — see
 * firestore.rules `practiceSessions` comment) by checking for an existing
 * session first.
 */
export async function createPracticeSession(
  data: Omit<PracticeSession, 'id' | 'createdAt'>,
): Promise<string> {
  const existing = await getTodaysSessionForAthleteEvent(data.athleteId, data.event);
  if (existing) {
    throw new Error('Already recorded today for this event');
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(practiceSessionDoc(id), {
    id,
    ...data,
    createdAt: Timestamp.now(),
  });
  return id;
}
