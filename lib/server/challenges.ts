// Server side of coach challenges (docs/challenge-plan.md, phase 3). Every
// write to challenges/* and challengeAssignments/* happens here, through
// the Admin SDK, from app/api/challenge/*. Clients may only read
// (firestore.rules), so nobody can assign themselves, edit a started
// challenge or fake progress.
//
// Edit lock (decision 9): `locked` is set by the start route (phase 4) at
// the first start. While it is true, update and delete are refused here no
// matter what the client sends; the coach duplicates instead.
import { FieldValue, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { adminDb, isCoachUid } from './firebase-admin';
import { RoomError } from './rooms';
import { validateTemplate } from '../challenge';
import type { ChallengeTemplate } from '../types/challenge';

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Most students one assign / one challenge may carry, so every write for a
 *  challenge fits in one transaction (Firestore: 500 writes). */
export const MAX_ASSIGN = 200;

export const assignmentId = (challengeId: string, studentUid: string) => `${challengeId}_${studentUid}`;

function templateOf(raw: Record<string, unknown>): ChallengeTemplate {
  const r = validateTemplate(raw);
  if ('error' in r) throw new RoomError(400, r.error);
  return r.value;
}

function templateFields(d: DocumentData): ChallengeTemplate {
  return { event: d.event, metric: d.metric, targetMs: d.targetMs, streak: d.streak, title: d.title, note: d.note ?? '' };
}

/** Active coach who owns the room, or a 400/403/404. */
async function ownedRoom(db: Firestore, callerUid: string, roomId: unknown): Promise<DocumentReference> {
  if (typeof roomId !== 'string' || !ID_RE.test(roomId)) throw new RoomError(400, 'bad-request');
  const snap = await db.doc(`rooms/${roomId}`).get();
  if (!snap.exists) throw new RoomError(404, 'no-room');
  if (snap.get('coachUid') !== callerUid) throw new RoomError(403, 'not-room-coach');
  if (!(await isCoachUid(callerUid))) throw new RoomError(403, 'not-coach');
  return snap.ref;
}

/** Challenge the caller coaches, or a 400/403/404. */
async function ownedChallenge(db: Firestore, callerUid: string, challengeId: unknown): Promise<{ ref: DocumentReference; data: DocumentData }> {
  if (typeof challengeId !== 'string' || !ID_RE.test(challengeId)) throw new RoomError(400, 'bad-request');
  const ref = db.doc(`challenges/${challengeId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new RoomError(404, 'no-challenge');
  const data = snap.data()!;
  if (data.coachUid !== callerUid) throw new RoomError(403, 'not-challenge-coach');
  return { ref, data };
}

const startedAssignment = (d: DocumentData) => d.firstStartedAt != null || d.status !== 'assigned';

export async function createChallenge(callerUid: string, body: Record<string, unknown>): Promise<{ challengeId: string; title: string }> {
  const template = templateOf(body);
  const db = adminDb();
  const roomRef = await ownedRoom(db, callerUid, body.roomId);
  const ref = db.collection('challenges').doc();
  await ref.create({
    ...template, coachUid: callerUid, roomId: roomRef.id,
    locked: false, duplicatedFrom: null, archived: false,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  return { challengeId: ref.id, title: template.title };
}

/** Edit the template — only while never started. The copy in every
 *  assignment follows, in the same transaction. */
export async function updateChallenge(callerUid: string, body: Record<string, unknown>): Promise<{ title: string }> {
  const template = templateOf(body);
  const db = adminDb();
  const { ref } = await ownedChallenge(db, callerUid, body.challengeId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get('locked') === true) throw new RoomError(409, 'locked');
    const assignments = await tx.get(db.collection('challengeAssignments').where('challengeId', '==', ref.id));
    if (assignments.docs.some(a => startedAssignment(a.data()))) throw new RoomError(409, 'locked');
    tx.update(ref, { ...template, updatedAt: FieldValue.serverTimestamp() });
    for (const a of assignments.docs) tx.update(a.ref, { template });
    return { title: template.title };
  });
}

/** Delete — only while never started; its (unstarted) assignments go too. */
export async function deleteChallenge(callerUid: string, body: Record<string, unknown>): Promise<{ deleted: number }> {
  const db = adminDb();
  const { ref } = await ownedChallenge(db, callerUid, body.challengeId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get('locked') === true) throw new RoomError(409, 'locked');
    const assignments = await tx.get(db.collection('challengeAssignments').where('challengeId', '==', ref.id));
    if (assignments.docs.some(a => startedAssignment(a.data()))) throw new RoomError(409, 'locked');
    for (const a of assignments.docs) tx.delete(a.ref);
    tx.delete(ref);
    return { deleted: assignments.size };
  });
}

/** "Хуулбарлах": a new, unlocked, unassigned challenge with the same
 *  template in the same room (decision 9). Allowed locked or not. */
export async function duplicateChallenge(callerUid: string, body: Record<string, unknown>): Promise<{ challengeId: string }> {
  const db = adminDb();
  const { data, ref: source } = await ownedChallenge(db, callerUid, body.challengeId);
  await ownedRoom(db, callerUid, data.roomId);
  const ref = db.collection('challenges').doc();
  await ref.create({
    ...templateFields(data), coachUid: callerUid, roomId: data.roomId,
    locked: false, duplicatedFrom: source.id, archived: false,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  return { challengeId: ref.id };
}

function uidList(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new RoomError(400, 'no-students');
  const uids = [...new Set(raw)];
  if (uids.length > MAX_ASSIGN) throw new RoomError(400, 'too-many');
  if (!uids.every(u => typeof u === 'string' && ID_RE.test(u))) throw new RoomError(400, 'bad-request');
  return uids as string[];
}

/**
 * Assign one challenge to one or many students at once. Every student must
 * be an ACTIVE member of the challenge's room, else nothing is written.
 * Already-assigned students are skipped (the id is deterministic, so there
 * is never a duplicate). Allowed after the lock too — the template is fixed.
 */
export async function assignChallenge(callerUid: string, body: Record<string, unknown>): Promise<{ assigned: string[]; skipped: string[] }> {
  const uids = uidList(body.uids);
  const db = adminDb();
  const { ref, data } = await ownedChallenge(db, callerUid, body.challengeId);
  const roomRef = await ownedRoom(db, callerUid, data.roomId);
  return db.runTransaction(async (tx) => {
    const challenge = (await tx.get(ref)).data();
    if (!challenge) throw new RoomError(404, 'no-challenge');
    const members = await tx.getAll(...uids.map(u => roomRef.collection('members').doc(u)));
    if (members.some(m => !m.exists || m.get('status') !== 'active')) throw new RoomError(409, 'not-active-member');
    const existing = await tx.getAll(...uids.map(u => db.doc(`challengeAssignments/${assignmentId(ref.id, u)}`)));
    const count = await tx.get(db.collection('challengeAssignments').where('challengeId', '==', ref.id).count());
    const fresh = uids.filter((_, i) => !existing[i].exists);
    if (count.data().count + fresh.length > MAX_ASSIGN) throw new RoomError(400, 'too-many');
    const template = templateFields(challenge);
    uids.forEach((uid, i) => {
      if (existing[i].exists) return;
      tx.create(existing[i].ref, {
        challengeId: ref.id, roomId: roomRef.id, coachUid: callerUid, studentUid: uid,
        studentName: String(members[i].get('displayName') ?? ''),
        template, status: 'assigned', visibleToCoach: true,
        firstStartedAt: null, firstStartedUbDate: null, completedAt: null, daysTaken: null,
        sessionsCount: 0, blocksAttempted: 0, bestStreak: 0,
        assignedAt: FieldValue.serverTimestamp(),
      });
    });
    return { assigned: fresh, skipped: uids.filter((_, i) => existing[i].exists) };
  });
}

/** Unassign one student — only before that assignment has ever started. */
export async function unassignChallenge(callerUid: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const [uid] = uidList([body.uid]);
  const db = adminDb();
  const { ref } = await ownedChallenge(db, callerUid, body.challengeId);
  const aRef = db.doc(`challengeAssignments/${assignmentId(ref.id, uid)}`);
  return db.runTransaction(async (tx) => {
    const a = await tx.get(aRef);
    if (!a.exists) throw new RoomError(404, 'no-assignment');
    if (startedAssignment(a.data()!)) throw new RoomError(409, 'started');
    tx.delete(aRef);
    return { ok: true as const };
  });
}
