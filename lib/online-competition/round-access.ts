import type { Firestore } from 'firebase-admin/firestore';
import { roundKey } from './scrambles';
import { fetchRoundStates } from './round-results';

// ── Who may attempt what, right now ─────────────────────────────────────
// Server-only. One implementation shared by the solve flow's scramble
// route (which enforces it) and the dashboard's round-access route (which
// only explains it), so an athlete can never be shown "Эхлүүлэх" for
// something the API would then refuse.

export type RoundAccessReason = 'ok' | 'no-live-round' | 'not-qualified';

export interface RoundAccess {
  /** The round currently live for this event, or null if none is. */
  liveRound: number | null;
  allowed: boolean;
  reason: RoundAccessReason;
}

export const ROUND_ACCESS_MESSAGE: Record<Exclude<RoundAccessReason, 'ok'>, string> = {
  'no-live-round': 'Энэ төрлийн раунд одоогоор нээлттэй биш байна.',
  'not-qualified': 'Та энэ раундад шалгараагүй байна.',
};

/** Lowest live round for the event. Only one round per event is expected
 *  to be live at a time (the admin page closes the previous one before
 *  opening the next), but taking the lowest keeps the answer deterministic
 *  if two ever are. */
function findLiveRound(
  states: Map<string, { status: string }>,
  eventId: string,
): number | null {
  let live: number | null = null;
  for (const [key, state] of states) {
    if (state.status !== 'live') continue;
    const sep = key.lastIndexOf('_');
    if (key.slice(0, sep) !== eventId) continue;
    const round = Number(key.slice(sep + 1));
    if (!Number.isFinite(round)) continue;
    if (live === null || round < live) live = round;
  }
  return live;
}

/** Resolves access for one athlete and event.
 *
 *  Round 1 has no prerequisite — any registered athlete may attempt it
 *  once it is live. Round 2+ requires the athlete's uid in the PREVIOUS
 *  round's qualifiers doc; a missing doc means nobody has been advanced
 *  yet, so nobody qualifies. */
export async function resolveRoundAccess(
  db: Firestore,
  competitionId: string,
  eventId: string,
  uid: string,
  statesCache?: Map<string, { status: string; openedAt: number | null }>,
): Promise<RoundAccess> {
  const states = statesCache ?? (await fetchRoundStates(db, competitionId));
  const liveRound = findLiveRound(states, eventId);
  if (liveRound === null) {
    return { liveRound: null, allowed: false, reason: 'no-live-round' };
  }
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
