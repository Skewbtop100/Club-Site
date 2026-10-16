// Coach role (docs/challenge-plan.md, decision 2): admins are coaches
// automatically; anyone else needs an active coaches/{uid} document, which
// only the club admin can write (firestore.rules).
import {
  collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';
import type { AppUser } from '@/lib/auth-context';

/** One read at most (none for an admin). */
export async function fetchIsCoach(user: AppUser | null): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  try {
    const snap = await getDoc(doc(db, COL.COACHES, user.uid));
    return snap.exists() && snap.get('active') === true;
  } catch {
    return false;
  }
}

/** Admin only — uid → active, for the admin users tab. */
export function subscribeCoachFlags(
  onData: (active: Map<string, boolean>) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, COL.COACHES),
    (snap) => {
      const m = new Map<string, boolean>();
      for (const d of snap.docs) m.set(d.id, d.get('active') === true);
      onData(m);
    },
    (err) => onError?.(err),
  );
}

/** Admin only — grant or revoke. Revoking keeps the document (active:false)
 *  so history stays attributable. */
export async function setCoach(uid: string, displayName: string, active: boolean, adminUid: string): Promise<void> {
  await setDoc(doc(db, COL.COACHES, uid), {
    uid, displayName, active, grantedBy: adminUid, grantedAt: serverTimestamp(),
  }, { merge: true });
}
