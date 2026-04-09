import {
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  collection,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL, resultsCol, resultDoc } from '@/lib/firebase/collections';
import type { Result } from '@/lib/types';

/** Real-time subscription to ALL results. Returns unsubscribe function. */
export function subscribeResults(
  onData: (results: Result[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    resultsCol,
    (snap) => onData(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  );
}

/** Real-time subscription filtered by competitionId. Returns unsubscribe function. */
export function subscribeResultsByComp(
  competitionId: string,
  onData: (results: Result[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(collection(db, COL.RESULTS), where('competitionId', '==', competitionId));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Result))),
    (err) => onError?.(err),
  );
}

/** One-time fetch of all results for a competition. */
export async function getResultsByComp(competitionId: string): Promise<Result[]> {
  const q = query(collection(db, COL.RESULTS), where('competitionId', '==', competitionId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Result));
}

/** One-time fetch of all results for an athlete. */
export async function getResultsByAthlete(athleteId: string): Promise<Result[]> {
  const q = query(collection(db, COL.RESULTS), where('athleteId', '==', athleteId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Result));
}

/** One-time fetch of all results. */
export async function getAllResults(): Promise<Result[]> {
  const snap = await getDocs(resultsCol);
  return snap.docs.map((d) => d.data());
}

/** Save (create or overwrite) a result by deterministic docId. */
export async function saveResult(
  docId: string,
  data: Omit<Result, 'id'> & { submittedAt?: unknown; submittedBy?: string },
): Promise<void> {
  await setDoc(resultDoc(docId), {
    id: docId,
    ...data,
    submittedAt: data.submittedAt ?? Timestamp.now(),
  } as Result);
}

/** Import a result from external source (WCA). Same as saveResult but marks source. */
export async function importResult(
  docId: string,
  data: Omit<Result, 'id' | 'source' | 'status'>,
): Promise<void> {
  await saveResult(docId, { ...data, source: 'import', status: 'published', submittedAt: Timestamp.now() });
}

/** Delete a result permanently. */
export async function deleteResult(id: string): Promise<void> {
  await deleteDoc(resultDoc(id));
}
