// ── An attempt nobody can judge must not be recordable ─────────────────
// The solve page asks this route for a scramble at the start of every
// attempt, and what comes back decides whether the athlete may begin.
//
// THE BUG THIS SUITE EXISTS FOR: an athlete with no group assignment used
// to be handed a randomly generated scramble, indistinguishable from an
// official one on screen. They would solve five attempts against a
// scramble nobody else had, film all of it, and the problem would surface
// at review — after the solving was done, with nothing to compare the
// video to and no way to give the attempts back.
//
// The fix turns on a distinction this suite is mostly about: "no group"
// and "no scrambles imported at all" both used to be the same answer.
// They are not the same situation. A round with no import is an ordinary
// club round where random is right for EVERYONE, and it must keep
// working — breaking that would lock every athlete out of every
// competition that doesn't use WCA imports.
//
// Exercises the real compiled module against the Firestore emulator.
// Run: npm run test:groups

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-groups-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/group-scramble.ts',
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

const { lookupGroupScramble } = require(path.join(OUT, 'group-scramble.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-groups' }, 'groups'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

const GROUPED = 'uid-grouped';
const UNGROUPED = 'uid-ungrouped';

/** Seeds one event+round of a competition. `groups` omitted entirely =
 *  the round never had scrambles imported. */
async function seed(compId, { groups, assignments } = {}) {
  const comp = db.collection('onlineCompetitions').doc(compId);
  if (groups) {
    await comp.collection('scrambleData').doc('333_1').set({ eventId: '333', round: 1, groups });
  }
  if (assignments) {
    await comp.collection('groupAssignments').doc('333_1').set({ assignments });
  }
}

const look = (compId, uid, attempt) =>
  lookupGroupScramble(db, { competitionId: compId, eventId: '333', round: 1, uid, attempt });

(async () => {
  console.log('\n=== official scrambles: who may solve, and who is refused ===\n');

  // ── An ordinary official round ────────────────────────────────────────
  await seed('comp-official', {
    groups: [
      { label: 'A', scrambles: ["R U R'", "F F F", "L D L'"] },
      { label: 'B', scrambles: ["U2 R2", "D D D", "B L B'"] },
    ],
    assignments: { [GROUPED]: 1 },
  });

  {
    const r = await look('comp-official', GROUPED, 2);
    ok('1. an assigned athlete gets their group\'s scramble for this attempt',
      r && r.scramble === 'D D D' && r.groupLabel === 'B', JSON.stringify(r));
  }
  {
    // Attempt indexing is 1-based against the array — an off-by-one here
    // would hand out the wrong attempt's scramble, silently and legally.
    const r = await look('comp-official', GROUPED, 1);
    ok('2. ...indexed by attempt, 1-based', r && r.scramble === 'U2 R2', JSON.stringify(r));
  }

  // ── THE HOLE: assigned to nobody, in a round that has scrambles ───────
  {
    const r = await look('comp-official', UNGROUPED, 1);
    ok('3. an UNGROUPED athlete in an official round is refused',
      r !== null && r.noGroup === true, JSON.stringify(r));
    ok('4. ...and is NOT quietly given a scramble instead',
      !(r && r.scramble), JSON.stringify(r));
  }

  // ── No scramble for THIS attempt number ──────────────────────────────
  {
    const r = await look('comp-official', GROUPED, 4);
    ok('5. an attempt past the end of the group\'s set is refused',
      r && r.outOfRange === true && r.max === 3, JSON.stringify(r));
  }
  {
    // A blank entry inside the array — a malformed import rather than a
    // short one. Same outcome: no official scramble exists for this
    // attempt, so nothing may be invented for it.
    await seed('comp-blank', {
      groups: [{ label: 'A', scrambles: ["R U R'", '   ', "L D L'"] }],
      assignments: { [GROUPED]: 0 },
    });
    const r = await look('comp-blank', GROUPED, 2);
    ok('6. a blank scramble entry is refused, not filled in randomly',
      r !== null && r.noGroup === true, JSON.stringify(r));
    const ok3 = await look('comp-blank', GROUPED, 3);
    ok('7. ...while its neighbours in the same group still work',
      ok3 && ok3.scramble === "L D L'", JSON.stringify(ok3));
  }

  // ── The ordinary club round, which must NOT be broken by any of this ──
  {
    const r = await look('comp-casual', UNGROUPED, 1);
    ok('8. a round with NO imported scrambles still falls back to random',
      r === null, JSON.stringify(r));
    const r2 = await look('comp-casual', GROUPED, 3);
    ok('9. ...for every athlete, at every attempt',
      r2 === null, JSON.stringify(r2));
  }

  // ── Scrambles imported, assignments not done yet ──────────────────────
  // The window between an admin importing a JSON and assigning groups.
  // Nobody has a group, but the round is official, so nobody may solve —
  // which is the correct and recoverable state: the admin assigns, and
  // the athletes' next attempt request succeeds.
  {
    await seed('comp-unassigned', {
      groups: [{ label: 'A', scrambles: ["R U R'"] }],
    });
    const r = await look('comp-unassigned', GROUPED, 1);
    ok('10. scrambles imported but groups not assigned yet refuses everyone',
      r !== null && r.noGroup === true, JSON.stringify(r));
  }

  // ── A group index pointing outside the imported groups ───────────────
  {
    await seed('comp-badindex', {
      groups: [{ label: 'A', scrambles: ["R U R'"] }],
      assignments: { [GROUPED]: 7 },
    });
    const r = await look('comp-badindex', GROUPED, 1);
    ok('11. an assignment pointing at a group that does not exist is refused',
      r !== null && r.noGroup === true, JSON.stringify(r));
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
