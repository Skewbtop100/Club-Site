// ── Consistency checks on a filed attempt ──────────────────────────────
// Two clocks recorded independently — the athlete's typed stopwatch and
// the recorder's stage marks — and the arithmetic that says whether they
// can both be true. A judge uses this to decide where to look first
// across a hundred submissions; nothing here rejects, hides or approves
// anything.
//
// THE UNIT TRAP IS THE MAIN THING THIS SUITE GUARDS. reportedTime is
// CENTISECONDS and every mark is MILLISECONDS. Compare them raw and a
// 20-second solve reads as 2 seconds, so IMPOSSIBLE would fire on almost
// every honest attempt — a check that cries wolf is worse than no check,
// because a judge learns to ignore it. Several cases below are sized
// specifically to fail if the factor of ten goes missing.
//
// Pure arithmetic, so no emulator.
// Run: npm run test:checks

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-checks-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/submission-checks.ts',
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

compile();
const { checkSubmission, SUSPICIOUS_GAP_MS, DURATION_MISMATCH_MS } = require(
  path.join(OUT, 'submission-checks.js'),
);

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

/** A complete, internally consistent marks map. solveStart .. solveEnd is
 *  a 20-second window, which a 20.00s reported time fits exactly. */
const MARKS = {
  scrambleShown: 8_000,
  coverStart: 28_000,
  solveStart: 50_000,
  solveEnd: 70_000,
  cubeShown: 78_000,
  recordingEnd: 86_000,
};

/** reportedTime is CENTISECONDS: 2000 cs = 20.00 s. */
const sub = (over = {}) => ({
  reportedTime: 2000,
  isDnf: false,
  penalty: null,
  marks: { ...MARKS },
  // Matches recordingEnd exactly, so the baseline attempt is FULLY
  // checked. Without it every fixture here would read 'neutral' — the
  // duration comparison is the one that cannot be skipped and still
  // honestly report "checked and agreed".
  videoDurationMs: 86_000,
  ...over,
});

const codes = (s) => checkSubmission(s).flags.slice().sort().join(',');
const sev = (s) => checkSubmission(s).severity;

console.log('\n=== submission consistency checks ===\n');

// ── The clean case ─────────────────────────────────────────────────────
{
  const clean = sub();
  ok('1. a consistent attempt raises nothing', codes(clean) === '', codes(clean));
  ok('2. ...and reads as checked-and-clean, not as unchecked',
    sev(clean) === 'none', sev(clean));
}
{
  // 20.00s reported inside a 20s window: exactly equal, and equality is
  // not "exceeds". The boundary matters because an honest attempt where
  // the athlete stops the timer and the recording at the same instant
  // lands here.
  ok('3. reported time exactly equal to the window is not impossible',
    codes(sub({ reportedTime: 2000 })) === '');
}

// ── IMPOSSIBLE ─────────────────────────────────────────────────────────
{
  // 25.00s reported inside a 20s recorded window.
  const s = sub({ reportedTime: 2500 });
  ok('4. a reported time longer than the recorded solve is IMPOSSIBLE',
    codes(s) === 'IMPOSSIBLE', codes(s));
  ok('5. ...and is red', sev(s) === 'red', sev(s));
}
{
  // One centisecond over. Pins the comparison as strict.
  ok('6. one centisecond over the window still fires',
    codes(sub({ reportedTime: 2001 })) === 'IMPOSSIBLE');
}
{
  // THE UNIT TRAP, head on. 2000 cs is 20s and fits the 20s window. Read
  // as 2000 MILLISECONDS it would be 2s inside a 20s window — an 18s gap,
  // which is under the 30s threshold and so would silently raise nothing
  // here; but the same confusion on a long solve fires IMPOSSIBLE, below.
  const long = sub({ reportedTime: 12_000, marks: { ...MARKS, solveEnd: 50_000 + 120_000 } });
  ok('7. a 120-second solve in a 120-second window is consistent',
    codes(long) === '', codes(long));
  // Same window, a time that really is too long: 130.00s.
  const tooLong = sub({ reportedTime: 13_000, marks: { ...MARKS, solveEnd: 50_000 + 120_000 } });
  ok('8. ...and 130s in that window is impossible',
    codes(tooLong) === 'IMPOSSIBLE', codes(tooLong));
}

// ── SUSPICIOUS_GAP ─────────────────────────────────────────────────────
{
  ok('9. the threshold is exported for tuning in one place',
    SUSPICIOUS_GAP_MS === 30_000, String(SUSPICIOUS_GAP_MS));
}
{
  // A 20.00s solve inside a 60-second recorded window: a 40s gap.
  const s = sub({ marks: { ...MARKS, solveEnd: 50_000 + 60_000 } });
  ok('10. a long unexplained gap is SUSPICIOUS_GAP',
    codes(s) === 'SUSPICIOUS_GAP', codes(s));
  ok('11. ...and is red', sev(s) === 'red', sev(s));
}
{
  // Exactly at the threshold: a 20s solve in a 50s window is a 30s gap,
  // and the rule is "greater than", so this must NOT fire.
  const at = sub({ marks: { ...MARKS, solveEnd: 50_000 + 50_000 } });
  ok('12. a gap exactly at the threshold does not fire', codes(at) === '', codes(at));
  const over = sub({ marks: { ...MARKS, solveEnd: 50_000 + 50_001 } });
  ok('13. ...one millisecond past it does', codes(over) === 'SUSPICIOUS_GAP', codes(over));
}
{
  // A normal few-second gap — reaching for the timer, reading it,
  // reaching for the screen — is exactly what the threshold exists to
  // tolerate. This is the false-positive guard.
  const normal = sub({ marks: { ...MARKS, solveEnd: 50_000 + 25_000 } });
  ok('14. an ordinary few-second gap raises nothing', codes(normal) === '', codes(normal));
}

// ── MISSING_MARKS ──────────────────────────────────────────────────────
for (const key of ['coverStart', 'solveStart', 'solveEnd', 'cubeShown']) {
  const marks = { ...MARKS };
  delete marks[key];
  const got = checkSubmission(sub({ marks }));
  ok(`15. a missing ${key} fires MISSING_MARKS`,
    got.flags.includes('MISSING_MARKS') && got.severity === 'red',
    JSON.stringify(got));
}
{
  // recordingEnd comes from MediaRecorder's onstop, which a torn-down
  // recorder can legitimately miss. Flagging it would report a recorder
  // detail as an athlete problem.
  const marks = { ...MARKS };
  delete marks.recordingEnd;
  ok('16. a missing recordingEnd does NOT fire', codes(sub({ marks })) === '');
}
{
  // The recorder ran and gathered nothing. NOT legacy — this attempt has
  // a marks field, it is just empty — so it is flagged rather than
  // excused.
  const empty = sub({ marks: {} });
  ok('17. a present-but-empty marks map is flagged, not excused',
    codes(empty) === 'MISSING_MARKS', codes(empty));
}
{
  // A mark stored as something that is not a number is missing for every
  // purpose that matters.
  ok('18. a non-numeric mark counts as missing',
    codes(sub({ marks: { ...MARKS, solveEnd: '70000' } })) === 'MISSING_MARKS');
}

// ── Legacy: no marks field at all ──────────────────────────────────────
{
  const legacy = sub({ marks: undefined });
  ok('19. an attempt with NO marks field raises nothing', codes(legacy) === '', codes(legacy));
  // The distinction that matters: "we did not check this" must not read
  // as "this passed". A judge trusting a clean badge on an unverifiable
  // attempt is the failure mode.
  ok('20. ...and is NEUTRAL, not clean', sev(legacy) === 'neutral', sev(legacy));
}

// ── DNF: the TIME checks are skipped ───────────────────────────────────
{
  // A DNF with a reported time that would otherwise be impossible. Its
  // marks are complete, so nothing fires.
  const dnf = sub({ reportedTime: 9999, isDnf: true });
  ok('21. a DNF skips the time checks, even when one would fire',
    codes(dnf) === '', codes(dnf));
  ok('22. ...and reads as neutral, not clean', sev(dnf) === 'neutral', sev(dnf));
  const byPenalty = sub({ reportedTime: 9999, penalty: 'DNF' });
  ok('23. ...whether the DNF is the flag or the penalty',
    codes(byPenalty) === '' && sev(byPenalty) === 'neutral', codes(byPenalty));
}

// ── +2 counts ──────────────────────────────────────────────────────────
{
  // 19.50s reported fits a 20s window. With a +2 it is 21.50s, which does
  // not — so the penalty must be part of the comparison.
  const without = sub({ reportedTime: 1950 });
  ok('24. 19.50s in a 20s window is fine on its own', codes(without) === '');
  const withPlus2 = sub({ reportedTime: 1950, penalty: '+2' });
  ok('25. ...but the same attempt with a +2 is impossible',
    codes(withPlus2) === 'IMPOSSIBLE', codes(withPlus2));
}
{
  // And the +2 works the other way too: it shrinks a gap.
  // A 52s window against a 20.00s solve is a 32s gap, over the line. The
  // +2 makes the reported time 22.00s, bringing the gap to exactly 30s —
  // which is not "greater than", so it stops firing.
  const gap = sub({ marks: { ...MARKS, solveEnd: 50_000 + 52_000 } });
  ok('26. a +2 narrows the gap it is measured against',
    codes(gap) === 'SUSPICIOUS_GAP' &&
      codes({ ...gap, penalty: '+2' }) === '',
    `${codes(gap)} / ${codes({ ...gap, penalty: '+2' })}`);
}
{
  // A PENDING attempt is the whole point — it is the queue a judge works
  // through. effectiveAttemptTime scores anything unapproved as DNF, so a
  // naive call would skip every attempt this feature exists for.
  const pending = sub({ reportedTime: 2500, status: 'pending' });
  ok('27. a PENDING attempt is still checked, not skipped as unjudged',
    codes(pending) === 'IMPOSSIBLE', codes(pending));
}

// ── Everything at once ─────────────────────────────────────────────────
{
  // Marks missing AND a reported time longer than what remains.
  const marks = { coverStart: 28_000, solveStart: 50_000, solveEnd: 70_000 };
  const bad = sub({ reportedTime: 2500, marks });
  const got = checkSubmission(bad);
  ok('28. several conditions at once report all of them',
    got.flags.includes('MISSING_MARKS') && got.flags.includes('IMPOSSIBLE'),
    JSON.stringify(got));
  ok('29. ...still as one red severity', got.severity === 'red', got.severity);
  // IMPOSSIBLE and SUSPICIOUS_GAP are arithmetically mutually exclusive:
  // one needs a negative gap and the other a large positive one.
  ok('30. ...and never both IMPOSSIBLE and SUSPICIOUS_GAP',
    !(got.flags.includes('SUSPICIOUS_GAP') && got.flags.includes('IMPOSSIBLE')));
}

// ── DNF: MISSING_MARKS still runs ──────────────────────────────────────
// A DNF is a legitimate RESULT — the athlete tried and did not solve it,
// and pressed the stage buttons either way. Missing marks are not a
// result: the page was closed, a button was never pressed, or the
// recorder failed. Rolling the two together hid the second inside the
// first, which is precisely the case a judge needs when an athlete comes
// back afterwards reporting a technical problem.
{
  const complete = sub({ reportedTime: 9999, isDnf: true });
  ok('33. a DNF with complete marks raises nothing',
    codes(complete) === '', codes(complete));
  // NOT 'none'. The two time checks did not run, so "checked and agreed"
  // would be a guarantee that was never made — the same reasoning that
  // makes a legacy attempt neutral.
  ok('34. ...and is neutral, never none',
    sev(complete) === 'neutral', sev(complete));
}
{
  for (const key of ['coverStart', 'solveStart', 'solveEnd', 'cubeShown']) {
    const marks = { ...MARKS };
    delete marks[key];
    const got = checkSubmission(sub({ reportedTime: 9999, isDnf: true, marks }));
    ok(`35. a DNF missing ${key} is flagged`,
      got.flags.join() === 'MISSING_MARKS' && got.severity === 'red',
      JSON.stringify(got));
  }
}
{
  // Same again via the penalty rather than the isDnf flag — a judge's DNF
  // and the athlete's must not behave differently.
  const marks = { ...MARKS };
  delete marks.solveEnd;
  const got = checkSubmission(sub({ reportedTime: 9999, penalty: 'DNF', marks }));
  ok('36. a judge-applied DNF is flagged the same way',
    got.flags.join() === 'MISSING_MARKS' && got.severity === 'red', JSON.stringify(got));
}
{
  // A DNF whose recorder gathered nothing at all.
  const got = checkSubmission(sub({ reportedTime: 9999, isDnf: true, marks: {} }));
  ok('37. a DNF with an empty marks map is flagged, not excused',
    got.flags.join() === 'MISSING_MARKS' && got.severity === 'red', JSON.stringify(got));
}
{
  // Legacy is still legacy: no marks field means nothing was recorded to
  // check, DNF or not.
  const legacy = sub({ reportedTime: 9999, isDnf: true, marks: undefined });
  ok('38. a DNF with NO marks field stays legacy-neutral',
    codes(legacy) === '' && sev(legacy) === 'neutral', `${codes(legacy)} / ${sev(legacy)}`);
}
{
  // THE TIME CHECKS MUST STILL NEVER FIRE ON A DNF, including on data
  // engineered so that each of them would fire if the skip were lost —
  // and including when MISSING_MARKS is firing alongside.
  const impossibleShaped = sub({
    reportedTime: 9999,
    isDnf: true,
    marks: { ...MARKS, solveEnd: 50_000 + 1_000 },
  });
  const gapShaped = sub({
    reportedTime: 100,
    isDnf: true,
    marks: { ...MARKS, solveEnd: 50_000 + 120_000 },
  });
  ok('39. IMPOSSIBLE never fires on a DNF',
    !checkSubmission(impossibleShaped).flags.includes('IMPOSSIBLE'),
    codes(impossibleShaped));
  ok('40. SUSPICIOUS_GAP never fires on a DNF',
    !checkSubmission(gapShaped).flags.includes('SUSPICIOUS_GAP'), codes(gapShaped));

  const both = { ...impossibleShaped, marks: { solveStart: 50_000, solveEnd: 51_000 } };
  const got = checkSubmission(both);
  ok('41. a DNF that is both time-shaped and missing marks reports only MISSING_MARKS',
    got.flags.join() === 'MISSING_MARKS' && got.severity === 'red', JSON.stringify(got));
}

// ── DURATION_MISMATCH ──────────────────────────────────────────────────
// The one check that compares two DIFFERENT clocks: the recorder's, via
// recordingEnd, and Cloudinary's reading of the file that actually
// arrived. Every other check here compares marks with marks, so a
// constant offset — a recorder that started late and shifted all of them
// together — cancels out and reads as perfect consistency. That is not a
// hypothetical: it shipped, stayed green, and was found by an athlete
// with a stopwatch.
{
  ok('42. the threshold is exported for tuning in one place',
    DURATION_MISMATCH_MS === 5_000, String(DURATION_MISMATCH_MS));
}
{
  // The real bug, reproduced: a clip six seconds shorter than the
  // recorder thought it was.
  const short = sub({ videoDurationMs: 80_000 });
  ok('43. a clip shorter than recordingEnd by >5s fires',
    codes(short) === 'DURATION_MISMATCH', codes(short));
  ok('44. ...and is red', sev(short) === 'red', sev(short));
}
{
  // And the other direction — a file LONGER than the marks account for
  // is equally a disagreement between the two clocks.
  ok('45. a clip longer than recordingEnd by >5s also fires',
    codes(sub({ videoDurationMs: 92_000 })) === 'DURATION_MISMATCH');
}
{
  // The encoder flushes after the last mark, so a small honest gap is
  // expected. This is looking for seconds of missing clip, not for
  // milliseconds of flush.
  ok('46. a difference under the threshold does not fire',
    codes(sub({ videoDurationMs: 83_000 })) === '');
  ok('47. ...nor exactly at it, since the rule is "greater than"',
    codes(sub({ videoDurationMs: 81_000 })) === '');
  ok('48. ...but one millisecond past it does',
    codes(sub({ videoDurationMs: 80_999 })) === 'DURATION_MISMATCH');
}
{
  // SKIPPED, NOT PASSED. Neither half is evidence on its own, and
  // reporting 'none' would be claiming a comparison that never happened.
  const noDuration = sub({ videoDurationMs: undefined });
  ok('49. no stored duration skips the check',
    codes(noDuration) === '', codes(noDuration));
  ok('50. ...and reads neutral, never none',
    sev(noDuration) === 'neutral', sev(noDuration));
}
{
  const marks = { ...MARKS };
  delete marks.recordingEnd;
  const noEnd = sub({ marks });
  ok('51. no recordingEnd skips the check',
    codes(noEnd) === '', codes(noEnd));
  ok('52. ...and reads neutral, never none', sev(noEnd) === 'neutral', sev(noEnd));
}
{
  // A legacy attempt has neither, and is already neutral for having no
  // marks field at all — it must not acquire a flag from this.
  const legacy = sub({ marks: undefined, videoDurationMs: undefined });
  ok('53. a legacy attempt with neither raises nothing',
    codes(legacy) === '' && sev(legacy) === 'neutral', `${codes(legacy)} / ${sev(legacy)}`);
}
{
  // A DNF is recorded like any other attempt, so a truncated DNF clip is
  // just as much a problem — the athlete failing to solve says nothing
  // about whether the file is whole.
  const dnf = sub({ reportedTime: 9999, isDnf: true, videoDurationMs: 70_000 });
  ok('54. a DNF is still checked against its file',
    codes(dnf) === 'DURATION_MISMATCH' && sev(dnf) === 'red', JSON.stringify(checkSubmission(dnf)));
}
{
  // A non-numeric or negative duration is no duration.
  ok('55. a malformed duration is treated as absent',
    codes(sub({ videoDurationMs: '86000' })) === '' &&
      sev(sub({ videoDurationMs: -1 })) === 'neutral');
}
{
  // Several at once, including this one.
  const marks = { ...MARKS };
  delete marks.cubeShown;
  const both = sub({ reportedTime: 2500, marks, videoDurationMs: 60_000 });
  const got = checkSubmission(both);
  ok('56. it reports alongside the other checks, not instead of them',
    got.flags.includes('DURATION_MISMATCH') &&
      got.flags.includes('MISSING_MARKS') &&
      got.flags.includes('IMPOSSIBLE') &&
      got.severity === 'red',
    JSON.stringify(got));
}

// ── Malformed data must not throw ──────────────────────────────────────
{
  const cases = [
    {},
    { marks: null },
    { marks: 'nope' },
    { reportedTime: 'abc', marks: { ...MARKS } },
    { reportedTime: NaN, marks: { ...MARKS } },
    { reportedTime: 2000, marks: { ...MARKS, solveStart: 90_000 } }, // end before start
  ];
  let threw = null;
  for (const c of cases) {
    try {
      checkSubmission(c);
    } catch (e) {
      threw = `${JSON.stringify(c)}: ${e.message}`;
    }
  }
  ok('31. malformed or reversed data never throws', threw === null, threw);
  ok('32. ...and a reversed window raises no time flag',
    codes(sub({ marks: { ...MARKS, solveStart: 90_000 } })) === '');
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
