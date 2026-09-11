// ── Round progress: the admin overview's bars ───────────────────────────
// REAL unit tests — round-progress.ts is pure, so the arithmetic is
// exercised directly rather than read.
//
// THE BUG THIS PINS: the calculation used to live inline in AdminOverview
// and counted submissions whose `round` field equalled the competition
// round. `round` is the ATTEMPT INDEX 1-5, not a round. So a ten-athlete,
// single-round Ao5 showed a FULL BAR at 10/10 as soon as everyone had
// done their first attempt — with forty of the fifty solves still to
// come — and attempts 3-5 were never counted at all. The first group
// below is that exact scenario.
//
// Run: npm run test:progress

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-progress-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/round-progress.ts',
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

const { roundProgressRows } = require(path.join(OUT, 'round-progress.js'));

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

const EVENT_333 = { eventId: '333', label: '3x3x3', rounds: 1, resultFormat: 'ao5' };
const approved = (n, events = ['333']) => Array.from({ length: n }, () => ({ status: 'approved', events }));
/** `count` submissions for one event+round. */
const subs = (count, competitionRound = 1, event = '333') =>
  Array.from({ length: count }, () => ({ event, competitionRound }));

console.log('\n  -- THE BUG: attempts are not rounds --');
{
  // Ten athletes, one round, Ao5. Everyone has done attempt 1 and nothing
  // else: ten submissions exist, fifty are owed.
  const rows = roundProgressRows([EVENT_333], subs(10), approved(10));
  eq('one row for the round', rows.length, 1);
  eq('  ...counting the ten submissions that exist', rows[0].done, 10);
  eq('  ...against the fifty a solved round produces', rows[0].expected, 50);
  eq('  ...which is 20%, not 100%', rows[0].pct, 20);
  // The old inline version read `s.round === round`, so these ten attempt
  // -1 submissions came out as 10 / 10.
  ok('  ...and the bar is NOT full', rows[0].pct < 100);
}
{
  const rows = roundProgressRows([EVENT_333], subs(50), approved(10));
  eq('a fully solved round reads 50/50', `${rows[0].done}/${rows[0].expected}`, '50/50');
  eq('  ...at 100%', rows[0].pct, 100);
}
{
  // Attempts 3-5 were invisible to the old version: its loop stopped at
  // ev.rounds, so for a 1-round event only `round === 1` was ever counted.
  const half = roundProgressRows([EVENT_333], subs(25), approved(10));
  eq('every attempt counts, not just the first', half[0].done, 25);
  eq('  ...halfway', half[0].pct, 50);
}

console.log('\n  -- one row per event and round --');
{
  const events = [
    { eventId: '333', label: '3x3x3', rounds: 3, resultFormat: 'ao5' },
    { eventId: '222', label: '2x2x2', rounds: 1, resultFormat: 'ao5' },
  ];
  const submissions = [...subs(50, 1), ...subs(20, 2), ...subs(15, 1, '222')];
  const regs = [...approved(10, ['333', '222'])];
  const rows = roundProgressRows(events, submissions, regs);
  eq('a row per event+round WITH submissions', rows.map((r) => r.key).join(','), '333-1,333-2,222-1');
  eq('  ...round 3 has none, so it is omitted', rows.some((r) => r.key === '333-3'), false);
  eq('round 1 and round 2 are counted separately', `${rows[0].done},${rows[1].done}`, '50,20');
  eq('  ...and the other event is its own row', rows[2].done, 15);
  eq('labels name the event and the round', rows[1].label, '3x3x3 · Раунд 2');
  // Round 2+ over-counts: only qualifiers are expected to solve it, and
  // the qualifier list is not part of this data. Pinned as a known limit,
  // not a claim that it is right.
  eq('KNOWN LIMIT: a later round keeps the full denominator', rows[1].expected, 50);
}
{
  const events = [{ eventId: '333', label: '3x3x3', rounds: 2, resultFormat: 'ao5' }];
  const rows = roundProgressRows(events, subs(5, 2), approved(4));
  eq('a round with submissions but no earlier ones still shows', rows.length, 1);
  eq('  ...as round 2', rows[0].round, 2);
}
eq('no submissions at all: no rows', roundProgressRows([EVENT_333], [], approved(10)).length, 0);

console.log('\n  -- the denominator --');
{
  const mo3 = [{ eventId: '333bf', label: '3БНД', rounds: 1, resultFormat: 'mo3' }];
  const rows = roundProgressRows(mo3, subs(6, 1, '333bf'), approved(4, ['333bf']));
  eq('an Mo3 round owes three attempts per athlete', rows[0].expected, 12);
  eq('  ...so six of them is half', rows[0].pct, 50);
  const bo1 = [{ eventId: '333fm', label: 'ФМ', rounds: 1, resultFormat: 'bo1' }];
  eq('a Bo1 round owes one each',
    roundProgressRows(bo1, subs(3, 1, '333fm'), approved(4, ['333fm']))[0].expected, 4);
  // An event with no resultFormat stored falls back to ao5, like every
  // other reader (resolveResultFormat).
  const legacy = [{ eventId: '333', label: '3x3x3', rounds: 1 }];
  eq('a missing resultFormat counts as Ao5', roundProgressRows(legacy, subs(1), approved(2))[0].expected, 10);
}
{
  // D7: only APPROVED athletes are expected to solve.
  const regs = [
    ...approved(3),
    { status: 'pending', events: ['333'] },
    { status: 'waitlisted', events: ['333'] },
    { status: 'cancelled', events: ['333'] },
    { status: 'rejected', events: ['333'] },
  ];
  eq('pending, waitlisted, cancelled and rejected are not expected to solve',
    roundProgressRows([EVENT_333], subs(1), regs)[0].expected, 15);
  eq('an approved athlete not registered for THIS event is not counted either',
    roundProgressRows([EVENT_333], subs(1), [...approved(3), ...approved(2, ['222'])])[0].expected, 15);
}
{
  // Nobody approved yet, but submissions exist (an athlete solved before
  // being approved — PR-2 does not gate solving). No division by zero.
  const rows = roundProgressRows([EVENT_333], subs(5), []);
  eq('no approved athletes: expected 0', rows[0].expected, 0);
  eq('  ...and 0%, not NaN or Infinity', rows[0].pct, 0);
  ok('  ...the row still shows the work that exists', rows[0].done === 5);
}
{
  // Historical re-runs left more submissions in a slot than a run needs,
  // so done can exceed expected. A bar past its own end is worse than a
  // full one.
  const rows = roundProgressRows([EVENT_333], subs(70), approved(10));
  eq('more submissions than the round owes', `${rows[0].done}/${rows[0].expected}`, '70/50');
  eq('  ...caps the bar at 100%', rows[0].pct, 100);
}

console.log('\n  -- the call sites that were reading the wrong field --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const ADMIN = 'app/online-competition/admin/_components';

  // The server change that made all of this expressible.
  ok('the admin view carries competitionRound',
    /competitionRound: number;/.test(src('lib/online-competition/types.ts')));
  ok('  ...and the GET mapper fills it, defaulting a legacy document to round 1',
    src('app/api/online-competition/submissions/route.ts')
      .includes("competitionRound: typeof data.competitionRound === 'number' ? data.competitionRound : 1,"));

  const overview = src(`${ADMIN}/AdminOverview.tsx`);
  ok('the overview computes progress through this module', overview.includes('roundProgressRows('));
  ok('  ...and no longer counts attempts as rounds itself',
    !/s\.round === round/.test(overview));
  ok('the recent-submissions line shows the round AND the attempt',
    overview.includes('РАУНД {s.competitionRound} · ОРОЛДЛОГО {s.round}'));

  const panel = src(`${ADMIN}/SubmissionDetailPanel.tsx`);
  ok('the detail panel headlines the COMPETITION round',
    panel.includes('РАУНД {submission.competitionRound}'));
  ok('  ...and keeps the attempt index as the attempt',
    panel.includes('Оролдлого {submission.round}'));
  ok('  ...never printing the same number under both names',
    !panel.includes('РАУНД {submission.round}'));

  const grid = src(`${ADMIN}/ReviewGrid.tsx`);
  ok('the grid derives its round tabs from the event’s configuration',
    grid.includes('function roundsForEvent(') && grid.includes('roundsForEvent(eventConfig?.rounds ?? 1)'));
  // Code, not prose: the comment that replaced it names the old constant
  // and would otherwise fail its own assertion.
  ok('  ...with no hardcoded round list left',
    !/^const ROUNDS/m.test(grid) && !grid.includes('ROUNDS.map('));
  ok('  ...and filters rows to the selected round',
    grid.includes("s.event === eventId && s.competitionRound === round"));
  ok('  ...re-running the rows when the round changes',
    grid.includes('}, [registrations, submissions, eventId, round]);'));
  ok('the attempt columns still key off the attempt index',
    grid.includes('const key = `${s.uid}#${s.round}`;'));
  // Duplicates within one round are still possible in historical data, so
  // the indicator stays.
  ok('the duplicate-slot indicator is kept', grid.includes('row.slotCounts.set(roundNum, list.length);'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
