import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

// Rules tests for the per-competition judge (PIN login → custom token with
// claims { role: 'judge', competitionId, pinVersion, validUntil }), and for
// `results` writes now being admin + judge only.
//
// A judge may: read their competition's private/scrambles, and create an
// entered club result for that competition (or fill a next-round
// placeholder). Nothing else — in particular not the staged imports (the
// reveal runs on the server), not the PIN hash, no deletes, no edits of a
// finished result, no other competition.
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const ADMIN = 'admin1';
const MEMBER = 'member1'; // an ordinary Google account
const HOUR = 60 * 60 * 1000;

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-judge',
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
    for (const [id, status] of [['comp1', 'live'], ['comp2', 'live'], ['compDone', 'finished'], ['compOff', 'live'], ['compNoPin', 'live']]) {
      await setDoc(doc(db, 'competitions', id), {
        name: id, status, events: { '333': true, '444': true }, athletes: [],
        roundStatus: { '444_r1': 'complete' },
      });
      await setDoc(doc(db, 'competitions', id, 'private', 'scrambles'), { scrambleSets: { '333': { '1': { A: { main: ['R U F'], extra: [] } } } } });
      await setDoc(doc(db, 'competitions', id, 'private', 'importedResults_333'), { kind: 'importedResults', eventId: '333', rounds: { '1': [] } });
    }
    await setDoc(doc(db, 'competitions', 'comp1', 'private', 'judgeAccess'), { enabled: true, version: 'v2', pinHash: 'h', salt: 's' });
    await setDoc(doc(db, 'competitions', 'comp2', 'private', 'judgeAccess'), { enabled: true, version: 'v1', pinHash: 'h', salt: 's' });
    await setDoc(doc(db, 'competitions', 'compDone', 'private', 'judgeAccess'), { enabled: true, version: 'v1', pinHash: 'h', salt: 's' });
    await setDoc(doc(db, 'competitions', 'compOff', 'private', 'judgeAccess'), { enabled: false, version: 'v9' });
    // compNoPin: no judgeAccess document at all.

    // An existing finished club result, a next-round placeholder, an imported row.
    await setDoc(doc(db, 'results', 'comp1_333_r1_athDone'), { ...entry('athDone'), single: 900, average: 950 });
    await setDoc(doc(db, 'results', 'comp1_444_r2_athAdv'), {
      competitionId: 'comp1', eventId: '444', round: 2, athleteId: 'athAdv', athleteName: 'Adv',
      single: null, average: null, solves: [], status: 'draft', source: 'entry', isPlaceholder: true,
    });
    await setDoc(doc(db, 'results', 'impst_comp1_row0'), {
      competitionId: 'comp1', eventId: '333', round: 1, athleteId: '', athleteName: 'Imported',
      single: 700, average: 720, status: 'published', source: 'imported', importRowId: 'row0',
    });
    await setDoc(doc(db, 'results', 'comp2_333_r1_athX'), { ...entry('athX', { competitionId: 'comp2' }) });

    // Round gating fixture (testdata- prefix: isolated, never a real competition).
    //   333: round 1 open.  444: round 1 complete, ath1 advanced (placeholder).
    //   555: round 1 NOT complete, yet a stale round-2 placeholder for ath2.
    await setDoc(doc(db, 'competitions', TD_COMP), {
      name: TD_COMP, status: 'live',
      events: { '333': true, '222': true, '444': true, '555': true },
      athletes: [
        { id: TD_ATH1, name: 'Test One', events: ['333', '444'] },
        { id: TD_ATH2, name: 'Test Two', events: ['333', '444', '555'] },
      ],
      registrations: {
        [TD_ATH1]: { '333': true, '444': true },
        [TD_ATH2]: { '333': true, '444': true, '555': true },
      },
      roundStatus: { '444_r1': 'complete', '555_r1': 'ongoing' },
    });
    await setDoc(doc(db, 'competitions', TD_COMP, 'private', 'judgeAccess'), { enabled: true, version: 'v1', pinHash: 'h', salt: 's' });
    await setDoc(doc(db, 'results', `${TD_COMP}_444_r1_${TD_ATH1}`), { ...entry(TD_ATH1, { competitionId: TD_COMP, eventId: '444' }) });
    await setDoc(doc(db, 'results', `${TD_COMP}_444_r2_${TD_ATH1}`), {
      competitionId: TD_COMP, eventId: '444', round: 2, athleteId: TD_ATH1, athleteName: 'Test One',
      single: null, average: null, solves: [], status: 'draft', source: 'entry', isPlaceholder: true,
    });
    await setDoc(doc(db, 'results', `${TD_COMP}_555_r2_${TD_ATH2}`), {
      competitionId: TD_COMP, eventId: '555', round: 2, athleteId: TD_ATH2, athleteName: 'Test Two',
      single: null, average: null, solves: [], status: 'draft', source: 'entry', isPlaceholder: true,
    });
  });
}

const TD_COMP = 'testdata-rounds-comp';
const TD_ATH1 = 'testdata-ath1';
const TD_ATH2 = 'testdata-ath2';

/** A club result as the entry panel saves it. */
function entry(athleteId, over = {}) {
  return {
    competitionId: 'comp1', competitionName: 'comp1', eventId: '333', round: 1, group: 1,
    athleteId, athleteName: athleteId, single: 800, average: 850, solves: [800, 850, 850, 850, 900],
    penalties: ['none', 'none', 'none', 'none', 'none'], status: 'published', source: 'entry',
    judgeAthleteId: 'athJudge', judgeName: 'Judge J', ...over,
  };
}
const resultId = (d) => `${d.competitionId}_${d.eventId}_r${d.round}_${d.athleteId}`;

const claims = (over = {}) => ({ role: 'judge', competitionId: 'comp1', pinVersion: 'v2', validUntil: Date.now() + 24 * HOUR, ...over });
const judge = (over = {}, uid = 'judge_comp1_abc') => testEnv.authenticatedContext(uid, claims(over)).firestore();
const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const create = (db, data, id = resultId(data)) => setDoc(doc(db, 'results', id), data);

await seed();

console.log('\n=== judge: what is allowed ===\n');
await check('J1. reads their competition\'s scrambles', 'ALLOW', async () => {
  const snap = await getDoc(doc(judge(), 'competitions', 'comp1', 'private', 'scrambles'));
  if (!snap.data()?.scrambleSets) throw new Error('scrambles missing');
  return snap;
});
await check('J2. creates a club result for their competition, with a judge named', 'ALLOW', () => create(judge(), entry('athA')));
await check('J3. fills a next-round placeholder (an advanced athlete\'s round-2 result)', 'ALLOW', () =>
  create(judge(), entry('athAdv', { eventId: '444', round: 2 })));
await check('J4. reads results and the public competition like anyone', 'ALLOW', async () => {
  await getDocs(query(collection(judge(), 'results'), where('competitionId', '==', 'comp1')));
  return getDoc(doc(judge(), 'competitions', 'comp1'));
});

console.log('\n=== judge: private documents ===\n');
await check('P1. cannot read the staged import of their own competition', 'DENY', () =>
  getDoc(doc(judge(), 'competitions', 'comp1', 'private', 'importedResults_333')));
await check('P2. ...nor query the staged imports', 'DENY', () =>
  getDocs(query(collection(judge(), 'competitions', 'comp1', 'private'), where('kind', '==', 'importedResults'))));
await check('P3. ...nor write them (no reorder, no un-eliminate)', 'DENY', () =>
  setDoc(doc(judge(), 'competitions', 'comp1', 'private', 'importedResults_333'), { kind: 'importedResults', eventId: '333', rounds: {} }));
await check('P4. cannot read the PIN hash', 'DENY', () => getDoc(doc(judge(), 'competitions', 'comp1', 'private', 'judgeAccess')));
await check('P5. cannot change the PIN / re-enable access', 'DENY', () =>
  setDoc(doc(judge(), 'competitions', 'comp1', 'private', 'judgeAccess'), { enabled: true, version: 'v2', pinHash: 'x', salt: 'y' }));
await check('P6. cannot list the private subcollection', 'DENY', () => getDocs(collection(judge(), 'competitions', 'comp1', 'private')));
await check('P7. cannot write the scrambles', 'DENY', () =>
  setDoc(doc(judge(), 'competitions', 'comp1', 'private', 'scrambles'), { scrambleSets: {} }));
await check('P8. cannot read ANOTHER competition\'s scrambles', 'DENY', () =>
  getDoc(doc(judge(), 'competitions', 'comp2', 'private', 'scrambles')));

console.log('\n=== judge: results they may not write ===\n');
await check('R1. cannot edit an existing completed result', 'DENY', () =>
  create(judge(), entry('athDone', { single: 100, average: 100 })));
await check('R2. ...not even one field of it', 'DENY', () => updateDoc(doc(judge(), 'results', 'comp1_333_r1_athDone'), { single: 100 }));
await check('R3. cannot delete a result', 'DENY', () => deleteDoc(doc(judge(), 'results', 'comp1_333_r1_athDone')));
await check('R4. cannot delete a placeholder either', 'DENY', () => deleteDoc(doc(judge(), 'results', 'comp1_444_r2_athAdv')));
await check('R5. cannot create a result for another competition', 'DENY', () => create(judge(), entry('athA', { competitionId: 'comp2' })));
await check('R6. cannot overwrite another competition\'s result', 'DENY', () => create(judge(), entry('athX', { competitionId: 'comp2' })));
await check('R7. cannot save a result under another competition\'s id while claiming their own', 'DENY', () =>
  create(judge(), entry('athB'), 'comp2_333_r1_athB'));
await check('R8. cannot save under a free-form id (a second result for the same athlete+round)', 'DENY', () =>
  create(judge(), entry('athDone'), 'comp1_333_r1_athDone_again'));
await check('R9. cannot save without a judge', 'DENY', () => {
  const { judgeAthleteId: _j, judgeName: _n, ...noJudge } = entry('athC');
  return create(judge(), noJudge);
});
await check('R10. cannot save with an empty judge', 'DENY', () => create(judge(), entry('athC', { judgeAthleteId: '' })));
await check('R11. a judge cannot judge themselves (judge == athlete)', 'DENY', () => create(judge(), entry('athJudge')));
await check('R12. cannot write an imported result (a "reveal")', 'DENY', () =>
  setDoc(doc(judge(), 'results', 'impst_comp1_row1'), {
    competitionId: 'comp1', eventId: '333', round: 1, athleteId: '', athleteName: 'Fake', single: 100, average: 100,
    status: 'published', source: 'imported', importRowId: 'row1',
  }));
await check('R13. cannot alter a revealed imported result', 'DENY', () => updateDoc(doc(judge(), 'results', 'impst_comp1_row0'), { single: 1 }));
await check('R14. cannot create a placeholder / draft', 'DENY', () => create(judge(), entry('athD', { isPlaceholder: true, status: 'draft' })));
await check('R15. cannot write a batch that sneaks a delete in with a valid result', 'DENY', () => {
  const db = judge();
  const batch = writeBatch(db);
  const ok = entry('athE');
  batch.set(doc(db, 'results', resultId(ok)), ok);
  batch.delete(doc(db, 'results', 'comp1_333_r1_athDone'));
  return batch.commit();
});

console.log('\n=== judge: nothing of the admin\'s ===\n');
await check('X1. cannot mark a round complete (write the competition)', 'DENY', () =>
  updateDoc(doc(judge(), 'competitions', 'comp1'), { roundStatus: { '333_r1': 'complete' } }));
await check('X2. cannot change the competition\'s status', 'DENY', () => updateDoc(doc(judge(), 'competitions', 'comp1'), { status: 'upcoming' }));
await check('X3. cannot create or delete a competition', 'DENY', async () => {
  await assertFails(setDoc(doc(judge(), 'competitions', 'compNew'), { name: 'x', status: 'live' }));
  return deleteDoc(doc(judge(), 'competitions', 'comp1'));
});
await check('X4. cannot give itself a users document (so can never hold a role)', 'DENY', () =>
  setDoc(doc(judge(), 'users', 'judge_comp1_abc'), { uid: 'judge_comp1_abc', role: 'member' }));
await check('X5. ...certainly not an admin one', 'DENY', () =>
  setDoc(doc(judge(), 'users', 'judge_comp1_abc'), { uid: 'judge_comp1_abc', role: 'admin' }));
await check('X6. cannot read accounts', 'DENY', () => getDocs(collection(judge(), 'users')));
await check('X7. cannot write athletes or settings', 'DENY', async () => {
  await assertFails(setDoc(doc(judge(), 'athletes', 'athNew'), { name: 'x' }));
  return setDoc(doc(judge(), 'settings', 'eventVisibility'), { '333': 'hide' });
});
await check('X8. cannot read the login-attempt counters', 'DENY', () => getDoc(doc(judge(), 'judgeLoginAttempts', 'comp1_all')));
await check('X9. ...nor reset them', 'DENY', () => deleteDoc(doc(judge(), 'judgeLoginAttempts', 'comp1_all')));

console.log('\n=== judge: when access ends ===\n');
const DENIED = [
  ['E1. expired token (older than 24 h)', judge({ validUntil: Date.now() - 1000 })],
  ['E2. token with no expiry claim', testEnv.authenticatedContext('judge_x', { role: 'judge', competitionId: 'comp1', pinVersion: 'v2' }).firestore()],
  ['E3. PIN regenerated since (old pinVersion)', judge({ pinVersion: 'v1' })],
  ['E4. competition finished', judge({ competitionId: 'compDone', pinVersion: 'v1' })],
  ['E5. PIN disabled', judge({ competitionId: 'compOff', pinVersion: 'v9' })],
  ['E6. no PIN ever set for the competition', judge({ competitionId: 'compNoPin', pinVersion: '' })],
  ['E7. role claim missing', testEnv.authenticatedContext('judge_y', { competitionId: 'comp1', pinVersion: 'v2', validUntil: Date.now() + HOUR }).firestore()],
];
for (const [label, db] of DENIED) {
  const comp = label.startsWith('E4') ? 'compDone' : label.startsWith('E5') ? 'compOff' : label.startsWith('E6') ? 'compNoPin' : 'comp1';
  await check(`${label}: cannot read the scrambles`, 'DENY', () => getDoc(doc(db, 'competitions', comp, 'private', 'scrambles')));
  await check(`${label}: cannot create a result`, 'DENY', () => create(db, entry('athZ', { competitionId: comp })));
}

console.log('\n=== results: everyone else ===\n');
await check('M1. an ordinary signed-in account can no longer create a result', 'DENY', () => create(as(MEMBER), entry('athM')));
await check('M2. ...nor overwrite one', 'DENY', () => create(as(MEMBER), entry('athDone')));
await check('M3. ...nor delete one', 'DENY', () => deleteDoc(doc(as(MEMBER), 'results', 'comp1_333_r1_athDone')));
await check('M4. a signed-out visitor cannot write a result', 'DENY', () => create(anon(), entry('athM')));
await check('M5. a signed-out visitor still reads results', 'ALLOW', () => getDoc(doc(anon(), 'results', 'comp1_333_r1_athDone')));
await check('M6. an ordinary account cannot read the scrambles by claiming nothing', 'DENY', () =>
  getDoc(doc(as(MEMBER), 'competitions', 'comp1', 'private', 'scrambles')));
await check('M7. an ordinary account still creates its own users document', 'ALLOW', () =>
  setDoc(doc(as('newUser'), 'users', 'newUser'), { uid: 'newUser', role: 'member' }));

console.log('\n=== admin keeps full access ===\n');
await check('A1. creates a result without a judge (judge is optional for the admin)', 'ALLOW', () => {
  const { judgeAthleteId: _j, judgeName: _n, ...noJudge } = entry('athAdmin');
  return create(as(ADMIN), noJudge);
});
await check('A2. edits a completed result', 'ALLOW', () => updateDoc(doc(as(ADMIN), 'results', 'comp1_333_r1_athDone'), { single: 880 }));
await check('A3. writes a Daily Practice result (its own id shape)', 'ALLOW', () =>
  setDoc(doc(as(ADMIN), 'results', 'daily-practice_333_r1_athA_2026-10-13'), { competitionId: 'daily-practice', eventId: '333', round: 1, athleteId: 'athA', status: 'published', source: 'entry' }));
await check('A4. bulk-imports an external result and creates a placeholder', 'ALLOW', async () => {
  await setDoc(doc(as(ADMIN), 'results', 'imp_comp1_333_r1_g1_1_0'), { competitionId: 'comp1', eventId: '333', round: 1, athleteId: '', athleteName: 'Ext', status: 'published', source: 'imported' });
  return setDoc(doc(as(ADMIN), 'results', 'comp1_333_r2_athP'), { competitionId: 'comp1', eventId: '333', round: 2, athleteId: 'athP', status: 'draft', source: 'entry', isPlaceholder: true });
});
await check('A5. deletes a result', 'ALLOW', () => deleteDoc(doc(as(ADMIN), 'results', 'imp_comp1_333_r1_g1_1_0')));
await check('A6. reads and rewrites the PIN document, staged imports and scrambles', 'ALLOW', async () => {
  const db = as(ADMIN);
  await getDoc(doc(db, 'competitions', 'comp1', 'private', 'judgeAccess'));
  await getDocs(collection(db, 'competitions', 'comp1', 'private'));
  return setDoc(doc(db, 'competitions', 'comp1', 'private', 'importedResults_333'), { kind: 'importedResults', eventId: '333', rounds: {} });
});
await check('A7. marks a round complete', 'ALLOW', () => updateDoc(doc(as(ADMIN), 'competitions', 'comp1'), { roundStatus: { '333_r1': 'complete' } }));

console.log('\n=== judge: only the athlete\'s current round (round gating) ===\n');
const tdJudge = () => judge({ competitionId: TD_COMP, pinVersion: 'v1' }, 'judge_testdata_rounds');
const tdEntry = (athleteId, over = {}) => entry(athleteId, { competitionId: TD_COMP, competitionName: TD_COMP, ...over });
await check('G1. round 1 of an event the athlete is registered for', 'ALLOW', () => create(tdJudge(), tdEntry(TD_ATH1)));
await check('G2. round 1 of an event the athlete is NOT registered for', 'DENY', () => create(tdJudge(), tdEntry(TD_ATH1, { eventId: '222' })));
await check('G3. an athlete not on the roster at all', 'DENY', () => create(tdJudge(), tdEntry('testdata-stranger')));
await check('G4. round 2 without having advanced (no placeholder), round 1 complete', 'DENY', () =>
  create(tdJudge(), tdEntry(TD_ATH2, { eventId: '444', round: 2 })));
await check('G5. round 2 over their placeholder once round 1 is complete', 'ALLOW', () =>
  create(tdJudge(), tdEntry(TD_ATH1, { eventId: '444', round: 2 })));
await check('G6. round 2 over a placeholder while round 1 is NOT complete', 'DENY', () =>
  create(tdJudge(), tdEntry(TD_ATH2, { eventId: '555', round: 2 })));
await check('G7. a round already marked complete (missed it, no result)', 'DENY', () =>
  create(tdJudge(), tdEntry(TD_ATH2, { eventId: '444' })));
await check('G8. a round 2 created from scratch is never a judge\'s (even claiming round 1 done)', 'DENY', () =>
  create(tdJudge(), tdEntry(TD_ATH1, { eventId: '333', round: 2 })));
await check('G9. the admin may still write a DNS into a completed round', 'ALLOW', () =>
  setDoc(doc(as(ADMIN), 'results', `${TD_COMP}_444_r1_${TD_ATH2}`), {
    competitionId: TD_COMP, eventId: '444', round: 1, athleteId: TD_ATH2, athleteName: 'Test Two',
    single: -2, average: null, solves: [-2, -2, -2, -2, -2], status: 'published', source: 'entry', dns: true,
  }));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
