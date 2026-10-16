// Server side of coach rooms (docs/challenge-plan.md, phase 2). Every write
// to rooms/*, rooms/*/members/* and roomCodes/* happens here, through the
// Admin SDK, from app/api/rooms/*. Clients may only read (firestore.rules),
// so nobody can approve themselves, forge a membership, or pick a code.
import { randomInt } from 'node:crypto';
import { FieldValue, type DocumentData, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { adminDb, isCoachUid } from './firebase-admin';
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
  cleanRoomName, isRoomCode, normalizeRoomCode,
  type MemberAction, type MemberStatus,
} from '../types/challenge';

/** A refusal the route turns into `{ error: code }` with this HTTP status. */
export class RoomError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function profileOf(db: Firestore, uid: string): Promise<{ displayName: string; photoURL: string | null }> {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new RoomError(403, 'no-account');
  const name = snap.get('displayName');
  const photo = snap.get('photoURL');
  return {
    displayName: typeof name === 'string' && name.trim() ? name.trim() : 'Player',
    photoURL: typeof photo === 'string' && photo ? photo : null,
  };
}

/** Room the caller coaches, or a 403/404. */
async function ownedRoom(db: Firestore, callerUid: string, roomId: unknown): Promise<{ ref: DocumentReference; data: DocumentData }> {
  if (typeof roomId !== 'string' || !ID_RE.test(roomId)) throw new RoomError(400, 'bad-request');
  const ref = db.doc(`rooms/${roomId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new RoomError(404, 'no-room');
  const data = snap.data()!;
  if (data.coachUid !== callerUid) throw new RoomError(403, 'not-room-coach');
  return { ref, data };
}

/** Reserves a fresh code (create-only, so a clash just retries) inside `tx`. */
async function reserveCode(db: Firestore, tx: Transaction, roomId: string, coachUid: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRoomCode();
    const codeRef = db.doc(`roomCodes/${code}`);
    if ((await tx.get(codeRef)).exists) continue;
    tx.create(codeRef, { roomId, coachUid });
    return code;
  }
  throw new RoomError(503, 'code-space-busy');
}

export async function createRoom(callerUid: string, rawName: unknown): Promise<{ roomId: string; code: string; name: string }> {
  const name = cleanRoomName(rawName);
  if (!name) throw new RoomError(400, 'bad-name');
  if (!(await isCoachUid(callerUid))) throw new RoomError(403, 'not-coach');
  const db = adminDb();
  const coach = await profileOf(db, callerUid);
  const ref = db.collection('rooms').doc();
  const code = await db.runTransaction(async (tx) => {
    const c = await reserveCode(db, tx, ref.id, callerUid);
    tx.create(ref, {
      name, coachUid: callerUid, coachName: coach.displayName, code: c,
      archived: false, createdAt: FieldValue.serverTimestamp(),
    });
    return c;
  });
  return { roomId: ref.id, code, name };
}

export async function renameRoom(callerUid: string, roomId: unknown, rawName: unknown): Promise<{ name: string }> {
  const name = cleanRoomName(rawName);
  if (!name) throw new RoomError(400, 'bad-name');
  const db = adminDb();
  const { ref } = await ownedRoom(db, callerUid, roomId);
  await ref.update({ name });
  // Members carry a copy of the name for the student's list (incl. removed).
  const members = await ref.collection('members').get();
  for (let i = 0; i < members.docs.length; i += 400) {
    const batch = db.batch();
    for (const m of members.docs.slice(i, i + 400)) batch.update(m.ref, { roomName: name });
    await batch.commit();
  }
  return { name };
}

/** New code for the room; the old one stops resolving at once. */
export async function regenerateRoomCode(callerUid: string, roomId: unknown): Promise<{ code: string }> {
  const db = adminDb();
  const { ref } = await ownedRoom(db, callerUid, roomId);
  const code = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const old = snap.get('code');
    const c = await reserveCode(db, tx, ref.id, callerUid);
    if (typeof old === 'string' && old) tx.delete(db.doc(`roomCodes/${old}`));
    tx.update(ref, { code: c });
    return c;
  });
  return { code };
}

/**
 * Join request by code. New → pending. Already pending/active → unchanged.
 * Removed → pending again (the same document, so history stays attached;
 * a coach approving it is the "re-add" — plan decisions 10 and 24).
 */
export async function joinRoom(callerUid: string, rawCode: unknown): Promise<{ roomId: string; roomName: string; status: MemberStatus }> {
  if (typeof rawCode !== 'string') throw new RoomError(400, 'bad-code');
  const code = normalizeRoomCode(rawCode);
  if (!isRoomCode(code)) throw new RoomError(400, 'bad-code');
  const db = adminDb();
  const codeSnap = await db.doc(`roomCodes/${code}`).get();
  if (!codeSnap.exists) throw new RoomError(404, 'no-room');
  const roomId = codeSnap.get('roomId') as string;
  const roomRef = db.doc(`rooms/${roomId}`);
  const me = await profileOf(db, callerUid);

  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef);
    if (!room.exists || room.get('archived') === true || room.get('code') !== code) throw new RoomError(404, 'no-room');
    if (room.get('coachUid') === callerUid) throw new RoomError(400, 'own-room');
    const memberRef = roomRef.collection('members').doc(callerUid);
    const member = await tx.get(memberRef);
    const roomName = room.get('name') as string;
    const base = {
      uid: callerUid, roomId, roomName, coachName: room.get('coachName') as string,
      displayName: me.displayName, photoURL: me.photoURL,
    };
    if (!member.exists) {
      tx.create(memberRef, { ...base, status: 'pending', requestedAt: FieldValue.serverTimestamp(), decidedAt: null });
      return { roomId, roomName, status: 'pending' as const };
    }
    const status = member.get('status') as MemberStatus;
    if (status === 'removed') {
      tx.update(memberRef, { ...base, status: 'pending', requestedAt: FieldValue.serverTimestamp(), decidedAt: null });
      return { roomId, roomName, status: 'pending' as const };
    }
    // Refresh the copied name/photo, keep the status.
    tx.update(memberRef, { displayName: me.displayName, photoURL: me.photoURL });
    return { roomId, roomName, status };
  });
}

/**
 * Coach decision on one member:
 *   approve — pending → active
 *   reject  — pending → request deleted (nothing to keep; may ask again)
 *   remove  — active  → removed (kept, never deleted — decision 10)
 */
export async function decideMember(callerUid: string, roomId: unknown, memberUid: unknown, action: unknown): Promise<{ status: MemberStatus | 'deleted' }> {
  if (action !== 'approve' && action !== 'reject' && action !== 'remove') throw new RoomError(400, 'bad-action');
  if (typeof memberUid !== 'string' || !ID_RE.test(memberUid)) throw new RoomError(400, 'bad-request');
  const db = adminDb();
  const { ref } = await ownedRoom(db, callerUid, roomId);
  const memberRef = ref.collection('members').doc(memberUid);
  // The student's assignments in this room: hidden from the coach while
  // removed, visible again on re-add (decisions 10, 24 — phase 3).
  const assignmentsQuery = db.collection('challengeAssignments')
    .where('roomId', '==', ref.id).where('studentUid', '==', memberUid);
  return db.runTransaction(async (tx) => {
    const member = await tx.get(memberRef);
    if (!member.exists) throw new RoomError(404, 'no-member');
    const status = member.get('status') as MemberStatus;
    const act = action as MemberAction;
    const assignments = act === 'reject' ? null : await tx.get(assignmentsQuery);
    const setVisible = (visibleToCoach: boolean) => {
      for (const a of assignments?.docs ?? []) tx.update(a.ref, { visibleToCoach });
    };
    if (act === 'approve') {
      if (status !== 'pending') throw new RoomError(409, 'not-pending');
      tx.update(memberRef, { status: 'active', decidedAt: FieldValue.serverTimestamp() });
      setVisible(true);
      return { status: 'active' as const };
    }
    if (act === 'reject') {
      if (status !== 'pending') throw new RoomError(409, 'not-pending');
      tx.delete(memberRef);
      return { status: 'deleted' as const };
    }
    if (status !== 'active') throw new RoomError(409, 'not-active');
    tx.update(memberRef, { status: 'removed', decidedAt: FieldValue.serverTimestamp() });
    setVisible(false);
    return { status: 'removed' as const };
  });
}
