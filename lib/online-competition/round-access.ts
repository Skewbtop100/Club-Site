import type { Firestore } from 'firebase-admin/firestore';
import { roundKey } from './scrambles';
import { fetchRoundStates } from './round-results';

// ── Who may attempt what, right now ─────────────────────────────────────
// Server-only. One implementation shared by the solve flow's scramble
// route (which enforces it) and the dashboard's round-access route (which
// only explains it), so an athlete can never be shown "Эхлүүлэх" for
// something the API would then refuse.

export type RoundAccessReason = 'ok' | 'no-live-round' | 'not-qualified' | 'conflicting-live-rounds';

export interface RoundAccess {
  /** The ONE round live for this event — null if none is, and null if more
   *  than one is (see liveRoundsForEvent). */
  liveRound: number | null;
  allowed: boolean;
  reason: RoundAccessReason;
}

export const ROUND_ACCESS_MESSAGE: Record<Exclude<RoundAccessReason, 'ok'>, string> = {
  'no-live-round': 'Энэ төрлийн раунд одоогоор нээлттэй биш байна.',
  'not-qualified': 'Та энэ раундад шалгараагүй байна.',
  'conflicting-live-rounds':
    'Энэ төрөлд нэгээс олон раунд зэрэг нээлттэй байна. Зохион байгуулагч засах хүртэл түр хүлээнэ үү.',
};

/** Every live round of one event, ascending.
 *
 *  ── ONE LIVE ROUND PER EVENT ──
 *  Rounds of an event are sequential: round N+1 is defined by round N's
 *  cut, and the cut ends round N. So two live rounds of one event is never
 *  a legitimate state — it only arises by reopening an earlier round while
 *  a later one is open. openRound (round-open.ts) now refuses that.
 *
 *  This used to return just the LOWEST live round, "to keep the answer
 *  deterministic if two ever are". Deterministic, but wrong in exactly
 *  that case: reopening round 1 while round 2 was live handed round-2
 *  qualifiers round-1 scrambles and filed their attempts into round 1.
 *  Callers now see every live round, and resolveRoundAccess refuses when
 *  there is more than one — an ambiguous state admits nobody. */
export function liveRoundsForEvent(
  states: Iterable<[string, { status: unknown }]>,
  eventId: string,
): number[] {
  const out: number[] = [];
  for (const [key, state] of states) {
    if (state.status !== 'live') continue;
    const sep = key.lastIndexOf('_');
    if (key.slice(0, sep) !== eventId) continue;
    const round = Number(key.slice(sep + 1));
    if (!Number.isInteger(round) || round < 1) continue;
    out.push(round);
  }
  return out.sort((a, b) => a - b);
}

/** One configured event's live-round status. `liveRounds` empty is the
 *  state the admin UI warns about as a gap (every solve attempt refused
 *  with 'no-live-round'); more than one is a conflict (every attempt
 *  refused with 'conflicting-live-rounds'). */
export interface EventLiveRoundStatus {
  eventId: string;
  label: string;
  /** The single live round, or null when there are none or several. */
  liveRound: number | null;
  liveRounds: number[];
}

/** Live-round status for EVERY event a competition configures, in config
 *  order.
 *
 *  A thin fan-out over liveRoundsForEvent above — deliberately the same
 *  rule the solve gate enforces with, so the admin warning can never
 *  disagree with what an athlete actually experiences. One roundState read
 *  serves the whole competition. This asks nothing about qualification
 *  (there is no athlete here), which is the only reason it isn't just
 *  resolveRoundAccessForCompetition. */
export async function resolveEventLiveRounds(
  db: Firestore,
  competitionId: string,
): Promise<EventLiveRoundStatus[]> {
  const compSnap = await db.collection('onlineCompetitions').doc(competitionId).get();
  if (!compSnap.exists) return [];

  const events = compSnap.get('events');
  if (!Array.isArray(events)) return [];

  const states = await fetchRoundStates(db, competitionId);
  const out: EventLiveRoundStatus[] = [];
  for (const e of events) {
    const eventId = typeof e?.eventId === 'string' ? e.eventId : '';
    if (!eventId) continue;
    const liveRounds = liveRoundsForEvent(states, eventId);
    out.push({
      eventId,
      label: typeof e?.label === 'string' && e.label ? e.label : eventId.toUpperCase(),
      liveRound: liveRounds.length === 1 ? liveRounds[0] : null,
      liveRounds,
    });
  }
  return out;
}

/** Resolves access for one athlete and event.
 *
 *  Round 1 has no prerequisite — any registered athlete may attempt it
 *  once it is live. Round N ≥ 2 requires the athlete's uid in round N-1's
 *  qualifiers doc; a missing doc means nobody has been advanced yet, so
 *  nobody qualifies. More than one live round refuses everyone. */
export async function resolveRoundAccess(
  db: Firestore,
  competitionId: string,
  eventId: string,
  uid: string,
  statesCache?: Map<string, { status: string; openedAt: number | null }>,
): Promise<RoundAccess> {
  const states = statesCache ?? (await fetchRoundStates(db, competitionId));
  const liveRounds = liveRoundsForEvent(states, eventId);
  if (liveRounds.length === 0) {
    return { liveRound: null, allowed: false, reason: 'no-live-round' };
  }
  if (liveRounds.length > 1) {
    return { liveRound: null, allowed: false, reason: 'conflicting-live-rounds' };
  }
  const liveRound = liveRounds[0];
  if (liveRound <= 1) {
    return { liveRound, allowed: true, reason: 'ok' };
  }

  const snap = await db
    .collection('onlineCompetitions')
    .doc(competitionId)
    .collection('qualifiers')
    .doc(roundKey(eventId, liveRound - 1))
    .get();
  const uids = snap.get('uids');
  const qualified = Array.isArray(uids) && uids.includes(uid);
  return {
    liveRound,
    allowed: qualified,
    reason: qualified ? 'ok' : 'not-qualified',
  };
}

/** Same answer for every event the competition is configured for — one
 *  roundState read shared across them, for the dashboard. */
export async function resolveRoundAccessForCompetition(
  db: Firestore,
  competitionId: string,
  uid: string,
): Promise<Record<string, RoundAccess>> {
  const compSnap = await db.collection('onlineCompetitions').doc(competitionId).get();
  if (!compSnap.exists) return {};
  const events = compSnap.get('events');
  const eventIds = Array.isArray(events)
    ? events.map((e: { eventId?: unknown }) => e?.eventId).filter((e): e is string => typeof e === 'string')
    : [];

  const states = await fetchRoundStates(db, competitionId);
  const out: Record<string, RoundAccess> = {};
  for (const eventId of eventIds) {
    out[eventId] = await resolveRoundAccess(db, competitionId, eventId, uid, states);
  }
  return out;
}
