// ── Result-format maths ─────────────────────────────────────────────────
// Pure unit tests for computeResult / computeAo5 / attemptsForFormat /
// formatLabel. No emulator, no Firestore — these functions touch nothing.
//
// The load-bearing group is the WRAPPER section at the bottom: computeAo5
// is now a projection of computeResult(_, 'ao5'), and every existing
// scorer still calls computeAo5. If those two ever disagree, historical
// results silently change.
//
// Run: npm run test:formats

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-format-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/ao5.ts',
    'lib/online-competition/time-utils.ts',
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

const {
  computeResult,
  computeAo5,
  attemptsForFormat,
  formatLabel,
  effectiveAttemptTime,
  RESULT_FORMATS,
} = require(path.join(OUT, 'ao5.js'));
const { parseTimeLimit, fmtTimeLimit } = require(path.join(OUT, 'time-utils.js'));

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
const val = (times, format) => computeResult(times, format).value;

console.log('\n=== result formats ===\n');

// ── attemptsForFormat / formatLabel ───────────────────────────────────
console.log('  -- attempt counts and labels --');
eq('attemptsForFormat(ao5) = 5', attemptsForFormat('ao5'), 5);
eq('attemptsForFormat(mo3) = 3', attemptsForFormat('mo3'), 3);
eq('attemptsForFormat(bo3) = 3', attemptsForFormat('bo3'), 3);
eq('attemptsForFormat(bo2) = 2', attemptsForFormat('bo2'), 2);
eq('attemptsForFormat(bo1) = 1', attemptsForFormat('bo1'), 1);
eq('formatLabel(ao5)', formatLabel('ao5'), 'Ao5');
eq('formatLabel(mo3)', formatLabel('mo3'), 'Mo3');
eq('formatLabel(bo3)', formatLabel('bo3'), 'Bo3');
eq('formatLabel(bo2)', formatLabel('bo2'), 'Bo2');
eq('formatLabel(bo1)', formatLabel('bo1'), 'Bo1');
ok('every format has a count and a label', RESULT_FORMATS.every((f) => attemptsForFormat(f) > 0 && !!formatLabel(f)));

// ── Ao5 ────────────────────────────────────────────────────────────────
console.log('\n  -- ao5 --');
// [1000,1100,1200,1300,1400]: drop 1000 and 1400, mean(1100,1200,1300)
eq('ao5 clean set', val([1000, 1100, 1200, 1300, 1400], 'ao5'), 1200);
// One DNF is the worst and is dropped, whatever position it sits in.
eq('ao5 one DNF last', val([1000, 1100, 1200, 1300, 'DNF'], 'ao5'), 1200);
// Distinct times from the 'DNF last' case above, so this genuinely
// exercises a leading DNF rather than coincidentally matching:
// drop best 1000 and worst DNF, mean(1100, 1200, 1900) = 1400.
eq('ao5 one DNF first', val(['DNF', 1000, 1100, 1200, 1900], 'ao5'), 1400);
eq('ao5 one DNF middle', val([1000, 'DNF', 1100, 1300, 1400], 'ao5'), 1267);
eq('ao5 two DNF -> null', val([1000, 'DNF', 1100, 1300, 'DNF'], 'ao5'), null);
eq('ao5 all DNF -> null', val(['DNF', 'DNF', 'DNF', 'DNF', 'DNF'], 'ao5'), null);
// Excluded = [best, worst], and they are reported even on a DNF average.
eq('ao5 excludes best+worst', JSON.stringify(computeResult([1000, 1100, 1200, 1300, 1400], 'ao5').excludedIndices), '[0,4]');
eq(
  'ao5 one DNF: the DNF is the excluded worst',
  JSON.stringify(computeResult([1000, 'DNF', 1100, 1300, 1400], 'ao5').excludedIndices),
  '[0,1]',
);
eq(
  'ao5 DNF average still reports excluded indices',
  computeResult([1000, 'DNF', 1100, 1300, 'DNF'], 'ao5').excludedIndices.length,
  2,
);
// Rounding: Math.round, matching every other average in the repo.
// mean(1000,1001,1002) = 1001 exactly; mean(1000,1000,1001) = 1000.33 -> 1000
eq('ao5 rounds (down)', val([1, 1000, 1000, 1001, 99999], 'ao5'), 1000);
// mean(1000,1001,1001) = 1000.67 -> 1001
eq('ao5 rounds (up)', val([1, 1000, 1001, 1001, 99999], 'ao5'), 1001);

// ── Mo3 ────────────────────────────────────────────────────────────────
console.log('\n  -- mo3 --');
eq('mo3 clean set', val([1000, 1100, 1200], 'mo3'), 1100);
// The rule people get wrong: no trimming, so ONE DNF kills it.
eq('mo3 one DNF -> null (no cushion)', val([1000, 1100, 'DNF'], 'mo3'), null);
eq('mo3 one DNF first -> null', val(['DNF', 1000, 1100], 'mo3'), null);
eq('mo3 all DNF -> null', val(['DNF', 'DNF', 'DNF'], 'mo3'), null);
eq('mo3 excludes nothing', JSON.stringify(computeResult([1000, 1100, 1200], 'mo3').excludedIndices), '[]');
// mean(1000,1000,1001) = 1000.33 -> 1000; mean(1000,1001,1001) = 1000.67 -> 1001
eq('mo3 rounds (down)', val([1000, 1000, 1001], 'mo3'), 1000);
eq('mo3 rounds (up)', val([1000, 1001, 1001], 'mo3'), 1001);
eq('mo3 wrong length -> null', val([1000, 1100], 'mo3'), null);

// ── Bo3 / Bo2 / Bo1 ────────────────────────────────────────────────────
console.log('\n  -- bo3 / bo2 / bo1 --');
eq('bo3 clean set -> best', val([1200, 1000, 1100], 'bo3'), 1000);
eq('bo3 one DNF -> best of the rest', val([1200, 'DNF', 1100], 'bo3'), 1100);
eq('bo3 two DNF -> the single finish', val(['DNF', 'DNF', 1100], 'bo3'), 1100);
eq('bo3 all DNF -> null', val(['DNF', 'DNF', 'DNF'], 'bo3'), null);
eq('bo3 excludes nothing', JSON.stringify(computeResult([1200, 1000, 1100], 'bo3').excludedIndices), '[]');
eq('bo2 clean set -> best', val([1200, 1000], 'bo2'), 1000);
eq('bo2 one DNF -> the other', val(['DNF', 1000], 'bo2'), 1000);
eq('bo2 all DNF -> null', val(['DNF', 'DNF'], 'bo2'), null);
eq('bo1 single time', val([1234], 'bo1'), 1234);
eq('bo1 DNF -> null', val(['DNF'], 'bo1'), null);
eq('bo3 wrong length -> null', val([1000, 1100], 'bo3'), null);
eq('bo1 wrong length -> null', val([1000, 1100], 'bo1'), null);
// A best-of never rounds — it returns a stored time untouched.
eq('bo3 returns the time verbatim (no rounding)', val([1001, 1003, 1007], 'bo3'), 1001);

// ── the wrapper: computeAo5 === computeResult(_, 'ao5') ───────────────
console.log('\n  -- wrapper agreement --');
const WRAPPER_CASES = [
  ['clean', [1000, 1100, 1200, 1300, 1400]],
  ['DNF first', ['DNF', 1000, 1100, 1200, 1300]],
  ['DNF middle', [1000, 'DNF', 1100, 1300, 1400]],
  ['DNF last', [1000, 1100, 1200, 1300, 'DNF']],
  ['two DNF', [1000, 'DNF', 1100, 1300, 'DNF']],
  ['all DNF', ['DNF', 'DNF', 'DNF', 'DNF', 'DNF']],
  ['ties', [1000, 1000, 1000, 1000, 1000]],
  ['rounding down', [1, 1000, 1000, 1001, 99999]],
  ['rounding up', [1, 1000, 1001, 1001, 99999]],
  // Malformed lengths included on purpose: Ao5 is deliberately NOT
  // length-guarded so the wrapper stays identical for EVERY input, not
  // just well-formed ones.
  ['short (3)', [1000, 1100, 1200]],
  ['long (7)', [1000, 1100, 1200, 1300, 1400, 1500, 1600]],
];
for (const [name, times] of WRAPPER_CASES) {
  const legacy = computeAo5(times);
  const viaFormat = computeResult(times, 'ao5');
  ok(
    `wrapper agrees: ${name}`,
    legacy.ao5 === viaFormat.value &&
      legacy.bestIndex === viaFormat.excludedIndices[0] &&
      legacy.worstIndex === viaFormat.excludedIndices[1],
    `computeAo5=${JSON.stringify(legacy)} computeResult=${JSON.stringify(viaFormat)}`,
  );
}
// The shape itself must not have drifted — SummaryStage reads these keys.
const shape = computeAo5([1000, 1100, 1200, 1300, 1400]);
ok(
  'computeAo5 still returns exactly {ao5,bestIndex,worstIndex}',
  JSON.stringify(Object.keys(shape).sort()) === '["ao5","bestIndex","worstIndex"]',
  JSON.stringify(Object.keys(shape)),
);

// ── penalties are applied BEFORE these functions ──────────────────────
// computeResult/computeAo5 know nothing about penalties: a +2 is folded
// into the time by effectiveAttemptTime, and a DNF becomes the 'DNF'
// sentinel there. These assert that boundary rather than a behaviour of
// the format maths.
console.log('\n  -- penalties are pre-applied (effectiveAttemptTime) --');
const att = (o) => effectiveAttemptTime({ status: 'approved', reportedTime: 1000, penalty: null, ...o }, null);
eq('no penalty -> raw time', att({}), 1000);
eq('+2 adds 200cs', att({ penalty: '+2' }), 1200);
eq('judge DNF -> sentinel', att({ penalty: 'DNF' }), 'DNF');
eq('self-reported DNF -> sentinel', att({ isDnf: true }), 'DNF');
eq('rejected -> DNF whatever the time says', att({ status: 'rejected', reportedTime: 5 }), 'DNF');
eq('pending -> DNF (never a trusted time)', att({ status: 'pending' }), 'DNF');
// End to end: a +2 on the middle attempt shifts the Ao5 by exactly 200/3.
eq(
  '+2 flows through into an Ao5',
  val([1000, 1100, att({ penalty: '+2' }), 1300, 1400].map((t) => t), 'ao5'),
  Math.round((1100 + 1200 + 1300) / 3),
);


// ── time limit: parse / format / enforcement rule ─────────────────────
console.log('\n  -- parseTimeLimit --');
const pl = (t) => {
  const r = parseTimeLimit(t);
  return r.ok ? r.value : 'REJECTED';
};
eq('"10:00" -> 60000cs', pl('10:00'), 60000);
eq('"1:30.00" -> 9000cs', pl('1:30.00'), 9000);
eq('"1:30.50" -> 9050cs', pl('1:30.50'), 9050);
eq('"0:30" -> 3000cs', pl('0:30'), 3000);
eq('"30" (bare seconds) -> 3000cs', pl('30'), 3000);
eq('"30.50" -> 3050cs', pl('30.50'), 3050);
eq('"1:30.5" (one decimal) -> 9050cs', pl('1:30.5'), 9050);
eq('whitespace is trimmed', pl('  10:00  '), 60000);
// Empty is VALID and means no limit — not an error.
eq('"" -> null (no limit)', pl(''), null);
eq('"   " -> null (no limit)', pl('   '), null);
// Rejections
eq('"600" is REJECTED (ambiguous: 600s or 6:00?)', pl('600'), 'REJECTED');
eq('"abc" is REJECTED', pl('abc'), 'REJECTED');
eq('"10:60" is REJECTED (seconds must be 0-59)', pl('10:60'), 'REJECTED');
eq('"0" is REJECTED (a zero limit DNFs everything)', pl('0'), 'REJECTED');
eq('"0:00" is REJECTED', pl('0:00'), 'REJECTED');
eq('"-1:00" is REJECTED', pl('-1:00'), 'REJECTED');
eq('"1:2:3" is REJECTED', pl('1:2:3'), 'REJECTED');
eq('"10:00.000" is REJECTED (max 2 decimals)', pl('10:00.000'), 'REJECTED');

console.log('\n  -- fmtTimeLimit round-trips --');
for (const t of ['10:00', '1:30.50', '0:30', '2:05']) {
  const cs = pl(t);
  eq(`"${t}" -> cs -> text`, fmtTimeLimit(cs), t);
}

console.log('\n  -- effectiveAttemptTime + the limit --');
const at = (o, limit = null) =>
  effectiveAttemptTime({ status: 'approved', reportedTime: 1000, penalty: null, ...o }, limit);
// null limit changes nothing at all.
eq('null limit: a time passes through', at({ reportedTime: 999999 }, null), 999999);
eq('null limit: +2 still applies', at({ reportedTime: 1000, penalty: '+2' }, null), 1200);
// Under / at / over.
eq('under the limit is unaffected', at({ reportedTime: 5900 }, 6000), 5900);
eq('EXACTLY the limit is allowed (not over)', at({ reportedTime: 6000 }, 6000), 6000);
eq('one centisecond over is a DNF', at({ reportedTime: 6001 }, 6000), 'DNF');
// The case a judge creates: legal until +2 pushes it over.
eq('9:59 under a 10:00 limit is legal', at({ reportedTime: 59900 }, 60000), 59900);
eq('9:59 + 2s under a 10:00 limit is a DNF', at({ reportedTime: 59900, penalty: '+2' }, 60000), 'DNF');
eq('  ...and 9:57 + 2s is still legal', at({ reportedTime: 59700, penalty: '+2' }, 60000), 59900);
// The limit never rescues an already-DNF attempt or a rejected one.
eq('a rejected attempt is still DNF under a limit', at({ status: 'rejected', reportedTime: 1 }, 60000), 'DNF');
eq('a self-reported DNF is still DNF', at({ isDnf: true }, 60000), 'DNF');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
