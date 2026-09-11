// ── May this athlete start, right now? ──────────────────────────────────
// REAL unit tests — event-state.ts is pure.
//
// THE BUG THIS PINS: an `ok` answer from the round-access gate used to
// fall through to a `Date.now() >= competition.startAt` comparison, so a
// competition with rounds open since September and a December start
// rendered a DISABLED button for every athlete. The gate is what the solve
// flow actually enforces with; the button has to follow the same thing.
//
// Run: npm run test:eventstate

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-eventstate-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/event-state.ts',
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

const { deriveEventState } = require(path.join(OUT, 'event-state.js'));

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

const NOW = Date.UTC(2026, 8, 11, 4, 0);
const HOUR = 3_600_000;
const comp = (startMs) => ({ startAt: startMs === null ? null : { toMillis: () => startMs } });
const access = (reason, liveRound = 1) => ({ liveRound, allowed: reason === 'ok', reason });

console.log('\n  -- the gate decides --');
{
  // THE BUG, exactly: an open round three months before the competition's
  // scheduled start.
  const december = comp(Date.UTC(2026, 11, 9, 1, 0));
  eq('an open round beats a start date in the future', deriveEventState(december, access('ok'), NOW), 'live');
  eq('  ...and the same competition without the gate is idle',
    deriveEventState(december, undefined, NOW), 'idle');

  eq('no live round: idle, whatever the schedule says',
    deriveEventState(comp(NOW - HOUR), access('no-live-round', null), NOW), 'idle');
  eq('not qualified says so, rather than going quiet',
    deriveEventState(comp(NOW - HOUR), access('not-qualified', 2), NOW), 'notqualified');
  // A refusal outranks a start time that has passed.
  eq('a refusal is not overridden by a start date in the past',
    deriveEventState(comp(NOW - 10 * HOUR), access('no-live-round', null), NOW), 'idle');
}

console.log('\n  -- startAt only where the gate has not answered --');
{
  eq('access still loading, start passed: live (the old behaviour)',
    deriveEventState(comp(NOW - 1), undefined, NOW), 'live');
  eq('access still loading, start in the future: idle',
    deriveEventState(comp(NOW + 1), undefined, NOW), 'idle');
  eq('the lookup FAILED (null), start passed: live',
    deriveEventState(comp(NOW - 1), null, NOW), 'live');
  eq('exactly at the start instant counts as started', deriveEventState(comp(NOW), undefined, NOW), 'live');
  eq('no start date at all: idle', deriveEventState(comp(null), undefined, NOW), 'idle');
  eq('no start date, but the gate says ok: live',
    deriveEventState(comp(null), access('ok'), NOW), 'live');
  // A false "live" here costs nothing — the solve page re-asks the same
  // gate and refuses with an explanation. A false "idle" strands the
  // athlete, which is what this changeset is about.
  ok('the fallback never contradicts a gate answer',
    ['ok', 'no-live-round', 'not-qualified'].every((reason) => {
      const withGate = deriveEventState(comp(NOW - HOUR), access(reason), NOW);
      return reason === 'ok' ? withGate === 'live' : withGate !== 'live';
    }));
}

console.log('\n  -- the callers --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // One definition, two surfaces: the dashboard card and the detail
  // page's start panel. A second copy is how they would drift apart.
  ok('the dashboard reads it from lib',
    src('app/online-competition/dashboard/_components/LiveCard.tsx')
      .includes("from '@/lib/online-competition/event-state'"));
  ok('the detail page’s start panel reads the same one',
    src('app/online-competition/[competitionId]/details/_components/StartRoundPanel.tsx')
      .includes("from '@/lib/online-competition/event-state'"));
  ok('the dashboard-local copy is gone',
    !fs.existsSync(path.join(ROOT, 'app/online-competition/dashboard/_components/eventState.ts')));
  // The start panel passes no startAt: on that page an unknown gate must
  // not produce a button on a guess.
  ok('the start panel never falls back to a start date',
    src('app/online-competition/[competitionId]/details/_components/StartRoundPanel.tsx')
      .includes('deriveEventState({ startAt: null }'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
