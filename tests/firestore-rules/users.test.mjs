import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

// Rules tests for users/{uid} — and for isAdmin(), which reads its role.
//
// THE HOLE THESE CLOSE: `allow write: if request.auth.uid == uid` let any
// signed-in user write role: 'admin' on their own document. isAdmin() reads
// exactly that field, and it gates onlineSubmissions update/delete, draft
// competitions, and more — so one write made anyone a judge.
//
// Also pinned: every legitimate client write to a users document still
// works (auth-context's upsert, the profile edit, points.ts), a club admin
// can still manage users and still do admin things, and isAdmin() fails
// closed on a missing document, a missing role, or a wrong value.
//
// Same conventions as the other suites: RULES_PATH overrides the rules
// file, the emulator is assumed to be up (npm run test:rules wraps that).
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const ADMIN = 'admin1';
const MEMBER = 'member1';
const NEWBIE = 'newbie1';
const NO_DOC = 'nodoc1';
const NO_ROLE = 'norole1';
const WRONG_CASE = 'wrongcase1';

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-users',
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

const SUBMISSION = 'member1__comp1__333__r1__a1';

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', points: 0 });
    await setDoc(doc(db, 'users', MEMBER), { uid: MEMBER, role: 'member', displayName: 'M', points: 10, athleteId: null });
    await setDoc(doc(db, 'users', NO_ROLE), { uid: NO_ROLE, displayName: 'No role' });
    await setDoc(doc(db, 'users', WRONG_CASE), { uid: WRONG_CASE, role: 'Admin' });
    await setDoc(doc(db, 'onlineCompetitions', 'draft1'), { name: 'Draft', status: 'draft' });
    await setDoc(doc(db, 'onlineSubmissions', SUBMISSION), {
      uid: MEMBER, competitionId: 'comp1', event: '333', round: 1, competitionRound: 1,
      reportedTime: 1234, isDnf: false, penalty: null, status: 'pending',
    });
  });
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

console.log('\n=== users/{uid} — nobody grants themselves a role ===\n');
await seed();

// ── the legitimate writes still work ───────────────────────────────────
await check('U1. first sign-in creates the doc exactly as auth-context does (role member)', 'ALLOW', () =>
  setDoc(doc(as(NEWBIE), 'users', NEWBIE), {
    uid: NEWBIE, displayName: 'New', email: 'n@example.com', photoURL: null, role: 'member',
    points: 0, athleteId: null, unlockedTools: [], createdAt: serverTimestamp(), lastLoginAt: serverTimestamp(),
  }));
await check('U2. later sign-in refreshes lastLoginAt / displayName / photoURL', 'ALLOW', () =>
  updateDoc(doc(as(MEMBER), 'users', MEMBER), { lastLoginAt: serverTimestamp(), displayName: 'M2', photoURL: null }));
await check('U3. the profile edit (displayName)', 'ALLOW', () =>
  updateDoc(doc(as(MEMBER), 'users', MEMBER), { displayName: 'Renamed' }));
await check('U4. a points.ts transaction write (points, lastDailyBonus, totalSolves)', 'ALLOW', () =>
  updateDoc(doc(as(MEMBER), 'users', MEMBER), { points: 15, lastDailyBonus: serverTimestamp(), totalSolves: 3 }));
await check('U5. a merge write that carries the unchanged role forward', 'ALLOW', () =>
  setDoc(doc(as(MEMBER), 'users', MEMBER), { role: 'member', displayName: 'Same role' }, { merge: true }));

// ── self-escalation is refused, every way it can be spelled ────────────
await seed();
await check('U6. creating your own doc as admin', 'DENY', () =>
  setDoc(doc(as(NEWBIE), 'users', NEWBIE), { uid: NEWBIE, role: 'admin' }));
await check('U7. creating your own doc as athlete', 'DENY', () =>
  setDoc(doc(as(NEWBIE), 'users', NEWBIE), { uid: NEWBIE, role: 'athlete' }));
await check('U8. updateDoc your own role to admin', 'DENY', () =>
  updateDoc(doc(as(MEMBER), 'users', MEMBER), { role: 'admin' }));
await check('U9. setDoc merge your own role to admin', 'DENY', () =>
  setDoc(doc(as(MEMBER), 'users', MEMBER), { role: 'admin' }, { merge: true }));
await check('U10. overwrite your own whole doc with role admin', 'DENY', () =>
  setDoc(doc(as(MEMBER), 'users', MEMBER), { uid: MEMBER, role: 'admin', points: 10 }));
await check('U11. slip role in beside a legitimate field', 'DENY', () =>
  updateDoc(doc(as(MEMBER), 'users', MEMBER), { displayName: 'innocent', role: 'admin' }));
await check('U12. delete your own role field', 'DENY', () =>
  updateDoc(doc(as(MEMBER), 'users', MEMBER), { role: deleteField() }));
await check('U13. give a role field to your own doc that had none', 'DENY', () =>
  updateDoc(doc(as(NO_ROLE), 'users', NO_ROLE), { role: 'admin' }));
await check('U14. write someone else\'s doc', 'DENY', () =>
  updateDoc(doc(as(MEMBER), 'users', NO_ROLE), { displayName: 'hijacked' }));
await check('U15. create a doc for someone else', 'DENY', () =>
  setDoc(doc(as(MEMBER), 'users', 'someone-else'), { uid: 'someone-else', role: 'member' }));

// ── ...so the escalation it enabled is gone ─────────────────────────────
await check('E1. the member still cannot approve their own submission', 'DENY', () =>
  updateDoc(doc(as(MEMBER), 'onlineSubmissions', SUBMISSION), { status: 'approved' }));
await check('E2. ...cannot read a draft competition', 'DENY', () =>
  getDoc(doc(as(MEMBER), 'onlineCompetitions', 'draft1')));
await check('E3. ...cannot delete a submission', 'DENY', () =>
  deleteDoc(doc(as(MEMBER), 'onlineSubmissions', SUBMISSION)));

// ── an admin can still do admin things ─────────────────────────────────
await seed();
await check('A1. an admin changes another user\'s role (UsersTab)', 'ALLOW', () =>
  updateDoc(doc(as(ADMIN), 'users', MEMBER), { role: 'athlete' }));
await check('A2. an admin adjusts points and links an athlete (UsersTab)', 'ALLOW', () =>
  updateDoc(doc(as(ADMIN), 'users', MEMBER), { points: 110, athleteId: 'ath1', role: 'athlete' }));
await check('A3. an admin reads a draft competition', 'ALLOW', () =>
  getDoc(doc(as(ADMIN), 'onlineCompetitions', 'draft1')));
await check('A4. an admin updates a submission', 'ALLOW', () =>
  updateDoc(doc(as(ADMIN), 'onlineSubmissions', SUBMISSION), { status: 'approved' }));
await check('A5. an admin deletes a submission', 'ALLOW', () =>
  deleteDoc(doc(as(ADMIN), 'onlineSubmissions', SUBMISSION)));
await check('A6. an admin can still edit their own doc', 'ALLOW', () =>
  updateDoc(doc(as(ADMIN), 'users', ADMIN), { displayName: 'Admin' }));

// ── isAdmin() fails closed ─────────────────────────────────────────────
await seed();
await check('F1. no users document: not an admin', 'DENY', () =>
  getDoc(doc(as(NO_DOC), 'onlineCompetitions', 'draft1')));
await check('F2. a users document with no role: not an admin', 'DENY', () =>
  getDoc(doc(as(NO_ROLE), 'onlineCompetitions', 'draft1')));
await check('F3. role "Admin" (wrong case): not an admin', 'DENY', () =>
  getDoc(doc(as(WRONG_CASE), 'onlineCompetitions', 'draft1')));
await check('F4. signed out: not an admin', 'DENY', () =>
  getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'onlineCompetitions', 'draft1')));

// ── the judges' login counters are server-only ──────────────────────────
await check('L1. a client cannot read a login counter, even an admin', 'DENY', () =>
  getDoc(doc(as(ADMIN), 'onlineAdminLoginAttempts', 'abc')));
await check('L2. a client cannot reset a login counter', 'DENY', () =>
  setDoc(doc(as(MEMBER), 'onlineAdminLoginAttempts', 'abc'), { count: 0, windowStartMs: 0 }));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
