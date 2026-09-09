import { isAveragingFormat, type ResultFormat } from '@/lib/online-competition/ao5';

/** Provisional personal-best check for the solve flow's live indicator.
 *
 *  Shared by the entry-stage toast and the summary screen so the two can
 *  never disagree about what the athlete just saw.
 *
 *  This is UNOFFICIAL: it compares a self-reported time against the PR
 *  stored on onlineParticipants/{uid}.stats[eventId]. Nothing here writes
 *  that value — stats is computed exclusively by the admin recompute
 *  after a judge approves the submission (see
 *  lib/online-competition/athleteStats.ts), which is why every surface
 *  using this is labelled "шүүгч баталгаажуулснаар эцэслэнэ".
 */
export interface StoredBests {
  pr: number | null;
  /** Best Ao5, from ao5 rounds only. */
  ao5: number | null;
  /** Best Mo3, from mo3 rounds only. Absent for an athlete whose stats
   *  predate the field. */
  mo3: number | null;
}

/** A DNF never counts. With no stored PR yet, any real time is a personal
 *  best by definition — a first-ever solve for the event. */
export function beatsPr(timeCs: number | null, isDnf: boolean, bests: { pr: number | null } | null): boolean {
  if (isDnf || timeCs === null) return false;
  if (!bests || bests.pr === null) return true;
  return timeCs < bests.pr;
}

/** Same rule for the average, but against THE MATCHING FORMAT's best.
 *
 *  Was beatsAo5, comparing against a single stored `ao5` field. With Mo3
 *  stored separately that would have compared an Mo3 result against an Ao5
 *  best — two numbers that are not comparable (a mean of 3 with nothing
 *  dropped is systematically slower), and it would have shown a "new PR"
 *  toast on almost every Mo3 solve.
 *
 *  A bo-N round has no average at all, so it never qualifies here — its
 *  single is already covered by beatsPr. */
export function beatsAverage(
  value: number | null,
  format: ResultFormat,
  bests: StoredBests | null,
): boolean {
  if (value === null || bests === null) return false;
  if (!isAveragingFormat(format)) return false;
  const current = format === 'mo3' ? bests.mo3 : bests.ao5;
  return current === null || value < current;
}
