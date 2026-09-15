import {
  doc,
  getDoc,
  waitForPendingWrites,
  deleteField,
  getDocs,
  runTransaction,
  query,
  serverTimestamp,
  where,
  setDoc,
  Timestamp,
  collection,
} from 'firebase/firestore';
import { onlineCompDb } from './firebase';
import {
  normalizeStoredEvents,
  normalizeStoredSchedule,
  normalizeStoredSections,
} from './competition-shape';
import { RegistrationEditRefused, buildRegistrationWrite, normalizeStoredRegistration } from './registration-shape';
import { submissionDocId } from './submission-id';
import type { FiledAttempt } from './run-resume';
import type {
  OnlineCompetition,
  OnlineCompetitionStatus,
  OnlineParticipant,
  OnlineParticipantProfileInput,
  OnlineParticipantProfileStatus,
  OnlineRegistration,
  OnlineSubmission,
  SolveMarks,
} from './types';
import { SUBMISSION_RETENTION_MS } from './submission-retention';
import { resolveVerification, resubmissionStatuses, type ResubmissionStatuses } from './verification';

// Must list every member of OnlineCompetitionStatus — see the identical
// list (and the same warning) in admin-competitions.ts. Omitting 'draft'
// here would make normalizeStatus report a draft as 'upcoming'.
const VALID_STATUSES: OnlineCompetitionStatus[] = ['draft', 'upcoming', 'live', 'finished'];

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
  // Never 'draft' — same reasoning as the server-side twin in
  // admin-competitions.ts.
  return 'upcoming';
}

// Events, sections and schedule go through the SHARED normalisers in
// competition-shape.ts — the same functions the admin GET routes call.
//
// This file used to carry its own `normalizeEvents`, which rebuilt each
// event field by field and had never been taught `advancement` or
// `surchargeMnt`. Every public page therefore read every event as
// included in the base fee (so the detail page's НЭМЭЛТ ХУРААМЖ could
// never appear) and had no advancement plan to show. One reader now, so
// a field the admin can save is a field the public can see. The legacy
// string[] shape this function handled is handled there too.
//
// `sections` and `schedule` used to arrive here as the raw document
// spread, unnormalised; they are normalised now as well.

/** The one mapping from a raw competition document to the public shape,
 *  shared by both fetchers so they cannot disagree. */
function toPublicCompetition(id: string, data: Omit<OnlineCompetition, 'id'>): OnlineCompetition {
  return {
    id,
    ...data,
    status: normalizeStatus(data.status),
    events: normalizeStoredEvents(data.events),
    sections: normalizeStoredSections(data.sections),
    schedule: normalizeStoredSchedule(data.schedule),
  };
}

/** One competition, by id. Returns null both when the doc does not exist
 *  and when the rules refuse it — which, since drafts became unreadable to
 *  clients (firestore.rules: onlineCompetitions), is what a draft looks
 *  like from out here. Collapsing the two is deliberate: to a visitor a
 *  draft simply isn't a competition yet, and the detail page's "Тэмцээн
 *  олдсонгүй" is the honest answer. It also keeps the fan-out in
 *  fetchMyRegistrations working if a competition is ever moved BACK to
 *  draft — those rows drop out instead of failing the whole join.
 *
 *  Only 'permission-denied' is swallowed. Any other error (offline, a
 *  malformed id) still throws, so a real failure stays a visible load
 *  error rather than a silent empty page. */
export async function fetchCompetition(competitionId: string): Promise<OnlineCompetition | null> {
  let snap;
  try {
    snap = await getDoc(doc(onlineCompDb, 'onlineCompetitions', competitionId));
  } catch (err) {
    if ((err as { code?: string })?.code === 'permission-denied') return null;
    throw err;
  }
  if (!snap.exists()) return null;
  return toPublicCompetition(snap.id, snap.data() as Omit<OnlineCompetition, 'id'>);
}

// Public read for the hub and the competitions page — every NON-DRAFT
// competition, grouped by status client-side.
//
// The `status != 'draft'` filter is not a convenience, it is what makes
// this query legal. The matching rule (firestore.rules) refuses any doc
// whose status is 'draft', and Firestore only permits a list query it can
// prove returns nothing the rule would refuse — an unfiltered read of this
// collection is now rejected outright rather than silently filtered. The
// rules test suite pins both halves of that (tests/firestore-rules/
// competitions.test.mjs).
//
// `!=` rather than an `in` list of the allowed values: a legacy doc may
// still carry the pre-migration 'active'/'closed' strings (see
// normalizeStatus above), and an `in` list would have to enumerate those
// too or silently drop those competitions from the public site.
//
// KNOWN LIMITATION: an inequality filter matches only docs that HAVE the
// field, so a competition doc with no `status` at all would disappear from
// the public list. Every doc written by toFirestoreDoc has one, and the
// type declares it required, so this is theoretical — but it is the one
// behaviour that changed here beyond hiding drafts, and it cannot be
// avoided while the rule is enforced: a query covering field-less docs is
// not provably safe. Such a doc is still reachable by direct id
// (fetchCompetition), which the rule's `!('status' in resource.data)`
// clause explicitly allows.
//
// Still no server-side sort — older docs may lack `createdAt` entirely
// (see the admin list route's identical reasoning) and Firestore would
// silently drop them from an orderBy query.
export async function fetchAllCompetitions(): Promise<OnlineCompetition[]> {
  const snap = await getDocs(
    query(collection(onlineCompDb, 'onlineCompetitions'), where('status', '!=', 'draft')),
  );
  return snap.docs.map((d) => toPublicCompetition(d.id, d.data() as Omit<OnlineCompetition, 'id'>));
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
// normalizeStatus() above and the shared event normaliser for legacy
// competition docs.
//
// Derived from the two verification parts (verification.ts): 'approved'
// only when details AND photo are both approved.
export function resolveProfileStatus(participant: OnlineParticipant | null): OnlineParticipantProfileStatus {
  return resolveVerification(participant).status;
}

/** Which image represents an athlete, everywhere in this feature.
 *
 *  Approved → the APPROVED photo (types.ts calls it the official one — it
 *  is the snapshot an admin actually reviewed), falling back to the latest
 *  submitted one. Not approved → the submitted photo. Neither → null, and
 *  the caller renders its initials block.
 *
 *  Deliberately NOT the Google avatar: that is whatever picture is on the
 *  athlete's Gmail account, which a judge has never seen and which the
 *  athlete can change at will.
 *
 *  One implementation, called by every surface. Two surfaces disagreeing
 *  about which photo is official means the same athlete shows up with two
 *  different faces. The one deliberate exception is the admin's PENDING
 *  review list, which shows photoUrl only — it is reviewing the newly
 *  submitted photo, so the approved one would defeat the purpose.
 *
 *  Structurally typed rather than taking OnlineParticipant, so the admin
 *  view (OnlineParticipantAdminView) can pass itself in unchanged. */
export function resolveParticipantPhoto(
  participant:
    | {
        profileStatus?: OnlineParticipantProfileStatus | null;
        photoStatus?: string | null;
        approvedPhotoUrl?: string | null;
        photoUrl?: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!participant) return null;
  // The PHOTO part, not the whole profile: a photo approved while the
  // details are re-reviewed is still the official one.
  if (resolveVerification(participant).photo.status === 'approved') {
    return participant.approvedPhotoUrl ?? participant.photoUrl ?? null;
  }
  return participant.photoUrl ?? null;
}

// Written by the athlete profile form (app/online-competition/profile) on
// submit — the first submission, a resubmission after rejection, and an
// approved athlete's edit. Approval/rejection only ever happen server-side
// via the Admin SDK (app/api/online-competition/admin-athletes/[uid]/route.ts),
// which is also what the Firestore rules for this collection enforce.
//
// Each verification part is decided on its own (resubmissionStatuses): a
// rejected part goes back to pending; an approved part stays approved
// unless this save changes it. A transaction, because that decision is made
// against the stored record, and a stale copy from the page could keep a
// part "approved" that the rules would then refuse.
export async function submitParticipantProfile(
  uid: string,
  input: OnlineParticipantProfileInput,
): Promise<ResubmissionStatuses> {
  const ref = doc(onlineCompDb, 'onlineParticipants', uid);
  return runTransaction(onlineCompDb, async (tx) => {
    const snap = await tx.get(ref);
    const next = resubmissionStatuses(snap.exists() ? snap.data() : null, input);
    tx.set(
      ref,
      {
        lastName: input.lastName,
        firstName: input.firstName,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        citizenship: input.citizenship,
        wcaId: input.wcaId,
        photoUrl: input.photoUrl,
        photoPublicId: input.photoPublicId,
        detailsStatus: next.detailsStatus,
        photoStatus: next.photoStatus,
        profileStatus: next.profileStatus,
        // Only when something now waits for the admin: the review queue is
        // ordered by it, and a save that changed nothing reviewable (a WCA
        // ID) is not a new request.
        ...(next.anyPending ? { submittedAt: serverTimestamp() } : {}),
        // An account whose data was merged away is left empty and fully
        // reusable. Filling in a profile is the moment it stops being
        // "merged away", so the record of that move is cleared HERE rather
        // than anywhere else: this is the single write that gives the
        // document content again, so the flag and the content it describes
        // change atomically. deleteField() on an absent field is a no-op,
        // so the ordinary first-time submission is unaffected.
        //
        // Permitted by firestore.rules: mergedInto/mergedAt are not in
        // judgeFieldsUntouched()'s admin-owned lockout, and no clause
        // constrains them, so a client may clear them. Proven by the
        // 'a merged-away athlete may submit a fresh profile' case in
        // tests/firestore-rules.
        mergedInto: deleteField(),
        mergedAt: deleteField(),
      },
      { merge: true },
    );
    return next;
  });
}

function registrationRef(uid: string, competitionId: string) {
  return doc(onlineCompDb, 'onlineParticipants', uid, 'registrations', competitionId);
}

// First registration CREATES the document; every later save UPDATES only
// the athlete's own fields. Which fields each writes is decided by
// buildRegistrationWrite (registration-shape.ts), the one place it is
// spelled out and tested.
//
// This used to be a plain setDoc with no merge, replacing the whole
// document on every edit. That silently erased the `results` map
// recordAo5Result writes onto the same document, rewrote registeredAt so
// it recorded the last save instead of the first registration, and —
// once an admin writes a review status — would have erased that too.
//
// A TRANSACTION, because create-or-update is decided by reading the
// document first: two tabs registering at the same moment must not both
// take the create path and both stamp registeredAt. The read is of the
// athlete's own document, which the owner-only read rule allows.
export async function registerForCompetition(
  uid: string,
  competitionId: string,
  eventIds: string[],
  note = '',
): Promise<void> {
  const ref = registrationRef(uid, competitionId);
  await runTransaction(onlineCompDb, async (tx) => {
    const snap = await tx.get(ref);
    const write = buildRegistrationWrite(
      snap.exists(),
      { competitionId, events: eventIds, note },
      { now: serverTimestamp(), remove: deleteField() },
      // The stored document: for an approved registration, an added event
      // becomes a request instead of joining `events`.
      snap.exists() ? snap.data() : null,
    );
    if (write.kind === 'refused') throw new RegistrationEditRefused(write.reason);
    if (write.kind === 'create') tx.set(ref, write.data);
    else tx.update(ref, write.data);
  });
}

export async function fetchRegistration(uid: string, competitionId: string): Promise<OnlineRegistration | null> {
  const snap = await getDoc(registrationRef(uid, competitionId));
  if (!snap.exists()) return null;
  // Converts the legacy status, and reads the note defensively — see
  // normalizeStoredRegistration.
  return normalizeStoredRegistration(snap.data(), competitionId);
}

// For the "Миний тэмцээнүүд" dashboard — every competition this user has
// ever registered for, regardless of that competition's current status
// (the dashboard splits live/upcoming/finished itself).
export async function fetchMyRegistrations(uid: string): Promise<OnlineRegistration[]> {
  const snap = await getDocs(collection(onlineCompDb, 'onlineParticipants', uid, 'registrations'));
  // The document id IS the competition id, so it is the fallback for a
  // document missing the mirrored field.
  return snap.docs.map((d) => normalizeStoredRegistration(d.data(), d.id));
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
export async function fetchMySubmissions(uid: string, count = 5): Promise<OnlineSubmission[]> {
  const snap = await getDocs(query(collection(onlineCompDb, 'onlineSubmissions'), where('uid', '==', uid)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<OnlineSubmission, 'id'>) }))
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
    .slice(0, count);
}

/** Every attempt this athlete has already filed for one competition and
 *  event, across all rounds — what the solve page resumes from.
 *
 *  THE SAME UNFILTERED-BY-EVERYTHING-ELSE SHAPE as fetchMySubmissions
 *  above, and for the same reason. A query with four equality filters
 *  (uid + competitionId + event + competitionRound) is the obvious form
 *  and is NOT used: this project has already taken a production outage
 *  from assuming a query shape the emulator serves happily and production
 *  refuses for want of an index (see countRegistrationsFor in
 *  admin-competitions.ts). `where('uid','==',uid)` is the one shape
 *  already proven against production here; the rest is an in-memory
 *  filter over one athlete's own submissions, which is a small, bounded
 *  set.
 *
 *  The uid equality filter is also what makes the read provably safe
 *  under the onlineSubmissions read rule, which only admits documents the
 *  caller owns. */
export async function fetchMyFiledAttempts(
  uid: string,
  competitionId: string,
  event: string,
): Promise<FiledAttempt[]> {
  const snap = await getDocs(query(collection(onlineCompDb, 'onlineSubmissions'), where('uid', '==', uid)));
  const mine: FiledAttempt[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.competitionId !== competitionId || data.event !== event) continue;
    // A document written before competitionRound existed cannot be placed
    // in a round, so it cannot be resumed into one either.
    if (typeof data.round !== 'number' || typeof data.competitionRound !== 'number') continue;
    mine.push({
      submissionId: d.id,
      attempt: data.round,
      competitionRound: data.competitionRound,
      reportedTime: typeof data.reportedTime === 'number' ? data.reportedTime : 0,
      isDnf: data.isDnf === true,
    });
  }
  return mine;
}

/** Thrown when this attempt is ALREADY FILED with different contents —
 *  a different time or DNF flag than the one being written now.
 *
 *  Distinguished from the harmless case on purpose. A retry after a
 *  network failure re-files the SAME attempt with the SAME time, and that
 *  must read as success: the write had already landed, the athlete just
 *  never saw the acknowledgement. A different time means something else
 *  entirely — the attempt was solved again — and the rules refuse it,
 *  because rewriting a filed attempt is how a bad solve would be
 *  discarded. */
export class SubmissionAlreadyFiledError extends Error {
  readonly submissionId: string;
  readonly filedTime: number;
  constructor(submissionId: string, filedTime: number) {
    super(`Submission ${submissionId} is already filed with a different result`);
    this.name = 'SubmissionAlreadyFiledError';
    this.submissionId = submissionId;
    this.filedTime = filedTime;
  }
}

function isPermissionDenied(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'permission-denied';
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
  /** R2 evidence — the object key the presign route derived. The legacy
   *  Cloudinary pair is no longer fileable (firestore.rules). */
  videoKey: string;
  reportedTime: number;
  /** Self-reported DNF (Phase 5's manual keypad entry) — optional so the
   *  original solve page's call site (which never reports DNF) is
   *  unaffected. */
  isDnf?: boolean;
  /** Where each stage button was pressed, in ms from the first frame of
   *  the video (see SolveMarks). Optional, and legal while incomplete: a
   *  recorder that never fired `onstart` yields none at all, and the
   *  attempt must file regardless — the marks help a reviewer seek, they
   *  are not what the submission is for. */
  marks?: Partial<SolveMarks>;
  /** The uploaded clip's length in ms, from Cloudinary's own response —
   *  not from the recorder, deliberately. It is the length of the file a
   *  judge will actually watch, which is the only number worth comparing
   *  the marks against. Optional: an upload response without a duration
   *  must still file. */
  videoDurationMs?: number;
}): Promise<string> {
  // Informational from the sweep's point of view: it deletes on the server-
  // pinned createdAt plus the same period (submission-retention.ts), and
  // this stored date can only delay that, never bring it forward.
  const retentionExpiresAt = Timestamp.fromMillis(Date.now() + SUBMISSION_RETENTION_MS);
  // setDoc at a deterministic id, NOT addDoc: see submission-id.ts. A
  // second file of the same attempt replaces the first — a re-uploaded
  // video, a re-solved redo of the same round — instead of adding a
  // duplicate nobody can adjudicate.
  const id = submissionDocId({
    uid: input.uid,
    competitionId: input.competitionId,
    event: input.event,
    competitionRound: input.competitionRound,
    attempt: input.round,
  });
  // Refused here, before Firestore sees it: an undefined field would be
  // rejected as an unsupported value anyway, with a far less useful error,
  // and an attempt with no video is one a judge can only reject.
  // A videoKey only: firestore.rules no longer accepts the legacy Cloudinary
  // pair on a new submission (a client-chosen public id was one the sweep
  // would delete), so filing one would only come back permission-denied.
  if (!input.videoKey) {
    throw new Error('createSubmission: no video evidence (videoKey)');
  }
  const ref = doc(onlineCompDb, 'onlineSubmissions', id);
  const isDnf = input.isDnf ?? false;
  try {
    await setDoc(ref, {
      competitionId: input.competitionId,
      uid: input.uid,
      event: input.event,
      round: input.round,
      competitionRound: input.competitionRound,
      // THE EVIDENCE: this attempt's own R2 object. firestore.rules pins the
      // key to the writer's uid, competition, event, round and attempt.
      videoKey: input.videoKey,
      reportedTime: input.reportedTime,
      isDnf,
      // ALWAYS WRITTEN, even empty. firestore.rules accepts the field as
      // optional (for the submissions filed before it existed) and the
      // map as partial — so an attempt whose marks are missing or
      // half-filled still lands, which is the requirement that matters:
      // no set of seek positions is worth refusing a solve over.
      marks: input.marks ?? {},
      // Stills are no longer captured. Written empty, which is the only
      // value firestore.rules accepts: a non-empty list was a set of
      // Cloudinary image ids cleanup would delete.
      timerShotIds: [],
      cubeShotIds: [],
      // OMITTED RATHER THAN NULLED when absent. Firestore rejects an
      // explicit undefined, and a stored null would have to be told apart
      // from a real zero by every reader; an absent field is already the
      // shape every other optional here uses.
      ...(typeof input.videoDurationMs === 'number'
        ? { videoDurationMs: input.videoDurationMs }
        : {}),
      penalty: null,
      status: 'pending',
      createdAt: serverTimestamp(),
      retentionExpiresAt,
    });
    return id;
  } catch (e) {
    // ALREADY FILED IS SUCCESS. An athlete may create a submission but not
    // update one (firestore.rules), so re-filing an attempt that already
    // landed comes back permission-denied — and a retry after a network
    // failure does exactly that. Telling the athlete their attempt failed
    // when it is safely stored would send them to solve it again.
    //
    // Only a denial is worth a second look; anything else (offline, a
    // Firestore outage) is a real failure and is rethrown untouched.
    if (!isPermissionDenied(e)) throw e;
    let filed;
    try {
      filed = await getDoc(ref);
    } catch {
      // A get of a document that does not exist is ALSO denied by the read
      // rule (it dereferences resource.data.uid), so this tells us
      // nothing new — the original denial stands.
      throw e;
    }
    if (!filed.exists()) throw e;
    const data = filed.data();
    // The identity fields cannot disagree: they are what the id is built
    // from. The result can, and that is the case worth separating.
    if (data.reportedTime === input.reportedTime && (data.isDnf ?? false) === isDnf) return id;
    throw new SubmissionAlreadyFiledError(id, data.reportedTime as number);
  }
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
