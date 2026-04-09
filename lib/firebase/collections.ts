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
import type { Athlete, Competition, Result, WcaRecordDoc, EventVisibility } from '@/lib/types';

// ── Collection name constants ────────────────────────────────────────────────

export const COL = {
  ATHLETES:    'athletes',
  COMPETITIONS:'competitions',
  RESULTS:     'results',
  USERS:       'users',
  ASSIGNMENTS: 'assignments',
  WCA_RECORDS: 'wcaRecords',
  SETTINGS:    'settings',
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

export function competitionDoc(id: string): DocumentReference<Competition> {
  return doc(db, COL.COMPETITIONS, id).withConverter(makeConverter<Competition>()) as DocumentReference<Competition>;
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
