// ── Is this round actually solvable by everyone in it? ─────────────────
// Server-only (Admin SDK reads). Asked once, by the admin, at the moment
// they open a round — see openRound.
//
// WHY HERE AND NOT ONLY IN THE SCRAMBLE ROUTE. The route already refuses
// an athlete with no group assignment, which is correct but late: the
// athlete discovers it when they sit down to solve, having been told the
// round is open, and the admin discovers it from a confused message
// rather than from the action that caused it. The same fact is knowable
// before anything goes live, when fixing it costs one assignment click.
//
// IT ONLY REFUSES. Nothing here assigns anybody to anything — an
// auto-assignment triggered by opening a round would be a significant
// decision (who competes against whom) taken as a side effect of a
// different one, and made silently at the worst possible moment.

import type { Firestore } from 'firebase-admin/firestore';
import { roundKey, type ScrambleGroup } from './scrambles';
import { resolveOfficialScramble } from './group-scramble';
import { fetchScrambleRoster } from './scramble-roster';

export interface UnassignedAthlete {
  uid: string;
  displayName: string;
}

export type RoundScrambleReadiness =
  /** Nothing stands in the way of opening.
   *
   *  `random` is not a lesser kind of ok: a round with no imported
   *  scrambles generates one per attempt and has never had groups, which
   *  is how most club competitions run. */
  | { ok: true; mode: 'random' }
  | { ok: true; mode: 'official'; checked: number }
  /** An import exists but holds no usable scramble — an empty groups
   *  array, or groups whose scramble lists are empty. EVERY athlete fails
   *  in this state, so they are deliberately not enumerated: a hundred
   *  names would bury the one fact that matters, which is that the import
   *  is the thing to fix. */
  | { ok: false; reason: 'no-scrambles' }
  /** Named, not counted. The admin's next action is to assign these
   *  specific people, so a number would only send them looking. */
  | { ok: false; reason: 'unassigned'; athletes: UnassignedAthlete[] };

function usable(s: unknown): boolean {
  return typeof s === 'string' && s.trim() !== '';
}

/** True when the import is present but carries nothing anyone could
 *  solve. Distinct from "no import", which is not this module's problem. */
function importIsEmpty(groups: unknown): boolean {
  if (!Array.isArray(groups) || groups.length === 0) return true;
  return groups.every((g) => {
    const scrambles = (g as ScrambleGroup | undefined)?.scrambles;
    return !Array.isArray(scrambles) || !scrambles.some(usable);
  });
}

/** Everyone who would be expected to solve this round.
 *
 *  EXPORTED because the group seeder assigns exactly this set. Two
 *  answers to "who is in this round" would mean a seeder that assigns a
 *  set the round-start check then disagrees with — a round that refuses
 *  to open immediately after being auto-assigned.
 *
 *  Round 1 is everyone registered and competing in this event. LATER
 *  ROUNDS ARE NOT: they are gated on the previous round's qualifiers doc
 *  (see resolveRoundAccess), so an athlete who did not advance cannot
 *  attempt round 2 and has no business holding its start up. Checking
 *  every registrant instead would make round 2 un-openable the moment
 *  anybody was eliminated, which is every round 2 there has ever been. */
export async function eligibleAthletesForRound(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<UnassignedAthlete[]> {
  const registered = (await fetchScrambleRoster(db, competitionId))
    .filter((a) => a.events.includes(eventId))
    .map((a) => ({ uid: a.uid, displayName: a.displayName }));

  if (round <= 1) return registered;

  const qualSnap = await db
    .collection('onlineCompetitions')
    .doc(competitionId)
    .collection('qualifiers')
    .doc(roundKey(eventId, round - 1))
    .get();
  const uids = qualSnap.get('uids');
  // openRound has already refused a round 2+ whose qualifiers doc is
  // missing, so this is only reached with a real one. An unreadable
  // `uids` means nobody qualified, which is an empty round rather than a
  // broken one.
  const qualified = new Set(Array.isArray(uids) ? uids.filter((u) => typeof u === 'string') : []);
  return registered.filter((a) => qualified.has(a.uid));
}

/** Whether this round can be opened, and if not, what the admin must fix.
 *
 *  Reads the two scramble documents ONCE and applies the same rule the
 *  scramble route applies per request (resolveOfficialScramble), so the
 *  answer here and the answer an athlete gets mid-round cannot disagree. */
export async function roundScrambleReadiness(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<RoundScrambleReadiness> {
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const key = roundKey(eventId, round);

  const [scrambleSnap, assignSnap] = await Promise.all([
    compRef.collection('scrambleData').doc(key).get(),
    compRef.collection('groupAssignments').doc(key).get(),
  ]);

  // THE SAME QUESTION lookupGroupScramble ASKS, and deliberately not a
  // rule of this module's own. A round with no imported scrambles runs on
  // random generation, has no groups by definition, and must open exactly
  // as it always has — a check that blocked it would lock every club
  // competition that doesn't use WCA imports out of its own rounds.
  if (!scrambleSnap.exists) return { ok: true, mode: 'random' };

  const groups = scrambleSnap.get('groups');
  if (importIsEmpty(groups)) return { ok: false, reason: 'no-scrambles' };

  const assignments = assignSnap.exists ? (assignSnap.get('assignments') ?? {}) : undefined;
  const athletes = await eligibleAthletesForRound(db, competitionId, eventId, round);

  // Attempt 1: the one every athlete in the round will ask for, and the
  // minimum that has to exist for them to begin. A group short of LATER
  // attempts is caught by the route's out-of-range refusal rather than
  // being guessed at here, since the round's attempt count is the
  // format's business and not this check's.
  const unassigned = athletes.filter(
    (a) => !('scramble' in resolveOfficialScramble({ groups, assignments, uid: a.uid, attempt: 1 })),
  );

  if (unassigned.length > 0) return { ok: false, reason: 'unassigned', athletes: unassigned };
  return { ok: true, mode: 'official', checked: athletes.length };
}

/** The admin-facing wording for a refusal. Kept beside the check so the
 *  two cannot drift, and so the route stays a pass-through. */
export const ROUND_READINESS_MESSAGE = {
  'no-scrambles': 'Энэ раундад холилт оруулаагүй байна.',
  unassigned:
    'Дараах тамирчид группэд хуваарилагдаагүй байна. Хуваарилсны дараа раунд эхэлнэ.',
} as const;
