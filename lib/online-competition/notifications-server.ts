import { FieldValue } from 'firebase-admin/firestore';
import { getOnlineCompAdminDb } from './firebase-admin';
import { ONLINE_NOTIFICATIONS, type OnlineNotificationType } from './types';

// ── Server-only writer for onlineNotifications ────────────────────────────
// Notifications are created exclusively here, with the Admin SDK, because
// the only trigger so far (the judge decision in
// app/api/online-competition/review/route.ts) runs server-side behind the
// password-cookie admin gate — there is no Firebase Auth identity there for
// security rules to check. firestore.rules therefore denies `create` on
// this collection to every client, exactly as it does for
// onlineSubmissions.status/penalty.
//
// The client-side half (subscribe / markRead / markAllRead / formatting)
// lives in ./notifications.ts. Neither file imports the other: the shared
// collection name sits in ./types.ts, which pulls in no Firebase SDK at
// all, so this module never drags the client app into a server route and
// ./notifications.ts never drags firebase-admin into a client bundle.

export interface CreateNotificationParams {
  /** Recipient's Firebase Auth uid. */
  uid: string;
  type: OnlineNotificationType;
  /** Final Mongolian display text — composed by the caller, at write time. */
  title: string;
  /** Short uppercase label for the meta line. */
  contextLabel: string;
  /** Where clicking navigates; '' for a non-clickable notice. */
  href?: string;
}

/** Write one notification. Returns the new doc id. */
export async function createNotification(params: CreateNotificationParams): Promise<string> {
  const db = getOnlineCompAdminDb();
  const ref = await db.collection(ONLINE_NOTIFICATIONS).add({
    uid: params.uid,
    type: params.type,
    title: params.title,
    contextLabel: params.contextLabel,
    href: params.href ?? '',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}
