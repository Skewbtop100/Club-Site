// Club personal bests / club records summary, and the PR/TR badges the live
// results viewer derives from it. Pure — the Firestore side is in
// lib/firebase/services/club-bests.ts. Imported relatively (not via '@/') so
// scripts/test-club-bests.ts can compile it standalone.
//
// Why a summary: PR and TR depend on every result the club has ever
// recorded. Reading the whole `results` collection each time someone opens
// the viewer would cost thousands of reads; one small document
// (settings/clubBests), recomputed by an admin when a competition is
// finished, costs one.

import { getMinPlausibleSolveCs } from './time-utils';
import type { Result } from './types';

/** Best single (`s`) and average (`a`) in centiseconds; a key is absent when
 *  there is no valid result of that kind. */
export interface BestPair { s?: number; a?: number }

export interface ClubBests {
  /** athleteId → eventId → that athlete's bests. */
  athletes: Record<string, Record<string, BestPair>>;
  /** eventId → the club's bests (the TR). */
  club: Record<string, BestPair>;
}

type BestResult = Pick<Result, 'id' | 'athleteId' | 'eventId' | 'competitionId' | 'single' | 'average'> &
  Partial<Pick<Result, 'round' | 'status' | 'source' | 'isPlaceholder'>>;

const KEY = { single: 's', average: 'a' } as const;

/** A club athlete's own, real, published result (not imported, not a placeholder). */
function isClubResult(r: BestResult, clubAthleteIds: Set<string>): boolean {
  return !!r.athleteId && clubAthleteIds.has(r.athleteId)
    && r.status === 'published' && !r.isPlaceholder
    && r.source !== 'imported' && r.source !== 'import';
}

/** A time that can count as a best: positive (not DNF/DNS/missing) and not
 *  below the event's plausibility floor — the same guard the records tab
 *  uses so a dropped-digit typo ("0.55") can't become a record. */
function countable(value: number | null | undefined, eventId: string): value is number {
  return typeof value === 'number' && value >= getMinPlausibleSolveCs(eventId);
}

function lower(current: number | undefined, value: number): number {
  return current === undefined || value < current ? value : current;
}

/**
 * The summary: every club athlete's best single and average per event, and
 * the club's, over the published club results of FINISHED competitions only.
 * A competition that is still live is therefore never in it — which is what
 * makes it "bests from before this competition" for the live viewer.
 */
export function computeClubBests(
  results: BestResult[], finishedCompetitionIds: Set<string>, clubAthleteIds: Set<string>,
): ClubBests {
  const bests: ClubBests = { athletes: {}, club: {} };
  for (const r of results) {
    if (!isClubResult(r, clubAthleteIds) || !finishedCompetitionIds.has(r.competitionId)) continue;
    for (const type of ['single', 'average'] as const) {
      const value = r[type];
      if (!countable(value, r.eventId)) continue;
      const k = KEY[type];
      const athlete = ((bests.athletes[r.athleteId] ??= {})[r.eventId] ??= {});
      athlete[k] = lower(athlete[k], value);
      const club = (bests.club[r.eventId] ??= {});
      club[k] = lower(club[k], value);
    }
  }
  return bests;
}

/** PR / TR for one result, single and average judged separately. */
export interface LocalBadges {
  single: { pr: boolean; tr: boolean };
  average: { pr: boolean; tr: boolean };
}

/**
 * PR and TR for the club results of ONE competition, chronologically, the
 * way WCA marks records:
 *
 *  - PR: the value beats or ties the athlete's best from before this
 *    competition AND from their earlier rounds of the same event here. (A
 *    final slower than their first round is not a PR.) An athlete with no
 *    earlier result gets PR on their first.
 *  - TR: the same against the club's best — before this competition and in
 *    earlier rounds here — and within one round only the best result gets
 *    it; athletes tied for that best share it.
 *  - TR implies PR (cascading, as everywhere else).
 *
 * Rounds are taken in order; within a round there is no order (results of a
 * round are entered in any sequence), which is why a round's TR goes to its
 * best result rather than to whoever was typed in first.
 *
 * `bests` null (summary not loaded, or never computed) → no badges at all:
 * without it every result would look like a first-ever PR.
 * Returns badges by result id; results that earn none are simply absent.
 */
export function computeLocalBadges(
  competitionResults: BestResult[], bests: ClubBests | null, clubAthleteIds: Set<string>,
): Record<string, LocalBadges> {
  const out: Record<string, LocalBadges> = {};
  if (!bests) return out;
  const mine = competitionResults.filter(r => isClubResult(r, clubAthleteIds));
  const mark = (id: string, type: 'single' | 'average', what: 'pr' | 'tr') => {
    (out[id] ??= { single: { pr: false, tr: false }, average: { pr: false, tr: false } })[type][what] = true;
  };

  for (const eventId of new Set(mine.map(r => r.eventId))) {
    const eventResults = mine.filter(r => r.eventId === eventId);
    const rounds = [...new Set(eventResults.map(r => r.round || 1))].sort((a, b) => a - b);
    for (const type of ['single', 'average'] as const) {
      const k = KEY[type];
      // Running bests: start from before the competition, then absorb each round.
      const athleteBest: Record<string, number | undefined> = {};
      let clubBest = bests.club[eventId]?.[k];
      for (const round of rounds) {
        const inRound = eventResults
          .filter(r => (r.round || 1) === round && countable(r[type], eventId))
          .map(r => ({ r, value: r[type] as number }));
        if (inRound.length === 0) continue;

        const roundBest = Math.min(...inRound.map(x => x.value));
        const roundSetsTr = clubBest === undefined || roundBest <= clubBest;
        for (const { r, value } of inRound) {
          const before = r.athleteId in athleteBest ? athleteBest[r.athleteId] : bests.athletes[r.athleteId]?.[eventId]?.[k];
          const isTr = roundSetsTr && value === roundBest;
          if (isTr) mark(r.id, type, 'tr');
          if (isTr || before === undefined || value <= before) mark(r.id, type, 'pr');
        }
        for (const { r, value } of inRound) {
          const before = r.athleteId in athleteBest ? athleteBest[r.athleteId] : bests.athletes[r.athleteId]?.[eventId]?.[k];
          athleteBest[r.athleteId] = lower(before, value);
        }
        clubBest = lower(clubBest, roundBest);
      }
    }
  }
  return out;
}
