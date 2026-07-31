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
): Promise<{ athleteId: string; athleteName: string; bestAo5: number; date: string }[]> {
  const q = query(
    practiceSessionsCol,
    where('event', '==', event),
    where('date', '>=', daysAgoInClubTz(days)),
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

  return Array.from(bestByAthlete.entries())
    .map(([athleteId, v]) => ({ athleteId, athleteName: v.athleteName, bestAo5: v.bestAo5, date: v.date }))
    .sort((a, b) => a.bestAo5 - b.bestAo5);
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
 * Progress comparison for one athlete+event: today's session plus the
 * closest prior session on or before yesterday / 7 days ago / 30 days ago
 * (NOT exact-date matches — see mostRecentOnOrBefore), plus up to the last
 * 30 days of sessions ascending by date for charting.
 */
export async function getPracticeComparison(
  athleteId: string,
  event: string,
): Promise<{
  today: PracticeSession | null;
  yesterday: PracticeSession | null;
  sevenDaysAgo: PracticeSession | null;
  thirtyDaysAgo: PracticeSession | null;
  trend: PracticeSession[];
}> {
  const trendQuery = query(
    practiceSessionsCol,
    where('athleteId', '==', athleteId),
    where('event', '==', event),
    where('date', '>=', daysAgoInClubTz(30)),
    orderBy('date', 'asc'),
  );

  const [today, yesterday, sevenDaysAgo, thirtyDaysAgo, trendSnap] = await Promise.all([
    getTodaysSessionForAthleteEvent(athleteId, event),
    mostRecentOnOrBefore(athleteId, event, daysAgoInClubTz(1)),
    mostRecentOnOrBefore(athleteId, event, daysAgoInClubTz(7)),
    mostRecentOnOrBefore(athleteId, event, daysAgoInClubTz(30)),
    getDocs(trendQuery),
  ]);

  return {
    today,
    yesterday,
    sevenDaysAgo,
    thirtyDaysAgo,
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
