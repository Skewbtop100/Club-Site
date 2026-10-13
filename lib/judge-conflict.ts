// Judge conflict rules for results entry (admin and judge panels), pure so
// they can be unit-tested (scripts/test-judge.ts):
//
//  1. A judge cannot judge themselves.
//  2. An athlete who judged any result in group G of event E round R cannot
//     then compete in group G of E round R — they have seen its scrambles.
//     Other groups stay open, and other rounds are independent (different
//     scrambles).
//  3. The reverse is fine: an athlete may judge a group they already
//     competed in.

import type { Result } from './types';

type JudgedResult = Pick<Result, 'eventId'> & Partial<Pick<Result, 'round' | 'group' | 'judgeAthleteId'>>;

/** Rule 1. Empty ids never conflict (nothing chosen yet). */
export function isSelfJudging(judgeAthleteId: string, athleteId: string): boolean {
  return !!judgeAthleteId && judgeAthleteId === athleteId;
}

/** Rule 2: the groups of event+round that `athleteId` has judged a result in. */
export function judgedGroups(results: JudgedResult[], athleteId: string, eventId: string, round: number): Set<number> {
  const groups = new Set<number>();
  if (!athleteId || !eventId) return groups;
  for (const r of results) {
    if (r.judgeAthleteId !== athleteId || r.eventId !== eventId || (r.round || 1) !== round) continue;
    if (typeof r.group === 'number') groups.add(r.group);
  }
  return groups;
}

export interface GroupAvailability {
  /** Groups the athlete may not compete in (they judged them). */
  blocked: Set<number>;
  /** Groups still open to them, in the order offered. */
  open: number[];
  /** True when every offered group is blocked — the athlete cannot compete
   *  in this round at all (e.g. a one-group round they judged). */
  roundBlocked: boolean;
}

/** Which of a round's offered groups an athlete may still compete in. */
export function groupAvailability(
  offeredGroups: number[], results: JudgedResult[], athleteId: string, eventId: string, round: number,
): GroupAvailability {
  const judged = judgedGroups(results, athleteId, eventId, round);
  const blocked = new Set(offeredGroups.filter(g => judged.has(g)));
  const open = offeredGroups.filter(g => !blocked.has(g));
  return { blocked, open, roundBlocked: offeredGroups.length > 0 && open.length === 0 };
}
