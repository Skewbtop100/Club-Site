import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from 'firebase/firestore';

// Rules tests for the coach challenge, phase 2 (docs/challenge-plan.md):
// coaches/{uid}, roomCodes/{code}, rooms/{roomId}, rooms/{roomId}/members/{uid}
// and the collection-group read of a student's own memberships.
//
// Every WRITE to rooms, members and roomCodes goes through app/api/rooms/*
// (Admin SDK, which bypasses rules) — so here every client write must fail,
// even the room's own coach and the club admin. What clients may READ:
//   room     — its coach; a pending or active member (not a removed one)
//   member   — the student's own doc always (removed included, plan N4);
//              the coach: pending + active only (plan decision 24)
//   coaches  — the coach themself or the admin; writes admin only
//
// Same conventions as the other suites: RULES_PATH overrides the rules
// file, the emulator is assumed to be up (npm run test:rules wraps that).
const RULES = process.env.RULES_PATH ?? 'firestore.rules';

const ADMIN = 'admin1';
const COACH = 'coach1';        // coaches/coach1 active
const COACH2 = 'coach2';       // coaches/coach2 active, owns room2, member of room1
const REVOKED = 'revoked1';    // coaches/revoked1 active:false
const PENDING = 'pending1';
const ACTIVE = 'active1';
const REMOVED = 'removed1';
const STRANGER = 'stranger1';

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-rooms',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

async function check(name, expect, fn) {
  let ok;
  let detail;
  try {
    if (expect === 'ALLOW') await assertSucceeds(fn());
    else await assertFails(fn());
    ok = true;
  } catch (e) {
    ok = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [expected ${expect}] ${name}`);
  if (!ok) console.log(`          -> ${detail}`);
}

const member = (uid, roomId, status) => ({
  uid, roomId, roomName: 'Room', coachName: 'Coach', displayName: uid, photoURL: null,
  status, requestedAt: null, decidedAt: null,
});

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of [[ADMIN, 'admin'], [COACH, 'member'], [COACH2, 'athlete'], [REVOKED, 'member'],
      [PENDING, 'member'], [ACTIVE, 'member'], [REMOVED, 'member'], [STRANGER, 'member']]) {
      await setDoc(doc(db, 'users', uid), { uid, role, displayName: uid });
    }
    await setDoc(doc(db, 'coaches', COACH), { uid: COACH, active: true });
    await setDoc(doc(db, 'coaches', COACH2), { uid: COACH2, active: true });
    await setDoc(doc(db, 'coaches', REVOKED), { uid: REVOKED, active: false });
    await setDoc(doc(db, 'rooms', 'room1'), { name: 'Room 1', coachUid: COACH, coachName: 'Coach', code: 'ABC234', archived: false });
    await setDoc(doc(db, 'rooms', 'room2'), { name: 'Room 2', coachUid: COACH2, coachName: 'Coach 2', code: 'XYZ789', archived: false });
    await setDoc(doc(db, 'roomCodes', 'ABC234'), { roomId: 'room1', coachUid: COACH });
    await setDoc(doc(db, 'rooms', 'room1', 'members', PENDING), member(PENDING, 'room1', 'pending'));
    await setDoc(doc(db, 'rooms', 'room1', 'members', ACTIVE), member(ACTIVE, 'room1', 'active'));
    await setDoc(doc(db, 'rooms', 'room1', 'members', REMOVED), member(REMOVED, 'room1', 'removed'));
    await setDoc(doc(db, 'rooms', 'room1', 'members', COACH2), member(COACH2, 'room1', 'active'));
    await setDoc(doc(db, 'rooms', 'room2', 'members', ACTIVE), member(ACTIVE, 'room2', 'pending'));
  });
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const asJudge = () => testEnv.authenticatedContext('judge1', { role: 'judge', competitionId: 'c1' }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const membersOf = (db, roomId) => collection(db, 'rooms', roomId, 'members');

await seed();

console.log('\n=== coaches/{uid} — only the admin grants ===\n');
await check('C1. admin grants a coach', 'ALLOW', () =>
  setDoc(doc(as(ADMIN), 'coaches', STRANGER), { uid: STRANGER, active: true }));
await check('C2. a member cannot make themselves a coach', 'DENY', () =>
  setDoc(doc(as(PENDING), 'coaches', PENDING), { uid: PENDING, active: true }));
await check('C3. a coach cannot grant another account', 'DENY', () =>
  setDoc(doc(as(COACH), 'coaches', STRANGER), { uid: STRANGER, active: true }));
await check('C4. a revoked coach cannot re-activate themselves', 'DENY', () =>
  updateDoc(doc(as(REVOKED), 'coaches', REVOKED), { active: true }));
await check('C5. a coach reads their own coach doc', 'ALLOW', () => getDoc(doc(as(COACH), 'coaches', COACH)));
await check('C6. a member cannot read someone else\'s coach doc', 'DENY', () => getDoc(doc(as(PENDING), 'coaches', COACH)));
await check('C7. admin lists all coaches', 'ALLOW', () => getDocs(collection(as(ADMIN), 'coaches')));
await check('C8. a non-admin cannot list coaches', 'DENY', () => getDocs(collection(as(COACH), 'coaches')));
await check('C9. admin revokes a coach', 'ALLOW', () => updateDoc(doc(as(ADMIN), 'coaches', COACH2), { active: false }));
await check('C10. a judge session cannot grant itself coach', 'DENY', () =>
  setDoc(doc(asJudge(), 'coaches', 'judge1'), { uid: 'judge1', active: true }));
await seed();

console.log('\n=== roomCodes/{code} — server only ===\n');
await check('K1. a signed-in user cannot read a code', 'DENY', () => getDoc(doc(as(STRANGER), 'roomCodes', 'ABC234')));
await check('K2. the room\'s own coach cannot read it either', 'DENY', () => getDoc(doc(as(COACH), 'roomCodes', 'ABC234')));
await check('K3. nobody lists codes', 'DENY', () => getDocs(collection(as(ADMIN), 'roomCodes')));
await check('K4. a coach cannot claim a code from the client', 'DENY', () =>
  setDoc(doc(as(COACH), 'roomCodes', 'QQQ234'), { roomId: 'room1', coachUid: COACH }));

console.log('\n=== rooms/{roomId} — reads ===\n');
await check('R1. coach reads their room', 'ALLOW', () => getDoc(doc(as(COACH), 'rooms', 'room1')));
await check('R2. an active member reads the room', 'ALLOW', () => getDoc(doc(as(ACTIVE), 'rooms', 'room1')));
await check('R3. a pending member reads the room', 'ALLOW', () => getDoc(doc(as(PENDING), 'rooms', 'room1')));
await check('R4. a REMOVED student cannot read room data', 'DENY', () => getDoc(doc(as(REMOVED), 'rooms', 'room1')));
await check('R5. a stranger cannot read another room', 'DENY', () => getDoc(doc(as(STRANGER), 'rooms', 'room1')));
await check('R6. another coach cannot read a room they don\'t coach or belong to', 'DENY', () =>
  getDoc(doc(as(COACH), 'rooms', 'room2')));
await check('R7. a coach who is a student in another coach\'s room reads it', 'ALLOW', () =>
  getDoc(doc(as(COACH2), 'rooms', 'room1')));
await check('R8. coach lists their own rooms', 'ALLOW', () =>
  getDocs(query(collection(as(COACH), 'rooms'), where('coachUid', '==', COACH))));
await check('R9. listing all rooms is refused', 'DENY', () => getDocs(collection(as(COACH), 'rooms')));
await check('R10. listing another coach\'s rooms is refused', 'DENY', () =>
  getDocs(query(collection(as(COACH), 'rooms'), where('coachUid', '==', COACH2))));
await check('R11. signed-out cannot read a room', 'DENY', () => getDoc(doc(anon(), 'rooms', 'room1')));
await check('R12. the admin has no blanket read of other coaches\' rooms', 'DENY', () => getDoc(doc(as(ADMIN), 'rooms', 'room1')));

console.log('\n=== rooms/{roomId} — every client write refused ===\n');
await check('W1. a coach cannot create a room from the client', 'DENY', () =>
  setDoc(doc(as(COACH), 'rooms', 'roomX'), { name: 'X', coachUid: COACH, code: 'QQQ234', archived: false }));
await check('W2. a non-coach cannot create a room', 'DENY', () =>
  setDoc(doc(as(STRANGER), 'rooms', 'roomY'), { name: 'Y', coachUid: STRANGER, code: 'QQQ235', archived: false }));
await check('W3. the admin cannot create a room from the client either', 'DENY', () =>
  setDoc(doc(as(ADMIN), 'rooms', 'roomZ'), { name: 'Z', coachUid: ADMIN, code: 'QQQ236', archived: false }));
await check('W4. coach cannot rename from the client (server route only)', 'DENY', () =>
  updateDoc(doc(as(COACH), 'rooms', 'room1'), { name: 'Renamed' }));
await check('W5. coach cannot change the code from the client', 'DENY', () =>
  updateDoc(doc(as(COACH), 'rooms', 'room1'), { code: 'QQQ237' }));
await check('W6. a member cannot take over the room', 'DENY', () =>
  updateDoc(doc(as(ACTIVE), 'rooms', 'room1'), { coachUid: ACTIVE }));
await check('W7. nobody deletes a room', 'DENY', () => deleteDoc(doc(as(COACH), 'rooms', 'room1')));

console.log('\n=== members — reads ===\n');
await check('M1. a pending student reads their own membership', 'ALLOW', () =>
  getDoc(doc(as(PENDING), 'rooms', 'room1', 'members', PENDING)));
await check('M2. a REMOVED student still reads their own membership (N4)', 'ALLOW', () =>
  getDoc(doc(as(REMOVED), 'rooms', 'room1', 'members', REMOVED)));
await check('M3. coach reads a pending member', 'ALLOW', () =>
  getDoc(doc(as(COACH), 'rooms', 'room1', 'members', PENDING)));
await check('M4. coach reads an active member', 'ALLOW', () =>
  getDoc(doc(as(COACH), 'rooms', 'room1', 'members', ACTIVE)));
await check('M5. coach CANNOT read a removed member (decision 24)', 'DENY', () =>
  getDoc(doc(as(COACH), 'rooms', 'room1', 'members', REMOVED)));
await check('M6. coach lists pending + active members', 'ALLOW', () =>
  getDocs(query(membersOf(as(COACH), 'room1'), where('status', 'in', ['pending', 'active']))));
await check('M7. coach cannot list members without the status filter', 'DENY', () =>
  getDocs(membersOf(as(COACH), 'room1')));
await check('M8. coach cannot list removed members', 'DENY', () =>
  getDocs(query(membersOf(as(COACH), 'room1'), where('status', '==', 'removed'))));
await check('M9. a student cannot read another student\'s membership', 'DENY', () =>
  getDoc(doc(as(ACTIVE), 'rooms', 'room1', 'members', PENDING)));
await check('M10. a student cannot list the room\'s members', 'DENY', () =>
  getDocs(query(membersOf(as(ACTIVE), 'room1'), where('status', 'in', ['pending', 'active']))));
await check('M11. another coach (a student here) cannot list this room\'s members', 'DENY', () =>
  getDocs(query(membersOf(as(COACH2), 'room1'), where('status', 'in', ['pending', 'active']))));
await check('M12. a student lists their own memberships across rooms', 'ALLOW', () =>
  getDocs(query(collectionGroup(as(ACTIVE), 'members'), where('uid', '==', ACTIVE))));
await check('M13. a removed student still lists their own memberships', 'ALLOW', () =>
  getDocs(query(collectionGroup(as(REMOVED), 'members'), where('uid', '==', REMOVED))));
await check('M14. listing someone else\'s memberships is refused', 'DENY', () =>
  getDocs(query(collectionGroup(as(STRANGER), 'members'), where('uid', '==', ACTIVE))));
await check('M15. an unfiltered collection-group read is refused', 'DENY', () =>
  getDocs(collectionGroup(as(COACH), 'members')));

console.log('\n=== members — every client write refused ===\n');
await check('X1. a student cannot approve themselves', 'DENY', () =>
  updateDoc(doc(as(PENDING), 'rooms', 'room1', 'members', PENDING), { status: 'active' }));
await check('X2. a student cannot create an active membership', 'DENY', () =>
  setDoc(doc(as(STRANGER), 'rooms', 'room1', 'members', STRANGER), member(STRANGER, 'room1', 'active')));
await check('X3. a student cannot create even a pending request directly', 'DENY', () =>
  setDoc(doc(as(STRANGER), 'rooms', 'room1', 'members', STRANGER), member(STRANGER, 'room1', 'pending')));
await check('X4. a removed student cannot un-remove themselves', 'DENY', () =>
  updateDoc(doc(as(REMOVED), 'rooms', 'room1', 'members', REMOVED), { status: 'active' }));
await check('X5. coach cannot approve from the client (server route only)', 'DENY', () =>
  updateDoc(doc(as(COACH), 'rooms', 'room1', 'members', PENDING), { status: 'active' }));
await check('X6. coach cannot delete a membership', 'DENY', () =>
  deleteDoc(doc(as(COACH), 'rooms', 'room1', 'members', ACTIVE)));
await check('X7. a student cannot delete their own (history is kept)', 'DENY', () =>
  deleteDoc(doc(as(ACTIVE), 'rooms', 'room1', 'members', ACTIVE)));
await check('X8. a student cannot write a membership into another student\'s slot', 'DENY', () =>
  setDoc(doc(as(STRANGER), 'rooms', 'room1', 'members', PENDING), member(PENDING, 'room1', 'active')));

console.log('\n=== judge sessions get nothing ===\n');
await check('J1. a judge cannot read a room', 'DENY', () => getDoc(doc(asJudge(), 'rooms', 'room1')));
await check('J2. a judge cannot list rooms', 'DENY', () =>
  getDocs(query(collection(asJudge(), 'rooms'), where('coachUid', '==', COACH))));
await check('J3. a judge cannot read a membership', 'DENY', () =>
  getDoc(doc(asJudge(), 'rooms', 'room1', 'members', ACTIVE)));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail ? 1 : 0);
