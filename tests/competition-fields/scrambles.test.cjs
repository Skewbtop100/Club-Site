// ── TNoodle import: scrambles per group ─────────────────────────────────
// Pure unit tests for parseTnoodleJson + expectedScrambleCountFor. No
// emulator — the parser touches nothing.
//
// The parser used to impose a hard 5 scrambles per group on every round.
// The TNoodle file has always carried the real count (a 3-attempt round
// exports 3 per set), so a legitimate Mo3/Bo3 export was rejected as
// malformed. It now takes the expected count from the competition, which
// means it is NO LONGER a pure function of the file.
//
// Run: npm run test:scrambles

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-scrambles-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/scrambles.ts',
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
  parseTnoodleJson,
  expectedScrambleCountFor,
  DEFAULT_SCRAMBLES_PER_GROUP,
} = require(path.join(OUT, 'scrambles.js'));

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

/** A minimal TNoodle-shaped export: one event, one round, one group of N. */
const file = (eventId, count, rounds = 1) => ({
  wcif: {
    events: [
      {
        id: eventId,
        rounds: Array.from({ length: rounds }, (_, r) => ({
          id: `${eventId}-r${r + 1}`,
          scrambleSets: [{ scrambles: Array.from({ length: count }, (_, i) => `R U R' U' ${i}`) }],
        })),
      },
    ],
  },
});

console.log('\n=== TNoodle import: scrambles per group ===\n');

eq('DEFAULT_SCRAMBLES_PER_GROUP is still 5', DEFAULT_SCRAMBLES_PER_GROUP, 5);

// ── backward compatibility: no lookup means the old behaviour ─────────
console.log('  -- no lookup supplied (old behaviour) --');
ok('5 scrambles parse', parseTnoodleJson(file('333', 5)).ok);
ok('3 scrambles are REJECTED without a lookup', (() => {
  const r = parseTnoodleJson(file('333', 3));
  // A round that cannot be used is a warning + skip, and a file with no
  // usable round at all fails outright.
  return !r.ok;
})(), 'a 3-scramble round parsed with no lookup');
eq('a 5-scramble round keeps exactly 5', parseTnoodleJson(file('333', 5)).rounds[0].groups[0].scrambles.length, 5);

// ── with the competition's expectation ────────────────────────────────
console.log('\n  -- expectedScrambleCountFor --');
const ao5Comp = expectedScrambleCountFor([{ eventId: '333', resultFormat: 'ao5' }]);
const mo3Comp = expectedScrambleCountFor([{ eventId: '333', resultFormat: 'mo3' }]);
const bo3Comp = expectedScrambleCountFor([{ eventId: '333', resultFormat: 'bo3' }]);
const bo1Comp = expectedScrambleCountFor([{ eventId: '333', resultFormat: 'bo1' }]);
const legacyComp = expectedScrambleCountFor([{ eventId: '333' }]);

eq('ao5 event expects 5', ao5Comp('333', 1), 5);
eq('mo3 event expects 3', mo3Comp('333', 1), 3);
eq('bo3 event expects 3', bo3Comp('333', 1), 3);
eq('bo1 event expects 1', bo1Comp('333', 1), 1);
eq('an event with NO stored format expects 5 (read-time default)', legacyComp('333', 1), 5);
eq('an event the competition does not run falls back to 5', mo3Comp('222', 1), 5);

console.log('\n  -- parsing with the expectation --');
ok('a 3-scramble round parses for an Mo3 event', parseTnoodleJson(file('333', 3), mo3Comp).ok);
eq(
  '  ...and keeps exactly 3',
  parseTnoodleJson(file('333', 3), mo3Comp).rounds[0].groups[0].scrambles.length,
  3,
);
ok('a 1-scramble round parses for a Bo1 event', parseTnoodleJson(file('333', 1), bo1Comp).ok);
eq(
  '  ...and keeps exactly 1',
  parseTnoodleJson(file('333', 1), bo1Comp).rounds[0].groups[0].scrambles.length,
  1,
);

// Too few for the format is still refused — this is the guard, not a
// leniency: importing a half-length round would strand the athlete on the
// attempt the file cannot supply.
ok('3 scrambles are REJECTED for an Ao5 event', !parseTnoodleJson(file('333', 3), ao5Comp).ok);
ok('2 scrambles are REJECTED for an Mo3 event', !parseTnoodleJson(file('333', 2), mo3Comp).ok);

// TNoodle emits EXTRA scrambles for extra attempts; the importer trims to
// what the round needs rather than storing them.
eq(
  'a 5-scramble file is trimmed to 3 for an Mo3 event',
  parseTnoodleJson(file('333', 5), mo3Comp).rounds[0].groups[0].scrambles.length,
  3,
);
eq(
  '  ...keeping the FIRST 3, in order',
  parseTnoodleJson(file('333', 5), mo3Comp).rounds[0].groups[0].scrambles.join('|'),
  ["R U R' U' 0", "R U R' U' 1", "R U R' U' 2"].join('|'),
);

// Every round of an event uses that event's count.
const multi = parseTnoodleJson(file('333', 3, 2), mo3Comp);
ok('both rounds of a multi-round Mo3 event parse', multi.ok && multi.rounds.length === 2,
  multi.ok ? String(multi.rounds.length) : multi.error);

// A mixed file: one event Ao5, one Mo3, each judged by its own count.
const mixed = expectedScrambleCountFor([
  { eventId: '333', resultFormat: 'ao5' },
  { eventId: '222', resultFormat: 'mo3' },
]);
const mixedFile = {
  wcif: {
    events: [
      { id: '333', rounds: [{ id: '333-r1', scrambleSets: [{ scrambles: ['a', 'b', 'c', 'd', 'e'] }] }] },
      { id: '222', rounds: [{ id: '222-r1', scrambleSets: [{ scrambles: ['f', 'g', 'h'] }] }] },
    ],
  },
};
const mixedParsed = parseTnoodleJson(mixedFile, mixed);
ok('a mixed-format file parses both events', mixedParsed.ok && mixedParsed.rounds.length === 2,
  mixedParsed.ok ? String(mixedParsed.rounds.length) : mixedParsed.error);
if (mixedParsed.ok) {
  const by = Object.fromEntries(mixedParsed.rounds.map((r) => [r.eventId, r.groups[0].scrambles.length]));
  eq('  ...5 for the Ao5 event', by['333'], 5);
  eq('  ...3 for the Mo3 event', by['222'], 3);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
