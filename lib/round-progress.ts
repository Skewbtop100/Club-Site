// Where a club athlete stands in a competition event, round by round —
// shared by the results-entry panel (admin and /judge) and by Mark Round
// Complete (CompResultsTab). Pure, so scripts/test-round-progress.ts can
// check it without Firebase.
//
//  - An athlete enters results only for events they are registered for
//    (competition.athletes[].events).
//  - Only their CURRENT round is open: round 1 until they have a result in
//    it; round N+1 once round N is marked complete AND they advanced into
//    it (a next-round row exists — the placeholder Mark Round Complete
//    creates). Every other round is locked, finished ones included.
//  - Mark Round Complete first lists the club athletes who should have
//    competed in the round but have no result; each is resolved by going
//    back to enter it, or by marking them DNS (buildDnsResult).
//
// firestore.rules enforces the same round gating for a judge's writes.

import { DNS_VALUE } from './results-entry-helpers';
import type { Competition, Result } from './types';

type CompLite = Pick<Competition, 'id'> &
  Partial<Pick<Competition, 'name' | 'events' | 'athletes' | 'eventConfig' | 'roundStatus'>>;
type ResLite = Pick<Result, 'athleteId' | 'eventId'> &
  Partial<Pick<Result, 'competitionId' | 'round' | 'isPlaceholder' | 'source' | 'status'>>;

/** roundStatus key of an event round: "333_r2". */
export const roundKey = (eventId: string, round: number) => `${eventId}_r${round}`;

export function isRoundComplete(comp: CompLite, eventId: string, round: number): boolean {
  return comp.roundStatus?.[roundKey(eventId, round)] === 'complete';
}

export function totalRounds(comp: CompLite, eventId: string): number {
  return Math.max(1, comp.eventConfig?.[eventId]?.rounds ?? 1);
}

/** Imported rows (pasted / staged WCA results) are never club athletes. */
function isImported(r: ResLite): boolean {
  return r.source === 'imported' || r.source === 'import';
}

/**
 * The events to offer for an athlete, in `eventOrder` (the competition's
 * events as the dropdown lists them). No athlete chosen yet, or a
 * competition without a roster: all of them. Otherwise only the events the
 * athlete is registered for — none if they are not on the roster.
 */
export function athleteEventIds(comp: CompLite, athleteId: string, eventOrder: string[]): string[] {
  if (!athleteId || !comp.athletes) return eventOrder;
  const reg = comp.athletes.find(a => a.id === athleteId);
  if (!reg) return [];
  const mine = new Set(reg.events);
  return eventOrder.filter(id => mine.has(id));
}

/** Registered for the event (round 1's field). No roster = everyone. */
export function isRegisteredFor(comp: CompLite, athleteId: string, eventId: string): boolean {
  if (!comp.athletes) return true;
  return !!comp.athletes.find(a => a.id === athleteId)?.events.includes(eventId);
}

/** athleteId → eventId → true, from the roster. Written next to `athletes`
 *  (Competition.registrations) so firestore.rules can check it. */
export function registrationsMap(athletes: { id: string; events: string[] }[]): Record<string, Record<string, boolean>> {
  return Object.fromEntries(athletes.map(a => [a.id, Object.fromEntries(a.events.map(e => [e, true]))]));
}

export type RoundState =
  /** Results may be entered for this round, and only this one. */
  | { kind: 'open'; round: number }
  /** Not registered for the event at all. */
  | { kind: 'not-registered' }
  /** Has their result in `round`, which is not marked complete yet. */
  | { kind: 'waiting'; round: number }
  /** `round` is complete and they did not advance from it. */
  | { kind: 'not-advanced'; round: number }
  /** `round` was completed without a result from them. */
  | { kind: 'missed'; round: number }
  /** Has their result in the final round (`round`). */
  | { kind: 'finished'; round: number };

/**
 * The athlete's current round in one event of `comp`. `results` may hold
 * the whole competition (or more); only this athlete's rows of this event
 * are looked at.
 */
export function roundStateFor(comp: CompLite, results: ResLite[], athleteId: string, eventId: string): RoundState {
  const rows = results.filter(r =>
    r.athleteId === athleteId && r.eventId === eventId &&
    (r.competitionId === undefined || r.competitionId === comp.id));
  const total = totalRounds(comp, eventId);
  for (let round = 1; ; round++) {
    const inRound = rows.filter(r => (r.round || 1) === round);
    const qualified = round === 1 ? isRegisteredFor(comp, athleteId, eventId) || inRound.length > 0 : inRound.length > 0;
    if (!qualified) return round === 1 ? { kind: 'not-registered' } : { kind: 'not-advanced', round: round - 1 };
    const hasResult = inRound.some(r => !r.isPlaceholder);
    if (!hasResult) return isRoundComplete(comp, eventId, round) ? { kind: 'missed', round } : { kind: 'open', round };
    if (round >= total) return { kind: 'finished', round };
    if (!isRoundComplete(comp, eventId, round)) return { kind: 'waiting', round };
  }
}

/** The round open for entry, or null when every round is locked. */
export function openRound(state: RoundState): number | null {
  return state.kind === 'open' ? state.round : null;
}

/**
 * Club athletes who should compete in `eventId` round `round` but have no
 * result in it yet — what Mark Round Complete warns about. Round 1: everyone
 * registered for the event. Later rounds: club athletes who advanced into it
 * (have a row in it — the placeholder). Imported rows never count.
 * Athlete ids, in roster / ranking order.
 */
export function missingAthletes(comp: CompLite, results: ResLite[], eventId: string, round: number): string[] {
  const inRound = results.filter(r =>
    r.eventId === eventId && (r.round || 1) === round && !!r.athleteId && !isImported(r) &&
    (r.competitionId === undefined || r.competitionId === comp.id));
  const expected: string[] = round === 1
    ? (comp.athletes || []).filter(a => a.events.includes(eventId)).map(a => a.id)
    : [];
  for (const r of inRound) if (!expected.includes(r.athleteId)) expected.push(r.athleteId);
  const done = new Set(inRound.filter(r => !r.isPlaceholder).map(r => r.athleteId));
  return expected.filter(id => !done.has(id));
}

/** The deterministic result id of a club athlete's round (also the
 *  placeholder's) — firestore.rules requires this shape for judges. */
export function clubResultId(compId: string, eventId: string, round: number, athleteId: string): string {
  return `${compId}_${eventId}_r${round}_${athleteId}`;
}

/** A DNS result for a club athlete, replacing their placeholder (if any). */
export function buildDnsResult(
  comp: CompLite, eventId: string, round: number, athleteId: string, athleteName: string,
): { id: string; data: Omit<Result, 'id'> } {
  return {
    id: clubResultId(comp.id, eventId, round, athleteId),
    data: {
      athleteId, athleteName,
      competitionId: comp.id, competitionName: comp.name || '',
      eventId, round,
      single: DNS_VALUE, average: null,
      solves: [DNS_VALUE, DNS_VALUE, DNS_VALUE, DNS_VALUE, DNS_VALUE],
      status: 'published', source: 'entry', dns: true,
    },
  };
}
