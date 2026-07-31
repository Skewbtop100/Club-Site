import type { PracticeSession } from '@/lib/types/practice';

export type PracticeBadge = 'new_pr' | 'streak_7' | 'streak_30';

/**
 * Pure, derived badge computation for one practice session — nothing is
 * stored on the PracticeSession document (see the phase notes on why).
 *
 * `currentStreak` is optional and defaults to omitted-streak-badges: the
 * streak counts across ALL events (getPracticeStreak), which a single
 * event's history can't reconstruct on its own, so callers that only have
 * `athleteHistoryForEvent` on hand still get correct 'new_pr' results.
 */
export function getPracticeBadges(
  session: PracticeSession,
  athleteHistoryForEvent: PracticeSession[],
  currentStreak?: number,
): PracticeBadge[] {
  const badges: PracticeBadge[] = [];

  if (session.ao5 !== null) {
    let priorBest: number | null = null;
    for (const s of athleteHistoryForEvent) {
      if (s.id === session.id || s.ao5 === null) continue;
      if (priorBest === null || s.ao5 < priorBest) priorBest = s.ao5;
    }
    if (priorBest === null || session.ao5 < priorBest) {
      badges.push('new_pr');
    }
  }

  // Exactly on the milestone, not >= — a one-time nudge when they cross it,
  // not a persistent "you're still on a streak" flag (that's the separate
  // currentStreak display).
  if (currentStreak === 7) badges.push('streak_7');
  if (currentStreak === 30) badges.push('streak_30');

  return badges;
}
