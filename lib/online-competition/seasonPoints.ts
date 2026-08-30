import { getOnlineCompAdminDb } from './firebase-admin';
import { computeAo5, type AttemptTime } from './ao5';
import type { OnlineSeasonPointsBreakdownEntry } from './types';

const BASE_POINTS = 10;
const PLACEMENT_BONUS: Record<number, number> = { 1: 15, 2: 10, 3: 5 };

interface ApprovedSubmission {
  uid: string;
  round: number;
  reportedTime: number;
  isDnf?: boolean;
  penalty: '+2' | 'DNF' | null;
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
 * rounds 1-5 to get an Ao5 — a partially-approved set (some of their 5
 * attempts still pending/rejected) is skipped rather than averaging
 * whatever subset happens to be approved, since that wouldn't be a real
 * Ao5. Athletes are ranked ascending by Ao5 within each event; a DNF
 * average is excluded from ranking entirely (no placement, no points).
 * Points = 10 base for any placed result, +15/+10/+5 for 1st/2nd/3rd.
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

  const subsSnap = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .where('status', '==', 'approved')
    .get();

  // eventId -> uid -> submissions
  const byEvent = new Map<string, Map<string, ApprovedSubmission[]>>();
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
    involvedUids.add(uid);
    if (!byEvent.has(eventId)) byEvent.set(eventId, new Map());
    const byUid = byEvent.get(eventId)!;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid)!.push({
      uid,
      round: d.round,
      reportedTime: d.reportedTime,
      isDnf: d.isDnf,
      penalty: d.penalty ?? null,
    });
  }

  // uid -> { totalPoints delta from THIS competition, breakdown entries }
  const perUid = new Map<string, OnlineSeasonPointsBreakdownEntry[]>();

  for (const [eventId, byUid] of byEvent) {
    const ranked: { uid: string; ao5: number }[] = [];

    for (const [uid, subs] of byUid) {
      if (subs.length !== 5) continue; // incomplete set — not all 5 attempts approved yet
      const rounds = subs.map((s) => s.round).sort((a, b) => a - b);
      if (rounds.join(',') !== '1,2,3,4,5') continue; // missing/duplicate round
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
