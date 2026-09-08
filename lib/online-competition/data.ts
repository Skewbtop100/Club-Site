import {
  doc,
  getDoc,
  waitForPendingWrites,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  setDoc,
  Timestamp,
  addDoc,
  collection,
} from 'firebase/firestore';
import { onlineCompDb } from './firebase';
import type {
  OnlineCompetition,
  OnlineCompetitionEventConfig,
  OnlineCompetitionStatus,
  OnlineParticipant,
  OnlineParticipantProfileInput,
  OnlineParticipantProfileStatus,
  OnlineRegistration,
  OnlineSeasonAthletePoints,
  OnlineSubmission,
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

// Called from useOnlineAuth.tsx whenever onAuthStateChanged reports a
// non-anonymous (Google) user, so onlineParticipants stays in sync with
// their current Google profile.
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

// Reads from the SERVER, not getDoc()'s cache-or-server path, and that is
// load-bearing rather than a preference.
//
// OnlineAuthProvider fires upsertGoogleParticipant() from inside
// onAuthStateChanged without awaiting it, and every caller of this
// function runs off that same auth change — so the read races the write.
// While that setDoc(..., { merge: true }) is still pending and the SDK has
// no cached server copy of the doc, getDoc() resolves against the local
// mutation queue and returns a document consisting ONLY of the five fields
// the upsert writes (displayName/email/photoURL/uid/createdAt, the last
// one null because serverTimestamp() hasn't resolved). profileStatus is
// absent from that view, so resolveProfileStatus() reports 'incomplete'
// for an athlete who is actually approved — which showed up as the profile
// page offering a blank form to an approved athlete, and would equally
// make RegistrationPanel's gate bounce an approved athlete to the profile
// form. Confirmed live: the client saw exactly those five keys while the
// Admin SDK read profileStatus: 'approved' from the same document.
export async function fetchParticipant(uid: string): Promise<OnlineParticipant | null> {
  // Let any in-flight local mutation settle before reading. A server read
  // is NOT enough on its own: Firestore layers pending local writes over
  // every snapshot it hands back, including getDocFromServer()'s.
  // Bounded so an offline client still falls through to a read (which will
  // throw and surface as the caller's normal load error) instead of hanging.
  await Promise.race([
    waitForPendingWrites(onlineCompDb),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  const snap = await getDoc(doc(onlineCompDb, 'onlineParticipants', uid));
  if (!snap.exists()) return null;
  return snap.data() as OnlineParticipant;
}

// A participant doc created only via upsertGoogleParticipant (i.e. every
// athlete who has signed in but never opened the profile form) has no
// `profileStatus` field at all — treated as 'incomplete' here rather than
// writing that value onto every doc on sign-in, same reasoning as
// normalizeStatus()/normalizeEvents() above for legacy competition docs.
export function resolveProfileStatus(participant: OnlineParticipant | null): OnlineParticipantProfileStatus {
  return participant?.profileStatus ?? 'incomplete';
}

// Written by the athlete profile form (app/online-competition/profile) on
// submit — both the first-ever submission and a resubmission after
// rejection. Always moves profileStatus to 'pending'; approval/rejection
// only ever happen server-side via the Admin SDK (see
// app/api/online-competition/admin-athletes/[uid]/route.ts), which is also
// what the Firestore rules for this collection enforce (see the rules
// snippet in that route's file comment).
export async function submitParticipantProfile(uid: string, input: OnlineParticipantProfileInput): Promise<void> {
  await setDoc(
    doc(onlineCompDb, 'onlineParticipants', uid),
    {
      lastName: input.lastName,
      firstName: input.firstName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      citizenship: input.citizenship,
      photoUrl: input.photoUrl,
      photoPublicId: input.photoPublicId,
      profileStatus: 'pending',
      submittedAt: serverTimestamp(),
    },
    { merge: true },
  );
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

// The signed-in athlete's own submissions, for the dashboard's
// "СҮҮЛИЙН ТАЙЛАЛТУУД" list. Firestore rules only expose a submission to
// its owner (or an admin), and the uid equality filter is what makes the
// query provably safe under that rule.
//
// Deliberately no orderBy/limit in the query itself: ordering by createdAt
// alongside the uid filter needs a composite (uid, createdAt) index this
// project doesn't have, and an undeployed index throws FAILED_PRECONDITION
// at runtime. One athlete's submission count is small and bounded, so the
// sort and the cut happen here instead. If that ever stops being true, add
//   { "collectionGroup": "onlineSubmissions", "queryScope": "COLLECTION",
//     "fields": [ { "fieldPath": "uid", "order": "ASCENDING" },
//                 { "fieldPath": "createdAt", "order": "DESCENDING" } ] }
// to firestore.indexes.json and push the ordering into the query.
// One athlete's own season-points doc. The leaderboard query above only
// returns the top N, so the dashboard's "ОНОО" card needs a direct read —
// same collection, same public read rule.
export async function fetchAthleteSeasonPoints(
  season: string,
  uid: string,
): Promise<OnlineSeasonAthletePoints | null> {
  const snap = await getDoc(doc(onlineCompDb, 'onlineSeasonPoints', season, 'athletes', uid));
  if (!snap.exists()) return null;
  return snap.data() as OnlineSeasonAthletePoints;
}

export async function fetchMySubmissions(uid: string, count = 5): Promise<OnlineSubmission[]> {
  const snap = await getDocs(query(collection(onlineCompDb, 'onlineSubmissions'), where('uid', '==', uid)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<OnlineSubmission, 'id'>) }))
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
    .slice(0, count);
}

export async function createSubmission(input: {
  competitionId: string;
  uid: string;
  event: string;
  /** Attempt index 1-5 — see the field note in types.ts. */
  round: number;
  /** The competition round this run belongs to. REQUIRED (unlike the
   *  optional field on the stored doc, which is optional only for
   *  historical docs): the caller must resolve it once per run from the
   *  round-access gate rather than letting it default here, so the stored
   *  value can never disagree with the gate that admitted the athlete. */
  competitionRound: number;
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
    competitionRound: input.competitionRound,
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
