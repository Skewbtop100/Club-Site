import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, FieldPath } from 'firebase/firestore';

// Rules tests for a competition's imported WCA scrambles:
//   competitions/{id}                  the PUBLIC competition (anyone reads)
//   competitions/{id}/private/scrambles the scrambles (admin only, read + write)
//
// THE HOLE THIS CLOSES: the scrambles were first stored on the competition
// document itself, which every public page reads — any visitor could have
// read a round's scrambles before it was held.
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const ADMIN = 'admin1';
const MEMBER = 'member1';   // signed in, plain member
const ATHLETE = 'athlete1'; // signed in, linked to a club athlete competing in comp1

const SETS = { '333': { '1': { A: { main: ['R U F', 'U R F', 'F R U', 'L U B', 'D B L'], extra: ['B D R', 'L F U'] } } } };

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-scrambles',
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

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin' });
    await setDoc(doc(db, 'users', MEMBER), { uid: MEMBER, role: 'member' });
    await setDoc(doc(db, 'users', ATHLETE), { uid: ATHLETE, role: 'athlete', athleteId: 'athA' });
    await setDoc(doc(db, 'competitions', 'comp1'), {
      name: 'Club Open', status: 'upcoming', events: { '333': true },
      athletes: [{ id: 'athA', name: 'Бат', events: ['333'] }],
    });
    await setDoc(doc(db, 'competitions', 'comp1', 'private', 'scrambles'), { scrambleSets: SETS });
    // A competition with no import yet.
    await setDoc(doc(db, 'competitions', 'comp2'), { name: 'Empty', status: 'upcoming' });
  });
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const scrambles = (db, comp = 'comp1') => doc(db, 'competitions', comp, 'private', 'scrambles');

await seed();

console.log('\n=== the public competition document ===\n');
await check('C1. a signed-out visitor still reads the competition', 'ALLOW', async () => {
  const snap = await getDoc(doc(anon(), 'competitions', 'comp1'));
  if ('scrambleSets' in (snap.data() ?? {})) throw new Error('public doc carries scrambleSets');
  return snap;
});
await check('C2. ...and lists the competitions (the listing never includes the private doc)', 'ALLOW', () =>
  getDocs(collection(anon(), 'competitions')));

console.log('\n=== scrambles: nobody but an admin reads them ===\n');
await check('S1. a signed-out visitor cannot read the scrambles', 'DENY', () => getDoc(scrambles(anon())));
await check('S2. a signed-in member cannot read them', 'DENY', () => getDoc(scrambles(as(MEMBER))));
await check('S3. an athlete competing in that competition cannot read them', 'DENY', () => getDoc(scrambles(as(ATHLETE))));
await check('S4. a signed-out visitor cannot list the private subcollection', 'DENY', () =>
  getDocs(collection(anon(), 'competitions', 'comp1', 'private')));
await check('S5. ...nor a signed-in member', 'DENY', () =>
  getDocs(collection(as(MEMBER), 'competitions', 'comp1', 'private')));
await check('S6. a collection-group query over every "private" subcollection is refused', 'DENY', () =>
  getDocs(collectionGroup(as(MEMBER), 'private')));
await check('S7. a member cannot read the scrambles doc of a competition that has none either', 'DENY', () =>
  getDoc(scrambles(as(MEMBER), 'comp2')));

console.log('\n=== scrambles: nobody but an admin writes them ===\n');
await check('W1. a signed-out visitor cannot write scrambles', 'DENY', () => setDoc(scrambles(anon()), { scrambleSets: {} }));
await check('W2. a signed-in member cannot overwrite them', 'DENY', () => setDoc(scrambles(as(MEMBER)), { scrambleSets: {} }));
await check('W3. ...nor create them where none exist', 'DENY', () => setDoc(scrambles(as(MEMBER), 'comp2'), { scrambleSets: SETS }));
await check('W4. ...nor delete them', 'DENY', () => deleteDoc(scrambles(as(ATHLETE))));
await check('W5. a member cannot put scrambles back on the public competition document', 'DENY', () =>
  updateDoc(doc(as(MEMBER), 'competitions', 'comp1'), { scrambleSets: SETS }));

console.log('\n=== scrambles: the admin ===\n');
await check('A1. an admin reads the scrambles (ResultsEntryTab, CompetitionsTab)', 'ALLOW', async () => {
  const snap = await getDoc(scrambles(as(ADMIN)));
  if (snap.data()?.scrambleSets?.['333']?.['1']?.A?.main?.length !== 5) throw new Error('scrambles missing');
  return snap;
});
await check('A2. an admin reads a competition with no import (an absent document)', 'ALLOW', () => getDoc(scrambles(as(ADMIN), 'comp2')));
await check('A3. an admin creates the scrambles doc on first import (saveScrambleSets)', 'ALLOW', () =>
  setDoc(scrambles(as(ADMIN), 'comp2'), { scrambleSets: SETS }, { mergeFields: [new FieldPath('scrambleSets', '333', '1')] }));
await check('A4. a re-import replaces one round and leaves the others', 'ALLOW', async () => {
  const db = as(ADMIN);
  await setDoc(scrambles(db), { scrambleSets: { '333': { '2': { A: { main: ['F2'], extra: [] } } } } },
    { mergeFields: [new FieldPath('scrambleSets', '333', '2')] });
  await setDoc(scrambles(db), { scrambleSets: { '333': { '2': { B: { main: ['B2'], extra: [] } } } } },
    { mergeFields: [new FieldPath('scrambleSets', '333', '2')] });
  const sets = (await getDoc(scrambles(db))).data().scrambleSets;
  if (sets['333']['1'].A.main.length !== 5) throw new Error('round 1 was touched');
  if ('A' in sets['333']['2'] || sets['333']['2'].B.main[0] !== 'B2') throw new Error('round 2 was merged, not replaced');
});
await check('A5. an admin deletes a competition together with its scrambles (deleteCompetition)', 'ALLOW', () => {
  const db = as(ADMIN);
  const batch = writeBatch(db);
  batch.delete(scrambles(db, 'comp2'));
  batch.delete(doc(db, 'competitions', 'comp2'));
  return batch.commit();
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
