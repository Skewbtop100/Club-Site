// ── A round must not open on athletes who cannot solve it ──────────────
// The scramble route already refuses an athlete with no group assignment.
// That is correct and it is LATE: the athlete meets it sitting in front
// of a camera, having been told the round is open, and the admin meets it
// as a confused message from somebody else rather than as the result of
// the action that caused it.
//
// So the same fact is asked at the admin's start action, where the fix is
// one assignment click. This suite pins the four answers that action can
// give, and one of them is "yes, open it" — which matters as much as the
// refusals, because a check that blocked a competition running on random
// scrambles would lock every club competition out of its own rounds.
//
// Exercises the real compiled modules against the Firestore emulator.
// Run: npm run test:roundready

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-roundready-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/round-readiness.ts',
      '--outDir', path.basename(OUT),
      '--module', 'commonjs',
      '--target', 'es2022',
      '--moduleResolution', 'node',
      '--strict',
      '--skipLibCheck',
      '--esModuleInterop',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
compile();

const { roundScrambleReadiness, ROUND_READINESS_MESSAGE } = require(
  path.join(OUT, 'round-readiness.js'),
);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-roundready' }, 'roundready'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

const EVENT = '333';

/** Registers an athlete for a competition, the way the roster reads them:
 *  a participant profile plus a competing registration subdocument. */
async function register(compId, uid, displayName, { status = 'approved', events = [EVENT] } = {}) {
  await db.collection('onlineParticipants').doc(uid).set({ displayName }, { merge: true });
  await db
    .collection('onlineParticipants')
    .doc(uid)
    .collection('registrations')
    .doc(compId)
    .set({ competitionId: compId, status, events });
}

async function importScrambles(compId, round, groups) {
  await db
    .collection('onlineCompetitions')
    .doc(compId)
    .collection('scrambleData')
    .doc(`${EVENT}_${round}`)
    .set({ eventId: EVENT, round, groups });
}

async function assign(compId, round, assignments) {
  await db
    .collection('onlineCompetitions')
    .doc(compId)
    .collection('groupAssignments')
    .doc(`${EVENT}_${round}`)
    .set({ eventId: EVENT, round, assignments });
}

const GROUPS = [
  { label: 'A', scrambles: ["R U R'", "F F F", "L D L'"] },
  { label: 'B', scrambles: ["U2 R2", "D D D", "B L B'"] },
];

const check = (compId, round = 1) => roundScrambleReadiness(db, compId, EVENT, round);

(async () => {
  console.log('\n=== opening a round: who is not ready ===\n');

  // ── 1. Everyone assigned — the round opens ────────────────────────────
  {
    const C = 'rr-allgood';
    await register(C, 'u-ann', 'Анн');
    await register(C, 'u-bat', 'Бат');
    await importScrambles(C, 1, GROUPS);
    await assign(C, 1, { 'u-ann': 0, 'u-bat': 1 });

    const r = await check(C);
    ok('1. every registered athlete assigned -> the round opens',
      r.ok === true && r.mode === 'official', JSON.stringify(r));
    ok('2. ...having actually checked them, not vacuously passed',
      r.checked === 2, JSON.stringify(r));
  }

  // ── 2. One athlete unassigned — refused, BY NAME ──────────────────────
  {
    const C = 'rr-oneshort';
    await register(C, 'u-ann', 'Анн');
    await register(C, 'u-bat', 'Бат');
    await register(C, 'u-cec', 'Цэцэг');
    await importScrambles(C, 1, GROUPS);
    await assign(C, 1, { 'u-ann': 0, 'u-cec': 1 });

    const r = await check(C);
    ok('3. one unassigned athlete refuses the round',
      r.ok === false && r.reason === 'unassigned', JSON.stringify(r));
    // The point of the whole feature: the admin must be able to act on
    // this without going to look anything up.
    ok('4. ...naming exactly who, and only who',
      r.athletes?.length === 1 && r.athletes[0].uid === 'u-bat', JSON.stringify(r.athletes));
    ok('5. ...with a display name, not a uid',
      r.athletes?.[0].displayName === 'Бат', JSON.stringify(r.athletes));
    ok('6. ...under the message that says what to do',
      ROUND_READINESS_MESSAGE.unassigned ===
        'Дараах тамирчид группэд хуваарилагдаагүй байна. Хуваарилсны дараа раунд эхэлнэ.');
  }

  // ── 3. No import at all — random-scramble mode, opens normally ────────
  // The regression this suite exists to prevent as much as the bug: most
  // club competitions never import a WCA JSON, have no groups by
  // definition, and must be entirely unaffected.
  {
    const C = 'rr-random';
    await register(C, 'u-ann', 'Анн');
    await register(C, 'u-bat', 'Бат');

    const r = await check(C);
    ok('7. a round with NO imported scrambles opens normally',
      r.ok === true && r.mode === 'random', JSON.stringify(r));
    ok('8. ...and names nobody, because nobody is missing anything',
      r.athletes === undefined, JSON.stringify(r));
  }

  // ── 4. Import present but empty — refused, WITHOUT the name list ──────
  {
    const C = 'rr-emptyimport';
    for (let i = 0; i < 12; i++) await register(C, `u-crowd-${i}`, `Тамирчин ${i}`);
    await importScrambles(C, 1, []);

    const r = await check(C);
    ok('9. an import with no groups refuses the round',
      r.ok === false && r.reason === 'no-scrambles', JSON.stringify(r));
    // Twelve names here would bury the one thing to fix, and a real round
    // could carry a hundred.
    ok('10. ...without listing every athlete in the competition',
      r.athletes === undefined, JSON.stringify(r));
    ok('11. ...saying the import is what is missing',
      ROUND_READINESS_MESSAGE['no-scrambles'] === 'Энэ раундад холилт оруулаагүй байна.');
  }
  {
    // Groups exist but hold nothing solvable — the same situation wearing
    // a different shape, and it must not fall through to naming everyone.
    const C = 'rr-emptygroups';
    await register(C, 'u-ann', 'Анн');
    await importScrambles(C, 1, [{ label: 'A', scrambles: [] }, { label: 'B', scrambles: ['  '] }]);

    const r = await check(C);
    ok('12. groups with no usable scrambles refuse the same way',
      r.ok === false && r.reason === 'no-scrambles', JSON.stringify(r));
  }

  // ── 5. Only athletes registered for THIS event count ──────────────────
  {
    const C = 'rr-otherevent';
    await register(C, 'u-ann', 'Анн');
    await register(C, 'u-two', 'Хоёр', { events: ['222'] });
    await importScrambles(C, 1, GROUPS);
    await assign(C, 1, { 'u-ann': 0 });

    const r = await check(C);
    ok('13. an athlete registered for another event does not hold 3x3 up',
      r.ok === true, JSON.stringify(r));
  }

  // ── 6. Withdrawn/pending registrations do not hold a round up ─────────
  {
    const C = 'rr-notcompeting';
    await register(C, 'u-ann', 'Анн');
    await register(C, 'u-out', 'Гарсан', { status: 'withdrawn' });
    await importScrambles(C, 1, GROUPS);
    await assign(C, 1, { 'u-ann': 0 });

    const r = await check(C);
    ok('14. a non-competing registration is not expected to have a group',
      r.ok === true, JSON.stringify(r));
  }

  // ── 7. Round 2 checks QUALIFIERS, not everyone registered ─────────────
  // Round 2 is only open to whoever advanced. Checking every registrant
  // would make round 2 un-openable the moment anyone was eliminated,
  // which is every round 2 there has ever been.
  {
    const C = 'rr-round2';
    await register(C, 'u-ann', 'Анн');
    await register(C, 'u-bat', 'Бат');
    await register(C, 'u-cec', 'Цэцэг');
    await importScrambles(C, 2, GROUPS);
    // Only the two who advanced are assigned for round 2.
    await assign(C, 2, { 'u-ann': 0, 'u-bat': 1 });
    await db
      .collection('onlineCompetitions')
      .doc(C)
      .collection('qualifiers')
      .doc(`${EVENT}_1`)
      .set({ uids: ['u-ann', 'u-bat'] });

    const r = await check(C, 2);
    ok('15. round 2 ignores an eliminated athlete with no group',
      r.ok === true && r.checked === 2, JSON.stringify(r));
  }
  {
    // ...but a QUALIFIED athlete with no group still stops it.
    const C = 'rr-round2-short';
    await register(C, 'u-ann', 'Анн');
    await register(C, 'u-bat', 'Бат');
    await importScrambles(C, 2, GROUPS);
    await assign(C, 2, { 'u-ann': 0 });
    await db
      .collection('onlineCompetitions')
      .doc(C)
      .collection('qualifiers')
      .doc(`${EVENT}_1`)
      .set({ uids: ['u-ann', 'u-bat'] });

    const r = await check(C, 2);
    ok('16. ...but a qualified athlete with no group still refuses it',
      r.ok === false && r.reason === 'unassigned' && r.athletes[0].uid === 'u-bat',
      JSON.stringify(r));
  }

  // ── 8. An assignment pointing nowhere useful ──────────────────────────
  {
    const C = 'rr-badindex';
    await register(C, 'u-ann', 'Анн');
    await importScrambles(C, 1, GROUPS);
    await assign(C, 1, { 'u-ann': 9 });

    const r = await check(C);
    ok('17. an assignment to a group that does not exist is not "assigned"',
      r.ok === false && r.reason === 'unassigned' && r.athletes[0].uid === 'u-ann',
      JSON.stringify(r));
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
