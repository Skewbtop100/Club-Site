// ── Schedule clock maths ────────────────────────────────────────────────
// Pure unit tests for scheduleTimings / scheduleSummary / fmtClock /
// fmtDurationMn. No emulator, no Firestore, no React.
//
// Two groups carry weight:
//   the ANCHOR   — a competition with no start time must produce no clock
//                  at all, rather than silently anchoring at midnight and
//                  showing every row a wrong time presented as a right one.
//   the OVERRUN  — measured against the real startAt→endAt window in
//                  milliseconds, not against two times of day. A
//                  competition running 20:00 → 02:00 has a six-hour
//                  window; comparing minutes-of-day would call a
//                  well-fitting schedule a fourteen-hour overrun.
//
// Run: npm run test:schedule

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-schedule-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/schedule.ts',
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
  SCHEDULE_DURATIONS,
  MINUTES_PER_DAY,
  minutesOfDay,
  dayOffsetOf,
  fmtClock,
  fmtDurationMn,
  scheduleTimings,
  scheduleSummary,
  durationsOf,
} = require(path.join(OUT, 'schedule.js'));

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

/** Local-time timestamps, built the way the editor's datetime-local
 *  values are, so the tests do not depend on the machine's timezone. */
const at = (h, m = 0, day = 25) => new Date(2026, 2, day, h, m).getTime();

console.log('\n  -- fmtClock --');
eq('600 -> 10:00', fmtClock(600), '10:00');
eq('0 -> 00:00', fmtClock(0), '00:00');
eq('630 -> 10:30', fmtClock(630), '10:30');
eq('1439 -> 23:59', fmtClock(1439), '23:59');
// Past midnight the day marker is not decoration: without it a 30-hour
// schedule shows two rows both reading 06:30.
eq('1440 -> 00:00 (+1)', fmtClock(1440), '00:00 (+1)');
eq('1830 -> 06:30 (+1)', fmtClock(1830), '06:30 (+1)');
eq('3000 -> 02:00 (+2)', fmtClock(3000), '02:00 (+2)');
eq('MINUTES_PER_DAY is 1440', MINUTES_PER_DAY, 1440);
eq('dayOffsetOf stays 0 inside the first day', dayOffsetOf(1439), 0);
eq('dayOffsetOf(1440) is 1', dayOffsetOf(1440), 1);

console.log('\n  -- fmtDurationMn --');
eq('160 -> 2ц 40м', fmtDurationMn(160), '2ц 40м');
eq('45 -> 45м (no hour part)', fmtDurationMn(45), '45м');
eq('120 -> 2ц (no minute part)', fmtDurationMn(120), '2ц');
eq('60 -> 1ц', fmtDurationMn(60), '1ц');
eq('0 -> 0м', fmtDurationMn(0), '0м');
eq('90 -> 1ц 30м', fmtDurationMn(90), '1ц 30м');

console.log('\n  -- minutesOfDay --');
eq('10:00 -> 600', minutesOfDay(at(10)), 600);
eq('10:30 -> 630', minutesOfDay(at(10, 30)), 630);
eq('00:00 -> 0', minutesOfDay(at(0)), 0);
eq('null in, NULL out — no anchor, no clock', minutesOfDay(null), null);

console.log('\n  -- scheduleTimings: each row starts when the last ends --');
{
  const t = scheduleTimings(600, [30, 45, 60]);
  eq('row 1 starts at the anchor', t[0].startMin, 600);
  eq('row 1 ends 30m later', t[0].endMin, 630);
  eq('row 2 starts where row 1 ended', t[1].startMin, 630);
  eq('row 2 ends 45m later', t[1].endMin, 675);
  eq('row 3 starts where row 2 ended', t[2].startMin, 675);
  eq('row 3 ends 60m later', t[2].endMin, 735);
  eq('  ...which is 12:15', fmtClock(t[2].endMin), '12:15');
}
eq('an empty schedule has no timings', scheduleTimings(600, []).length, 0);
// The accumulation is what makes reordering re-time everything for free:
// the same durations in a new order give the same total but new starts.
{
  const a = scheduleTimings(600, [30, 90]);
  const b = scheduleTimings(600, [90, 30]);
  eq('reordering keeps the end of the last row', a[1].endMin, b[1].endMin);
  ok('  ...but moves the middle boundary', a[1].startMin !== b[1].startMin,
    `${a[1].startMin} vs ${b[1].startMin}`);
}
// Past midnight it keeps counting rather than wrapping — this is what
// makes a continuous overnight competition render correctly.
{
  const t = scheduleTimings(1380, [60, 120]);
  eq('23:00 + 60m crosses midnight without wrapping', t[0].endMin, 1440);
  eq('  ...and renders as 00:00 (+1)', fmtClock(t[0].endMin), '00:00 (+1)');
  eq('the next row starts on day 2', fmtClock(t[1].startMin), '00:00 (+1)');
  eq('  ...and ends at 02:00 (+1)', fmtClock(t[1].endMin), '02:00 (+1)');
}
// A null anchor still produces internally consistent offsets, so the
// editor can total a schedule before a start time exists. The CALLER is
// what renders "—" instead of 00:00.
{
  const t = scheduleTimings(null, [30, 30]);
  eq('null anchor measures from 0', t[0].startMin, 0);
  eq('  ...and still accumulates', t[1].startMin, 30);
}

console.log('\n  -- scheduleSummary --');
{
  // 10:00 → 18:00 is an eight-hour window; 2h40m of programme fits.
  const s = scheduleSummary(at(10), at(18), [30, 60, 70]);
  eq('total is the sum of the durations', s.totalMin, 160);
  eq('  ...which reads 2ц 40м', fmtDurationMn(s.totalMin), '2ц 40м');
  eq('first is the start time', fmtClock(s.firstMin), '10:00');
  eq('last end is first + total', fmtClock(s.lastEndMin), '12:40');
  eq('it FITS, so there is no overflow', s.overflowMin, null);
}
{
  // 10:00 → 12:00 is two hours; 2h40m does not fit.
  const s = scheduleSummary(at(10), at(12), [30, 60, 70]);
  eq('an overrun is reported', s.overflowMin, 40);
  eq('  ...by how much, in words', fmtDurationMn(s.overflowMin), '40м');
}
eq('exactly filling the window is NOT an overrun',
  scheduleSummary(at(10), at(12), [60, 60]).overflowMin, null);
eq('one minute over IS an overrun',
  scheduleSummary(at(10), at(12), [60, 61]).overflowMin, 1);
// The case minutes-of-day arithmetic gets wrong: an overnight competition.
{
  const s = scheduleSummary(at(20), at(2, 0, 26), [60, 120, 60]);
  eq('an overnight window is measured in real time, not clock time', s.overflowMin, null);
  eq('  ...and the schedule ends at 00:00 (+1)', fmtClock(s.lastEndMin), '00:00 (+1)');
}
{
  const s = scheduleSummary(at(20), at(2, 0, 26), [180, 180, 180]);
  eq('  ...and a genuine overnight overrun is still caught', s.overflowMin, 180);
}

console.log('\n  -- scheduleSummary: missing bounds never crash --');
{
  const s = scheduleSummary(null, at(18), [30, 60]);
  eq('no startAt: the total still computes', s.totalMin, 90);
  eq('no startAt: there is no first time to show', s.firstMin, null);
  eq('no startAt: nor a last', s.lastEndMin, null);
  eq('no startAt: nothing to compare, so no overflow claim', s.overflowMin, null);
}
{
  const s = scheduleSummary(at(10), null, [30, 60]);
  eq('no endAt: the times still show', fmtClock(s.firstMin), '10:00');
  eq('no endAt: NO overflow claim — unknown is not "fits"', s.overflowMin, null);
}
{
  const s = scheduleSummary(null, null, []);
  eq('nothing at all: total 0', s.totalMin, 0);
  eq('nothing at all: no times', s.firstMin, null);
  eq('nothing at all: no overflow', s.overflowMin, null);
}
eq('no rows: an empty schedule cannot overrun', scheduleSummary(at(10), at(12), []).overflowMin, null);
eq('an inverted window (end before start) makes no overflow claim',
  scheduleSummary(at(18), at(10), [600]).overflowMin, null);

console.log('\n  -- durationsOf guards a hand-edited document --');
eq('reads the stored durations in order',
  durationsOf([{ durationMin: 30 }, { durationMin: 45 }]).join(','), '30,45');
eq('a zero duration reads as 0, not NaN', durationsOf([{ durationMin: 0 }])[0], 0);
eq('a negative reads as 0', durationsOf([{ durationMin: -30 }])[0], 0);
eq('a non-number reads as 0', durationsOf([{ durationMin: '30' }])[0], 0);
eq('a missing duration reads as 0', durationsOf([{}])[0], 0);

console.log('\n  -- the offered durations --');
eq('the select offers the eight documented values', SCHEDULE_DURATIONS.join(','), '10,15,20,30,45,60,90,120');
ok('every one is a positive whole number', SCHEDULE_DURATIONS.every((d) => Number.isInteger(d) && d > 0));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
