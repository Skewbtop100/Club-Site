import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { onlineCompDb } from './firebase';
import { ONLINE_NOTIFICATIONS, type OnlineNotification } from './types';

// ── Client half of the notification feed ──────────────────────────────────
// Reads + the `read` flag only. Creating a notification is server-only and
// lives in ./notifications-server.ts, because the only writer is the
// judge-decision API route, which uses the Admin SDK — keeping the two in
// one module would drag firebase-admin into the client bundle (same
// client/server file split as data.ts vs admin-competitions.ts).
//
// Everything here goes through `onlineCompDb`, the second named Firebase
// app (see ./firebase.ts), never the club site's default app.

/** How many notifications the bell keeps in view. */
const FEED_LIMIT = 20;

/** Live feed of one athlete's newest notifications, newest first.
 *
 *  Requires the composite index (uid ASC, createdAt DESC) declared in
 *  firestore.indexes.json. Returns the unsubscribe function, so callers can
 *  hand it straight back from a useEffect. */
export function subscribeToNotifications(
  uid: string,
  cb: (notifications: OnlineNotification[]) => void,
): () => void {
  const q = query(
    collection(onlineCompDb, ONLINE_NOTIFICATIONS),
    where('uid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(FEED_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OnlineNotification, 'id'>) })));
    },
    (err) => {
      console.warn('[online-competition] notification feed failed', err);
      cb([]);
    },
  );
}

/** Flip `read` on a single notification. */
export async function markRead(notificationId: string): Promise<void> {
  await updateDoc(doc(onlineCompDb, ONLINE_NOTIFICATIONS, notificationId), { read: true });
}

/** Mark every currently-unread notification for this athlete as read.
 *
 *  Queries unread docs directly rather than working off whatever the bell
 *  happens to have in view, so unread items older than the feed's limit
 *  don't survive a "mark all read" and keep the badge lit. Batched in
 *  chunks because a Firestore batch caps at 500 writes. */
export async function markAllRead(uid: string): Promise<void> {
  const q = query(
    collection(onlineCompDb, ONLINE_NOTIFICATIONS),
    where('uid', '==', uid),
    where('read', '==', false),
  );
  const snap = await getDocs(q);
  if (snap.empty) return;

  const CHUNK = 400;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = writeBatch(onlineCompDb);
    for (const d of snap.docs.slice(i, i + CHUNK)) {
      batch.update(d.ref, { read: true });
    }
    await batch.commit();
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Midnight-normalized whole-day distance between two dates. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** The uppercase meta line under a notification title, e.g.
 *  'ТЭСТ ТЭМЦЭЭН · 4 МИНУТЫН ӨМНӨ'.
 *
 *  `createdAt` is null in the local snapshot between an optimistic
 *  serverTimestamp() write and its server round-trip — treated as "now"
 *  rather than crashing or rendering an empty slot. */
export function formatNotifMeta(
  contextLabel: string,
  createdAt: Timestamp | Date | null | undefined,
  now: Date = new Date(),
): string {
  const when =
    createdAt instanceof Timestamp
      ? createdAt.toDate()
      : createdAt instanceof Date
        ? createdAt
        : now;

  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);

  let stamp: string;
  if (minutes < 1) {
    stamp = 'САЯХАН';
  } else if (minutes < 60) {
    stamp = `${minutes} МИНУТЫН ӨМНӨ`;
  } else if (calendarDaysBetween(when, now) === 0) {
    stamp = `ӨНӨӨДӨР ${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
  } else {
    stamp = `${calendarDaysBetween(when, now)} ӨДРИЙН ӨМНӨ`;
  }

  return [contextLabel, stamp].filter(Boolean).join(' · ').toUpperCase();
}
