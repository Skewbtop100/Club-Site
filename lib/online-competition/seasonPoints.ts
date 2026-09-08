import { getOnlineCompAdminDb } from './firebase-admin';
import { computeAo5, type AttemptTime } from './ao5';
import type { OnlineSeasonPointsBreakdownEntry } from './types';

const BASE_POINTS = 10;
const PLACEMENT_BONUS: Record<number, number> = { 1: 15, 2: 10, 3: 5 };

interface ApprovedSubmission {
  uid: string;
  /** Attempt index 1-5 within one run. */
  round: number;
  /** The competition round this attempt belongs to. */
  competitionRound: number;
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
  /** competitionRound -> that round's APPROVED submissions. */
  approvedByRound: Map<number, ApprovedSubmission[]>;
  /** Highest competitionRound this athlete has ANY submission in for this
   *  event — pending and rejected included. This is their furthest round
   *  REACHED, which is what placement is decided on; it deliberately does
   *  not depend on whether that round has been judged yet. */
  furthestRound: number;
}

/** A submission's effective Ao5 input: DNF (self-reported at entry, or
 *  — in practice never for an *approved* doc, since a judge-assigned DNF
 *  penalty gets `status: 'rejected'`, not 'approved' — included anyway
 *  for robustness) counts as 'DNF'; a judge's +2 penalty adds 200cs. */
function effectiveTime(s: ApprovedSubmission): AttemptTime {
  if (s.isDnf || s.penalty === 'DNF') return 'DNF';
  return s.reportedTime + (s.penalty === '+2' ? 200 : 0);
}

/** Recomputes season points for one competition and merges them into
 *  onlineSeasonPoints/{season}/athletes/{uid}.
 *
 * Scoring: only approved submissions count. For each event, an athlete
 * needs a *complete* set of exactly 5 approved submissions covering
 * attempts 1-5 to get an Ao5 — a partially-approved set (some of their 5
 * attempts still pending/rejected) is skipped rather than averaging
 * whatever subset happens to be approved, since that wouldn't be a real
 * Ao5. Athletes are ranked ascending by Ao5 within each event; a DNF
 * average is excluded from ranking entirely (no placement, no points).
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

    // Unchanged meaning: uids with at least one CURRENTLY-approved
    // submission, so an athlete who placed on a previous recompute but no
    // longer does still gets their stale breakdown entry cleared below.
    const approved = d.status === 'approved';
    if (approved) involvedUids.add(uid);

    if (!byEvent.has(eventId)) byEvent.set(eventId, new Map());
    const byUid = byEvent.get(eventId)!;
    let entry = byUid.get(uid);
    if (!entry) {
      entry = { approvedByRound: new Map(), furthestRound: competitionRound };
      byUid.set(uid, entry);
    }
    // Reached, regardless of how far judging has got.
    if (competitionRound > entry.furthestRound) entry.furthestRound = competitionRound;
    if (!approved) continue;

    if (!entry.approvedByRound.has(competitionRound)) entry.approvedByRound.set(competitionRound, []);
    entry.approvedByRound.get(competitionRound)!.push({
      uid,
      round: d.round,
      competitionRound,
      reportedTime: d.reportedTime,
      isDnf: d.isDnf,
      penalty: d.penalty ?? null,
    });
  }

  // uid -> { totalPoints delta from THIS competition, breakdown entries }
  const perUid = new Map<string, OnlineSeasonPointsBreakdownEntry[]>();

  for (const [eventId, byUid] of byEvent) {
    const ranked: { uid: string; ao5: number }[] = [];

    for (const [uid, entry] of byUid) {
      // Placement comes from the furthest round reached and from nothing
      // else. If that round is not fully approved yet the athlete is
      // excluded outright — there is deliberately no fallback to an
      // earlier round, which would score them as if they had never
      // advanced past it.
      const subs = entry.approvedByRound.get(entry.furthestRound) ?? [];
      if (subs.length !== 5) continue; // incomplete set — not all 5 attempts approved yet
      const rounds = subs.map((s) => s.round).sort((a, b) => a - b);
      if (rounds.join(',') !== '1,2,3,4,5') continue; // missing/duplicate attempt
      const byRound = new Map(subs.map((s) => [s.round, s]));
      const times: AttemptTime[] = [1, 2, 3, 4, 5].map((r) => effectiveTime(byRound.get(r)!));
      const { ao5 } = computeAo5(times);
      if (ao5 === null) continue; // DNF average — excluded from ranking
      ranked.push({ uid, ao5 });
    }

    ranked.sort((a, b) => a.ao5 - b.ao5);
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
