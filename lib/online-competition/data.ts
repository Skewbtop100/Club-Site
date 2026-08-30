import {
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  addDoc,
  collection,
} from 'firebase/firestore';
import { onlineCompDb } from './firebase';
import type {
  OnlineCompetition,
  OnlineCompetitionEventConfig,
  OnlineCompetitionScramble,
  OnlineCompetitionStatus,
  OnlineParticipant,
  OnlineRegistration,
  OnlineSeasonAthletePoints,
  NextEventRound,
} from './types';

const RETENTION_DAYS = 14;

const VALID_STATUSES: OnlineCompetitionStatus[] = ['upcoming', 'live', 'finished'];

// Client-safe duplicate of admin-competitions.ts's normalizeCompetitionStatus
// — that one can't be imported here since it pulls in 'firebase-admin/
// firestore', which is Node-only and would break the client bundle. Docs
// created before the Phase 1 schema migration (e.g. test-comp-1) may still
// carry the old 'upcoming' | 'active' | 'closed' shape; the hub groups
// competitions strictly by the new enum, so an unnormalized legacy value
// would silently fall into no group at all.
function normalizeStatus(raw: unknown): OnlineCompetitionStatus {
  if (typeof raw === 'string' && VALID_STATUSES.includes(raw as OnlineCompetitionStatus)) {
    return raw as OnlineCompetitionStatus;
  }
  if (raw === 'active') return 'live';
  if (raw === 'closed') return 'finished';
  return 'upcoming';
}

// `events` used to be a plain string[] before the Phase 1 schema update
// added { eventId, label, rounds } objects. Firestore reads aren't
// runtime-validated against the type, so a doc created before that
// migration (e.g. the original test-comp-1 seed) still has the old shape
// — every consumer (hub groups, detail page, registration panel) assumes
// the new object shape and calls `.eventId`/`.rounds` directly, so this
// normalizes once here rather than making every call site defensive.
function normalizeEvents(raw: unknown): OnlineCompetitionEventConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionEventConfig[] = [];
  for (const e of raw) {
    if (typeof e === 'string') {
      out.push({ eventId: e, label: e.toUpperCase(), rounds: 1 });
    } else if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).eventId === 'string') {
      const obj = e as Partial<OnlineCompetitionEventConfig>;
      out.push({
        eventId: obj.eventId as string,
        label: typeof obj.label === 'string' ? obj.label : (obj.eventId as string).toUpperCase(),
        rounds: typeof obj.rounds === 'number' && obj.rounds > 0 ? obj.rounds : 1,
      });
    }
  }
  return out;
}

export async function fetchCompetition(competitionId: string): Promise<OnlineCompetition | null> {
  const snap = await getDoc(doc(onlineCompDb, 'onlineCompetitions', competitionId));
  if (!snap.exists()) return null;
  const data = snap.data() as Omit<OnlineCompetition, 'id'>;
  return { id: snap.id, ...data, status: normalizeStatus(data.status), events: normalizeEvents(data.events) };
}

// Public read (Firestore rules: `allow read: if true` on onlineCompetitions)
// for the hub page — every competition, grouped by status client-side. No
// server-side sort here since older docs may lack `createdAt` entirely
// (see the admin list route's identical reasoning) and Firestore would
// silently drop them from an orderBy query.
export async function fetchAllCompetitions(): Promise<OnlineCompetition[]> {
  const snap = await getDocs(collection(onlineCompDb, 'onlineCompetitions'));
  return snap.docs.map((d) => {
    const data = d.data() as Omit<OnlineCompetition, 'id'>;
    return { id: d.id, ...data, status: normalizeStatus(data.status), events: normalizeEvents(data.events) };
  });
}

// Public read for the hub's "ОНООНЫ ХҮСНЭГТ" section — points are
// recomputed by an admin action (lib/online-competition/seasonPoints.ts),
// not live-aggregated here. Empty array (not an error) if the season has
// no computed points yet, e.g. right after it's created.
export async function fetchSeasonLeaderboard(season: string, count = 10): Promise<OnlineSeasonAthletePoints[]> {
  const snap = await getDocs(
    query(
      collection(onlineCompDb, 'onlineSeasonPoints', season, 'athletes'),
      orderBy('totalPoints', 'desc'),
      limit(count),
    ),
  );
  return snap.docs.map((d) => d.data() as OnlineSeasonAthletePoints);
}

// ── STUB: next event/round selection ────────────────────────────────────
// Full round-progression logic (multiple rounds per event, cutoffs, moving
// on only once a submission is judged, etc.) doesn't exist yet. For now
// this always sends every participant to the competition's first
// configured event, round 1, so the rest of the page has something
// concrete to render end-to-end.
//
// A real implementation should look at this participant's history in
// `onlineSubmissions` for this competitionId (which events/rounds already
// have a pending/approved submission) and the competition's configured
// event/round order to decide what's next — and probably return `null`
// once every event is done.
export function getNextEventRound(competition: OnlineCompetition): NextEventRound {
  // `competition.events` is always the normalized { eventId, label, rounds }
  // shape by the time it gets here — fetchCompetition() normalizes legacy
  // string[] docs (see normalizeEvents in this file) before returning.
  return { event: competition.events[0]?.eventId ?? '333', round: 1 };
}

function scrambleDocId(event: string, round: number): string {
  return `${event}_r${round}`;
}

// Fetches the stored scramble for this event/round, generating and storing
// one via the server route if it doesn't exist yet. Uses a transaction so
// two participants hitting an unset scramble at the same moment still end
// up sharing a single, fair scramble rather than each generating their own.
export async function getOrCreateScramble(
  competitionId: string,
  event: string,
  round: number,
): Promise<string> {
  const ref = doc(
    onlineCompDb,
    'onlineCompetitions',
    competitionId,
    'scrambles',
    scrambleDocId(event, round),
  );

  const existing = await getDoc(ref);
  if (existing.exists()) {
    return (existing.data() as OnlineCompetitionScramble).scramble;
  }

  const res = await fetch(`/api/online-competition/scramble?event=${encodeURIComponent(event)}`);
  if (!res.ok) throw new Error('Scramble generation failed');
  const { scramble } = (await res.json()) as { scramble: string };

  return runTransaction(onlineCompDb, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      return (snap.data() as OnlineCompetitionScramble).scramble;
    }
    tx.set(ref, { event, round, scramble, createdAt: serverTimestamp() });
    return scramble;
  });
}

export async function upsertParticipant(uid: string, displayName: string): Promise<void> {
  await setDoc(
    doc(onlineCompDb, 'onlineParticipants', uid),
    { uid, displayName, createdAt: serverTimestamp() },
    { merge: true },
  );
}

// Separate from upsertParticipant() above (used by the solve page's
// anonymous-auth nickname step) rather than widening that function's
// signature — this keeps that page's only call site untouched, since it's
// deliberately not being migrated to Google auth this turn. Called from
// useOnlineAuth.tsx whenever onAuthStateChanged reports a non-anonymous
// (Google) user, so onlineParticipants stays in sync with their current
// Google profile.
export async function upsertGoogleParticipant(profile: {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
}): Promise<void> {
  await setDoc(
    doc(onlineCompDb, 'onlineParticipants', profile.uid),
    {
      uid: profile.uid,
      displayName: profile.displayName ?? 'Тамирчин',
      photoURL: profile.photoURL,
      email: profile.email,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function fetchParticipant(uid: string): Promise<OnlineParticipant | null> {
  const snap = await getDoc(doc(onlineCompDb, 'onlineParticipants', uid));
  if (!snap.exists()) return null;
  return snap.data() as OnlineParticipant;
}

function registrationRef(uid: string, competitionId: string) {
  return doc(onlineCompDb, 'onlineParticipants', uid, 'registrations', competitionId);
}

// Plain setDoc (no merge) — the doc ID is the competitionId, so
// re-registering for the same competition overwrites the previous
// selection wholesale rather than merging stale array entries into it.
export async function registerForCompetition(
  uid: string,
  competitionId: string,
  eventIds: string[],
): Promise<void> {
  await setDoc(registrationRef(uid, competitionId), {
    competitionId,
    events: eventIds,
    registeredAt: serverTimestamp(),
    status: 'registered',
  });
}

export async function fetchRegistration(uid: string, competitionId: string): Promise<OnlineRegistration | null> {
  const snap = await getDoc(registrationRef(uid, competitionId));
  if (!snap.exists()) return null;
  return snap.data() as OnlineRegistration;
}

// For the "Миний тэмцээнүүд" dashboard — every competition this user has
// ever registered for, regardless of that competition's current status
// (the dashboard splits live/upcoming/finished itself).
export async function fetchMyRegistrations(uid: string): Promise<OnlineRegistration[]> {
  const snap = await getDocs(collection(onlineCompDb, 'onlineParticipants', uid, 'registrations'));
  return snap.docs.map((d) => d.data() as OnlineRegistration);
}

export async function createSubmission(input: {
  competitionId: string;
  uid: string;
  event: string;
  round: number;
  videoUrl: string;
  cloudinaryPublicId: string;
  reportedTime: number;
  /** Self-reported DNF (Phase 5's manual keypad entry) — optional so the
   *  original solve page's call site (which never reports DNF) is
   *  unaffected. */
  isDnf?: boolean;
}): Promise<string> {
  const retentionExpiresAt = Timestamp.fromMillis(
    Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const docRef = await addDoc(collection(onlineCompDb, 'onlineSubmissions'), {
    competitionId: input.competitionId,
    uid: input.uid,
    event: input.event,
    round: input.round,
    videoUrl: input.videoUrl,
    cloudinaryPublicId: input.cloudinaryPublicId,
    reportedTime: input.reportedTime,
    isDnf: input.isDnf ?? false,
    penalty: null,
    status: 'pending',
    createdAt: serverTimestamp(),
    retentionExpiresAt,
  });
  return docRef.id;
}

// Where the computed Ao5 lives: nested on the athlete's OWN registration
// doc (onlineParticipants/{uid}/registrations/{competitionId}), under
// results.{eventId} — not a 6th onlineSubmissions doc or a new top-level
// collection. Reasoning: the Ao5 is a derived-from-this-athlete's-own-5-
// attempts value, and the registration doc is already the natural home
// for "this athlete's status for this competition" (the dashboard already
// reads it) — a separate collection would just be another round-trip for
// data that's 1:1 with an existing doc. Uses setDoc's `mergeFields`
// option (a dot-path merge, not a plain merge:true) so writing one
// event's result can't clobber a sibling event's
// `results.{otherEventId}` already stored there, and so the existing
// onlineParticipants/{uid}/registrations rule (which only re-validates
// competitionId/events on the resulting doc) is unaffected by this
// additional field.
export async function recordAo5Result(
  uid: string,
  competitionId: string,
  eventId: string,
  result: { ao5: number | null; attempts: (number | 'DNF')[] },
): Promise<void> {
  await setDoc(
    registrationRef(uid, competitionId),
    {
      results: {
        [eventId]: {
          ao5: result.ao5,
          attempts: result.attempts,
          submittedAt: serverTimestamp(),
        },
      },
    },
    { mergeFields: [`results.${eventId}`] },
  );
}
