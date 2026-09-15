// ── The scramble gate's pure decisions, and its wiring ──────────────────
// REAL unit tests for the parts of scramble-gate.ts that need no Firestore
// (the whole gate runs against the emulator in scramble-gate.test.cjs),
// plus source assertions for what cannot run here: the route and the rules.
//
// Run: npm run test:gatedecisions

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-gatedecisions-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/scramble-gate.ts',
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

const gate = require(path.join(OUT, 'scramble-gate.js'));
const { planResume, runShapeFor } = require(path.join(OUT, 'run-resume.js'));

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
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('\n  -- registration --');
{
  eq('no registration', gate.registrationGate(null, '333').error, 'not-registered');
  for (const status of ['pending', 'waitlisted', 'cancelled', 'rejected']) {
    const g = gate.registrationGate({ status, events: ['333'] }, '333');
    ok(`${status}: refused, with the dashboard's own wording`, !g.ok && g.error === 'registration-not-approved' && g.message.length > 0);
  }
  ok('an unknown status value is not approved', !gate.registrationGate({ status: 'vip', events: ['333'] }, '333').ok);
  eq('approved, wrong event', gate.registrationGate({ status: 'approved', events: ['222'] }, '333').error, 'event-not-registered');
  eq('approved, no events list', gate.registrationGate({ status: 'approved', events: 'x' }, '333').error, 'event-not-registered');
  eq('approved for this event', gate.registrationGate({ status: 'approved', events: ['333'] }, '333'), { ok: true });
  eq('legacy "registered" normalises to approved', gate.registrationGate({ status: 'registered', events: ['333'] }, '333'), { ok: true });
}

console.log('\n  -- the attempt --');
{
  const shape = runShapeFor({ resultFormat: 'ao5' }, 1);
  const filed = (n, round = 1) =>
    Array.from({ length: n }, (_, i) => ({ submissionId: '', attempt: i + 1, competitionRound: round, reportedTime: 1000, isDnf: false }));
  const plan = (n) => planResume(filed(n), 1, shape);

  eq('nothing filed, no parameter: attempt 1', gate.decideScrambleAttempt(plan(0), null), { kind: 'serve', attempt: 1 });
  eq('the client asking for the next attempt: served', gate.decideScrambleAttempt(plan(2), 3), { kind: 'serve', attempt: 3 });
  eq('CLIENT-SUPPLIED ATTEMPT IGNORED: asking for 5 at attempt 1 serves nothing',
    gate.decideScrambleAttempt(plan(0), 5), { kind: 'refuse', error: 'attempt-mismatch', nextAttempt: 1 });
  eq('asking BACKWARDS for an already-filed attempt serves nothing',
    gate.decideScrambleAttempt(plan(3), 2), { kind: 'refuse', error: 'attempt-mismatch', nextAttempt: 4 });
  eq('exactly one ahead: wait for the filing', gate.decideScrambleAttempt(plan(1), 3), { kind: 'wait', attempt: 3 });
  eq('RETRY: the unfiled attempt again is the same attempt', gate.decideScrambleAttempt(plan(2), 3), gate.decideScrambleAttempt(plan(2), 3));
  eq('a complete run serves nothing', gate.decideScrambleAttempt(plan(5), null).kind, 'refuse');
  eq('filings in ANOTHER round do not move this round', gate.decideScrambleAttempt(planResume(filed(4, 2), 1, shape), null), { kind: 'serve', attempt: 1 });
  const cut = planResume(
    [1, 2].map((a) => ({ submissionId: '', attempt: a, competitionRound: 1, reportedTime: 5000, isDnf: false })),
    1,
    runShapeFor({ resultFormat: 'ao5', cutoffs: [{ round: 1, cutoffCs: 3000 }] }, 1),
  );
  eq('a missed cutoff ends the run: nothing more is served', gate.decideScrambleAttempt(cut, null).error, 'run-complete');

  eq('attempt parameter: absent', gate.parseRequestedAttempt(null), null);
  eq('attempt parameter: "3"', gate.parseRequestedAttempt('3'), 3);
  ok('attempt parameter: garbage is NaN (refused), not 1', Number.isNaN(gate.parseRequestedAttempt('abc')) && Number.isNaN(gate.parseRequestedAttempt('0')) && Number.isNaN(gate.parseRequestedAttempt('2.5')));
  eq('run shape: Mo3 is three attempts', runShapeFor({ resultFormat: 'mo3' }, 1).attempts, 3);
  eq('run shape: the cutoff is per round', [runShapeFor({ cutoffs: [{ round: 2, cutoffCs: 900 }] }, 1).cutoffCs, runShapeFor({ cutoffs: [{ round: 2, cutoffCs: 900 }] }, 2).cutoffPhase], [null, 2]);
  eq('ticket id', gate.runTicketId('u1', '333', 2), 'u1__333__r2');
}

console.log('\n  -- the wiring --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const route = src('app/api/online-competition/scramble/route.ts');
  ok('the route decides through the gate', route.includes('authorizeScrambleRequest('));
  ok('  ...never looks a scramble up itself', !route.includes('lookupGroupScramble('));
  ok('  ...reads the attempt parameter only through parseRequestedAttempt', route.includes("parseRequestedAttempt(url.searchParams.get('attempt'))") && (route.match(/searchParams\.get\('attempt'\)/g) ?? []).length === 1);
  ok('  ...records the ticket BEFORE returning a scramble',
    route.indexOf('recordScrambleServed(') > 0 &&
      route.indexOf('await recordScrambleServed(') < route.indexOf('scramble: text,') &&
      // exactly one response object carries a scramble
      (route.match(/^\s+scramble: /gm) ?? []).length === 1);
  ok('  ...and answers 500 with no scramble when the gate cannot be evaluated', /catch \(e\) \{[\s\S]{0,300}?status: 500/.test(route));

  const rules = src('firestore.rules');
  ok('rules: a submission create requires the run ticket', /submissionIdMatchesContents\(\) &&\s*runTicketOk\(\) &&/.test(rules));
  ok('rules: at the id runTicketId builds',
    rules.includes("runTickets/$(request.resource.data.uid + '__' + request.resource.data.event + '__r' + string(request.resource.data.competitionRound))"));
  ok('rules: only attempts whose scramble was served', rules.includes('request.resource.data.round <= get(ticket).data.servedThrough'));
  ok('rules: tickets are closed to every client', /match \/runTickets\/\{ticketId\} \{\s*allow read, write: if false;/.test(rules));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
