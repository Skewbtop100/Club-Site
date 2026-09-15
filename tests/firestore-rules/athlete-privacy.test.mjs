import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, runTransaction, setDoc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';

// Rules tests for what an athlete's data exposes, in all three places it
// lives:
//   athletes/{id}                  the club's PUBLIC profile (anyone)
//   athletes/{id}/private/identity date of birth + phone (admin, linked owner)
//   onlineParticipants/{uid}       the online athlete's full record (self, admin)
//   users/{uid}                    the account, with its email (self, admin)
//
// THE HOLE: onlineParticipants and users were readable by any signed-in
// account, and athletes by anyone — email, date of birth, citizenship and
// verification photos, minors' included.
//
// The online athlete's PUBLIC half (name and results) is not a Firestore
// read at all: the roster and live routes project it with the Admin SDK, and
// tests/competition-fields/roster-view.test.cjs pins exactly which keys
// leave (no email, date of birth, citizenship or photo).
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const ADMIN = 'admin1';
const MEMBER = 'member1'; // owns club athlete athA, and is online athlete member1
const OTHER = 'other1';   // owns club athlete athB, and is online athlete other1
const STRANGER = 'stranger1'; // signed in, owns nothing

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-privacy',
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

/** Reads a document and throws unless it carries every `want` key and none
 *  of the `never` keys — so an ALLOW proves what came back, not just that
 *  something did. */
async function readHas(ref, want, never = []) {
  const snap = await getDoc(ref);
  const data = snap.data() ?? {};
  for (const k of want) if (!(k in data)) throw new Error(`missing ${k}`);
  for (const k of never) if (k in data) throw new Error(`carries ${k}`);
  return snap;
}

const ONLINE_FULL = (uid) => ({
  uid,
  displayName: 'Google Name',
  email: `${uid}@example.com`,
  firstName: 'Эрдэнэ', lastName: 'Бат',
  approvedFirstName: 'Эрдэнэ', approvedLastName: 'Бат',
  dateOfBirth: '2011-04-12', approvedDateOfBirth: '2011-04-12',
  gender: 'male', approvedGender: 'male',
  citizenship: 'mn', approvedCitizenship: 'mn',
  photoUrl: 'https://res.cloudinary.com/x/id.jpg', approvedPhotoUrl: 'https://res.cloudinary.com/x/id.jpg',
  profileStatus: 'approved',
  stats: { 333: { pr: 900, ao5: 1100, solveCount: 12 } },
});

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', email: 'admin@example.com' });
    await setDoc(doc(db, 'users', MEMBER), { uid: MEMBER, role: 'athlete', email: 'member@example.com', displayName: 'M', photoURL: null, points: 5, athleteId: 'athA' });
    await setDoc(doc(db, 'users', OTHER), { uid: OTHER, role: 'athlete', email: 'other@example.com', displayName: 'O', photoURL: null, points: 5, athleteId: 'athB' });
    await setDoc(doc(db, 'users', STRANGER), { uid: STRANGER, role: 'member', email: 'stranger@example.com' });

    await setDoc(doc(db, 'athletes', 'athA'), { name: 'Бат', lastName: 'Эрдэнэ', wcaId: '2019BATA01', imageUrl: 'https://example.com/a.jpg', ownerId: MEMBER });
    await setDoc(doc(db, 'athletes', 'athA', 'private', 'identity'), { birthDate: '2011-04-12', phone: '99112233' });
    await setDoc(doc(db, 'athletes', 'athB'), { name: 'Other', imageUrl: 'https://example.com/b.jpg', ownerId: OTHER });
    await setDoc(doc(db, 'athletes', 'athB', 'private', 'identity'), { birthDate: '2012-01-01' });
    // Not yet moved by the migration.
    await setDoc(doc(db, 'athletes', 'athLegacy'), { name: 'Legacy', birthDate: '2009-09-09' });

    await setDoc(doc(db, 'results', 'r1'), { athleteId: 'athA', eventId: '333', single: 900, average: 1100 });
    await setDoc(doc(db, 'wcaRecords', 'rec1'), { eventId: '333', single: 300 });

    await setDoc(doc(db, 'onlineParticipants', MEMBER), ONLINE_FULL(MEMBER));
    await setDoc(doc(db, 'onlineParticipants', OTHER), ONLINE_FULL(OTHER));
  });
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const PRIVATE_ONLINE = ['email', 'dateOfBirth', 'approvedDateOfBirth', 'citizenship', 'approvedCitizenship', 'photoUrl'];

await seed();

console.log('\n=== club athletes: the public profile ===\n');
await check('P1. a signed-in non-admin reads name, photo and WCA id — and no date of birth or phone', 'ALLOW', () =>
  readHas(doc(as(STRANGER), 'athletes', 'athA'), ['name', 'imageUrl', 'wcaId'], ['birthDate', 'phone']));
await check('P2. ...and so does a signed-out visitor (the club site is public)', 'ALLOW', () =>
  readHas(doc(anon(), 'athletes', 'athA'), ['name', 'imageUrl']));
await check('P3. a signed-in non-admin lists the athletes (rankings, roster pages)', 'ALLOW', () =>
  getDocs(collection(as(STRANGER), 'athletes')));
await check('P4. results are readable', 'ALLOW', () => getDoc(doc(as(STRANGER), 'results', 'r1')));
await check('P5. records are readable', 'ALLOW', () => getDoc(doc(as(STRANGER), 'wcaRecords', 'rec1')));

console.log('\n=== club athletes: date of birth and phone ===\n');
await check('X1. a signed-in non-admin cannot read an athlete\'s date of birth / phone', 'DENY', () =>
  getDoc(doc(as(STRANGER), 'athletes', 'athA', 'private', 'identity')));
await check('X2. an account linked to ANOTHER athlete cannot read this one\'s', 'DENY', () =>
  getDoc(doc(as(OTHER), 'athletes', 'athA', 'private', 'identity')));
await check('X3. ...nor list them', 'DENY', () =>
  getDocs(collection(as(OTHER), 'athletes', 'athA', 'private')));
await check('X4. a signed-out visitor cannot read them', 'DENY', () =>
  getDoc(doc(anon(), 'athletes', 'athA', 'private', 'identity')));
await check('X5. the private doc of an athlete with no owner is admin-only', 'DENY', () =>
  getDoc(doc(as(STRANGER), 'athletes', 'athLegacy', 'private', 'identity')));
await check('O1. the linked athlete reads their own date of birth and phone', 'ALLOW', () =>
  readHas(doc(as(MEMBER), 'athletes', 'athA', 'private', 'identity'), ['birthDate', 'phone']));
await check('O2. ...but cannot change them', 'DENY', () =>
  setDoc(doc(as(MEMBER), 'athletes', 'athA', 'private', 'identity'), { birthDate: '2000-01-01' }));
await check('O3. ...nor move a date of birth back onto their public profile', 'DENY', () =>
  updateDoc(doc(as(MEMBER), 'athletes', 'athA'), { birthDate: '2000-01-01' }));

console.log('\n=== club athletes: the admin ===\n');
await check('A1. an admin reads any athlete\'s private identity', 'ALLOW', () =>
  readHas(doc(as(ADMIN), 'athletes', 'athB', 'private', 'identity'), ['birthDate']));
await check('A2. an admin writes a private identity (AthletesTab)', 'ALLOW', () =>
  setDoc(doc(as(ADMIN), 'athletes', 'athB', 'private', 'identity'), { birthDate: '2012-02-02' }, { merge: true }));
await check('A3. an admin creates an athlete without private fields', 'ALLOW', () =>
  setDoc(doc(as(ADMIN), 'athletes', 'athNew'), { name: 'New', lastName: 'X', wcaId: '', imageUrl: '' }));
await check('A4. an admin CANNOT put a date of birth on the public profile', 'DENY', () =>
  setDoc(doc(as(ADMIN), 'athletes', 'athNew2'), { name: 'New', birthDate: '2010-01-01' }));
await check('A5. ...or a phone', 'DENY', () =>
  updateDoc(doc(as(ADMIN), 'athletes', 'athA'), { phone: '99112233' }));
await check('A6. an admin links an account (UsersTab / claim approval)', 'ALLOW', () =>
  updateDoc(doc(as(ADMIN), 'athletes', 'athB'), { ownerId: STRANGER }));
await check('A7. the edit path: an unmoved athlete\'s fields move private in one transaction', 'ALLOW', () => {
  const db = as(ADMIN);
  return runTransaction(db, async (t) => {
    const pub = doc(db, 'athletes', 'athLegacy');
    const cur = await t.get(pub);
    t.update(pub, { name: 'Legacy', birthDate: deleteField(), phone: deleteField() });
    t.set(doc(db, 'athletes', 'athLegacy', 'private', 'identity'), { birthDate: cur.data().birthDate }, { merge: true });
  });
});
await check('A8. an admin deletes an athlete and its private identity', 'ALLOW', async () => {
  await deleteDoc(doc(as(ADMIN), 'athletes', 'athNew', 'private', 'identity'));
  return deleteDoc(doc(as(ADMIN), 'athletes', 'athNew'));
});

await seed();
console.log('\n=== online athletes: onlineParticipants ===\n');
await check('N1. a signed-in non-admin cannot read another athlete\'s record (email, DOB, citizenship)', 'DENY', () =>
  getDoc(doc(as(STRANGER), 'onlineParticipants', MEMBER)));
await check('N2. ...even as an athlete themselves (other athlete reading this one)', 'DENY', () =>
  getDoc(doc(as(OTHER), 'onlineParticipants', MEMBER)));
await check('N3. ...nor list the collection', 'DENY', () =>
  getDocs(collection(as(OTHER), 'onlineParticipants')));
await check('N4. a signed-out visitor cannot read one', 'DENY', () =>
  getDoc(doc(anon(), 'onlineParticipants', MEMBER)));
await check('N5. an athlete still reads their OWN full record', 'ALLOW', () =>
  readHas(doc(as(MEMBER), 'onlineParticipants', MEMBER), ['displayName', 'stats', ...PRIVATE_ONLINE]));
await check('N6. an admin reads any athlete\'s full record', 'ALLOW', () =>
  readHas(doc(as(ADMIN), 'onlineParticipants', OTHER), PRIVATE_ONLINE));
await check('N7. an admin lists the collection', 'ALLOW', () =>
  getDocs(collection(as(ADMIN), 'onlineParticipants')));
await check('N8. the athlete\'s own registrations are still readable', 'ALLOW', () =>
  getDocs(collection(as(MEMBER), 'onlineParticipants', MEMBER, 'registrations')));

console.log('\n=== accounts: users ===\n');
await check('U1. a signed-in non-admin cannot read another account (its email)', 'DENY', () =>
  getDoc(doc(as(STRANGER), 'users', MEMBER)));
await check('U2. ...nor list the accounts', 'DENY', () =>
  getDocs(collection(as(STRANGER), 'users')));
await check('U3. a signed-out visitor cannot read an account', 'DENY', () =>
  getDoc(doc(anon(), 'users', MEMBER)));
await check('U4. an account reads its own document (auth-context, timer profile)', 'ALLOW', () =>
  readHas(doc(as(MEMBER), 'users', MEMBER), ['email', 'points', 'role']));
await check('U5. a points.ts transaction on your own document still works', 'ALLOW', () => {
  const db = as(MEMBER);
  return runTransaction(db, async (t) => {
    const ref = doc(db, 'users', MEMBER);
    const cur = await t.get(ref);
    t.update(ref, { points: (cur.data().points ?? 0) + 1 });
  });
});
await check('U6. an admin reads any account', 'ALLOW', () =>
  readHas(doc(as(ADMIN), 'users', OTHER), ['email']));
await check('U7. an admin lists the accounts (UsersTab, admin dashboard)', 'ALLOW', () =>
  getDocs(collection(as(ADMIN), 'users')));
await check('U8. a claim approval awards points to ANOTHER account, as an admin', 'ALLOW', () => {
  const db = as(ADMIN);
  return runTransaction(db, async (t) => {
    const ref = doc(db, 'users', OTHER);
    const cur = await t.get(ref);
    t.update(ref, { points: (cur.data().points ?? 0) + 50 });
  });
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
