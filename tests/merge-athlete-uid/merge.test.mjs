// Fixture test for scripts/merge-athlete-uid.mjs, against the Firestore
// emulator. It seeds a synthetic two-athlete merge alongside two bystander
// athletes, runs the REAL script as a child process with --commit, and
// asserts the end state. Nothing here can reach production: the emulator
// is started by `firebase emulators:exec`, which sets
// FIRESTORE_EMULATOR_HOST for this process and every child it spawns.
//
//   npm run test:merge

import { execFileSync } from 'node:child_process';
import admin from 'firebase-admin';
import { replaceUidInArray, rekeyAssignments } from '../../scripts/merge-athlete-uid.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — run this via `npm run test:merge`.');
  process.exit(1);
}

const OLD = 'oldUid0000000000000000000001';
const NEW = 'newUid0000000000000000000002';
const OTHER1 = 'otherA0000000000000000000003';
const OTHER2 = 'otherB0000000000000000000004';
const OLD_EMAIL = 'old@merge-test.invalid';
const NEW_EMAIL = 'new@merge-test.invalid';
const COMP = 'comp-merge-test';
const SEASON = 'season-merge-test';
const RKEY = '333_1';

const app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'merge-test' });
const db = app.firestore();
const T = admin.firestore.Timestamp;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail !== undefined) console.log(`          -> ${detail}`);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}\n             actual   ${a}`);
}

/** Timestamps compare badly across reads; flatten to millis. */
function norm(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof T) return `ts:${value.toMillis()}`;
  if (Array.isArray(value)) return value.map(norm);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, norm(value[k])]));
  }
  return value;
}

async function seed() {
  // Wipe anything a previous run left behind, so the suite is re-runnable.
  for (const uid of [OLD, NEW, OTHER1, OTHER2]) {
    const ref = db.collection('onlineParticipants').doc(uid);
    for (const r of await ref.collection('registrations').listDocuments()) await r.delete();
    await ref.delete();
  }
  for (const d of await db.collection('onlineSubmissions').listDocuments()) await d.delete();
  for (const d of await db.collection('onlineNotifications').listDocuments()) await d.delete();
  const seasonRef = db.collection('onlineSeasonPoints').doc(SEASON);
  for (const d of await seasonRef.collection('athletes').listDocuments()) await d.delete();
  const compRef = db.collection('onlineCompetitions').doc(COMP);
  for (const col of ['qualifiers', 'groupAssignments']) {
    for (const d of await compRef.collection(col).listDocuments()) await d.delete();
  }

  // ── Participants ──
  await db.collection('onlineParticipants').doc(OLD).set({
    uid: OLD,
    displayName: 'Old Account Name',
    email: OLD_EMAIL,
    photoURL: 'https://lh3.google/old.jpg',
    createdAt: T.fromMillis(1_700_000_000_000),
    lastName: 'Ganzorig',
    firstName: 'Batbayar',
    dateOfBirth: '2003-04-12',
    gender: 'male',
    citizenship: 'Mongolia',
    photoUrl: 'https://res.cloudinary.com/x/verify.jpg',
    photoPublicId: 'verify',
    profileStatus: 'approved',
    approvedPhotoUrl: 'https://res.cloudinary.com/x/verify.jpg',
    approvedLastName: 'Ganzorig',
    approvedFirstName: 'Batbayar',
    approvedDateOfBirth: '2003-04-12',
    approvedGender: 'male',
    approvedCitizenship: 'Mongolia',
    submittedAt: T.fromMillis(1_700_000_100_000),
    reviewedAt: T.fromMillis(1_700_000_200_000),
    rejectionReason: null,
    stats: { 333: { pr: 900, ao5: 1000, solveCount: 12 }, 222: { pr: 300, ao5: 350, solveCount: 5 } },
  });
  await db.collection('onlineParticipants').doc(NEW).set({
    uid: NEW,
    displayName: 'New Account Name',
    email: NEW_EMAIL,
    photoURL: 'https://lh3.google/new.jpg',
    createdAt: T.fromMillis(1_800_000_000_000),
    // A leftover rollup on the fresh account. If the merge used
    // set(merge:true) this key would survive and fuse the two rollups.
    stats: { 555: { pr: 1, ao5: 1, solveCount: 1 } },
  });
  for (const [uid, name] of [[OTHER1, 'Bystander One'], [OTHER2, 'Bystander Two']]) {
    await db.collection('onlineParticipants').doc(uid).set({
      uid,
      displayName: name,
      email: `${uid}@merge-test.invalid`,
      photoURL: null,
      createdAt: T.fromMillis(1_750_000_000_000),
      lastName: name.split(' ')[1],
      profileStatus: 'approved',
      approvedLastName: name.split(' ')[1],
      stats: { 333: { pr: 111, ao5: 222, solveCount: 3 } },
    });
  }

  // ── Submissions: 3 on OLD, 1 on a bystander ──
  for (let i = 1; i <= 3; i++) {
    await db.collection('onlineSubmissions').doc(`sub-old-${i}`).set({
      competitionId: COMP, uid: OLD, event: '333', round: i, competitionRound: 1,
      reportedTime: 900 + i, penalty: null, status: 'approved',
      videoUrl: 'https://res.cloudinary.com/x/v.webm', cloudinaryPublicId: `pub-${i}`,
      createdAt: T.fromMillis(1_700_000_300_000 + i),
    });
  }
  await db.collection('onlineSubmissions').doc('sub-other-1').set({
    competitionId: COMP, uid: OTHER1, event: '333', round: 1, competitionRound: 1,
    reportedTime: 111, penalty: null, status: 'approved',
    videoUrl: 'https://res.cloudinary.com/x/o.webm', cloudinaryPublicId: 'pub-o',
    createdAt: T.fromMillis(1_700_000_400_000),
  });

  // ── Registrations on OLD; one carries a results object ──
  await db.collection('onlineParticipants').doc(OLD).collection('registrations').doc(COMP).set({
    competitionId: COMP,
    events: ['333', '222'],
    status: 'registered',
    registeredAt: T.fromMillis(1_700_000_500_000),
    results: { 333: { ao5: 1000, attempts: [901, 902, 903, 904, 'DNF'], submittedAt: T.fromMillis(1_700_000_600_000) } },
  });
  await db.collection('onlineParticipants').doc(OLD).collection('registrations').doc('comp-other').set({
    competitionId: 'comp-other', events: ['222'], status: 'registered',
    registeredAt: T.fromMillis(1_700_000_700_000),
  });

  // ── Season points: OLD plus a bystander ──
  await db.collection('onlineSeasonPoints').doc(SEASON).collection('athletes').doc(OLD).set({
    uid: OLD, displayName: 'Old Account Name', photoURL: 'https://lh3.google/old.jpg',
    totalPoints: 45, breakdown: [{ competitionId: COMP, eventId: '333', points: 25, placement: 1 }],
  });
  await db.collection('onlineSeasonPoints').doc(SEASON).collection('athletes').doc(OTHER1).set({
    uid: OTHER1, displayName: 'Bystander One', photoURL: null,
    totalPoints: 10, breakdown: [{ competitionId: COMP, eventId: '333', points: 10, placement: 2 }],
  });

  // ── Notifications: 3 on OLD (mixed read state), 1 on a bystander ──
  await db.collection('onlineNotifications').doc('n-old-1').set({
    uid: OLD, type: 'round_result', title: 'a', contextLabel: 'X', href: '/x', read: false,
    createdAt: T.fromMillis(1_700_000_800_000),
  });
  await db.collection('onlineNotifications').doc('n-old-2').set({
    uid: OLD, type: 'round_advanced', title: 'b', contextLabel: 'X', href: '/x', read: true,
    createdAt: T.fromMillis(1_700_000_810_000),
  });
  await db.collection('onlineNotifications').doc('n-old-3').set({
    uid: OLD, type: 'round_result', title: 'c', contextLabel: 'X', href: '/x', read: false,
    createdAt: T.fromMillis(1_700_000_820_000),
  });
  await db.collection('onlineNotifications').doc('n-other-1').set({
    uid: OTHER2, type: 'round_result', title: 'd', contextLabel: 'X', href: '/x', read: false,
    createdAt: T.fromMillis(1_700_000_830_000),
  });

  // ── Competition containers: OLD at index 1 of 3; map holds all three ──
  await db.collection('onlineCompetitions').doc(COMP).set({
    name: 'Merge Test Competition', status: 'finished', season: SEASON,
    events: [{ eventId: '333', label: '3x3x3', rounds: 2 }],
  });
  await db.collection('onlineCompetitions').doc(COMP).collection('qualifiers').doc(RKEY).set({
    eventId: '333', round: 1, uids: [OTHER1, OLD, OTHER2],
  });
  await db.collection('onlineCompetitions').doc(COMP).collection('groupAssignments').doc(RKEY).set({
    eventId: '333', round: 1, assignments: { [OTHER1]: 0, [OLD]: 2, [OTHER2]: 1 },
  });
}

function runMerge(extraArgs = []) {
  try {
    const out = execFileSync(
      process.execPath,
      ['scripts/merge-athlete-uid.mjs', '--old-email', OLD_EMAIL, '--new-email', NEW_EMAIL, ...extraArgs],
      { encoding: 'utf8', env: process.env },
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Everything the merge could possibly touch, normalised for comparison. */
async function snapshotWorld() {
  const world = {};
  for (const uid of [OLD, NEW, OTHER1, OTHER2]) {
    const ref = db.collection('onlineParticipants').doc(uid);
    const d = await ref.get();
    world[`participant/${uid}`] = d.exists ? norm(d.data()) : null;
    const regs = await ref.collection('registrations').get();
    world[`registrations/${uid}`] = regs.docs.map((r) => [r.id, norm(r.data())]);
  }
  const subs = await db.collection('onlineSubmissions').get();
  world.submissions = subs.docs.map((d) => [d.id, d.get('uid')]).sort();
  const notifs = await db.collection('onlineNotifications').get();
  world.notifications = notifs.docs.map((d) => [d.id, d.get('uid'), d.get('read')]).sort();
  const ath = await db.collection('onlineSeasonPoints').doc(SEASON).collection('athletes').get();
  world.season = ath.docs.map((d) => [d.id, norm(d.data())]).sort();
  const q = await db.collection('onlineCompetitions').doc(COMP).collection('qualifiers').doc(RKEY).get();
  world.qualifiers = q.get('uids');
  const g = await db.collection('onlineCompetitions').doc(COMP).collection('groupAssignments').doc(RKEY).get();
  world.assignments = norm(g.get('assignments'));
  return world;
}

// ══════════════════ Pure-function tests ══════════════════
function pureTests() {
  console.log('\n── Pure functions: replaceUidInArray ────────────────────');
  eq('old uid at index 1 of 3 — replaced in place, order kept',
    replaceUidInArray(['a', 'old', 'b'], 'old', 'new'), ['a', 'new', 'b']);
  eq('old uid at index 0 — stays at index 0',
    replaceUidInArray(['old', 'a', 'b'], 'old', 'new'), ['new', 'a', 'b']);
  eq('old uid last', replaceUidInArray(['a', 'b', 'old'], 'old', 'new'), ['a', 'b', 'new']);
  eq('old uid is the only entry', replaceUidInArray(['old'], 'old', 'new'), ['new']);
  eq('old uid absent — null (nothing to do)', replaceUidInArray(['a', 'b'], 'old', 'new'), null);
  eq('already migrated — null', replaceUidInArray(['a', 'new', 'b'], 'old', 'new'), null);
  eq('empty array — null', replaceUidInArray([], 'old', 'new'), null);
  eq('not an array — null', replaceUidInArray(undefined, 'old', 'new'), null);
  check('input array is not mutated', (() => {
    const src = ['a', 'old', 'b'];
    replaceUidInArray(src, 'old', 'new');
    return JSON.stringify(src) === JSON.stringify(['a', 'old', 'b']);
  })());

  console.log('\n── Pure functions: rekeyAssignments ─────────────────────');
  eq('old key among others — rekeyed, value and others kept',
    rekeyAssignments({ a: 0, old: 2, b: 1 }, 'old', 'new'), { a: 0, new: 2, b: 1 });
  eq('old key is the only entry', rekeyAssignments({ old: 7 }, 'old', 'new'), { new: 7 });
  eq('group index 0 survives (falsy value)', rekeyAssignments({ old: 0 }, 'old', 'new'), { new: 0 });
  eq('old key absent — null', rekeyAssignments({ a: 1 }, 'old', 'new'), null);
  eq('already migrated — null', rekeyAssignments({ new: 2 }, 'old', 'new'), null);
  eq('empty map — null', rekeyAssignments({}, 'old', 'new'), null);
  eq('not a map — null', rekeyAssignments(null, 'old', 'new'), null);
  check('input map is not mutated', (() => {
    const src = { a: 0, old: 2 };
    rekeyAssignments(src, 'old', 'new');
    return JSON.stringify(src) === JSON.stringify({ a: 0, old: 2 });
  })());
}

// ══════════════════ Main ══════════════════
async function main() {
  console.log('\n================ merge-athlete-uid fixture ================');
  pureTests();

  await seed();
  const before = await snapshotWorld();

  console.log('\n── Run 1: --commit ──────────────────────────────────────');
  const run1 = runMerge(['--commit']);
  check('merge exited 0', run1.code === 0, run1.out.split('\n').slice(-6).join('\n'));

  const oldDoc = await db.collection('onlineParticipants').doc(OLD).get();
  const newDoc = await db.collection('onlineParticipants').doc(NEW).get();
  const oldData = oldDoc.data() ?? {};
  const newData = newDoc.data() ?? {};

  // 1 — qualifiers
  console.log('\n── 1. qualifiers uids[] ─────────────────────────────────');
  const quals = (await db.collection('onlineCompetitions').doc(COMP).collection('qualifiers').doc(RKEY).get()).get('uids');
  eq('array is [OTHER1, NEW, OTHER2] — new uid at index 1', quals, [OTHER1, NEW, OTHER2]);
  check('length unchanged (3)', quals.length === 3, quals.length);
  check('index 1 holds the new uid', quals[1] === NEW, quals[1]);
  check('OTHER1 byte-identical at index 0', quals[0] === OTHER1, quals[0]);
  check('OTHER2 byte-identical at index 2', quals[2] === OTHER2, quals[2]);
  check('old uid gone from the array', !quals.includes(OLD));

  // 2 — groupAssignments
  console.log('\n── 2. groupAssignments map ──────────────────────────────');
  const assigns = (await db.collection('onlineCompetitions').doc(COMP).collection('groupAssignments').doc(RKEY).get()).get('assignments');
  check('old key removed', !Object.prototype.hasOwnProperty.call(assigns, OLD));
  check('new key present with the SAME group index (2)', assigns[NEW] === 2, assigns[NEW]);
  check('OTHER1 entry untouched (0)', assigns[OTHER1] === 0, assigns[OTHER1]);
  check('OTHER2 entry untouched (1)', assigns[OTHER2] === 1, assigns[OTHER2]);
  check('map still has exactly 3 entries', Object.keys(assigns).length === 3, Object.keys(assigns).length);

  // 3 — submissions + notifications
  console.log('\n── 3. submissions and notifications ─────────────────────');
  const subsAfter = await db.collection('onlineSubmissions').get();
  const oldSubs = subsAfter.docs.filter((d) => d.get('uid') === OLD);
  const newSubs = subsAfter.docs.filter((d) => d.get('uid') === NEW);
  check('3 submissions now carry the new uid', newSubs.length === 3, newSubs.length);
  check('no submission carries the old uid', oldSubs.length === 0, oldSubs.length);
  check("bystander's submission untouched",
    subsAfter.docs.find((d) => d.id === 'sub-other-1')?.get('uid') === OTHER1);
  const notifsAfter = await db.collection('onlineNotifications').get();
  check('3 notifications now carry the new uid',
    notifsAfter.docs.filter((d) => d.get('uid') === NEW).length === 3);
  check('no notification carries the old uid',
    notifsAfter.docs.filter((d) => d.get('uid') === OLD).length === 0);
  check('read/unread state preserved (2 unread, 1 read)',
    notifsAfter.docs.filter((d) => d.get('uid') === NEW && d.get('read') === false).length === 2 &&
    notifsAfter.docs.filter((d) => d.get('uid') === NEW && d.get('read') === true).length === 1);
  check("bystander's notification untouched",
    notifsAfter.docs.find((d) => d.id === 'n-other-1')?.get('uid') === OTHER2);

  // 4 — registrations
  console.log('\n── 4. registrations ─────────────────────────────────────');
  const newRegs = await db.collection('onlineParticipants').doc(NEW).collection('registrations').get();
  const oldRegs = await db.collection('onlineParticipants').doc(OLD).collection('registrations').get();
  check('2 registrations under the new uid', newRegs.size === 2, newRegs.size);
  check('0 registrations left under the old uid', oldRegs.size === 0, oldRegs.size);
  const moved = newRegs.docs.find((d) => d.id === COMP);
  eq('results object intact after the move',
    norm(moved?.get('results')),
    norm(before[`registrations/${OLD}`].find(([id]) => id === COMP)[1].results));

  // 5 — season points
  console.log('\n── 5. season points ─────────────────────────────────────');
  const seasonNew = await db.collection('onlineSeasonPoints').doc(SEASON).collection('athletes').doc(NEW).get();
  const seasonOld = await db.collection('onlineSeasonPoints').doc(SEASON).collection('athletes').doc(OLD).get();
  check('doc exists under the new uid', seasonNew.exists);
  check('doc gone from the old uid', !seasonOld.exists);
  check('totalPoints carried over (45)', seasonNew.get('totalPoints') === 45, seasonNew.get('totalPoints'));
  eq('breakdown carried over', norm(seasonNew.get('breakdown')),
    [{ competitionId: COMP, eventId: '333', placement: 1, points: 25 }]);
  check('uid field rewritten', seasonNew.get('uid') === NEW, seasonNew.get('uid'));
  check('displayName refreshed from the new account',
    seasonNew.get('displayName') === 'New Account Name', seasonNew.get('displayName'));
  check('photoURL refreshed from the new account',
    seasonNew.get('photoURL') === 'https://lh3.google/new.jpg', seasonNew.get('photoURL'));
  check("bystander's season doc untouched",
    (await db.collection('onlineSeasonPoints').doc(SEASON).collection('athletes').doc(OTHER1).get()).get('totalPoints') === 10);

  // 6 — merged profile
  console.log('\n── 6. merged profile ────────────────────────────────────');
  check('uid from NEW', newData.uid === NEW, newData.uid);
  check('email from NEW', newData.email === NEW_EMAIL, newData.email);
  check('displayName from NEW', newData.displayName === 'New Account Name', newData.displayName);
  check('photoURL from NEW', newData.photoURL === 'https://lh3.google/new.jpg', newData.photoURL);
  check('createdAt from OLD', newData.createdAt?.toMillis() === 1_700_000_000_000, newData.createdAt?.toMillis());
  for (const [k, v] of Object.entries({
    lastName: 'Ganzorig', firstName: 'Batbayar', dateOfBirth: '2003-04-12',
    gender: 'male', citizenship: 'Mongolia', profileStatus: 'approved',
    photoUrl: 'https://res.cloudinary.com/x/verify.jpg', photoPublicId: 'verify',
    approvedPhotoUrl: 'https://res.cloudinary.com/x/verify.jpg',
    approvedLastName: 'Ganzorig', approvedFirstName: 'Batbayar',
    approvedDateOfBirth: '2003-04-12', approvedGender: 'male', approvedCitizenship: 'Mongolia',
  })) {
    check(`${k} from OLD`, newData[k] === v, newData[k]);
  }
  check('submittedAt from OLD', newData.submittedAt?.toMillis() === 1_700_000_100_000);
  check('reviewedAt from OLD', newData.reviewedAt?.toMillis() === 1_700_000_200_000);
  eq('stats REPLACED wholesale with the old rollup', norm(newData.stats),
    norm({ 222: { pr: 300, ao5: 350, solveCount: 5 }, 333: { pr: 900, ao5: 1000, solveCount: 12 } }));
  check("new account's leftover stats key '555' is gone",
    !Object.prototype.hasOwnProperty.call(newData.stats ?? {}, '555'),
    Object.keys(newData.stats ?? {}).join(','));

  // 7 — tombstone: the old doc is EMPTIED, not merely flagged
  console.log('\n── 7. old doc tombstoned and stripped ───────────────────');
  check('old doc still exists', oldDoc.exists);
  check('mergedInto points at the new uid', oldData.mergedInto === NEW, oldData.mergedInto);
  check('mergedAt recorded', oldData.mergedAt !== undefined);
  // Every field the merge migrated must be gone. Leaving any of them means
  // signing in with the old Gmail shows a complete-looking second athlete.
  const MUST_BE_STRIPPED = [
    'lastName', 'firstName', 'dateOfBirth', 'gender', 'citizenship',
    'photoUrl', 'photoPublicId', 'profileStatus', 'submittedAt', 'reviewedAt',
    'rejectionReason', 'stats',
    'approvedPhotoUrl', 'approvedLastName', 'approvedFirstName',
    'approvedDateOfBirth', 'approvedGender', 'approvedCitizenship',
  ];
  for (const field of MUST_BE_STRIPPED) {
    check(`${field} stripped from the old doc`, oldData[field] === undefined, JSON.stringify(oldData[field]));
  }
  check(
    'old doc has NOTHING but its Google identity + tombstone markers',
    Object.keys(oldData).sort().join(',') === 'createdAt,displayName,email,mergedAt,mergedInto,photoURL,uid',
    Object.keys(oldData).sort().join(','),
  );
  // ...and the identity it keeps is its OWN, untouched.
  check('uid kept (own)', oldData.uid === OLD, oldData.uid);
  check('email kept (own)', oldData.email === OLD_EMAIL, oldData.email);
  check('displayName kept (own)', oldData.displayName === 'Old Account Name', oldData.displayName);
  check('photoURL kept (own)', oldData.photoURL === 'https://lh3.google/old.jpg', oldData.photoURL);
  check('createdAt kept (own)', oldData.createdAt?.toMillis() === 1_700_000_000_000, oldData.createdAt?.toMillis());

  // 8 — bystanders
  console.log('\n── 8. bystander athletes untouched ──────────────────────');
  for (const uid of [OTHER1, OTHER2]) {
    const after = norm((await db.collection('onlineParticipants').doc(uid).get()).data());
    eq(`${uid.slice(0, 8)}… participant doc identical in every field`, after, before[`participant/${uid}`]);
  }

  // ── Run 2: re-run guarded by the tombstone ──
  console.log('\n── Run 2: --commit --resume on an already-merged athlete ─');
  const afterRun1 = await snapshotWorld();
  const run2 = runMerge(['--commit', '--resume']);
  check('exits non-zero (refuses to merge twice)', run2.code !== 0, `exit ${run2.code}`);
  check('aborts on the mergedInto guard', run2.out.includes('already been merged'));
  eq('world byte-identical to after run 1', await snapshotWorld(), afterRun1);

  // ── Run 3: a true resume — tombstone cleared, everything already moved ──
  // This is the state an interrupted run leaves behind, and it exercises
  // the "already migrated" skip branches in the F and G transactions.
  console.log('\n── Run 3: true resume (tombstone cleared, work already done) ─');
  await db.collection('onlineParticipants').doc(OLD).update({
    mergedInto: admin.firestore.FieldValue.delete(),
    mergedAt: admin.firestore.FieldValue.delete(),
  });
  const beforeRun3 = await snapshotWorld();
  const run3 = runMerge(['--commit', '--resume']);
  check('exits 0', run3.code === 0, run3.out.split('\n').slice(-6).join('\n'));
  const afterRun3 = await snapshotWorld();
  // The only legitimate difference is the fresh tombstone on the old doc.
  const strip = (w) => {
    const c = JSON.parse(JSON.stringify(w));
    delete c[`participant/${OLD}`].mergedAt;
    delete c[`participant/${OLD}`].mergedInto;
    return c;
  };
  eq('world unchanged apart from the re-applied tombstone', strip(afterRun3), strip(beforeRun3));
  check('tombstone re-applied', (await db.collection('onlineParticipants').doc(OLD).get()).get('mergedInto') === NEW);
  check('qualifiers array still correct after resume',
    JSON.stringify(afterRun3.qualifiers) === JSON.stringify([OTHER1, NEW, OTHER2]),
    JSON.stringify(afterRun3.qualifiers));
  check('assignments still correct after resume',
    JSON.stringify(afterRun3.assignments) === JSON.stringify(norm({ [OTHER1]: 0, [NEW]: 2, [OTHER2]: 1 })),
    JSON.stringify(afterRun3.assignments));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
