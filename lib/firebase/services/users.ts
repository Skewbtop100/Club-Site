import {
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { userDoc, usersCol } from '@/lib/firebase/collections';

export interface AppUser {
  id: string;
  username: string;
  password?: string;
  role: string;
  athleteId?: string | null;
  createdAt?: unknown;
}

/** Real-time subscription to all users. Returns unsubscribe function. */
export function subscribeUsers(
  onData: (users: AppUser[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    usersCol(),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppUser))),
    (err) => onError?.(err),
  );
}

/**
 * Look up a user by username.
 * Returns the matching document, or null if not found.
 */
export async function findUserByUsername(username: string): Promise<AppUser | null> {
  const q = query(usersCol(), where('username', '==', username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as AppUser;
}

/** Create a new user with a generated id. */
export async function addUser(
  data: Omit<AppUser, 'id'>,
): Promise<string> {
  const id = Date.now().toString(36);
  await setDoc(userDoc(id), { ...data, createdAt: Timestamp.now() });
  return id;
}

/** Update an existing user. */
export async function updateUser(
  id: string,
  data: Partial<Omit<AppUser, 'id'>>,
): Promise<void> {
  await updateDoc(userDoc(id), data as Record<string, unknown>);
}

/** Delete a user permanently. */
export async function deleteUser(id: string): Promise<void> {
  await deleteDoc(userDoc(id));
}
