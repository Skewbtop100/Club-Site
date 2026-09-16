// ── The practice review grid's rows ─────────────────────────────────────
// Pure unit tests for lib/online-competition/practice-review-rows.ts. No
// emulator, no Firestore, no React.
//
// What carries weight here:
//   A ROW IS THE ATHLETE'S WHOLE HISTORY on both tabs. The ХЯНАГДААГҮЙ tab
//     decides which athletes appear, never which of their runs — deciding a
//     run must not take it off the screen.
//   A ROW LEAVES ХЯНАГДААГҮЙ once nothing of its is pending, EXCEPT while the
//     admin has that athlete's run open: the decision is seen to land, as it
//     is on the competition grid, and the row goes when the panel moves on.
//
// Run: npm run test:practicerows

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-practice-rows-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/practice-review-rows.ts',
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

const R = require(path.join(OUT, 'practice-review-rows.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`          -> ${detail}`);
  }
}
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const run = (id, uid, status, t) => ({ id, uid, displayName: uid.toUpperCase(), status, createdAtMs: t });

// "Tried five times and got it wrong each time" — four refusals and the
// fifth waiting. Plus one athlete with nothing waiting, and one with a redo.
const FIVE = [
  run('a1', 'ann', 'incorrect', 100),
  run('a2', 'ann', 'incorrect', 200),
  run('a3', 'ann', 'incorrect', 300),
  run('a4', 'ann', 'incorrect', 400),
  run('a5', 'ann', 'pending', 500),
];
const DONE = [run('b1', 'bob', 'correct', 50), run('b2', 'bob', 'redo', 60)];
const OTHER = [run('c1', 'cat', 'pending', 700), run('c2', 'cat', 'correct', 650)];
const ALL = [...FIVE, ...DONE, ...OTHER];

const ids = (row) => row.runs.map((r) => r.id).join(',');
const uids = (rows) => rows.map((r) => r.uid).join(',');

console.log('\n  -- ХЯНАГДААГҮЙ: a row is the whole history --');
{
  const rows = R.practiceReviewRows(ALL, 'pending', null);
  eq('only athletes with something pending appear', uids(rows), 'ann,cat');
  const ann = rows.find((r) => r.uid === 'ann');
  eq('the row carries all five runs, decided ones included', ann.runs.length, 5);
  eq('  ...oldest first, left to right', ids(ann), 'a1,a2,a3,a4,a5');
  eq('  ...each keeping its own state',
    ann.runs.map((r) => r.status).join(','), 'incorrect,incorrect,incorrect,incorrect,pending');
  eq('the pending count is the runs waiting, not the runs drawn', ann.pending, 1);
  eq('used-of-ten counts all five', ann.used, 5);
  const cat = rows.find((r) => r.uid === 'cat');
  eq('a decided run older than the pending one still shows, in order', ids(cat), 'c2,c1');
}

console.log('\n  -- deciding a run does not take it off the screen --');
{
  // The fourth refusal becomes a fifth: ann's last pending run decided.
  const decided = ALL.map((r) => (r.id === 'a5' ? { ...r, status: 'incorrect' } : r));

  const whileOpen = R.practiceReviewRows(decided, 'pending', 'ann');
  const ann = whileOpen.find((r) => r.uid === 'ann');
  ok('while her run is open, the row stays', ann !== undefined, uids(whileOpen));
  eq('  ...with all five runs', ann && ann.runs.length, 5);
  eq('  ...the decided one now reading its new state', ann && ann.runs[4].status, 'incorrect');
  eq('  ...and nothing pending', ann && ann.pending, 0);
  // The row must not jump under the admin's cursor.
  eq('  ...and it keeps its place at the top', whileOpen[0].uid, 'ann');

  const afterClose = R.practiceReviewRows(decided, 'pending', null);
  eq('once the panel closes, the row leaves', uids(afterClose), 'cat');

  const movedOn = R.practiceReviewRows(decided, 'pending', 'cat');
  eq('once the panel moves to another athlete, it leaves too', uids(movedOn), 'cat');

  // Holding is only ever a stay of execution for a row with NOTHING pending.
  const partly = ALL.map((r) => (r.id === 'c1' ? { ...r, status: 'correct' } : r));
  eq('an athlete held while NOT open does not appear',
    uids(R.practiceReviewRows(partly, 'pending', null)), 'ann');
  // Held is decided by the OPEN RUN, which can only be one the admin clicked
  // on screen — so holding keeps a row, it never summons one from elsewhere.
  eq('the held athlete is the only exception to the pending filter',
    uids(R.practiceReviewRows([...DONE, run('d1', 'dan', 'correct', 70)], 'pending', 'bob')), 'bob');
}

console.log('\n  -- БҮГД: every athlete, unchanged by a decision --');
{
  const rows = R.practiceReviewRows(ALL, 'all', null);
  eq('every athlete appears', rows.length, 3);
  eq('waiting athletes first, longest-standing first', uids(rows), 'ann,cat,bob');
  const bob = rows.find((r) => r.uid === 'bob');
  eq('an athlete with nothing pending is still there', bob.runs.length, 2);
  eq('  ...a redo does not spend one of the ten', bob.used, 1);
  const decided = ALL.map((r) => (r.id === 'a5' ? { ...r, status: 'correct' } : r));
  eq('deciding a run keeps every row', R.practiceReviewRows(decided, 'all', 'ann').length, 3);
  eq('  ...and the held athlete does not drop below the waiting ones',
    uids(R.practiceReviewRows(decided, 'all', 'ann')), 'ann,cat,bob');
}

console.log('\n  -- the tab count follows the runs on screen --');
{
  eq('two waiting', R.practicePendingCount(ALL), 2);
  eq('one after a decision, with no reload',
    R.practicePendingCount(ALL.map((r) => (r.id === 'a5' ? { ...r, status: 'redo' } : r))), 1);
  eq('none', R.practicePendingCount(DONE), 0);
}

console.log('\n  -- edges --');
{
  eq('no runs, no rows', R.practiceReviewRows([], 'pending', null).length, 0);
  const undated = R.practiceReviewRows([run('x', 'zed', 'pending', null)], 'pending', null);
  eq('a run with no date still makes a row', undated.length, 1);
  // Input order must not decide the drawn order.
  const shuffled = R.practiceReviewRows([...FIVE].reverse(), 'pending', null);
  eq('runs are ordered by date, not by arrival', ids(shuffled[0]), 'a1,a2,a3,a4,a5');
}

console.log('\n  -- the screen uses it --');
{
  const src = fs.readFileSync(
    path.join(ROOT, 'app/online-competition/admin/_components/PracticeReview.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('rows come from practiceReviewRows, held by the open run', /practiceReviewRows\(data\.runs, scope, heldUid\)/.test(code));
  // THE REGRESSION ITSELF: a decision must not reload the list or close the
  // panel — that is what took a row's history off the screen.
  const decide = code.slice(code.indexOf('async function decide'), code.indexOf('return (', code.indexOf('async function decide')));
  ok('deciding does not reload the list', !/await load\(\)/.test(decide), decide.slice(0, 200));
  ok('deciding does not close the panel', !/setOpenId\(null\)/.test(decide));
  ok('deciding patches the run in place', /runs: prev\.runs\.map\(/.test(decide));
  ok('the tab count is counted from the runs on screen', /practicePendingCount\(data\.runs\)/.test(code));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
