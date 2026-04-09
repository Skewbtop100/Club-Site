import { getDocs, onSnapshot, query, where, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';

export interface Assignment {
  id: string;
  competitionId: string;
  eventId: string;
  heat: number;
  competitor?: string[];
  judge?: string[];
  scrambler?: string[];
  standby?: string[];
}

/** One-time fetch of assignments for a competition. */
export async function getAssignmentsByComp(competitionId: string): Promise<Assignment[]> {
  const q = query(collection(db, COL.ASSIGNMENTS), where('competitionId', '==', competitionId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Assignment));
}

/** Real-time subscription for assignments by competition. Returns unsubscribe function. */
export function subscribeAssignmentsByComp(
  competitionId: string,
  onData: (assignments: Assignment[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(collection(db, COL.ASSIGNMENTS), where('competitionId', '==', competitionId));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Assignment))),
    (err) => onError?.(err),
  );
}
