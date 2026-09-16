// ── The practice area's rules ────────────────────────────────────────────
// Pure unit tests for lib/online-competition/practice.ts. No emulator, no
// Firestore, no React.
//
// What carries weight here:
//   THE ALLOWANCE IS COUNTED, never stored. Ten runs in total, and a `redo`
//     does not spend one — an admin asking for another attempt must not be
//     a punishment. A PENDING run does spend one, or an athlete could
//     record eleven by staying ahead of the review queue.
//   THE BACKSTOP. The competition sweep keeps an unjudged video forever, on
//     the reasoning that it is evidence nobody has looked at. Nothing
//     depends on a practice run, so 30 days after recording it goes whether
//     it was reviewed or not — and 7 days after a review, whichever is
//     first.
//   A REFUSAL NEEDS A REASON. The whole point of practising is finding out
//     what to fix.
//
// Run: npm run test:practice

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-practice-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/practice.ts',
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

const P = require(path.join(OUT, 'practice.js'));

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

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1, 12, 0);

console.log('\n  -- the allowance is counted, not stored --');
{
  eq('the limit is ten', P.PRACTICE_RUN_LIMIT, 10);
  const none = P.practiceAllowance([]);
  eq('a first-time athlete has used none', none.used, 0);
  eq('  ...and has all ten', none.remaining, 10);
  eq('  ...and is not at the limit', none.atLimit, false);
}
{
  const a = P.practiceAllowance(['correct', 'incorrect', 'pending']);
  eq('every decided run spends one', a.used, 3);
  eq('  ...leaving seven', a.remaining, 7);
  // An athlete could otherwise record eleven by staying ahead of the queue.
  ok('a PENDING run spends one', P.spendsAllowance('pending') === true);
}
{
  const a = P.practiceAllowance(['correct', 'redo', 'redo', 'pending']);
  eq('a REDO does not spend one', a.used, 2);
  eq('  ...so the athlete gets those attempts back', a.remaining, 8);
  ok('spendsAllowance says so directly', P.spendsAllowance('redo') === false);
}
{
  const ten = Array.from({ length: 10 }, () => 'correct');
  const a = P.practiceAllowance(ten);
  eq('ten used: none remaining', a.remaining, 0);
  eq('  ...and at the limit', a.atLimit, true);
  // Belt and braces: a corrupted eleventh must not produce a negative.
  const over = P.practiceAllowance([...ten, 'pending']);
  eq('more than ten never goes negative', over.remaining, 0);
  eq('  ...and is still at the limit', over.atLimit, true);
}

console.log('\n  -- a stored status is read defensively --');
{
  eq('a known status reads back', P.normalizePracticeStatus('correct'), 'correct');
  // Unrecognised lands in the queue where a human looks at it, rather than
  // being counted as decided.
  eq('nonsense reads as pending', P.normalizePracticeStatus('approved'), 'pending');
  eq('missing reads as pending', P.normalizePracticeStatus(undefined), 'pending');
  eq('a number reads as pending', P.normalizePracticeStatus(1), 'pending');
  // It is NOT the submission vocabulary, and must never accept it.
  eq('"rejected" is not a practice status', P.normalizePracticeStatus('rejected'), 'pending');
}

console.log('\n  -- a refusal needs a reason --');
{
  eq('incorrect requires one', P.practiceReasonRequired('incorrect'), true);
  eq('correct does not', P.practiceReasonRequired('correct'), false);
  eq('redo does not', P.practiceReasonRequired('redo'), false);

  eq('incorrect with a reason is valid', P.practiceReviewValid('incorrect', 'Холилт буруу'), true);
  eq('incorrect with none is not', P.practiceReviewValid('incorrect', null), false);
  eq('incorrect with blank is not', P.practiceReviewValid('incorrect', '   '), false);
  eq('correct with no reason is valid', P.practiceReviewValid('correct', null), true);
  eq('redo with no reason is valid', P.practiceReviewValid('redo', null), true);
  eq('a reason over the ceiling is refused',
    P.practiceReviewValid('incorrect', 'a'.repeat(P.PRACTICE_REASON_MAX + 1)), false);
  eq('  ...exactly at it is fine',
    P.practiceReviewValid('incorrect', 'a'.repeat(P.PRACTICE_REASON_MAX)), true);
  ok('the offered reasons are a shortcut, not the vocabulary',
    Array.isArray(P.PRACTICE_REFUSAL_REASONS) && P.PRACTICE_REFUSAL_REASONS.length >= 3);
}

console.log('\n  -- the stage marks, read defensively --');
{
  // THE ROUTE IS THE ONLY PLACE THIS CAN BE CHECKED: practiceRuns is closed
  // to clients, so there are no firestore.rules validating the shape the way
  // they do for a submission's marks.
  const all = {
    scrambleShown: 1000, coverStart: 2000, solveStart: 3000,
    solveEnd: 4000, cubeShown: 5000, recordingEnd: 6000,
  };
  eq('six keys, and only these six', P.PRACTICE_MARK_KEYS.length, 6);
  eq('a full set survives', JSON.stringify(P.readPracticeMarks(all)), JSON.stringify(all));
  // HALF-FILLED IS LEGAL AND NORMAL. A run that cannot be filed is a video
  // thrown away; a jump with nothing to aim at just disables itself.
  eq('a partial set survives as a partial set',
    JSON.stringify(P.readPracticeMarks({ solveStart: 1, solveEnd: 2 })),
    JSON.stringify({ solveStart: 1, solveEnd: 2 }));
  eq('nothing at all is {}', JSON.stringify(P.readPracticeMarks(undefined)), '{}');
  eq('null is {}', JSON.stringify(P.readPracticeMarks(null)), '{}');
  eq('an array is {}', JSON.stringify(P.readPracticeMarks([1, 2])), '{}');
  eq('a string is {}', JSON.stringify(P.readPracticeMarks('x')), '{}');
  // A RUN FILED BEFORE MARKS EXISTED reads back as {}, never undefined, so
  // the panel never has to guard for the field's absence.
  eq('a document with no marks field reads back as {}', JSON.stringify(P.readPracticeMarks({})), '{}');
  // The guards that keep a malformed mark from becoming a NaN seek.
  eq('a numeric string is dropped', JSON.stringify(P.readPracticeMarks({ solveStart: '5' })), '{}');
  eq('NaN is dropped', JSON.stringify(P.readPracticeMarks({ solveStart: NaN })), '{}');
  eq('Infinity is dropped', JSON.stringify(P.readPracticeMarks({ solveStart: Infinity })), '{}');
  eq('a negative offset is dropped', JSON.stringify(P.readPracticeMarks({ solveStart: -1 })), '{}');
  eq('zero survives - it is a real point in a clip',
    JSON.stringify(P.readPracticeMarks({ solveStart: 0 })), JSON.stringify({ solveStart: 0 }));
  // Anything the client invents is ignored rather than stored.
  eq('an unknown key is dropped',
    JSON.stringify(P.readPracticeMarks({ solveStart: 1, nonsense: 2 })),
    JSON.stringify({ solveStart: 1 }));
  eq('one bad key does not take the good ones with it',
    JSON.stringify(P.readPracticeMarks({ solveStart: 1, solveEnd: NaN })),
    JSON.stringify({ solveStart: 1 }));
}

console.log('\n  -- practiceGate: verified athletes only --');
{
  const g = (profile) => P.practiceGate(profile);
  const APPROVED = { detailsStatus: 'approved', photoStatus: 'approved' };
  eq('verified is allowed', g(APPROVED).allowed, true);
  eq('legacy approved is allowed', g({ profileStatus: 'approved' }).allowed, true);
  // FAIL CLOSED on absence.
  eq('no document is refused', g(null).allowed, false);
  eq('  ...as never submitted', g(null).status, 'incomplete');
  eq('undefined is refused', g(undefined).allowed, false);
  eq('an empty profile is never submitted', g({}).status, 'incomplete');
  eq('pending is refused as pending',
    g({ detailsStatus: 'pending', photoStatus: 'pending' }).status, 'pending');
  eq('half-approved is refused', g({ detailsStatus: 'approved', photoStatus: 'pending' }).allowed, false);
  const rej = g({ detailsStatus: 'approved', photoStatus: 'rejected', photoRejectionReason: 'Бүдэг' });
  eq('rejected is refused as rejected', rej.status, 'rejected');
  eq('  ...carrying the SAME summary registration shows', rej.reason, 'Зураг: Бүдэг');
  eq('a reason is only carried while rejected',
    g({ detailsStatus: 'pending', photoStatus: 'pending', detailsRejectionReason: 'old' }).reason, null);
  // Nothing an athlete could add to their own profile opens the gate: the
  // participant rule has no keys().hasOnly, so extra fields are writable.
  eq('an invented "verified" field does nothing', g({ verified: true, practiceAllowed: true }).allowed, false);
}

console.log('\n  -- retention: two clocks, whichever is first --');
{
  eq('the review clock is 7 days', P.PRACTICE_REVIEWED_RETENTION_DAYS, 7);
  eq('the backstop is 30 days', P.PRACTICE_MAX_RETENTION_DAYS, 30);
}
{
  const reviewed = (createdDaysAgo, reviewedDaysAgo, status = 'correct') => ({
    status,
    createdAtMs: NOW - createdDaysAgo * DAY,
    reviewedAtMs: reviewedDaysAgo === null ? null : NOW - reviewedDaysAgo * DAY,
  });
  eq('reviewed 8 days ago: swept', P.isPracticeSweepable(reviewed(9, 8), NOW), true);
  eq('reviewed 6 days ago: kept', P.isPracticeSweepable(reviewed(9, 6), NOW), false);
  eq('reviewed exactly 7 days ago: swept', P.isPracticeSweepable(reviewed(9, 7), NOW), true);
  eq('a refusal is swept on the same clock', P.isPracticeSweepable(reviewed(9, 8, 'incorrect'), NOW), true);
  eq('a redo is swept on the same clock', P.isPracticeSweepable(reviewed(9, 8, 'redo'), NOW), true);
}
{
  const pending = (daysAgo) => ({ status: 'pending', createdAtMs: NOW - daysAgo * DAY, reviewedAtMs: null });
  // THE DIFFERENCE FROM THE COMPETITION RULE, which keeps an unjudged
  // submission forever.
  eq('never reviewed, 31 days old: swept by the backstop', P.isPracticeSweepable(pending(31), NOW), true);
  eq('never reviewed, exactly 30 days: swept', P.isPracticeSweepable(pending(30), NOW), true);
  eq('never reviewed, 29 days: kept', P.isPracticeSweepable(pending(29), NOW), false);
  eq('never reviewed, brand new: kept', P.isPracticeSweepable(pending(0), NOW), false);
}
{
  // Reviewed, but only just, and already past the backstop: the backstop
  // wins, because it is "whichever comes first".
  const old = { status: 'correct', createdAtMs: NOW - 40 * DAY, reviewedAtMs: NOW - 1 * DAY };
  eq('past the backstop, freshly reviewed: still swept', P.isPracticeSweepable(old, NOW), true);
}
{
  // A decided run with no reviewedAt cannot be dated on the review clock,
  // so only the backstop can take it.
  const odd = { status: 'correct', createdAtMs: NOW - 10 * DAY, reviewedAtMs: null };
  eq('decided but undated: kept until the backstop', P.isPracticeSweepable(odd, NOW), false);
  eq('  ...and taken by it', P.isPracticeSweepable({ ...odd, createdAtMs: NOW - 31 * DAY }, NOW), true);
  eq('no createdAt at all: never swept',
    P.isPracticeSweepable({ status: 'correct', createdAtMs: null, reviewedAtMs: NOW - 99 * DAY }, NOW), false);
}

console.log('\n  -- what the athlete is told about expiry --');
{
  const pendingRun = { status: 'pending', createdAtMs: NOW, reviewedAtMs: null };
  eq('an unreviewed run expires at the backstop',
    P.practiceExpiryMs(pendingRun), NOW + 30 * DAY);
  const reviewedRun = { status: 'correct', createdAtMs: NOW, reviewedAtMs: NOW + 2 * DAY };
  eq('a reviewed run expires 7 days after the review',
    P.practiceExpiryMs(reviewedRun), NOW + 9 * DAY);
  const lateReview = { status: 'correct', createdAtMs: NOW, reviewedAtMs: NOW + 28 * DAY };
  eq('a late review does not extend past the backstop',
    P.practiceExpiryMs(lateReview), NOW + 30 * DAY);
  eq('undateable: null', P.practiceExpiryMs({ status: 'correct', createdAtMs: null, reviewedAtMs: null }), null);
}

console.log('\n  -- it is not the submission vocabulary --');
{
  const raw = fs.readFileSync(path.join(ROOT, 'lib/online-competition/practice.ts'), 'utf8');
  // COMMENTS STRIPPED FIRST, the same way run-protection.test.cjs strips
  // them: this module's header explains that there is no approve/+2/DNF
  // here, and a raw scan would be tripped by the explanation rather than by
  // the mistake it warns about.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // A practice review is not a time decision, and nothing in the CODE may
  // imply one. These words belong to judging and must not appear.
  for (const word of ['+2', 'penalty', 'reportedTime', 'competitionRound', 'ao5']) {
    ok(`no "${word}" anywhere in the practice rules`, !src.includes(word));
  }
  ok('it says out loud that practice runs are their own collection',
    /practiceRuns/.test(raw));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
