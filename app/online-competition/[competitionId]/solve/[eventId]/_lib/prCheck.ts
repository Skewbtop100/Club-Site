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
  ao5: number | null;
}

/** A DNF never counts. With no stored PR yet, any real time is a personal
 *  best by definition — a first-ever solve for the event. */
export function beatsPr(timeCs: number | null, isDnf: boolean, bests: { pr: number | null } | null): boolean {
  if (isDnf || timeCs === null) return false;
  if (!bests || bests.pr === null) return true;
  return timeCs < bests.pr;
}

/** Same rule for the average: a first-ever Ao5 counts. A DNF average
 *  never does. */
export function beatsAo5(ao5: number | null, bests: StoredBests | null): boolean {
  if (ao5 === null || bests === null) return false;
  return bests.ao5 === null || ao5 < bests.ao5;
}
