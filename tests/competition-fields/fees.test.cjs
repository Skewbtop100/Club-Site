// ── Fee formatting and totals ───────────────────────────────────────────
// Pure unit tests for formatMnt / competitionFeeTotals / athleteFeeMnt.
// No emulator, no Firestore, no React.
//
// Two groups carry weight:
//   formatMnt   — deliberately hand-written rather than toLocaleString,
//                 precisely so its output is identical on every runtime.
//                 These assertions are what makes that claim checkable.
//   athleteFeeMnt — the function the public registration page will call.
//                 Nothing calls it yet; it is tested now so the claim that
//                 the data shape supports a per-athlete total is a fact
//                 rather than a promise.
//
// Run: npm run test:fees

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-fees-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/fees.ts',
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

const { formatMnt, surchargeOf, competitionFeeTotals, athleteFeeMnt } = require(path.join(OUT, 'fees.js'));

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

console.log('\n  -- formatMnt --');
eq('15000 -> 15 000₮', formatMnt(15000), '15 000₮');
eq('0 -> 0₮', formatMnt(0), '0₮');
eq('500 -> 500₮ (no separator under 1000)', formatMnt(500), '500₮');
eq('1000 -> 1 000₮', formatMnt(1000), '1 000₮');
eq('999 -> 999₮', formatMnt(999), '999₮');
eq('1000000 -> 1 000 000₮', formatMnt(1000000), '1 000 000₮');
eq('123456789 -> 123 456 789₮', formatMnt(123456789), '123 456 789₮');
// The separator is a PLAIN space (U+0020), not a narrow no-break space —
// an admin copying a fee into a bank transfer must get what they see.
ok('the separator is U+0020, not a no-break space', formatMnt(15000).charCodeAt(2) === 0x20,
  `charCode ${formatMnt(15000).charCodeAt(2)}`);
eq('a fraction is truncated, never rendered', formatMnt(15000.7), '15 000₮');
eq('a negative renders with a leading minus', formatMnt(-15000), '-15 000₮');

console.log('\n  -- surchargeOf: null means included --');
eq('absent -> null', surchargeOf({}), null);
eq('null -> null', surchargeOf({ surchargeMnt: null }), null);
eq('a positive integer passes through', surchargeOf({ surchargeMnt: 5000 }), 5000);
// The write path REFUSES all of these; this is what protects a reader
// from a hand-edited document.
eq('0 reads as null (included)', surchargeOf({ surchargeMnt: 0 }), null);
eq('a negative reads as null', surchargeOf({ surchargeMnt: -5000 }), null);
eq('a fraction reads as null', surchargeOf({ surchargeMnt: 2500.5 }), null);
eq('a string reads as null', surchargeOf({ surchargeMnt: '5000' }), null);

console.log('\n  -- competitionFeeTotals --');
const EVENTS = [
  { eventId: '333', surchargeMnt: null },
  { eventId: '222', surchargeMnt: null },
  { eventId: '444', surchargeMnt: 5000 },
  { eventId: '555', surchargeMnt: 3000 },
];
{
  const t = competitionFeeTotals(15000, EVENTS);
  eq('min is the base fee alone', t.minMnt, 15000);
  eq('max is base plus EVERY surcharge', t.maxMnt, 23000);
  eq('included events, in configured order', t.includedEventIds.join(','), '333,222');
  eq('surcharged events, in configured order', t.surcharged.map((s) => s.eventId).join(','), '444,555');
}
{
  // No surcharges anywhere: min and max are the same number, which is
  // what makes the review cell show one value instead of a range.
  const t = competitionFeeTotals(15000, [{ eventId: '333', surchargeMnt: null }]);
  eq('no surcharges: max equals min', t.maxMnt, t.minMnt);
  eq('  ...and everything is included', t.includedEventIds.join(','), '333');
}
{
  const t = competitionFeeTotals(null, EVENTS);
  eq('an unset base fee counts as 0', t.minMnt, 0);
  eq('  ...and max is still the surcharges', t.maxMnt, 8000);
}
{
  const t = competitionFeeTotals(0, [{ eventId: '333', surchargeMnt: 5000 }]);
  eq('a base of 0 with every event surcharged is a real configuration', t.minMnt, 0);
  eq('  ...max is the surcharge alone', t.maxMnt, 5000);
}
{
  const t = competitionFeeTotals(15000, []);
  eq('no events: min is the base', t.minMnt, 15000);
  eq('no events: max is the base', t.maxMnt, 15000);
  eq('no events: nothing is listed as included', t.includedEventIds.length, 0);
}

console.log('\n  -- athleteFeeMnt: the registration page total --');
const fee = (chosen) => athleteFeeMnt(15000, EVENTS, chosen);
eq('only included events -> the base alone', fee(['333', '222']), 15000);
eq('one surcharged event -> base + that surcharge', fee(['333', '444']), 20000);
eq('every event -> the max', fee(['333', '222', '444', '555']), 23000);
eq('  ...which equals competitionFeeTotals.maxMnt', fee(['333', '222', '444', '555']),
  competitionFeeTotals(15000, EVENTS).maxMnt);
eq('one included event -> the base', fee(['333']), 15000);
eq('both surcharges -> base + both', fee(['444', '555']), 23000);
// Registering IS what the base fee buys, so an empty selection still owes
// it — a 0 would be wrong the moment they add an event.
eq('no events chosen still owes the base', fee([]), 15000);
// A registration can outlive an event the admin removed.
eq('an event no longer configured is ignored, not charged', fee(['333', 'ghost']), 15000);
eq('a duplicate in the selection is not charged twice', fee(['444', '444']), 20000);
eq('an unset base fee gives surcharges only', athleteFeeMnt(null, EVENTS, ['444']), 5000);
eq('a free competition totals 0', athleteFeeMnt(null, [{ eventId: '333', surchargeMnt: null }], ['333']), 0);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
