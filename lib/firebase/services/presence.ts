import { rtdb } from '@/lib/firebase';
import { ref, set, update, onValue, onDisconnect, serverTimestamp } from 'firebase/database';

export interface OnlineUser {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  /** WCA event ID, e.g. '333' */
  event: string;
  /** Human-readable label, e.g. '3x3 Cube' */
  eventName?: string;
  lastSeen: number;
}

/**
 * Mark the current user as online in /presence/timer/{uid}.
 * Sets up onDisconnect removal so the record disappears when
 * the connection drops without a manual cleanup.
 * Returns a cleanup fn that removes the record on manual unmount.
 */
export function trackPresence(
  uid: string,
  displayName: string,
  photoURL: string | null,
  event: string,
  eventName: string,
): () => void {
  const userRef = ref(rtdb, `presence/timer/${uid}`);
  set(userRef, {
    uid,
    displayName,
    photoURL: photoURL ?? null,
    event,
    eventName,
    lastSeen: serverTimestamp(),
  });
  onDisconnect(userRef).remove();
  return () => {
    set(userRef, null);
  };
}

/**
 * Update only the event fields for an already-tracked user.
 * Preserves uid / displayName / photoURL already on the record.
 */
export function updatePresenceEvent(
  uid: string,
  event: string,
  eventName: string,
): void {
  const userRef = ref(rtdb, `presence/timer/${uid}`);
  update(userRef, { event, eventName, lastSeen: serverTimestamp() });
}

/**
 * Subscribe to the live list of online timer users.
 * Returns an unsubscribe function.
 * Filters to records seen within the last 30 seconds as a safety
 * net in case onDisconnect didn't fire (e.g. hard device kill).
 */
export function subscribeOnlineUsers(
  callback: (users: OnlineUser[]) => void,
): () => void {
  const listRef = ref(rtdb, 'presence/timer');
  return onValue(listRef, (snap) => {
    const data = snap.val() ?? {};
    const list = Object.values(data) as OnlineUser[];
    const now = Date.now();
    const fresh = list.filter(u => u.lastSeen && (now - u.lastSeen < 30_000));
    callback(fresh);
  });
}
