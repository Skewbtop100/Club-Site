import {
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  athleteDoc,
  athleteRequestDoc,
  athleteRequestsCol,
  userDoc,
} from '@/lib/firebase/collections';
import type { AthleteRequest } from '@/lib/types';
import { awardAthleteLinked } from '@/lib/points';

// Reason copy reused everywhere an admin-driven action invalidates a
// pending request. Centralised so the message stays consistent in toasts,
// timestamps, and the rejected-state card on the user's Profile page.
export const ORPHAN_REJECT_REASON = 'Тамирчин аль хэдийн бусадтай холбогдсон';

// ── Read helpers ─────────────────────────────────────────────────────────

export function tsToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return null;
}

/** Real-time subscription to all of one user's requests (any status). */
export function subscribeUserRequests(
  uid: string,
  onData: (requests: AthleteRequest[]) => void,
  onError?: (err: Error) => void,
): () => void {
  // Single `where` — no composite index needed. Sort client-side.
  const q = query(athleteRequestsCol, where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(d => d.data())),
    (err) => onError?.(err),
  );
}

/** Real-time subscription to all pending requests (admin queue). */
export function subscribePendingRequests(
  onData: (requests: AthleteRequest[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(athleteRequestsCol, where('status', '==', 'pending'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(d => d.data())),
    (err) => onError?.(err),
  );
}

// ── Write helpers ────────────────────────────────────────────────────────

export interface SubmitRequestInput {
  uid: string;
  userDisplayName: string;
  userEmail: string;
  userPhotoURL: string | null;
  athleteId: string;
  athleteName: string;
}

/**
 * Create a new pending request. Throws if the user already has one open
 * (we surface this as a UI error rather than silently overwriting). Doesn't
 * change athlete.ownerId — that flips only on admin approval.
 */
export async function submitAthleteRequest(input: SubmitRequestInput): Promise<string> {
  // Check for an existing pending request — small race window between this
  // read and the write below, but the consequence is at most one duplicate
  // per user, easily resolved by an admin.
  const existing = await getDocs(query(
    athleteRequestsCol,
    where('uid', '==', input.uid),
    where('status', '==', 'pending'),
  ));
  if (!existing.empty) {
    throw new Error('Танд аль хэдийн хүлээгдэж буй хүсэлт байна.');
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(athleteRequestDoc(id), {
    id,
    uid: input.uid,
    userDisplayName: input.userDisplayName,
    userEmail: input.userEmail,
    userPhotoURL: input.userPhotoURL,
    athleteId: input.athleteId,
    athleteName: input.athleteName,
    status: 'pending',
    requestedAt: serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
    rejectReason: null,
  });
  return id;
}

/** Hard-delete the request. Used by the user's "Хүсэлт цуцлах" button. */
export async function cancelAthleteRequest(id: string): Promise<void> {
  await deleteDoc(athleteRequestDoc(id));
}

/**
 * Admin approves a pending request: writes the bidirectional link AND
 * auto-rejects any other pending requests for the same athlete (so two
 * users can't end up "both approved" after a race). All five writes share
 * one batch — partial states can't leak even if Firestore is flaky.
 */
export async function approveAthleteRequest(
  request: Pick<AthleteRequest, 'id' | 'uid' | 'athleteId'>,
  adminUid: string,
): Promise<void> {
  const orphans = await findOtherPendingForAthlete(request.athleteId, request.id);
  const batch = writeBatch(db);

  // 1. Mark the request approved.
  batch.update(athleteRequestDoc(request.id), {
    status: 'approved',
    resolvedAt: serverTimestamp(),
    resolvedBy: adminUid,
  });

  // 2-3. Bidirectional link.
  batch.update(userDoc(request.uid), {
    role: 'athlete',
    athleteId: request.athleteId,
  });
  batch.update(athleteDoc(request.athleteId), { ownerId: request.uid });

  // 4. Auto-reject anyone else queued for the same athlete.
  for (const orphan of orphans) {
    batch.update(athleteRequestDoc(orphan.id), {
      status: 'rejected',
      resolvedAt: serverTimestamp(),
      resolvedBy: adminUid,
      rejectReason: ORPHAN_REJECT_REASON,
    });
  }

  await batch.commit();

  // Award the athlete-linked points + queue the celebratory toast for the
  // user's next login. Best-effort: a failure here doesn't roll back the
  // approval (which already happened). Admin sees a console warning but
  // the user can still log in normally; if needed, an admin can re-grant
  // points manually from the points-admin tools.
  try {
    await awardAthleteLinked(request.uid);
  } catch (err) {
    console.warn('[athleteRequests] athlete-linked points award failed', err);
  }
}

/** Admin rejects a pending request with an explicit reason. */
export async function rejectAthleteRequest(
  id: string,
  adminUid: string,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    throw new Error('Шалтгаан 5-аас дээш тэмдэгт байх ёстой.');
  }
  const batch = writeBatch(db);
  batch.update(athleteRequestDoc(id), {
    status: 'rejected',
    resolvedAt: serverTimestamp(),
    resolvedBy: adminUid,
    rejectReason: trimmed,
  });
  await batch.commit();
}

/**
 * Find pending requests targeting `athleteId` excluding `excludeId` (the
 * one being approved). Used by approveAthleteRequest and by the manual
 * link path in /admin/users so both code paths invalidate orphans.
 */
async function findOtherPendingForAthlete(
  athleteId: string,
  excludeId: string,
): Promise<AthleteRequest[]> {
  const snap = await getDocs(query(
    athleteRequestsCol,
    where('athleteId', '==', athleteId),
    where('status', '==', 'pending'),
  ));
  return snap.docs.map(d => d.data()).filter(r => r.id !== excludeId);
}

/**
 * Same as the orphan-rejection branch of approveAthleteRequest, but for
 * the admin's manual link path (UsersTab onLinkAthlete) where there's no
 * triggering request id to exclude. Pass excludeId='' to reject all.
 */
export async function rejectOrphansForAthlete(
  athleteId: string,
  adminUid: string,
  excludeId = '',
): Promise<number> {
  const orphans = await findOtherPendingForAthlete(athleteId, excludeId);
  if (orphans.length === 0) return 0;
  const batch = writeBatch(db);
  for (const o of orphans) {
    batch.update(athleteRequestDoc(o.id), {
      status: 'rejected',
      resolvedAt: serverTimestamp(),
      resolvedBy: adminUid,
      rejectReason: ORPHAN_REJECT_REASON,
    });
  }
  await batch.commit();
  return orphans.length;
}

// Re-export for components that just want the doc ref (e.g. presence-only
// fast checks). Keeps the firebase plumbing inside this module.
export { athleteRequestsCol, athleteRequestDoc, doc as _doc };
