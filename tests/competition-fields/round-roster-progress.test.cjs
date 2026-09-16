// ── Roster progress: the numbers Раунд удирдах runs on ──────────────────
// Pure unit tests for roundRosterProgress. No emulator, no Firestore, no
// React.
//
// NOT tests/competition-fields/round-progress.test.cjs — that suite covers
// round-progress.ts, AdminOverview's submission-count bars, which answer a
// different question and keep their own documented approximations.
//
// What carries weight here:
//   THE ROSTER IS THE AUTHORITY on who is in a round. A submission from
//     somebody not on it must not add a participant — round membership is
//     decided by registration or by a qualifier document, never by the
//     existence of a solve.
//   complete + incomplete == participants, ALWAYS. The header shows all
//     three; if they stop adding up, the page is lying about something.
//   CUTOFF-AWARENESS is not this module's rule — it defers to
//     rankJudgedStandings, which the public standings and the qualifier
//     also use. The test for it is that an athlete the cutoff stopped
//     counts as COMPLETE on two attempts of five, because that is what the
//     ranking already believes. A second implementation here would
//     eventually disagree, and the first symptom would be an admin warned
//     that a finished round is unfinished.
//   AWAITING BEATS EVERYTHING. An athlete with five filed and one unjudged
//     is not complete, and is not the admin's to chase.
//
// Run: npm run test:rosterprogress

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-rosterprogress-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/round-roster-progress.ts',
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

const { roundRosterProgress } = require(path.join(OUT, 'round-roster-progress.js'));

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

const AO5 = { format: 'ao5', attempts: 5, timeLimitCs: null, cutoffCs: null };
/** ao5 with a 20.00 cutoff, which applies to the first two attempts. */
const AO5_CUT = { format: 'ao5', attempts: 5, timeLimitCs: null, cutoffCs: 2000 };

let seq = 0;
/** One submission. `time` in centiseconds; 'DNF' for a judge's rejection. */
function sub(uid, attempt, time, status = 'approved') {
  seq += 1;
  return {
    uid,
    event: '333',
    competitionRound: 1,
    attempt,
    status,
    reportedTime: time === 'DNF' ? 0 : time,
    isDnf: time === 'DNF',
    penalty: null,
    createdAt: seq,
  };
}
/** n approved attempts for one athlete, all the same time. */
const runOf = (uid, n, time = 1000) => Array.from({ length: n }, (_, i) => sub(uid, i + 1, time));

console.log('\n  -- the roster decides who is in the round --');
{
  const p = roundRosterProgress(['a', 'b', 'c'], [], AO5);
  eq('an empty round has every roster member as a participant', p.participants, 3);
  eq('  ...none complete', p.complete, 0);
  eq('  ...all incomplete', p.incomplete, 3);
  eq('  ...all not started', p.notStarted, 3);
  eq('  ...one row each', p.rows.length, 3);
  ok('  ...with empty cells', p.rows.every((r) => r.cells.length === 5 && r.cells.every((c) => c === null)));
}
{
  // A solve from somebody not in the round: real, and awaiting review, so
  // the judge's queue counts it — but it is not a participant.
  const p = roundRosterProgress(['a'], [sub('gatecrasher', 1, 900, 'pending')], AO5);
  eq('a submission from off the roster adds no participant', p.participants, 1);
  eq('  ...gets no row', p.rows.length, 1);
  eq('  ...but is still in the judge queue', p.pendingSubmissions, 1);
  eq('  ...and is not counted as an athlete awaiting review', p.pendingAthletes, 0);
}
{
  const p = roundRosterProgress(['a', 'a', 'b'], [], AO5);
  eq('a duplicated roster entry counts once', p.participants, 2);
}

console.log('\n  -- complete, incomplete, and the sum --');
{
  const p = roundRosterProgress(['a', 'b', 'c'], [...runOf('a', 5), ...runOf('b', 3)], AO5);
  eq('five of five is complete', p.complete, 1);
  eq('  ...three of five is not', p.incomplete, 2);
  eq('  ...complete + incomplete == participants', p.complete + p.incomplete, p.participants);
  eq('  ...b has started, so is not "not started"', p.notStarted, 1);
  const a = p.rows.find((r) => r.uid === 'a');
  const b = p.rows.find((r) => r.uid === 'b');
  eq('a: state', a.state, 'complete');
  eq('a: 5 of 5', `${a.filed}/${a.expected}`, '5/5');
  eq('b: state', b.state, 'incomplete');
  eq('b: 3 of 5', `${b.filed}/${b.expected}`, '3/5');
}
{
  // A judge-assigned DNF is a JUDGED attempt: the round is finished, and
  // WCA drops it as the worst of five. Not an unfinished round.
  const p = roundRosterProgress(['a'], [...runOf('a', 4), sub('a', 5, 'DNF')], AO5);
  eq('a DNF still completes the round', p.complete, 1);
  eq('  ...and shows as a filed attempt', p.rows[0].filed, 5);
  ok('  ...rendered as DNF, not a time', p.rows[0].cells[4] === 'DNF', JSON.stringify(p.rows[0].cells));
}

console.log('\n  -- awaiting review wins --');
{
  const p = roundRosterProgress(['a'], [...runOf('a', 4), sub('a', 5, 900, 'pending')], AO5);
  eq('five filed with one unjudged is NOT complete', p.complete, 0);
  eq('  ...it is awaiting', p.rows[0].state, 'awaiting');
  eq('  ...one submission in the queue', p.pendingSubmissions, 1);
  eq('  ...one athlete waiting', p.pendingAthletes, 1);
  eq('  ...and it counts as incomplete in the totals', p.incomplete, 1);
  eq('  ...the pending slot is named', JSON.stringify(p.rows[0].pendingSlots), '[5]');
  ok('  ...its cell stays empty, because nothing is judged there', p.rows[0].cells[4] === null);
}
{
  const p = roundRosterProgress(['a'], [sub('a', 1, 900, 'pending'), sub('a', 2, 900, 'pending')], AO5);
  eq('two unjudged from one athlete: two submissions', p.pendingSubmissions, 2);
  eq('  ...one athlete', p.pendingAthletes, 1);
  eq('  ...not "not started" — they have filed', p.notStarted, 0);
}
{
  // Out of the format's slots: ignored, as the rankers ignore it, so stale
  // data cannot inflate the judge's queue.
  const p = roundRosterProgress(['a'], [sub('a', 9, 900, 'pending'), sub('a', 0, 900, 'pending')], AO5);
  eq('attempts outside 1..5 are not queued', p.pendingSubmissions, 0);
}

console.log('\n  -- the cutoff, deferred to rankJudgedStandings --');
{
  // Both cutoff attempts judged and neither better than 20.00: the round
  // ends there. Two attempts, and the athlete IS finished.
  const p = roundRosterProgress(['a'], [sub('a', 1, 2500), sub('a', 2, 2400)], AO5_CUT);
  eq('cut off after the phase: complete', p.complete, 1);
  const r = p.rows[0];
  eq('  ...state', r.state, 'complete');
  ok('  ...marked as cut off', r.cutOff === true);
  eq('  ...owes only the phase', `${r.filed}/${r.expected}`, '2/2');
}
{
  // Beat the cutoff on attempt 2 -> owes all five, so two is not enough.
  const p = roundRosterProgress(['a'], [sub('a', 1, 2500), sub('a', 2, 1500)], AO5_CUT);
  eq('made the cutoff: two of five is incomplete', p.incomplete, 1);
  eq('  ...not marked cut off', p.rows[0].cutOff, false);
  eq('  ...owes five', p.rows[0].expected, 5);
}
{
  const p = roundRosterProgress(['a'], [sub('a', 1, 2500), sub('a', 2, 2400)], AO5);
  eq('no cutoff on the round: the same two attempts are incomplete', p.incomplete, 1);
  eq('  ...and nobody is cut off', p.rows[0].cutOff, false);
}

console.log("\n  -- row order is the admin's, not a ranking --");
{
  const p = roundRosterProgress(
    ['done', 'waiting', 'partial'],
    [...runOf('done', 5), ...runOf('partial', 2), ...runOf('waiting', 4), sub('waiting', 5, 900, 'pending')],
    AO5,
  );
  eq('awaiting first, then incomplete, then complete',
    p.rows.map((r) => r.uid).join(','), 'waiting,partial,done');
  ok('order does not depend on times', p.rows[0].state === 'awaiting');
}
{
  // Same input, different order in: same output.
  const subs = [...runOf('a', 5), ...runOf('b', 1)];
  const one = roundRosterProgress(['a', 'b'], subs, AO5).rows.map((r) => r.uid).join(',');
  const two = roundRosterProgress(['b', 'a'], subs.slice().reverse(), AO5).rows.map((r) => r.uid).join(',');
  eq('stable whatever order the roster and submissions arrive in', one, two);
}

console.log('\n  -- other formats --');
{
  const BO1 = { format: 'bo1', attempts: 1, timeLimitCs: null, cutoffCs: null };
  const p = roundRosterProgress(['a', 'b'], [sub('a', 1, 900)], BO1);
  eq('bo1: one attempt completes the round', p.complete, 1);
  eq('  ...and the other athlete owes one', p.rows.find((r) => r.uid === 'b').expected, 1);
}
{
  const MO3 = { format: 'mo3', attempts: 3, timeLimitCs: null, cutoffCs: null };
  const p = roundRosterProgress(['a'], runOf('a', 3), MO3);
  eq('mo3: three attempts complete the round', p.complete, 1);
}

console.log('\n  -- it is a DIFFERENT module from round-progress.ts --');
{
  const src = fs.readFileSync(path.join(ROOT, 'lib/online-competition/round-roster-progress.ts'), 'utf8');
  ok('it defers "finished" to rankJudgedStandings rather than deciding it',
    /rankJudgedStandings/.test(src));
  ok('  ...and does not reimplement the cutoff test',
    !/cutoffPhaseFor/.test(src), 'cutoffPhaseFor appears — the cutoff rule has been copied');
  ok('round-progress.ts is untouched by this feature',
    !/roundRosterProgress/.test(fs.readFileSync(path.join(ROOT, 'lib/online-competition/round-progress.ts'), 'utf8')));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
