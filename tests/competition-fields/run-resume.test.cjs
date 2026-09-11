// ── Picking a run back up ───────────────────────────────────────────────
// REAL unit tests, not source assertions: run-resume.ts is pure, so the
// arithmetic that decides which attempt an athlete solves next — and
// whether their run is already over — is exercised directly.
//
// What it is for: attempts are filed one at a time as they are recorded,
// so leaving the page must not be a way to discard a solve that went
// badly. Coming back has to land on the attempt AFTER the last one filed,
// with the earlier ones counted, in the round the run started in.
//
// The wiring around it (the read, the round-access call, what the athlete
// is shown) is a React component and cannot be tested here — see
// tests/solve-flow/run-protection.test.cjs for what is pinned by reading.
//
// Run: npm run test:resume

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-resume-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/run-resume.ts',
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

const { planResume, cutoffFailed, resolveAttemptTime, resumeNotice } = require(path.join(OUT, 'run-resume.js'));

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

/** An Ao5 round with no cutoff and no time limit, unless overridden. */
const AO5 = { format: 'ao5', attempts: 5, timeLimitCs: null, cutoffCs: null, cutoffPhase: null };
/** One filed attempt, as fetchMyFiledAttempts returns it. */
const filed = (attempt, reportedTime, over = {}) => ({
  submissionId: `u__c__333__r1__a${attempt}`,
  attempt,
  competitionRound: 1,
  reportedTime,
  isDnf: false,
  ...over,
});

console.log('\n  -- where the run picks up --');
{
  const fresh = planResume([], 1, AO5);
  eq('nothing filed: a fresh run at attempt 1', fresh.kind, 'fresh');
  eq('  ...attempt 1', fresh.nextAttempt, 1);
  eq('  ...with nothing to rebuild', fresh.priorAttempts.length, 0);
  eq('  ...in the live round', fresh.competitionRound, 1);
}
{
  const r = planResume([filed(1, 1244), filed(2, 1402)], 1, AO5);
  eq('two filed: the run resumes', r.kind, 'resume');
  eq('  ...at attempt 3 — the one AFTER the last filed', r.nextAttempt, 3);
  eq('  ...and the two are rebuilt', r.priorAttempts.length, 2);
  eq('  ...with their times', r.priorAttempts.map((a) => a.timeCs).join(','), '1244,1402');
}
// Order of the read is not order of the run.
eq('filed attempts arrive in any order', planResume([filed(3, 1351), filed(1, 1244), filed(2, 1402)], 1, AO5).nextAttempt, 4);
{
  const r = planResume([filed(1, 1244), filed(2, 0, { isDnf: true }), filed(3, 1351)], 1, AO5);
  eq('a DNF comes back as a DNF', r.priorAttempts[1].isDnf, true);
  // createSubmission stores 0 for a DNF; a 0 must never read as a 0.00 solve.
  eq('  ...with no time, not a 0.00', r.priorAttempts[1].timeCs, null);
  eq('  ...and does not break the count', r.nextAttempt, 4);
}
{
  const r = planResume([filed(1, 1244), filed(2, 1402), filed(3, 1351), filed(4, 1877), filed(5, 1390)], 1, AO5);
  eq('every attempt filed: the run is complete', r.kind, 'complete');
  eq('  ...and there is nothing left to solve', r.nextAttempt, 6);
  eq('  ...but all five are rebuilt for the result', r.priorAttempts.length, 5);
}
{
  // Not something this client can produce — it files in order, one at a
  // time — but if a hole ever existed, resuming PAST it would leave a run
  // that can never be completed.
  const r = planResume([filed(1, 1244), filed(3, 1351)], 1, AO5);
  eq('a gap is filled, not skipped', r.nextAttempt, 2);
  eq('  ...and only the contiguous prefix is rebuilt', r.priorAttempts.length, 1);
}
{
  const bo1 = { ...AO5, format: 'bo1', attempts: 1 };
  eq('a one-attempt format completes after one', planResume([filed(1, 1244)], 1, bo1).kind, 'complete');
  const mo3 = { ...AO5, format: 'mo3', attempts: 3 };
  eq('an Mo3 resumes at 3 of 3', planResume([filed(1, 1244), filed(2, 1402)], 1, mo3).nextAttempt, 3);
  // A format that shrank under a filed run: attempts beyond the run's
  // length are not counted.
  eq('attempts beyond the format are ignored',
    planResume([filed(1, 1), filed(2, 2), filed(3, 3), filed(4, 4)], 1, mo3).kind, 'complete');
}

console.log('\n  -- the round the run belongs to --');
{
  const roundOne = [filed(1, 1244), filed(2, 1402)];
  // THE RULE: a run started in round 1 must never continue into round 2.
  const r = planResume(roundOne, 2, AO5);
  eq('round 1 attempts do not resume into round 2', r.kind, 'fresh');
  eq('  ...round 2 starts at attempt 1', r.nextAttempt, 1);
  eq('  ...carrying none of round 1', r.priorAttempts.length, 0);
  eq('  ...and new attempts are filed into the LIVE round', r.competitionRound, 2);
  eq('  ...with the unfinished round reported so it can be explained', r.unfinishedRound, 1);
}
{
  const r = planResume([filed(1, 1, { competitionRound: 2 }), filed(2, 2, { competitionRound: 2 })], 2, AO5);
  eq('round 2 attempts resume round 2', r.nextAttempt, 3);
  eq('  ...and round 1 is not reported as unfinished when it has nothing', r.unfinishedRound, null);
}
{
  const complete1 = [1, 2, 3, 4, 5].map((a) => filed(a, 1000 + a));
  const r = planResume(complete1, 2, AO5);
  eq('a FINISHED earlier round is not "unfinished"', r.unfinishedRound, null);
  eq('  ...and round 2 still starts fresh', r.nextAttempt, 1);
}
{
  const r = planResume([filed(1, 1244)], null, AO5);
  eq('no round open: nothing can be solved', r.kind, 'no-live-round');
  eq('  ...and no round is claimed', r.competitionRound, null);
  eq('  ...with the unfinished run reported', r.unfinishedRound, 1);
}

console.log('\n  -- the cutoff, re-evaluated on a resumed run --');
{
  // 2 attempts to beat 15.00, on an Ao5.
  const shape = { ...AO5, cutoffCs: 1500, cutoffPhase: 2 };
  const missed = planResume([filed(1, 1600), filed(2, 1700)], 1, shape);
  eq('both attempts missed the cutoff: the run is over', missed.kind, 'complete');
  eq('  ...and it is marked as a cut-off run', missed.cutOff, true);
  eq('  ...so there is nothing to solve', missed.nextAttempt, 3);

  const beat = planResume([filed(1, 1600), filed(2, 1400)], 1, shape);
  eq('one attempt beat it: the run continues', beat.kind, 'resume');
  eq('  ...at attempt 3', beat.nextAttempt, 3);
  eq('  ...and is not a cut-off run', beat.cutOff, false);

  // STRICTLY better. Equalling the cutoff is not beating it.
  eq('equalling the cutoff does not beat it', planResume([filed(1, 1500), filed(2, 1500)], 1, shape).cutOff, true);
  eq('one centisecond under does', planResume([filed(1, 1500), filed(2, 1499)], 1, shape).cutOff, false);
  // Mid-phase: not yet decidable.
  eq('the cutoff is not judged before its phase is over', planResume([filed(1, 1600)], 1, shape).cutOff, false);
  eq('  ...and that run still resumes', planResume([filed(1, 1600)], 1, shape).nextAttempt, 2);
  // A DNF can never beat a cutoff.
  eq('two DNFs miss it', planResume([filed(1, 0, { isDnf: true }), filed(2, 0, { isDnf: true })], 1, shape).cutOff, true);
  // An attempt over the TIME LIMIT is a DNF, so it cannot beat the cutoff
  // either — even though its stored number is below it.
  const limited = { ...shape, timeLimitCs: 1000 };
  eq('an over-limit attempt cannot beat the cutoff',
    planResume([filed(1, 1200), filed(2, 900)], 1, limited).cutOff, false);
  eq('  ...but two over-limit attempts miss it',
    planResume([filed(1, 1200), filed(2, 1100)], 1, limited).cutOff, true);
}

console.log('\n  -- cutoffFailed and resolveAttemptTime on their own --');
{
  eq('no cutoff configured: never failed', cutoffFailed([1600, 1700], null, null), false);
  eq('a phase with no cutoff value: never failed', cutoffFailed([1600, 1700], 2, null), false);
  eq('fewer attempts than the phase: not yet', cutoffFailed([1600], 2, 1500), false);
  eq('every attempt of the phase at or over: failed', cutoffFailed([1600, 1700], 2, 1500), true);
  eq('one under: passed', cutoffFailed([1600, 1400], 2, 1500), false);
  // Attempts after the phase are irrelevant to it.
  eq('only the phase counts', cutoffFailed([1600, 1700, 100], 2, 1500), true);
  eq('a DNF is never a pass', cutoffFailed(['DNF', 'DNF'], 2, 1500), true);
}
{
  eq('a plain time', resolveAttemptTime({ timeCs: 1234, isDnf: false }, null), 1234);
  eq('a DNF', resolveAttemptTime({ timeCs: 1234, isDnf: true }, null), 'DNF');
  eq('no time at all', resolveAttemptTime({ timeCs: null, isDnf: false }, null), 'DNF');
  eq('under the limit', resolveAttemptTime({ timeCs: 900, isDnf: false }, 1000), 900);
  eq('exactly the limit is allowed', resolveAttemptTime({ timeCs: 1000, isDnf: false }, 1000), 1000);
  eq('over the limit is a DNF', resolveAttemptTime({ timeCs: 1001, isDnf: false }, 1000), 'DNF');
}

console.log('\n  -- a resumed run scores the same as an uninterrupted one --');
{
  // The property recordAo5Result depends on: what the server stored round
  // -trips into the same attempt values the live run held in memory.
  const live = [
    { timeCs: 1244, isDnf: false },
    { timeCs: null, isDnf: true },
    { timeCs: 1351, isDnf: false },
    { timeCs: 1877, isDnf: false },
    { timeCs: 1390, isDnf: false },
  ];
  const stored = live.map((a, i) => filed(i + 1, a.isDnf ? 0 : a.timeCs, { isDnf: a.isDnf }));
  const rebuilt = planResume(stored, 1, AO5).priorAttempts;
  eq('every attempt comes back identical', JSON.stringify(rebuilt), JSON.stringify(live));
  const limit = 1500;
  eq('  ...and resolves to the same scoring values',
    JSON.stringify(rebuilt.map((a) => resolveAttemptTime(a, limit))),
    JSON.stringify(live.map((a) => resolveAttemptTime(a, limit))));
}

console.log('\n  -- what the athlete is told --');
{
  eq('a fresh run says nothing', resumeNotice(planResume([], 1, AO5)), null);
  const r = resumeNotice(planResume([filed(1, 1244), filed(2, 1402)], 1, AO5));
  ok('a resumed run says how many are saved', /2 оролдлого/.test(r), r);
  ok('  ...and which attempt comes next', /3-р оролдлогоос/.test(r), r);
  const done = resumeNotice(planResume([1, 2, 3, 4, 5].map((a) => filed(a, 1000 + a)), 1, AO5));
  ok('a complete run is told to send the result', /Дүнгээ илгээнэ/.test(done), done);
  const cut = resumeNotice(planResume([filed(1, 1600), filed(2, 1700)], 1, { ...AO5, cutoffCs: 1500, cutoffPhase: 2 }));
  ok('a cut-off run is told why it ended', /шүүлтүүр/i.test(cut), cut);
  const stale = resumeNotice(planResume([filed(1, 1244)], 2, AO5));
  ok('an unfinished earlier round is explained', /1-р раундын/.test(stale), stale);
  eq('no live round: nothing to say here (the blocked screen says it)',
    resumeNotice(planResume([filed(1, 1244)], null, AO5)), null);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
