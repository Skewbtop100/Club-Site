// ── Which scramble an athlete is officially owed ──────────────────────
// Server-only (Admin SDK reads). Split out of the scramble route so the
// decision can be tested directly against the emulator rather than only
// through a Next handler that also wants next/server and cstimer.
//
// It answers one question — "does this athlete have an official scramble
// for this attempt, and if not, why not" — and the WHY is what the route
// acts on: no import at all means random generation is correct, while no
// group inside a round that HAS an import means the athlete must be
// refused rather than served something no judge can verify.

import type { Firestore } from 'firebase-admin/firestore';
import { roundKey, type ScrambleGroup } from './scrambles';

/** Looks up the athlete's official scramble; null means "fall back". */
export type GroupScrambleLookup =
  | { scramble: string; groupLabel: string }
  /** The athlete HAS an official group, but asked for an attempt beyond
   *  the scrambles it holds — refuse rather than silently going random. */
  | { outOfRange: true; max: number }
  /** THIS ROUND RUNS ON OFFICIAL SCRAMBLES AND THIS ATHLETE HAS NONE.
   *  Not in a group, no assignments imported yet, or the imported data
   *  cannot produce their scramble.
   *
   *  Distinct from null, and the distinction is the whole point. Both
   *  used to be null, so both fell through to random generation — and an
   *  ungrouped athlete in an official round would record five attempts
   *  against a scramble nobody else had and no judge could check them
   *  against. The video is fine, the time is fine, and the attempt is
   *  unjudgeable, which is only discovered at review. Refused instead. */
  | { noGroup: true }
  /** No official scramble applies to anyone here — this event+round never
   *  had scrambles imported, so random generation is the correct answer
   *  and always has been. This is the ordinary mode for a club
   *  competition that doesn't use WCA imports. */
  | null;

/** The rule itself, given the two documents' contents and nothing else.
 *
 *  SEPARATED FROM THE READS so that the admin's round-start check can
 *  apply the SAME rule to every registered athlete from one pair of
 *  document reads, instead of asking Firestore the same two questions
 *  once per athlete — and, more importantly, instead of growing a second
 *  opinion about what "this athlete has an official scramble" means. Two
 *  such opinions would drift, and the drift would show up as a round that
 *  starts cleanly and then refuses somebody mid-competition.
 *
 *  Never returns null: "this round has no import at all" is a fact about
 *  the DOCUMENT, not about the athlete, so it belongs to the caller. */
export function resolveOfficialScramble(params: {
  /** scrambleData/{event}_{round}.groups, unvalidated. */
  groups: unknown;
  /** groupAssignments/{event}_{round}.assignments, or undefined when that
   *  document does not exist at all. */
  assignments: unknown;
  uid: string;
  attempt: number;
}): Exclude<GroupScrambleLookup, null> {
  const { groups, assignments, uid, attempt } = params;

  if (typeof assignments !== 'object' || assignments === null) {
    return { noGroup: true as const };
  }

  const groupIndex = (assignments as Record<string, unknown>)[uid];
  if (typeof groupIndex !== 'number') return { noGroup: true as const };

  if (!Array.isArray(groups)) return { noGroup: true as const };
  const group = groups[groupIndex] as ScrambleGroup | undefined;
  if (!group || !Array.isArray(group.scrambles)) return { noGroup: true as const };

  // OUT OF RANGE IS AN ERROR, NOT A FALLBACK. This group has a definite
  // number of scrambles; an attempt beyond it means the caller and the
  // imported data disagree about the round's shape. Falling through to
  // random cstimer generation would hand the athlete an UNOFFICIAL
  // scramble in an official round, silently. With a fixed 5 that was
  // nearly unreachable; with per-event formats an off-by-one is a real
  // possibility, so it is surfaced instead.
  if (attempt > group.scrambles.length) {
    return { outOfRange: true as const, max: group.scrambles.length };
  }

  // Present in the array but unusable — a blank or non-string entry from
  // a malformed import. Same reasoning as out-of-range: this athlete has
  // no official scramble for this attempt, and inventing one silently is
  // the outcome being prevented.
  const scramble = group.scrambles[attempt - 1];
  if (typeof scramble !== 'string' || scramble.trim() === '') return { noGroup: true as const };

  return { scramble, groupLabel: group.label ?? '' };
}

export async function lookupGroupScramble(
  db: Firestore,
  params: {
    competitionId: string;
    eventId: string;
    round: number;
    uid: string;
    attempt: number;
  },
): Promise<GroupScrambleLookup> {
  const { competitionId, eventId, round, uid, attempt } = params;
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const key = roundKey(eventId, round);

  const [scrambleSnap, assignSnap] = await Promise.all([
    compRef.collection('scrambleData').doc(key).get(),
    compRef.collection('groupAssignments').doc(key).get(),
  ]);
  // THE ONE QUESTION THAT DECIDES WHICH KIND OF ROUND THIS IS. With no
  // imported scrambles for this event+round, nobody has a group and
  // random generation is right for everyone — the ordinary club setup.
  // Past this line the round is official, and from here every failure is
  // a refusal rather than a fallback: handing this athlete a random
  // scramble in a round everyone else is solving officially produces an
  // attempt no judge can check.
  //
  // The admin's round-start precondition asks this same question the same
  // way (see roundScrambleReadiness) rather than inventing its own test
  // for "is this an official round".
  if (!scrambleSnap.exists) return null;

  return resolveOfficialScramble({
    groups: scrambleSnap.get('groups'),
    assignments: assignSnap.exists ? (assignSnap.get('assignments') ?? {}) : undefined,
    uid,
    attempt,
  });
}
