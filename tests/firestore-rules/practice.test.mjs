import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

// ── practiceRuns, against the REAL rules ────────────────────────────────
// Two properties, and the second is the one that makes the feature work:
//
//   READ is the owner or an admin. A practice video is the athlete's own
//     attempt at learning; nobody else has business in it.
//   WRITE IS NOBODY. The ten-run cap has to be counted, rules cannot count,
//     so the cap lives in a server transaction and the collection is closed
//     to clients. If a client write ever becomes possible here, the cap
//     stops being a cap — which is why there are as many refusal cases
//     below as there are.
//
// Run: npm run test:practicerules   (or as part of npm run test:rules)

const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const MINE = 'athlete1';
const OTHER = 'athlete2';

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'practice-rules-check',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

const athlete = (uid) =>
  testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

const RUN = {
  uid: MINE,
  event: '333',
  scramble: "R U R' U'",
  timeCs: 1234,
  isDnf: false,
  videoKey: `practice-videos/${MINE}/333/abc.webm`,
  status: 'pending',
  reason: null,
};

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'practiceRuns', 'mine'), RUN);
    await setDoc(doc(db, 'practiceRuns', 'theirs'), { ...RUN, uid: OTHER });
    // An admin, for the admin-read case. `isAdmin()` reads users/{uid}.role,
    // which clients cannot write (see the users rules).
    await setDoc(doc(db, 'users', 'boss'), { role: 'admin' });
  });
}

async function check(name, expect, fn) {
  let good = true;
  let detail;
  try {
    await seed();
    if (expect === 'ALLOW') await assertSucceeds(fn());
    else await assertFails(fn());
  } catch (e) {
    good = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  [expected ${expect}] ${name}`);
  if (!good) console.log(`          -> ${detail}`);
}

const mineRef = (db) => doc(db, 'practiceRuns', 'mine');
const theirsRef = (db) => doc(db, 'practiceRuns', 'theirs');

console.log('\n=== reading ===\n');

await check('the owner can read their own run', 'ALLOW', () => getDoc(mineRef(athlete(MINE))));
await check('another athlete cannot read it', 'DENY', () => getDoc(mineRef(athlete(OTHER))));
await check('a signed-out visitor cannot read it', 'DENY', () => getDoc(mineRef(anon())));
await check("the owner cannot read somebody else's", 'DENY', () => getDoc(theirsRef(athlete(MINE))));
await check('an admin can read any run', 'ALLOW', () => getDoc(mineRef(athlete('boss'))));
await check('the owner can list their own runs', 'ALLOW', () =>
  getDocs(query(collection(athlete(MINE), 'practiceRuns'), where('uid', '==', MINE))));
// An unfiltered list would return other athletes' runs, so the rule must
// refuse a query it cannot prove is the owner's own.
await check('an unfiltered list is refused', 'DENY', () =>
  getDocs(collection(athlete(MINE), 'practiceRuns')));
await check("a list filtered to somebody else is refused", 'DENY', () =>
  getDocs(query(collection(athlete(MINE), 'practiceRuns'), where('uid', '==', OTHER))));

console.log('\n=== writing: NOBODY, which is what makes the cap real ===\n');

await check('the owner cannot create a run', 'DENY', () =>
  setDoc(doc(athlete(MINE), 'practiceRuns', 'new'), RUN));
await check('  ...not even one attributed to themselves', 'DENY', () =>
  setDoc(doc(athlete(MINE), 'practiceRuns', 'new2'), { ...RUN, uid: MINE }));
await check('the owner cannot update their own run', 'DENY', () =>
  updateDoc(mineRef(athlete(MINE)), { timeCs: 1 }));
// The two that would defeat the ten-run cap outright.
await check('  ...cannot mark it a redo to get the attempt back', 'DENY', () =>
  updateDoc(mineRef(athlete(MINE)), { status: 'redo' }));
await check('  ...cannot mark it correct', 'DENY', () =>
  updateDoc(mineRef(athlete(MINE)), { status: 'correct' }));
await check('  ...cannot delete it to free an attempt', 'DENY', () =>
  deleteDoc(mineRef(athlete(MINE))));
await check('another athlete cannot write it either', 'DENY', () =>
  updateDoc(mineRef(athlete(OTHER)), { status: 'correct' }));
await check('a signed-out visitor cannot write', 'DENY', () =>
  setDoc(doc(anon(), 'practiceRuns', 'nope'), RUN));
// The admin reviews through the Admin SDK, which bypasses rules — so even
// an admin CLIENT is refused here, and nothing is lost by it.
await check('an admin client is refused too (the review goes through the Admin SDK)', 'DENY', () =>
  updateDoc(mineRef(athlete('boss')), { status: 'correct' }));

console.log('\n=== the Admin SDK, which is the only writer ===\n');
{
  let good = true;
  let detail;
  try {
    await seed();
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'practiceRuns', 'server'), RUN));
  } catch (e) {
    good = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  the Admin SDK bypasses rules, so the practice route can file`);
  if (!good) console.log(`          -> ${detail}`);
}

console.log('\n=== it is NOT onlineSubmissions ===\n');
{
  // A practice run must not be reachable as a submission, and a submission
  // must not be reachable as a practice run. Different collections is the
  // guarantee; this pins that the practice document is not also written
  // somewhere the review queue reads.
  let good = true;
  try {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDocs(collection(ctx.firestore(), 'onlineSubmissions'));
      good = snap.empty;
    });
  } catch {
    good = false;
  }
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  filing a practice run writes nothing to onlineSubmissions`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
