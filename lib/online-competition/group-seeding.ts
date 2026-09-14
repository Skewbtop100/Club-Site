// ── Seeding athletes into scramble groups ──────────────────────────────
// Server-only (Admin SDK reads). Drives the admin's "assign everyone at
// once" action: work out each athlete's past form, order them by it, and
// deal them into the groups this round imported.
//
// ── WHY CONTIGUOUS BLOCKS ──
// Slowest and unseeded into group A, fastest into the last group, so
// athletes of similar speed share a scramble set.
//
// The alternative, which this replaced, is a snake seed (A,B,C,C,B,A...)
// that gives every group the same AVERAGE STRENGTH. That is the right
// answer when groups are heats measured against each other. This club
// runs every athlete inside one short window, so groups are not heats and
// there is nothing to balance — the grouping's only job is to put
// comparable athletes on identical scrambles. The snake seeder is gone
// rather than kept as an option; see the note at the foot of
// scrambles.ts.
//
// ── WHOSE RESULTS COUNT ──
// This platform's own judged submissions, and nothing else. The club
// site's virtualCompetitions/{id}/participantResults is a separate
// system with separate timing and separate judging, and is deliberately
// not read here — an athlete's club-site history is not their ХОРОМ form.

import type { Firestore } from 'firebase-admin/firestore';
import { effectiveAttemptTime } from './ao5';
import { normalizeCompetitionStatus } from './admin-competitions';

export interface SeededAthlete {
  uid: string;
  displayName: string;
  /** Best single approved time for this event, in centiseconds, across
   *  past FINISHED competitions. null = no past result, which is the
   *  ordinary state of a newcomer and never an error. */
  seedCs: number | null;
}

/** One athlete's place in a proposed assignment. */
export interface SeedPreviewEntry extends SeededAthlete {
  /** Where this proposal puts them. */
  groupIndex: number;
  /** Where they are now, or null if unassigned. */
  currentGroupIndex: number | null;
  /** True when applying this proposal would move them out of a group they
   *  are already in. The preview counts these so an admin can see the
   *  disruption before agreeing to it. */
  moved: boolean;
}

export interface SeedPreviewGroup {
  index: number;
  label: string;
  athletes: SeedPreviewEntry[];
}

export interface SeedPreview {
  groups: SeedPreviewGroup[];
  /** The map that would be written to groupAssignments.assignments. */
  assignments: Record<string, number>;
  /** How many eligible athletes already had a group before this. */
  alreadyAssigned: number;
  /** How many would change group if this were applied. Zero on a re-run
   *  over unchanged data — see the idempotency note on distributeIntoGroups. */
  moved: number;
  totalAthletes: number;
}

/** 'all' re-seeds everybody. 'unassigned' keeps every athlete who already
 *  has a group exactly where they are and places only the rest.
 *
 *  NO DEFAULT that silently overwrites: the route requires the admin to
 *  have picked one, because the two produce very different rounds and the
 *  difference is invisible afterwards. */
export type SeedScope = 'all' | 'unassigned';

// ── Seed values ────────────────────────────────────────────────────────

interface CompetitionRules {
  finished: boolean;
  timeLimitCs: number | null;
}

/** competitionId -> eventId -> what scoring this event ran under, plus
 *  whether the competition is over.
 *
 *  One read of onlineCompetitions rather than one per submission. The
 *  TIME LIMIT is why this exists at all: a past attempt's effective time
 *  depends on the limit its own competition set, so a seed computed
 *  without it would rank an over-limit solve as a real time. */
async function loadCompetitionRules(
  db: Firestore,
  eventId: string,
): Promise<Map<string, CompetitionRules>> {
  const snap = await db.collection('onlineCompetitions').select('events', 'status').get();
  const index = new Map<string, CompetitionRules>();
  for (const doc of snap.docs) {
    const events = doc.get('events');
    const entry = Array.isArray(events)
      ? (events as Record<string, unknown>[]).find((e) => e?.eventId === eventId)
      : undefined;
    index.set(doc.id, {
      finished: normalizeCompetitionStatus(doc.get('status')) === 'finished',
      timeLimitCs: typeof entry?.timeLimitCs === 'number' ? entry.timeLimitCs : null,
    });
  }
  return index;
}

/** Each athlete's best single for this event across past finished
 *  competitions.
 *
 *  ── WHAT IS DELIBERATELY EXCLUDED ──
 *  PENDING and REJECTED submissions. A pending attempt has not been
 *  judged, and seeding on it would let an athlete influence their own
 *  group by filing a fast time that a judge later throws out. A rejected
 *  attempt is not a time at all. effectiveAttemptTime maps both to 'DNF'
 *  on its own, and the query also filters to approved — belt and braces,
 *  because this is the property that makes the seed trustworthy.
 *
 *  THE COMPETITION BEING SEEDED, and any other unfinished one. Seeding a
 *  round on results from the competition it belongs to would rank
 *  athletes by how they have done so far in the event they are about to
 *  solve — and would change under them between two runs of the same
 *  action, which is the opposite of the stable ordering this is for.
 */
export async function fetchSeedTimes(
  db: Firestore,
  eventId: string,
  uids: string[],
  excludeCompetitionId: string,
): Promise<Map<string, number | null>> {
  const seeds = new Map<string, number | null>(uids.map((uid) => [uid, null]));
  if (uids.length === 0) return seeds;

  const wanted = new Set(uids);
  const [rules, snap] = await Promise.all([
    loadCompetitionRules(db, eventId),
    // Equality-only, so Firestore serves it from automatic single-field
    // indexes with no composite index to declare.
    db
      .collection('onlineSubmissions')
      .where('event', '==', eventId)
      .where('status', '==', 'approved')
      .get(),
  ]);

  for (const doc of snap.docs) {
    const d = doc.data();
    const uid = d.uid as string;
    if (!wanted.has(uid)) continue;

    const competitionId = d.competitionId as string;
    if (competitionId === excludeCompetitionId) continue;
    const rule = rules.get(competitionId);
    if (!rule?.finished) continue;

    const time = effectiveAttemptTime(
      {
        status: d.status,
        reportedTime: d.reportedTime,
        isDnf: d.isDnf,
        penalty: d.penalty ?? null,
      },
      rule.timeLimitCs,
    );
    if (typeof time !== 'number') continue;

    const prev = seeds.get(uid);
    if (prev === null || prev === undefined || time < prev) seeds.set(uid, time);
  }

  return seeds;
}

// ── Ordering and distribution ──────────────────────────────────────────

/** Fastest first, then everyone with no seed.
 *
 *  FULLY DETERMINISTIC, which is a requirement and not a nicety: uid
 *  breaks every tie, including the tie between two unseeded athletes, so
 *  running the seeder twice over unchanged data reproduces the same list
 *  rather than shuffling people between groups for no reason. */
export function orderBySeed(athletes: SeededAthlete[]): SeededAthlete[] {
  return [...athletes].sort((a, b) => {
    const aHas = a.seedCs !== null;
    const bHas = b.seedCs !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.seedCs !== b.seedCs) return (a.seedCs as number) - (b.seedCs as number);
    return a.uid.localeCompare(b.uid);
  });
}

/** Deals the ordered list into `groupCount` contiguous blocks.
 *
 *  DIRECTION: the list runs fastest → slowest → unseeded, and it is
 *  filled from the BACK, so the slowest and unseeded land in group A and
 *  the fastest in the last group. Newcomers therefore start in A
 *  together rather than being scattered among the quickest athletes in
 *  the competition.
 *
 *  SIZES: as even as the count allows, with the remainder going to the
 *  EARLIER groups — so eleven athletes across three groups are 4/4/3, and
 *  the group that takes the extra person is the one at the slow end.
 */
export function distributeIntoGroups(
  ordered: SeededAthlete[],
  groupCount: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (groupCount < 1) return out;

  // Slowest first: group A is filled from this end.
  const slowestFirst = [...ordered].reverse();
  const base = Math.floor(slowestFirst.length / groupCount);
  const remainder = slowestFirst.length % groupCount;

  let cursor = 0;
  for (let g = 0; g < groupCount; g++) {
    const size = base + (g < remainder ? 1 : 0);
    for (let i = 0; i < size; i++) {
      const athlete = slowestFirst[cursor++];
      if (athlete) out[athlete.uid] = g;
    }
  }
  return out;
}

/** The whole proposal: who goes where, what changes, and what is already
 *  settled. Pure — every read has happened by the time this is called, so
 *  the arithmetic is testable on its own.
 *
 *  Under 'unassigned', athletes who already have a group are pinned there
 *  and are NOT part of the ordering: only the newcomers are dealt out,
 *  into the same groups, so an admin can top up a round mid-registration
 *  without disturbing anybody already placed.
 */
export function buildSeedPreview(params: {
  athletes: SeededAthlete[];
  groupLabels: string[];
  current: Record<string, number>;
  scope: SeedScope;
}): SeedPreview {
  const { athletes, groupLabels, current, scope } = params;
  const groupCount = groupLabels.length;

  const isAssigned = (uid: string) => {
    const g = current[uid];
    return typeof g === 'number' && g >= 0 && g < groupCount;
  };

  const toPlace = scope === 'all' ? athletes : athletes.filter((a) => !isAssigned(a.uid));
  const placed = distributeIntoGroups(orderBySeed(toPlace), groupCount);

  const assignments: Record<string, number> = {};
  for (const a of athletes) {
    if (scope === 'unassigned' && isAssigned(a.uid)) assignments[a.uid] = current[a.uid];
    else if (a.uid in placed) assignments[a.uid] = placed[a.uid];
  }

  const groups: SeedPreviewGroup[] = groupLabels.map((label, index) => ({
    index,
    label,
    athletes: [],
  }));

  let moved = 0;
  for (const a of orderBySeed(athletes)) {
    const groupIndex = assignments[a.uid];
    if (typeof groupIndex !== 'number' || !groups[groupIndex]) continue;
    const currentGroupIndex = isAssigned(a.uid) ? current[a.uid] : null;
    const didMove = currentGroupIndex !== null && currentGroupIndex !== groupIndex;
    if (didMove) moved += 1;
    groups[groupIndex].athletes.push({
      ...a,
      groupIndex,
      currentGroupIndex,
      moved: didMove,
    });
  }

  return {
    groups,
    assignments,
    alreadyAssigned: athletes.filter((a) => isAssigned(a.uid)).length,
    moved,
    totalAthletes: athletes.length,
  };
}
