import { getOnlineCompAdminDb } from './firebase-admin';
import { computeAo5, effectiveAttemptTime, type AttemptTime } from './ao5';

interface JudgedSubmission {
  event: string;
  /** Approved or rejected — never pending. Load-bearing: a rejected
   *  attempt counts toward a set being COMPLETE but scores DNF, and its
   *  reportedTime is never read (see effectiveAttemptTime). */
  status: 'approved' | 'rejected';
  /** Attempt index 1-5 within one run. */
  round: number;
  /** Which competition this attempt belongs to. */
  competitionId: string;
  /** The competition round this attempt belongs to. */
  competitionRound: number;
  reportedTime: number;
  isDnf?: boolean;
  penalty: '+2' | 'DNF' | null;
}

/** The one shared rule (ao5.ts) — literally the same function the
 *  season-points scorer and the round ranker use, not a third copy of it. */
function effectiveTime(s: JudgedSubmission): AttemptTime {
  return effectiveAttemptTime(s);
}

export interface AthleteEventStats {
  /** Best single (lowest effective time) among approved submissions. */
  pr: number | null;
  /** Best Ao5 among complete judged rounds-1-5 sets. */
  ao5: number | null;
  /** Approved submissions for this event. */
  solveCount: number;
}

/** Recomputes per-event stats for every athlete who has an approved
 *  submission in this competition, and writes them to
 *  onlineParticipants/{uid}.stats.
 *
 *  Deliberately recomputes each athlete's stats GLOBALLY — across every
 *  competition they've ever had an approved submission in — rather than
 *  merging this competition's numbers into whatever was stored before.
 *  That satisfies the "never overwrite a PR with a worse value" rule by
 *  construction (the written value is always the true best over all their
 *  approved work), and makes re-running the recompute idempotent instead
 *  of drifting. The extra read is one equality query per involved
 *  athlete, which needs no composite index (Firestore serves
 *  equality-only queries from its automatic single-field indexes).
 *
 *  Independent of seasons: an athlete's PR is a fact about their solves,
 *  not about a season, so this runs even for a competition with no season
 *  set — which is also why the caller runs it before the points recompute
 *  (that one throws when `season` is empty).
 */
export async function recomputeAthleteStatsForCompetition(
  competitionId: string,
): Promise<{ athletesUpdated: number; events: number }> {
  const db = getOnlineCompAdminDb();

  // Judged, not approved: an athlete whose attempts were all rejected has
  // no approved submission at all, and would otherwise never be
  // recomputed — leaving a stale stat from before the rejection.
  const involved = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .where('status', 'in', ['approved', 'rejected'])
    .get();

  const uids = new Set<string>();
  involved.docs.forEach((d) => uids.add(d.data().uid as string));

  let eventsTouched = 0;
  for (const uid of uids) {
    // Every JUDGED submission this athlete has, anywhere. Rejected ones
    // are included so a round with a judge DNF still forms a complete
    // five-attempt set — approved-only left it at four and the set was
    // silently skipped, costing the athlete an Ao5 they had earned.
    // Pending stays excluded: an unjudged attempt makes the set
    // incomplete, which is the correct reason to skip it.
    //
    // No new composite index — `in` over two values expands to the same
    // equality shape this query already used.
    const mine = await db
      .collection('onlineSubmissions')
      .where('uid', '==', uid)
      .where('status', 'in', ['approved', 'rejected'])
      .get();

    const byEvent = new Map<string, JudgedSubmission[]>();
    for (const doc of mine.docs) {
      const d = doc.data();
      const s: JudgedSubmission = {
        event: d.event,
        status: d.status,
        round: d.round,
        competitionId: d.competitionId,
        // Attempts with no competitionRound can't be attributed to a round
        // and are excluded from Ao5 grouping below (NaN never matches a
        // real round key). They still count towards the single-solve PR,
        // which needs no grouping at all.
        competitionRound: typeof d.competitionRound === 'number' ? d.competitionRound : NaN,
        reportedTime: d.reportedTime,
        isDnf: d.isDnf,
        penalty: d.penalty ?? null,
      };
      if (!byEvent.has(s.event)) byEvent.set(s.event, []);
      byEvent.get(s.event)!.push(s);
    }

    const stats: Record<string, AthleteEventStats> = {};
    for (const [eventId, subs] of byEvent) {
      // PR: lowest effective time among non-DNF APPROVED solves.
      // `subs` now also holds rejected attempts (needed for complete Ao5
      // sets below), but effectiveTime maps every one of them to 'DNF',
      // which this filter drops — so a rejected attempt can never become
      // someone's personal best. Belt and braces: the approved filter is
      // also explicit here rather than relying on that alone.
      const approvedSubs = subs.filter((x) => x.status === 'approved');
      const times = approvedSubs.map(effectiveTime).filter((t): t is number => typeof t === 'number');
      const pr = times.length > 0 ? Math.min(...times) : null;

      // Ao5: best average over complete attempt-1-5 sets, where COMPLETE
      // means all five JUDGED (a rejected attempt is a DNF in the set, not
      // a missing one) and none still pending. Grouped per
      // competition AND per competition round: a round is the unit an Ao5
      // is actually solved over, so two rounds of the same event in one
      // competition are two independent candidates, never one merged set.
      // (Grouping by competition alone used to be the rule, on the
      // reasoning that "rounds only mean anything within one competition".
      // That is now inverted — grouping by competition alone is exactly
      // what let a round-1 attempt and a round-2 attempt average together
      // into an Ao5 neither of them was part of.) A group where the same
      // attempt index appears twice — an athlete re-running the solve
      // flow, which real data does contain — still has no unambiguous
      // set, so it is skipped rather than guessed at.
      //
      // Selection stays "best wins", unlike the season scorer's
      // furthest-round rule: a PR is a fact about a solve, so an average
      // set in round 1 remains this athlete's best even if they went on to
      // a slower final.
      const byRoundSet = new Map<string, JudgedSubmission[]>();
      for (const sub of subs) {
        if (!Number.isFinite(sub.competitionRound)) continue;
        const key = `${sub.competitionId}|${eventId}|${sub.competitionRound}`;
        if (!byRoundSet.has(key)) byRoundSet.set(key, []);
        byRoundSet.get(key)!.push(sub);
      }
      let bestAo5: number | null = null;
      for (const set of byRoundSet.values()) {
        if (set.length !== 5) continue;
        const rounds = set.map((s) => s.round).sort((a, b) => a - b);
        if (rounds.join(',') !== '1,2,3,4,5') continue;
        const byRound = new Map(set.map((s) => [s.round, s]));
        const { ao5 } = computeAo5([1, 2, 3, 4, 5].map((r) => effectiveTime(byRound.get(r)!)));
        if (ao5 === null) continue; // DNF average isn't a result
        if (bestAo5 === null || ao5 < bestAo5) bestAo5 = ao5;
      }

      // solveCount keeps its published meaning — APPROVED submissions —
      // rather than silently growing to include rejected ones now that
      // `subs` carries them.
      stats[eventId] = { pr, ao5: bestAo5, solveCount: approvedSubs.length };
      eventsTouched += 1;
    }

    // Merge at the document level so nothing else on the participant doc
    // is disturbed; `stats` itself is replaced wholesale because it was
    // just recomputed from the full source of truth.
    await db.collection('onlineParticipants').doc(uid).set({ stats }, { merge: true });
  }

  return { athletesUpdated: uids.size, events: eventsTouched };
}
