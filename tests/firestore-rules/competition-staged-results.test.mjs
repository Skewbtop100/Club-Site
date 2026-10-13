import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, setDoc, deleteDoc, runTransaction, writeBatch } from 'firebase/firestore';

// Rules tests for the staged import of a past competition's results:
//   competitions/{id}/private/importedResults_{eventId}  staged rows (admin only)
//   results/impst_{compId}_{rowId}                        a REVEALED row (public)
//
// The staged rows are the whole point of the feature being gradual: anyone
// who could read them would see every imported result — including rounds
// that have not been held — before it is revealed.
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const ADMIN = 'admin1';
const MEMBER = 'member1';   // signed in, plain member
const ATHLETE = 'athlete1'; // signed in, linked to a club athlete competing in comp1

const ROW = (n) => ({ id: `333_r1_row${n}`, name: `Imported ${n}`, solves: [700, 710, 720, 730, 740], single: 700, average: 720, order: n });
const STAGED = { kind: 'importedResults', eventId: '333', rounds: { '1': [ROW(0), ROW(1), ROW(2)], '2': [ROW(0)] } };

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-staged',
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
      name: 'Club Open', status: 'live', events: { '333': true },
      athletes: [{ id: 'athA', name: 'Бат', events: ['333'] }],
    });
    await setDoc(doc(db, 'competitions', 'comp1', 'private', 'importedResults_333'), STAGED);
    await setDoc(doc(db, 'competitions', 'comp1', 'private', 'scrambles'), { scrambleSets: {} });
    // One row already revealed as an ordinary public imported result.
    await setDoc(doc(db, 'results', 'impst_comp1_333_r1_row0'), {
      competitionId: 'comp1', eventId: '333', round: 1, athleteId: '', athleteName: 'Imported 0',
      single: 700, average: 720, status: 'published', source: 'imported', importRowId: '333_r1_row0',
    });
  });
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const staged = (db, ev = '333') => doc(db, 'competitions', 'comp1', 'private', `importedResults_${ev}`);
const stagedQuery = (db) => query(collection(db, 'competitions', 'comp1', 'private'), where('kind', '==', 'importedResults'));

await seed();

console.log('\n=== staged rows: nobody but an admin reads them ===\n');
await check('S1. a signed-out visitor cannot read the staged rows', 'DENY', () => getDoc(staged(anon())));
await check('S2. a signed-in member cannot read them', 'DENY', () => getDoc(staged(as(MEMBER))));
await check('S3. an athlete competing in that competition cannot read them', 'DENY', () => getDoc(staged(as(ATHLETE))));
await check('S4. a signed-out visitor cannot query them (the admin screens\' query)', 'DENY', () => getDocs(stagedQuery(anon())));
await check('S5. ...nor a signed-in member', 'DENY', () => getDocs(stagedQuery(as(MEMBER))));
await check('S6. a member cannot read the staged doc of an event with no import either', 'DENY', () => getDoc(staged(as(MEMBER), '222')));

console.log('\n=== staged rows: nobody but an admin writes them ===\n');
await check('W1. a signed-out visitor cannot write staged rows', 'DENY', () => setDoc(staged(anon()), STAGED));
await check('W2. a signed-in member cannot overwrite them (e.g. to un-eliminate or reorder)', 'DENY', () => setDoc(staged(as(MEMBER)), STAGED));
await check('W3. ...nor stage an event from scratch', 'DENY', () => setDoc(staged(as(MEMBER), '222'), { ...STAGED, eventId: '222' }));
await check('W4. ...nor delete them', 'DENY', () => deleteDoc(staged(as(ATHLETE))));

console.log('\n=== revealed rows are ordinary public results ===\n');
await check('P1. a signed-out visitor reads a revealed row', 'ALLOW', async () => {
  const snap = await getDoc(doc(anon(), 'results', 'impst_comp1_333_r1_row0'));
  if (snap.data()?.source !== 'imported') throw new Error('revealed row missing');
  return snap;
});
await check('P2. ...and the competition\'s results (the live viewer), which hold only what was revealed', 'ALLOW', async () => {
  const snap = await getDocs(query(collection(anon(), 'results'), where('competitionId', '==', 'comp1')));
  if (snap.size !== 1) throw new Error(`expected 1 revealed row, got ${snap.size}`);
  return snap;
});

console.log('\n=== staged rows: the admin ===\n');
await check('A1. an admin reads an event\'s staged rows', 'ALLOW', async () => {
  const snap = await getDoc(staged(as(ADMIN)));
  if (snap.data()?.rounds?.['1']?.length !== 3) throw new Error('staged rows missing');
  return snap;
});
await check('A2. an admin queries every staged event of a competition (not the scrambles doc)', 'ALLOW', async () => {
  const snap = await getDocs(stagedQuery(as(ADMIN)));
  if (snap.size !== 1 || snap.docs[0].id !== 'importedResults_333') throw new Error(`unexpected docs: ${snap.docs.map((d) => d.id)}`);
  return snap;
});
await check('A3. an admin stages an import in a transaction (saveStagedImport)', 'ALLOW', () => {
  const db = as(ADMIN);
  return runTransaction(db, async (tx) => {
    const ref = staged(db, '222');
    await tx.get(ref);
    tx.set(ref, { ...STAGED, eventId: '222' });
  });
});
await check('A4. a reveal writes the public result and the revealed flag in one batch (syncStagedEvent)', 'ALLOW', async () => {
  const db = as(ADMIN);
  const batch = writeBatch(db);
  batch.set(doc(db, 'results', 'impst_comp1_333_r1_row1'), {
    competitionId: 'comp1', eventId: '333', round: 1, athleteId: '', athleteName: 'Imported 1',
    single: 700, average: 720, status: 'published', source: 'imported', importRowId: '333_r1_row1',
  });
  batch.set(staged(db), { ...STAGED, rounds: { ...STAGED.rounds, '1': [ROW(0), { ...ROW(1), revealed: true }, ROW(2)] } });
  await batch.commit();
  // A retry writes the same document id again — still one row, not two.
  await setDoc(doc(db, 'results', 'impst_comp1_333_r1_row1'), { competitionId: 'comp1', eventId: '333', round: 1, athleteId: '', source: 'imported', status: 'published' });
  const snap = await getDocs(query(collection(db, 'results'), where('competitionId', '==', 'comp1')));
  if (snap.size !== 2) throw new Error(`expected 2 revealed rows, got ${snap.size}`);
});
await check('A5. an admin deletes a competition with everything in its private subcollection (deleteCompetition)', 'ALLOW', async () => {
  const db = as(ADMIN);
  const priv = await getDocs(collection(db, 'competitions', 'comp1', 'private'));
  if (priv.size !== 3) throw new Error(`expected 3 private docs, got ${priv.size}`);
  const batch = writeBatch(db);
  priv.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'competitions', 'comp1'));
  return batch.commit();
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
