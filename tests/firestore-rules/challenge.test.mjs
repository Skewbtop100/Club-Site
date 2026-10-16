import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from 'firebase/firestore';

// Rules tests for the coach challenge, phase 3 (docs/challenge-plan.md):
// challenges/{id} and challengeAssignments/{challengeId}_{studentUid}.
//
// Every WRITE goes through app/api/challenge/* (Admin SDK), so here every
// client write must fail — the coach's own, an admin's, a student's, and
// in particular any attempt to edit or unlock a started (locked) challenge.
// What clients may READ:
//   challenge   — its coach only
//   assignment  — the student always (removed included, plan N4); the
//                 coach only while visibleToCoach == true (decision 24)
//
// Same conventions as rooms.test.mjs: RULES_PATH overrides the rules file,
// the emulator is assumed to be up (npm run test:rules wraps that).
const RULES = process.env.RULES_PATH ?? 'firestore.rules';

const ADMIN = 'admin1';
const COACH = 'coach1';      // owns room1, challenges ch1 (unlocked) and ch2 (locked)
const COACH2 = 'coach2';     // owns room2 and ch3
const S1 = 'student1';       // active in room1, assigned ch1 + ch2
const S2 = 'student2';       // active in room1, assigned ch1
const REMOVED = 'removed1';  // removed from room1, assigned ch1 (hidden from the coach)
const STRANGER = 'stranger1';

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-challenges',
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

const template = { event: '222', metric: 'ao5', targetMs: 2000, streak: 5, title: '2x2 Ao5 < 2.00 × 5', note: '' };
const challenge = (coachUid, roomId, locked) => ({
  ...template, coachUid, roomId, locked, duplicatedFrom: null, archived: false, createdAt: null,
});
const assignment = (challengeId, roomId, coachUid, studentUid, visibleToCoach = true, extra = {}) => ({
  challengeId, roomId, coachUid, studentUid, studentName: studentUid, template,
  status: 'assigned', visibleToCoach,
  firstStartedAt: null, firstStartedUbDate: null, completedAt: null, daysTaken: null,
  sessionsCount: 0, blocksAttempted: 0, bestStreak: 0, assignedAt: null, ...extra,
});
const member = (uid, roomId, status) => ({
  uid, roomId, roomName: 'Room', coachName: 'Coach', displayName: uid, photoURL: null,
  status, requestedAt: null, decidedAt: null,
});

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of [[ADMIN, 'admin'], [COACH, 'member'], [COACH2, 'member'],
      [S1, 'member'], [S2, 'member'], [REMOVED, 'member'], [STRANGER, 'member']]) {
      await setDoc(doc(db, 'users', uid), { uid, role, displayName: uid });
    }
    await setDoc(doc(db, 'coaches', COACH), { uid: COACH, active: true });
    await setDoc(doc(db, 'coaches', COACH2), { uid: COACH2, active: true });
    await setDoc(doc(db, 'rooms', 'room1'), { name: 'Room 1', coachUid: COACH, coachName: 'Coach', code: 'ABC234', archived: false });
    await setDoc(doc(db, 'rooms', 'room2'), { name: 'Room 2', coachUid: COACH2, coachName: 'Coach 2', code: 'XYZ789', archived: false });
    await setDoc(doc(db, 'rooms', 'room1', 'members', S1), member(S1, 'room1', 'active'));
    await setDoc(doc(db, 'rooms', 'room1', 'members', S2), member(S2, 'room1', 'active'));
    await setDoc(doc(db, 'rooms', 'room1', 'members', REMOVED), member(REMOVED, 'room1', 'removed'));
    await setDoc(doc(db, 'challenges', 'ch1'), challenge(COACH, 'room1', false));
    await setDoc(doc(db, 'challenges', 'ch2'), challenge(COACH, 'room1', true));
    await setDoc(doc(db, 'challenges', 'ch3'), challenge(COACH2, 'room2', false));
    await setDoc(doc(db, 'challengeAssignments', `ch1_${S1}`), assignment('ch1', 'room1', COACH, S1));
    await setDoc(doc(db, 'challengeAssignments', `ch1_${S2}`), assignment('ch1', 'room1', COACH, S2));
    await setDoc(doc(db, 'challengeAssignments', `ch1_${REMOVED}`), assignment('ch1', 'room1', COACH, REMOVED, false));
    await setDoc(doc(db, 'challengeAssignments', `ch2_${S1}`), assignment('ch2', 'room1', COACH, S1, true,
      { status: 'in-progress', firstStartedAt: null, sessionsCount: 1 }));
    // Phase 4: a running session for S1, a closed one for REMOVED (hidden
    // from the coach), and S1's live pointer.
    await setDoc(doc(db, 'challengeSessions', 'sess1'), session('sess1', S1, 'active', true));
    await setDoc(doc(db, 'challengeSessions', 'sessR'), session('sessR', REMOVED, 'ended', false));
    await setDoc(doc(db, 'challengeLive', S1), { sessionId: 'sess1', assignmentId: `ch2_${S1}`, template, endsAt: null });
  });
}

function session(id, studentUid, status, visibleToCoach) {
  return {
    assignmentId: `ch2_${studentUid}`, challengeId: 'ch2', roomId: 'room1', coachUid: COACH, studentUid,
    template, startedAt: null, endsAt: null, ubDate: '2026-10-16', status, endedAt: null,
    solves: [], blocks: [], currentStreak: 0, bestStreak: 0, blocksAttempted: 0, flags: [], visibleToCoach,
  };
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const asJudge = () => testEnv.authenticatedContext('judge1', { role: 'judge', competitionId: 'c1' }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const assignments = (db) => collection(db, 'challengeAssignments');

await seed();

console.log('\n=== challenges — reads ===\n');
await check('CR1. coach reads their own challenge', 'ALLOW', () => getDoc(doc(as(COACH), 'challenges', 'ch1')));
await check('CR2. coach lists their challenges for a room', 'ALLOW', () =>
  getDocs(query(collection(as(COACH), 'challenges'), where('coachUid', '==', COACH), where('roomId', '==', 'room1'))));
await check('CR3. another coach cannot read it', 'DENY', () => getDoc(doc(as(COACH2), 'challenges', 'ch1')));
await check('CR4. another coach cannot list it', 'DENY', () =>
  getDocs(query(collection(as(COACH2), 'challenges'), where('coachUid', '==', COACH))));
await check('CR5. an assigned student cannot read the challenge (template is in the assignment)', 'DENY', () =>
  getDoc(doc(as(S1), 'challenges', 'ch1')));
await check('CR6. listing all challenges is refused', 'DENY', () => getDocs(collection(as(COACH), 'challenges')));
await check('CR7. the admin has no blanket read of a coach\'s challenge', 'DENY', () => getDoc(doc(as(ADMIN), 'challenges', 'ch1')));
await check('CR8. signed-out cannot read', 'DENY', () => getDoc(doc(anon(), 'challenges', 'ch1')));

console.log('\n=== challenges — every client write refused ===\n');
await check('CW1. coach cannot create a challenge from the client', 'DENY', () =>
  setDoc(doc(as(COACH), 'challenges', 'chX'), challenge(COACH, 'room1', false)));
await check('CW2. a student cannot create a challenge', 'DENY', () =>
  setDoc(doc(as(S1), 'challenges', 'chY'), challenge(S1, 'room1', false)));
await check('CW3. the admin cannot create one from the client either', 'DENY', () =>
  setDoc(doc(as(ADMIN), 'challenges', 'chZ'), challenge(ADMIN, 'room1', false)));
await check('CW4. coach cannot edit even an UNLOCKED challenge from the client (server route only)', 'DENY', () =>
  updateDoc(doc(as(COACH), 'challenges', 'ch1'), { targetMs: 1500 }));
await check('CW5. coach cannot edit a LOCKED challenge from the client', 'DENY', () =>
  updateDoc(doc(as(COACH), 'challenges', 'ch2'), { targetMs: 1500 }));
await check('CW6. coach cannot unlock a started challenge (locked: false)', 'DENY', () =>
  updateDoc(doc(as(COACH), 'challenges', 'ch2'), { locked: false }));
await check('CW7. coach cannot overwrite a locked challenge with setDoc', 'DENY', () =>
  setDoc(doc(as(COACH), 'challenges', 'ch2'), challenge(COACH, 'room1', false)));
await check('CW8. coach cannot delete a challenge from the client', 'DENY', () => deleteDoc(doc(as(COACH), 'challenges', 'ch1')));
await check('CW9. a student cannot edit a challenge', 'DENY', () => updateDoc(doc(as(S1), 'challenges', 'ch1'), { targetMs: 99990 }));
await check('CW10. another coach cannot touch it', 'DENY', () => updateDoc(doc(as(COACH2), 'challenges', 'ch1'), { title: 'x' }));

console.log('\n=== assignments — reads ===\n');
await check('AR1. a student reads their own assignment', 'ALLOW', () => getDoc(doc(as(S1), 'challengeAssignments', `ch1_${S1}`)));
await check('AR2. a student lists their own assignments', 'ALLOW', () =>
  getDocs(query(assignments(as(S1)), where('studentUid', '==', S1))));
await check('AR3. a student CANNOT read another student\'s assignment', 'DENY', () =>
  getDoc(doc(as(S1), 'challengeAssignments', `ch1_${S2}`)));
await check('AR4. a student cannot list another student\'s assignments', 'DENY', () =>
  getDocs(query(assignments(as(S1)), where('studentUid', '==', S2))));
await check('AR5. a student cannot list a challenge\'s assignments', 'DENY', () =>
  getDocs(query(assignments(as(S1)), where('challengeId', '==', 'ch1'))));
await check('AR6. a REMOVED student still reads their own assignment (N4)', 'ALLOW', () =>
  getDoc(doc(as(REMOVED), 'challengeAssignments', `ch1_${REMOVED}`)));
await check('AR7. coach reads a visible assignment', 'ALLOW', () => getDoc(doc(as(COACH), 'challengeAssignments', `ch1_${S1}`)));
await check('AR8. coach lists the room\'s visible assignments', 'ALLOW', () =>
  getDocs(query(assignments(as(COACH)), where('roomId', '==', 'room1'), where('coachUid', '==', COACH), where('visibleToCoach', '==', true))));
await check('AR9. coach CANNOT read a removed student\'s assignment (decision 24)', 'DENY', () =>
  getDoc(doc(as(COACH), 'challengeAssignments', `ch1_${REMOVED}`)));
await check('AR10. coach cannot list without the visibleToCoach filter', 'DENY', () =>
  getDocs(query(assignments(as(COACH)), where('roomId', '==', 'room1'), where('coachUid', '==', COACH))));
await check('AR11. another coach cannot read this room\'s assignments', 'DENY', () =>
  getDoc(doc(as(COACH2), 'challengeAssignments', `ch1_${S1}`)));
await check('AR12. another coach cannot list them', 'DENY', () =>
  getDocs(query(assignments(as(COACH2)), where('coachUid', '==', COACH), where('visibleToCoach', '==', true))));
await check('AR13. a stranger cannot read an assignment', 'DENY', () => getDoc(doc(as(STRANGER), 'challengeAssignments', `ch1_${S1}`)));
await check('AR14. listing every assignment is refused', 'DENY', () => getDocs(assignments(as(ADMIN))));

console.log('\n=== assignments — every client write refused ===\n');
await check('AW1. a student cannot assign themselves', 'DENY', () =>
  setDoc(doc(as(STRANGER), 'challengeAssignments', `ch1_${STRANGER}`), assignment('ch1', 'room1', COACH, STRANGER)));
await check('AW2. a student cannot assign a classmate', 'DENY', () =>
  setDoc(doc(as(S1), 'challengeAssignments', `ch3_${S2}`), assignment('ch3', 'room1', COACH, S2)));
await check('AW3. a student cannot mark their assignment completed', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeAssignments', `ch1_${S1}`), { status: 'completed' }));
await check('AW4. a student cannot write progress (bestStreak)', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeAssignments', `ch1_${S1}`), { bestStreak: 5 }));
await check('AW5. a student cannot edit the template copy', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeAssignments', `ch1_${S1}`), { 'template.targetMs': 99990 }));
await check('AW6. a student cannot un-hide themselves for the coach', 'DENY', () =>
  updateDoc(doc(as(REMOVED), 'challengeAssignments', `ch1_${REMOVED}`), { visibleToCoach: true }));
await check('AW7. a student cannot delete their assignment', 'DENY', () =>
  deleteDoc(doc(as(S1), 'challengeAssignments', `ch1_${S1}`)));
await check('AW8. coach cannot assign from the client (server route only)', 'DENY', () =>
  setDoc(doc(as(COACH), 'challengeAssignments', `ch1_${STRANGER}`), assignment('ch1', 'room1', COACH, STRANGER)));
await check('AW9. coach cannot unassign from the client', 'DENY', () =>
  deleteDoc(doc(as(COACH), 'challengeAssignments', `ch1_${S2}`)));
await check('AW10. coach cannot edit the template of a started assignment', 'DENY', () =>
  updateDoc(doc(as(COACH), 'challengeAssignments', `ch2_${S1}`), { 'template.targetMs': 1500 }));
await check('AW11. coach cannot see a removed student by flipping visibleToCoach', 'DENY', () =>
  updateDoc(doc(as(COACH), 'challengeAssignments', `ch1_${REMOVED}`), { visibleToCoach: true }));
await check('AW12. another coach cannot assign into a room they don\'t coach', 'DENY', () =>
  setDoc(doc(as(COACH2), 'challengeAssignments', `ch3_${S1}`), assignment('ch3', 'room1', COACH2, S1)));
await check('AW13. the admin cannot write assignments from the client', 'DENY', () =>
  setDoc(doc(as(ADMIN), 'challengeAssignments', `ch1_${ADMIN}`), assignment('ch1', 'room1', COACH, ADMIN)));

console.log('\n=== challengeSessions — reads (phase 4) ===\n');
const sessions = (db) => collection(db, 'challengeSessions');
await check('SR1. the student reads their own session', 'ALLOW', () => getDoc(doc(as(S1), 'challengeSessions', 'sess1')));
await check('SR2. the student lists their own sessions', 'ALLOW', () =>
  getDocs(query(sessions(as(S1)), where('studentUid', '==', S1))));
await check('SR3. another student cannot read it', 'DENY', () => getDoc(doc(as(S2), 'challengeSessions', 'sess1')));
await check('SR4. a REMOVED student still reads their own session (N4)', 'ALLOW', () => getDoc(doc(as(REMOVED), 'challengeSessions', 'sessR')));
await check('SR5. the coach reads a visible session', 'ALLOW', () => getDoc(doc(as(COACH), 'challengeSessions', 'sess1')));
await check('SR6. the coach cannot read a removed student\'s session', 'DENY', () => getDoc(doc(as(COACH), 'challengeSessions', 'sessR')));
await check('SR7. the coach lists the room\'s visible sessions', 'ALLOW', () =>
  getDocs(query(sessions(as(COACH)), where('roomId', '==', 'room1'), where('coachUid', '==', COACH), where('visibleToCoach', '==', true))));
await check('SR8. another coach cannot read it', 'DENY', () => getDoc(doc(as(COACH2), 'challengeSessions', 'sess1')));
await check('SR9. listing all sessions is refused', 'DENY', () => getDocs(sessions(as(ADMIN))));

console.log('\n=== coach live view queries (4b) ===\n');
const liveQuery = (db, roomId, coachUid) => query(sessions(db),
  where('roomId', '==', roomId), where('coachUid', '==', coachUid),
  where('visibleToCoach', '==', true), where('status', '==', 'active'));
await check('LV1. the coach listens to their room\'s running sessions', 'ALLOW', () => getDocs(liveQuery(as(COACH), 'room1', COACH)));
await check('LV2. …and the result never contains a removed student\'s session', 'ALLOW', async () => {
  const snap = await getDocs(query(sessions(as(COACH)),
    where('roomId', '==', 'room1'), where('coachUid', '==', COACH), where('visibleToCoach', '==', true)));
  if (snap.docs.some(d => d.id === 'sessR')) throw new Error('removed student\'s session delivered');
  if (!snap.docs.some(d => d.id === 'sess1')) throw new Error('own visible session missing');
  return snap;
});
await check('LV3. the live query without visibleToCoach is refused', 'DENY', () =>
  getDocs(query(sessions(as(COACH)), where('roomId', '==', 'room1'), where('coachUid', '==', COACH), where('status', '==', 'active'))));
await check('LV4. another coach cannot listen to this room', 'DENY', () => getDocs(liveQuery(as(COACH2), 'room1', COACH)));
await check('LV5. another coach\'s own-uid query on this room returns nothing of it', 'ALLOW', async () => {
  const snap = await getDocs(liveQuery(as(COACH2), 'room1', COACH2));
  if (!snap.empty) throw new Error('foreign sessions delivered');
  return snap;
});
await check('LV6. a student cannot listen to the room\'s sessions', 'DENY', () => getDocs(liveQuery(as(S1), 'room1', COACH)));
await check('LV7. the coach listens to the room\'s visible assignments', 'ALLOW', () =>
  getDocs(query(assignments(as(COACH)), where('roomId', '==', 'room1'), where('coachUid', '==', COACH), where('visibleToCoach', '==', true))));
await check('LV8. a judge cannot listen', 'DENY', () => getDocs(liveQuery(asJudge(), 'room1', COACH)));

console.log('\n=== challengeSessions — every client write refused ===\n');
await check('SW1. a student cannot start their own challenge (create a session)', 'DENY', () =>
  setDoc(doc(as(S1), 'challengeSessions', 'mine'), session('mine', S1, 'active', true)));
await check('SW2. a student cannot append a solve', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeSessions', 'sess1'), { solves: [{ seq: 1, ms: 100, penalty: 'none', stoppedAt: 1 }] }));
await check('SW3. a student cannot set their streak / progress', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeSessions', 'sess1'), { currentStreak: 5, bestStreak: 5 }));
await check('SW4. a student cannot extend the end time', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeSessions', 'sess1'), { endsAt: null }));
await check('SW5. a student cannot mark it completed', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeSessions', 'sess1'), { status: 'completed' }));
await check('SW6. a student cannot delete a session (e.g. a bad one)', 'DENY', () => deleteDoc(doc(as(S1), 'challengeSessions', 'sess1')));
await check('SW7. the coach cannot start a session from the client', 'DENY', () =>
  setDoc(doc(as(COACH), 'challengeSessions', 'byCoach'), session('byCoach', S2, 'active', true)));
await check('SW8. the coach cannot edit a session', 'DENY', () =>
  updateDoc(doc(as(COACH), 'challengeSessions', 'sess1'), { status: 'ended' }));
await check('SW9. the admin cannot write a session from the client', 'DENY', () =>
  setDoc(doc(as(ADMIN), 'challengeSessions', 'byAdmin'), session('byAdmin', S1, 'active', true)));

console.log('\n=== challengeLive — own read only, no writes ===\n');
await check('L1. the student reads their own pointer', 'ALLOW', () => getDoc(doc(as(S1), 'challengeLive', S1)));
await check('L2. another student cannot read it', 'DENY', () => getDoc(doc(as(S2), 'challengeLive', S1)));
await check('L3. the coach cannot read it', 'DENY', () => getDoc(doc(as(COACH), 'challengeLive', S1)));
await check('L4. nobody lists pointers', 'DENY', () => getDocs(collection(as(ADMIN), 'challengeLive')));
await check('L5. a student cannot point their own timer at a session (self-start)', 'DENY', () =>
  setDoc(doc(as(S2), 'challengeLive', S2), { sessionId: 'sess1', assignmentId: `ch1_${S2}`, template, endsAt: null }));
await check('L6. a student cannot clear / extend their pointer', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeLive', S1), { endsAt: null, sessionId: null }));
await check('L7. the coach cannot write a pointer', 'DENY', () =>
  setDoc(doc(as(COACH), 'challengeLive', S2), { sessionId: 'x', assignmentId: 'y', template, endsAt: null }));

console.log('\n=== progress on the assignment stays server-only ===\n');
await check('P1. a student cannot write completion fields', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeAssignments', `ch2_${S1}`), { status: 'completed', completedAt: null, daysTaken: 1 }));
await check('P2. a student cannot set sessionsCount / blocksAttempted', 'DENY', () =>
  updateDoc(doc(as(S1), 'challengeAssignments', `ch2_${S1}`), { sessionsCount: 0, blocksAttempted: 99 }));
await check('P3. the coach cannot set an active session pointer on the assignment', 'DENY', () =>
  updateDoc(doc(as(COACH), 'challengeAssignments', `ch2_${S1}`), { activeSessionId: 'x' }));

console.log('\n=== judge sessions get nothing ===\n');
await check('J4. a judge cannot read a challenge session', 'DENY', () => getDoc(doc(asJudge(), 'challengeSessions', 'sess1')));
await check('J5. a judge cannot read a live pointer', 'DENY', () => getDoc(doc(asJudge(), 'challengeLive', S1)));
await check('J1. a judge cannot read a challenge', 'DENY', () => getDoc(doc(asJudge(), 'challenges', 'ch1')));
await check('J2. a judge cannot read an assignment', 'DENY', () => getDoc(doc(asJudge(), 'challengeAssignments', `ch1_${S1}`)));
await check('J3. a judge cannot write a challenge', 'DENY', () =>
  setDoc(doc(asJudge(), 'challenges', 'chJ'), challenge('judge1', 'room1', false)));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail ? 1 : 0);
