import { getOnlineCompAdminDb } from './firebase-admin';
import { computeAo5, type AttemptTime } from './ao5';

interface ApprovedSubmission {
  event: string;
  round: number;
  reportedTime: number;
  isDnf?: boolean;
  penalty: '+2' | 'DNF' | null;
}

/** Same effective-time rule the season-points scorer uses: a judge's +2
 *  adds 200cs, a DNF is a DNF. */
function effectiveTime(s: ApprovedSubmission): AttemptTime {
  if (s.isDnf || s.penalty === 'DNF') return 'DNF';
  return s.reportedTime + (s.penalty === '+2' ? 200 : 0);
}

export interface AthleteEventStats {
  /** Best single (lowest effective time) among approved submissions. */
  pr: number | null;
  /** Best Ao5 among complete approved rounds-1-5 sets. */
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

  const involved = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .where('status', '==', 'approved')
    .get();

  const uids = new Set<string>();
  involved.docs.forEach((d) => uids.add(d.data().uid as string));

  let eventsTouched = 0;
  for (const uid of uids) {
    // Every approved submission this athlete has, anywhere.
    const mine = await db
      .collection('onlineSubmissions')
      .where('uid', '==', uid)
      .where('status', '==', 'approved')
      .get();

    const byEvent = new Map<string, ApprovedSubmission[]>();
    for (const doc of mine.docs) {
      const d = doc.data();
      const s: ApprovedSubmission = {
        event: d.event,
        round: d.round,
        reportedTime: d.reportedTime,
        isDnf: d.isDnf,
        penalty: d.penalty ?? null,
      };
      if (!byEvent.has(s.event)) byEvent.set(s.event, []);
      byEvent.get(s.event)!.push(s);
    }

    const stats: Record<string, AthleteEventStats> = {};
    for (const [eventId, subs] of byEvent) {
      // PR: lowest effective time among non-DNF approved solves.
      const times = subs.map(effectiveTime).filter((t): t is number => typeof t === 'number');
      const pr = times.length > 0 ? Math.min(...times) : null;

      // Ao5: best average over complete rounds-1-5 sets. Grouped per
      // competition because rounds only mean anything within one — and a
      // competition where the same round appears more than once (an
      // athlete re-running the solve flow, which real data does contain)
      // has no unambiguous set, so it's skipped rather than guessed at.
      // This mirrors the season scorer's "exactly 5, rounds 1-5" rule.
      const byComp = new Map<string, ApprovedSubmission[]>();
      for (const doc of mine.docs) {
        const d = doc.data();
        if (d.event !== eventId) continue;
        const key = d.competitionId as string;
        if (!byComp.has(key)) byComp.set(key, []);
        byComp.get(key)!.push({
          event: d.event,
          round: d.round,
          reportedTime: d.reportedTime,
          isDnf: d.isDnf,
          penalty: d.penalty ?? null,
        });
      }
      let bestAo5: number | null = null;
      for (const set of byComp.values()) {
        if (set.length !== 5) continue;
        const rounds = set.map((s) => s.round).sort((a, b) => a - b);
        if (rounds.join(',') !== '1,2,3,4,5') continue;
        const byRound = new Map(set.map((s) => [s.round, s]));
        const { ao5 } = computeAo5([1, 2, 3, 4, 5].map((r) => effectiveTime(byRound.get(r)!)));
        if (ao5 === null) continue; // DNF average isn't a result
        if (bestAo5 === null || ao5 < bestAo5) bestAo5 = ao5;
      }

      stats[eventId] = { pr, ao5: bestAo5, solveCount: subs.length };
      eventsTouched += 1;
    }

    // Merge at the document level so nothing else on the participant doc
    // is disturbed; `stats` itself is replaced wholesale because it was
    // just recomputed from the full source of truth.
    await db.collection('onlineParticipants').doc(uid).set({ stats }, { merge: true });
  }

  return { athletesUpdated: uids.size, events: eventsTouched };
}
