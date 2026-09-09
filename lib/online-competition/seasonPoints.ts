import { getOnlineCompAdminDb } from './firebase-admin';
import {
  attemptsForFormat,
  computeResult,
  effectiveAttemptTime,
  resolveResultFormat,
  type AttemptTime,
  type ResultFormat,
} from './ao5';
import type { OnlineSeasonPointsBreakdownEntry } from './types';

const BASE_POINTS = 10;
const PLACEMENT_BONUS: Record<number, number> = { 1: 15, 2: 10, 3: 5 };

interface JudgedSubmission {
  uid: string;
  /** Attempt index 1-5 within one run. */
  round: number;
  /** The competition round this attempt belongs to. */
  competitionRound: number;
  /** Approved or rejected — never pending; an unjudged attempt is filtered
   *  out before one of these is built. Load-bearing: effectiveAttemptTime
   *  reads it FIRST, so a rejected attempt scores DNF and its
   *  `reportedTime` is never trusted. */
  status: 'approved' | 'rejected';
  reportedTime: number;
  isDnf?: boolean;
  penalty: '+2' | 'DNF' | null;
}

/** One athlete's work in one event of this competition, partitioned by
 *  competition round — the grouping key is competitionId + eventId +
 *  competitionRound (competitionId is constant here; the query fetches a
 *  single competition). Before this partition existed, attempts from two
 *  different rounds could land in one five-attempt set and produce a
 *  fabricated Ao5. */
interface AthleteEvent {
  /** competitionRound -> that round's JUDGED submissions (approved or
   *  rejected). A rejected attempt is a DNF, not an absent one. */
  judgedByRound: Map<number, JudgedSubmission[]>;
  /** Highest competitionRound this athlete has ANY submission in for this
   *  event — pending and rejected included. This is their furthest round
   *  REACHED, which is what placement is decided on; it deliberately does
   *  not depend on whether that round has been judged yet. */
  furthestRound: number;
}

/** A submission's effective Ao5 input — the one shared rule (ao5.ts).
 *  A rejected attempt is a DNF; its reported time is never read. The old
 *  local copy noted that a judge DNF lands as `status: 'rejected'` and
 *  called handling it "robustness" — it was in fact the bug: such an
 *  attempt never reached this function at all, and its athlete was
 *  dropped from the event outright. */
function effectiveTime(s: JudgedSubmission, timeLimitCs: number | null): AttemptTime {
  return effectiveAttemptTime(s, timeLimitCs);
}

/** Recomputes season points for one competition and merges them into
 *  onlineSeasonPoints/{season}/athletes/{uid}.
 *
 * Scoring: JUDGED submissions count — approved ones at their time, and
 * rejected ones as a DNF. For each event, an athlete needs a *complete*
 * set of judged submissions covering every attempt THAT EVENT'S FORMAT
 * asks for (5 for Ao5, 3 for Mo3/Bo3, and so on) to get a result; a set
 * with an attempt still PENDING is skipped rather than averaging whatever
 * subset happens to be decided, since that wouldn't be a real Ao5.
 * Athletes are ranked ascending by Ao5 within each event; a DNF average
 * is excluded from ranking entirely (no placement, no points).
 * Points = 10 base for any placed result, +15/+10/+5 for 1st/2nd/3rd.
 *
 * WHICH ROUND SCORES — the furthest one reached. WCA semantics: an
 * athlete's placement in an event comes from the last round they made,
 * not from their best round. Someone who advances to round 2 is placed
 * on their round-2 result even if their round-1 Ao5 was faster; the
 * earlier rounds are superseded, not merely worse.
 *
 * The corollary matters as much as the rule: an athlete who reached
 * round 2 but whose round-2 set is incomplete or still being judged is
 * excluded from placement ENTIRELY until it completes. Falling back to
 * their round-1 result would score them as though they had never
 * advanced, which is precisely backwards. Because `furthestRound` is
 * derived from submissions of ANY status, a not-yet-judged later round
 * still counts as reached and still suppresses the earlier one.
 *
 * Idempotent: re-running this (e.g. after more submissions get approved,
 * or just to re-check) replaces this competition's *own* breakdown
 * entries in each affected athlete's doc rather than accumulating
 * duplicates — it does not touch entries from other competitions in the
 * same season.
 */
export async function recomputeSeasonPointsForCompetition(
  competitionId: string,
): Promise<{ season: string; athletesUpdated: number; eventsScored: number }> {
  const db = getOnlineCompAdminDb();

  const compSnap = await db.collection('onlineCompetitions').doc(competitionId).get();
  if (!compSnap.exists) {
    throw new Error('Competition not found');
  }
  const compData = compSnap.data()!;
  // seasonPoints RE-DERIVES each athlete's result rather than reading the
  // round standings, so it needs the format itself. The competition
  // document is already in hand here — no extra read.
  const rulesByEvent = new Map<string, { format: ResultFormat; timeLimitCs: number | null }>(
    (Array.isArray(compData.events) ? (compData.events as Record<string, unknown>[]) : [])
      .filter((e) => typeof e?.eventId === 'string')
      .map((e) => [
        e.eventId as string,
        {
          format: resolveResultFormat(e.resultFormat),
          timeLimitCs: typeof e.timeLimitCs === 'number' ? e.timeLimitCs : null,
        },
      ]),
  );
  const season: string = typeof compData.season === 'string' && compData.season ? compData.season : '';
  if (!season) {
    throw new Error('Competition has no season set');
  }

  // Every submission for this competition, not only the approved ones:
  // deciding the furthest round an athlete REACHED has to see pending and
  // rejected work too, or a not-yet-judged round 2 would be invisible and
  // the athlete would be scored on round 1 as if they had never advanced.
  // Only approved docs ever feed an Ao5 — the partition below keeps that
  // split explicit.
  const subsSnap = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .get();

  // eventId -> uid -> that athlete's per-round work in the event
  const byEvent = new Map<string, Map<string, AthleteEvent>>();
  // Every uid with at least one currently-approved submission for this
  // competition, regardless of whether they end up qualifying for a
  // placement — needed below so an athlete who qualified on a PREVIOUS
  // recompute but no longer does (e.g. a submission was rejected since)
  // still gets their stale breakdown entry for this competition cleared,
  // not just athletes who currently qualify.
  const involvedUids = new Set<string>();
  for (const doc of subsSnap.docs) {
    const d = doc.data();
    const eventId: string = d.event;
    const uid: string = d.uid;
    // A submission with no competitionRound cannot be attributed to a
    // round at all, so it takes no part here — the same treatment
    // rankRoundResults gives it, where the round filter simply never
    // matches. The field is required on every document written since the
    // cutover, so this is belt-and-braces rather than an expected path.
    const competitionRound = typeof d.competitionRound === 'number' ? d.competitionRound : null;
    if (competitionRound === null) continue;

    // JUDGED = decided either way. Two separate uses:
    //  - `judged` gates whether the attempt feeds an average at all
    //    (a pending attempt makes the round incomplete).
    //  - involvedUids drives the stale-entry cleanup below. Widened from
    //    approved-only so an athlete whose every attempt was rejected —
    //    who therefore has no approved submission at all — still gets a
    //    previous recompute's breakdown entry cleared. It never grants
    //    points; only DNF-free averages below do that.
    const judged = d.status === 'approved' || d.status === 'rejected';
    if (judged) involvedUids.add(uid);

    if (!byEvent.has(eventId)) byEvent.set(eventId, new Map());
    const byUid = byEvent.get(eventId)!;
    let entry = byUid.get(uid);
    if (!entry) {
      entry = { judgedByRound: new Map(), furthestRound: competitionRound };
      byUid.set(uid, entry);
    }
    // Reached, regardless of how far judging has got.
    if (competitionRound > entry.furthestRound) entry.furthestRound = competitionRound;
    if (!judged) continue;

    if (!entry.judgedByRound.has(competitionRound)) entry.judgedByRound.set(competitionRound, []);
    entry.judgedByRound.get(competitionRound)!.push({
      uid,
      round: d.round,
      competitionRound,
      status: d.status,
      reportedTime: d.reportedTime,
      isDnf: d.isDnf,
      penalty: d.penalty ?? null,
    });
  }

  // uid -> { totalPoints delta from THIS competition, breakdown entries }
  const perUid = new Map<string, OnlineSeasonPointsBreakdownEntry[]>();

  for (const [eventId, byUid] of byEvent) {
    // Every athlete in this loop is being scored on the SAME event of the
    // SAME competition, so they all share one format — which is what makes
    // comparing their values below legitimate. There is no cross-format
    // comparison here to guard against.
    const rules = rulesByEvent.get(eventId) ?? { format: 'ao5' as ResultFormat, timeLimitCs: null };
    const format = rules.format;
    const expected = attemptsForFormat(format);
    const wanted = Array.from({ length: expected }, (_, i) => i + 1);
    const ranked: { uid: string; value: number; best: number | null }[] = [];

    for (const [uid, entry] of byUid) {
      // Placement comes from the furthest round reached and from nothing
      // else. If that round is not fully approved yet the athlete is
      // excluded outright — there is deliberately no fallback to an
      // earlier round, which would score them as if they had never
      // advanced past it.
      const subs = entry.judgedByRound.get(entry.furthestRound) ?? [];
      if (subs.length !== expected) continue; // incomplete — an attempt is still unjudged
      const rounds = subs.map((s) => s.round).sort((a, b) => a - b);
      if (rounds.join(',') !== wanted.join(',')) continue; // missing/duplicate attempt
      const byRound = new Map(subs.map((s) => [s.round, s]));
      const times: AttemptTime[] = wanted.map((r) => effectiveTime(byRound.get(r)!, rules.timeLimitCs));
      const { value } = computeResult(times, format);
      // DNF result — NO SEASON PLACEMENT, deliberately, and deliberately
      // DIFFERENT from the round standings.
      //
      // The round standings now rank a DNF-result athlete (WCA does, below
      // everyone with a result, on their single — see round-results.ts).
      // Season points are not a WCA concept though; they are this
      // platform's own scheme, and its floor is BASE_POINTS for "placed at
      // all". Paying that for finishing a round without a result would
      // put a DNF average level with a real 4th-place average, and would
      // retroactively inflate every stored total the next time a season is
      // recomputed. Ranking someone and rewarding them are separate
      // questions, and only the first is what WCA settles.
      if (value === null) continue;
      const finished = times.filter((t): t is number => t !== 'DNF');
      ranked.push({ uid, value, best: finished.length > 0 ? Math.min(...finished) : null });
    }

    // Same WCA tie-break the round standings use (round-results.ts): equal
    // values are separated by the better SINGLE. It matters MORE here than
    // there — placement is this array's index, so a tie decides who gets
    // +15 and who gets +10. Previously ties fell to insertion order, which
    // is Firestore read order: not merely arbitrary but unstable between
    // runs of the same recompute.
    ranked.sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      if (a.best === null && b.best === null) return a.uid.localeCompare(b.uid);
      if (a.best === null) return 1;
      if (b.best === null) return -1;
      if (a.best !== b.best) return a.best - b.best;
      return a.uid.localeCompare(b.uid);
    });
    ranked.forEach(({ uid }, i) => {
      const placement = i + 1;
      const points = BASE_POINTS + (PLACEMENT_BONUS[placement] ?? 0);
      if (!perUid.has(uid)) perUid.set(uid, []);
      perUid.get(uid)!.push({ competitionId, eventId, points, placement });
    });
  }

  let athletesUpdated = 0;
  for (const uid of involvedUids) {
    const freshEntries = perUid.get(uid) ?? [];
    const [participantSnap, pointsSnap] = await Promise.all([
      db.collection('onlineParticipants').doc(uid).get(),
      db.collection('onlineSeasonPoints').doc(season).collection('athletes').doc(uid).get(),
    ]);
    const participant = participantSnap.data();
    const existing = pointsSnap.exists ? pointsSnap.data()! : { breakdown: [] };
    const existingBreakdown: OnlineSeasonPointsBreakdownEntry[] = Array.isArray(existing.breakdown)
      ? existing.breakdown
      : [];

    // Drop this competition's OWN prior entries (any event), then add the
    // freshly-computed set — makes re-running this idempotent instead of
    // accumulating duplicates, and correctly drops an event this athlete
    // no longer qualifies for (e.g. a submission got rejected since the
    // last recompute).
    const carriedOver = existingBreakdown.filter((b) => b.competitionId !== competitionId);
    const newBreakdown = [...carriedOver, ...freshEntries];
    const newTotal = newBreakdown.reduce((sum, b) => sum + b.points, 0);

    await db
      .collection('onlineSeasonPoints')
      .doc(season)
      .collection('athletes')
      .doc(uid)
      .set({
        uid,
        displayName: participant?.displayName ?? 'Тамирчин',
        photoURL: participant?.photoURL ?? null,
        totalPoints: newTotal,
        breakdown: newBreakdown,
      });
    athletesUpdated++;
  }

  return { season, athletesUpdated, eventsScored: byEvent.size };
}
