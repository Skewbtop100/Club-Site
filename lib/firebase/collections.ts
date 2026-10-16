/**
 * Centralized Firestore collection/document path constants.
 * All services must import from here — never hardcode paths in components.
 */
import {
  collection,
  doc,
  CollectionReference,
  DocumentReference,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type {
  Athlete,
  AthleteRequest,
  Competition,
  MatchHistory,
  PointTransaction,
  Result,
  WcaRecordDoc,
  EventVisibility,
} from '@/lib/types';

// ── Collection name constants ────────────────────────────────────────────────

export const COL = {
  ATHLETES:         'athletes',
  COMPETITIONS:     'competitions',
  RESULTS:          'results',
  USERS:            'users',
  ASSIGNMENTS:      'assignments',
  WCA_RECORDS:      'wcaRecords',
  SETTINGS:         'settings',
  ATHLETE_REQUESTS: 'athleteRequests',
  MATCH_HISTORY:    'matchHistory',
  POINT_TRANSACTIONS: 'pointTransactions',
  // Coach challenge (docs/challenge-plan.md). rooms/{id}/members is a
  // subcollection; roomCodes is server-only and never read by clients.
  COACHES:          'coaches',
  ROOMS:            'rooms',
  ROOM_MEMBERS:     'members',
  // Phase 3: both server-written only (app/api/challenge/*).
  CHALLENGES:       'challenges',
  CHALLENGE_ASSIGNMENTS: 'challengeAssignments',
} as const;

export const DOC = {
  /** settings/eventVisibility */
  EVENT_VISIBILITY: 'eventVisibility',
} as const;

// ── Generic converter ────────────────────────────────────────────────────────

function makeConverter<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore({ id: _omit, ...rest }: T): DocumentData {
      return rest as DocumentData;
    },
    fromFirestore(snap: QueryDocumentSnapshot, options?: SnapshotOptions): T {
      return { id: snap.id, ...snap.data(options) } as T;
    },
  };
}

// ── Typed collection references ──────────────────────────────────────────────

export const athletesCol = collection(db, COL.ATHLETES).withConverter(
  makeConverter<Athlete>(),
) as CollectionReference<Athlete>;

export const competitionsCol = collection(db, COL.COMPETITIONS).withConverter(
  makeConverter<Competition>(),
) as CollectionReference<Competition>;

export const resultsCol = collection(db, COL.RESULTS).withConverter(
  makeConverter<Result>(),
) as CollectionReference<Result>;

export const wcaRecordsCol = collection(db, COL.WCA_RECORDS) as CollectionReference<WcaRecordDoc>;

// ── Typed document references ────────────────────────────────────────────────

/** settings/eventVisibility — single document, no id field */
export const eventVisibilityDoc = doc(
  db,
  COL.SETTINGS,
  DOC.EVENT_VISIBILITY,
) as DocumentReference<EventVisibility>;

// ── Untyped helpers (for collections without a fixed shape) ──────────────────

export function athleteDoc(id: string): DocumentReference<Athlete> {
  return doc(db, COL.ATHLETES, id).withConverter(makeConverter<Athlete>()) as DocumentReference<Athlete>;
}

/** athletes/{id}/private/identity — date of birth and phone, admin and
 *  linked-owner only. See AthletePrivate. */
export function athletePrivateDoc(id: string) {
  return doc(db, COL.ATHLETES, id, 'private', 'identity');
}

export function competitionDoc(id: string): DocumentReference<Competition> {
  return doc(db, COL.COMPETITIONS, id).withConverter(makeConverter<Competition>()) as DocumentReference<Competition>;
}

/** competitions/{id}/private/scrambles — imported WCA scrambles
 *  ({ scrambleSets }), admin-only. Kept off the public competition document
 *  so nobody can read a round's scrambles before it is held. */
export function competitionScramblesDoc(id: string) {
  return doc(db, COL.COMPETITIONS, id, 'private', 'scrambles');
}

/** competitions/{id}/private — the admin-only subcollection (scrambles,
 *  staged imported results). */
export function competitionPrivateCol(id: string) {
  return collection(db, COL.COMPETITIONS, id, 'private');
}

/** competitions/{id}/private/importedResults_{eventId} — one event's staged
 *  import ({ kind: 'importedResults', eventId, rounds }), admin-only. One
 *  document per event: a whole competition's rows could pass the 1 MB limit. */
export function competitionStagedResultsDoc(id: string, eventId: string) {
  return doc(db, COL.COMPETITIONS, id, 'private', `importedResults_${eventId}`);
}

export function resultDoc(id: string): DocumentReference<Result> {
  return doc(db, COL.RESULTS, id).withConverter(makeConverter<Result>()) as DocumentReference<Result>;
}

export function assignmentsCol(competitionId?: string) {
  const col = collection(db, COL.ASSIGNMENTS);
  return col;
}

export function userDoc(id: string) {
  return doc(db, COL.USERS, id);
}

export function usersCol() {
  return collection(db, COL.USERS);
}

// ── athleteRequests ──────────────────────────────────────────────────────
//
// User-initiated "I am this athlete" claims. Approved by an admin from
// /admin/users → Хүсэлтүүд tab; the approval batch flips the request to
// 'approved' and writes the bidirectional users.athleteId / athletes.ownerId
// link in one transaction so partial states can't leak.
export const athleteRequestsCol = collection(db, COL.ATHLETE_REQUESTS).withConverter(
  makeConverter<AthleteRequest>(),
) as CollectionReference<AthleteRequest>;

export function athleteRequestDoc(id: string): DocumentReference<AthleteRequest> {
  return doc(db, COL.ATHLETE_REQUESTS, id).withConverter(
    makeConverter<AthleteRequest>(),
  ) as DocumentReference<AthleteRequest>;
}

// ── matchHistory ─────────────────────────────────────────────────────────
//
// Permanent record of a finished multiplayer match. Written once by the
// host (via lib/firebase/services/matchHistory.ts) when the final round
// transitions racing → results.
//
// Required composite index for "matches I played in":
//   matchHistory: playerUids (array-contains) + playedAt (desc)
export const matchHistoryCol = collection(db, COL.MATCH_HISTORY).withConverter(
  makeConverter<MatchHistory>(),
) as CollectionReference<MatchHistory>;

export function matchHistoryDoc(id: string): DocumentReference<MatchHistory> {
  return doc(db, COL.MATCH_HISTORY, id).withConverter(
    makeConverter<MatchHistory>(),
  ) as DocumentReference<MatchHistory>;
}

// ── pointTransactions ────────────────────────────────────────────────────
//
// Append-only ledger of every points award/deduction. Documents are
// written by lib/points.ts inside Firestore transactions that also
// increment the user's `points` field, so the row's `balanceAfter` is
// always consistent with the user doc at write time.
//
// Required composite index for "my recent transactions":
//   pointTransactions: uid (asc) + timestamp (desc)
export const pointTransactionsCol = collection(db, COL.POINT_TRANSACTIONS).withConverter(
  makeConverter<PointTransaction>(),
) as CollectionReference<PointTransaction>;

export function pointTransactionDoc(id: string): DocumentReference<PointTransaction> {
  return doc(db, COL.POINT_TRANSACTIONS, id).withConverter(
    makeConverter<PointTransaction>(),
  ) as DocumentReference<PointTransaction>;
}
