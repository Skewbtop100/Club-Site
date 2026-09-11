// ── The public athlete roster ───────────────────────────────────────────
// Pure — no Firestore, no React — so the three things that decide what the
// Тамирчид tab shows are unit-tested directly
// (tests/competition-fields/roster-view.test.cjs):
//   · which average an event's format even HAS
//   · what crosses the boundary into a public payload
//   · the ranking, and where the athletes with no result go
//
// WHAT THIS RANKS BY: each athlete's LIFETIME personal best, from the
// onlineParticipants[uid].stats rollup the admin points-recompute writes.
// Not results in this competition — nothing here reads onlineSubmissions
// or round-results, and the tab is therefore meaningful before the
// competition has started, which is the point of it.

import { attemptsForFormat, resolveResultFormat, type ResultFormat } from './ao5';

/** The per-event rollup, as stored. Only the two fields this reads. */
export interface RosterStats {
  pr?: number | null;
  ao5?: number | null;
  mo3?: number | null;
}

/** EXACTLY what the public route returns per athlete. Adding a field here
 *  publishes it to anyone on the internet; the test asserts the key list,
 *  so that has to be a decision rather than an accident.
 *
 *  Deliberately absent, all of which the ADMIN listing carries and this
 *  must not: note (its placeholder asks for a phone number), statusNote,
 *  email, dateOfBirth, citizenship, wcaId, registeredAt, updatedAt,
 *  results, status, and any photo — the mockup uses initials, so no image
 *  url crosses the boundary at all. */
export interface RosterAthlete {
  uid: string;
  /** The approved identity where there is one — see rosterName. */
  name: string;
  /** Precomputed so no client has to re-derive it from the name. */
  initials: string;
  /** eventId -> best single, centiseconds. Only events this athlete is
   *  registered for, and only where a result exists. */
  prByEvent: Record<string, number>;
  /** eventId -> the average this event's FORMAT produces. Absent for a
   *  bo-N event, which has no average at all. */
  avgByEvent: Record<string, number>;
  /** The events of THIS competition they are registered for. */
  events: string[];
}

/** WHICH AVERAGE AN EVENT HAS, derived from the format rather than named
 *  per event.
 *
 *  `ao5` and `mo3` are separate stored fields on purpose — a mean of 3
 *  with no dropped attempt is systematically slower than an Ao5, so they
 *  are not comparable — and a bo-N round produces no average at all.
 *  Reading `ao5` unconditionally would leave the ДУНДАЖ column
 *  permanently empty for an Mo3 event and silently mix two different
 *  numbers if it ever were populated.
 *
 *  DERIVED FROM attemptsForFormat, not from a list of format names: a new
 *  averaging format added to ao5.ts arrives here without an edit, and a
 *  format this does not know about degrades to "no average" rather than to
 *  the wrong one. bo1/bo2/bo3 are exactly the formats whose result is a
 *  single, which is what the attempt count cannot tell us — so the format
 *  name is used for the mapping and the attempt count is not consulted. */
export function averageFieldFor(format: ResultFormat): 'ao5' | 'mo3' | null {
  switch (format) {
    case 'ao5':
      return 'ao5';
    case 'mo3':
      return 'mo3';
    case 'bo1':
    case 'bo2':
    case 'bo3':
      return null;
  }
}

/** The average to publish for one event, or null when the event has none
 *  or the athlete has not set one. */
export function averageFor(stats: RosterStats | undefined, format: ResultFormat): number | null {
  const field = averageFieldFor(format);
  if (field === null || !stats) return null;
  const value = stats[field];
  return typeof value === 'number' ? value : null;
}

/** The name to publish: the ADMIN-APPROVED identity where the profile has
 *  been verified, else the self-entered one, else the Google display name.
 *  The same preference listCompetitionRegistrations uses, so the public
 *  roster and the admin review table never name the same athlete
 *  differently. */
export function rosterName(profile: {
  approvedLastName?: unknown;
  approvedFirstName?: unknown;
  lastName?: unknown;
  firstName?: unknown;
  displayName?: unknown;
}, uid: string): string {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const displayName = str(profile.displayName) ?? uid;
  const last = str(profile.approvedLastName) ?? str(profile.lastName);
  const first = str(profile.approvedFirstName) ?? str(profile.firstName);
  return last && first ? `${last} ${first}` : (first ?? last ?? displayName);
}

/** Up to two letters, uppercased — the avatar, since no photo is
 *  published. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** One athlete's public row, built from their registration and profile.
 *
 *  THE WHITELIST IS HERE, and it is a construction rather than a deletion:
 *  the returned object is assembled field by field, so a field added to
 *  the stored profile or registration cannot arrive in the payload by
 *  being carried along. */
export function toRosterAthlete(input: {
  uid: string;
  profile: Record<string, unknown>;
  /** The events of this competition the athlete is registered for. */
  events: string[];
  /** eventId -> resultFormat, from the competition's own configuration. */
  formatByEvent: Record<string, ResultFormat>;
}): RosterAthlete {
  const name = rosterName(input.profile as Parameters<typeof rosterName>[0], input.uid);
  const stats = (input.profile.stats ?? {}) as Record<string, RosterStats | undefined>;

  const prByEvent: Record<string, number> = {};
  const avgByEvent: Record<string, number> = {};
  for (const eventId of input.events) {
    const forEvent = stats[eventId];
    const pr = forEvent?.pr;
    if (typeof pr === 'number') prByEvent[eventId] = pr;
    const avg = averageFor(forEvent, input.formatByEvent[eventId] ?? resolveResultFormat(undefined));
    if (avg !== null) avgByEvent[eventId] = avg;
  }

  return { uid: input.uid, name, initials: initialsFor(name), prByEvent, avgByEvent, events: input.events };
}

export interface RosterRow {
  athlete: RosterAthlete;
  /** 1-based, or null for an athlete with no result in this event. */
  rank: number | null;
  pr: number | null;
  average: number | null;
}

/** The table, for one event.
 *
 *  · Athletes not registered for the event are OMITTED — they are not in
 *    it, and a roster of an event is not a roster of the competition.
 *  · Athletes WITH a personal best rank first, fastest to slowest.
 *  · Athletes WITHOUT one come last, unranked, showing "—". Not omitted:
 *    they are in the event and belong on its roster, and hiding them would
 *    erase every newcomer — the people most likely to be checking whether
 *    they are on the list.
 *  · The unranked tail is sorted BY NAME, deliberately not by registration
 *    order: the order athletes registered in is not otherwise public, and
 *    a list that quietly encodes it is a leak nobody would think to look
 *    for. uid breaks a tie between identical names.
 *  · Equal personal bests keep a stable order by name, so two athletes on
 *    the same time are not shuffled between page loads. */
export function rankRoster(athletes: RosterAthlete[], eventId: string): RosterRow[] {
  const byName = (a: RosterAthlete, b: RosterAthlete) =>
    a.name.localeCompare(b.name, 'mn') || a.uid.localeCompare(b.uid);

  const inEvent = athletes.filter((a) => a.events.includes(eventId));
  const ranked = inEvent
    .filter((a) => typeof a.prByEvent[eventId] === 'number')
    .sort((a, b) => a.prByEvent[eventId] - b.prByEvent[eventId] || byName(a, b));
  const unranked = inEvent.filter((a) => typeof a.prByEvent[eventId] !== 'number').sort(byName);

  return [
    ...ranked.map((athlete, i) => ({
      athlete,
      rank: i + 1,
      pr: athlete.prByEvent[eventId],
      average: athlete.avgByEvent[eventId] ?? null,
    })),
    ...unranked.map((athlete) => ({
      athlete,
      rank: null,
      pr: null,
      // An athlete with no single cannot have an average, but read it
      // rather than assume: the two are computed independently.
      average: athlete.avgByEvent[eventId] ?? null,
    })),
  ];
}

/** Whether this event's format produces an average at all — what the
 *  ДУНДАЖ column header keys off, so a bo-N event does not show a column
 *  of dashes. */
export function eventHasAverage(format: ResultFormat): boolean {
  return averageFieldFor(format) !== null;
}

/** Guard against a format whose attempt count and average disagree. Not
 *  used at runtime; it exists so the test can assert the mapping stays in
 *  step with ao5.ts rather than restating it. */
export function attemptsFor(format: ResultFormat): number {
  return attemptsForFormat(format);
}
