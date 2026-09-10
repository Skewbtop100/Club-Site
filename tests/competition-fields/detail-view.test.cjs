// ── Public detail page: derived rows ────────────────────────────────────
// Pure unit tests for detail-view.ts — the ТӨРЛҮҮД table and the ХУВААРЬ
// timeline. No emulator, no Firestore, no React.
//
// Two groups carry weight:
//   ТӨРЛҮҮД   — cutoffs are keyed PER ROUND and advancement is the plan
//               OUT of a round, so an off-by-one in either shows an athlete
//               the wrong round's rule with nothing looking broken.
//   ХУВААРЬ   — times are RECOMPUTED from startAt + durations, not read
//               from the stored startMin; a disagreement is reported, not
//               rendered. And a row for an event that no longer exists is
//               kept, so no later row's time moves.
//
// Run: npm run test:detail

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-detail-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/detail-view.ts',
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

const { roundLabel, advancementText, eventRoundRows, scheduleRows } = require(path.join(OUT, 'detail-view.js'));

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
// String() rather than a bare join: Array.join renders null as '', which
// would make "no value" indistinguishable from "an empty value".
const col = (rows, key) => rows.map((r) => String(r[key])).join(' | ');

console.log('\n  -- roundLabel / advancementText --');
eq('round 1 of 3', roundLabel(1, 3), 'Раунд 1');
eq('round 2 of 3', roundLabel(2, 3), 'Раунд 2');
eq('round 3 of 3 is the final', roundLabel(3, 3), 'Финал');
eq('a one-round event’s only round IS the final', roundLabel(1, 1), 'Финал');
eq('a count plan', advancementText({ method: 'count', value: 12 }), 'Дээд 12 дараагийн раундад');
eq('a percent plan', advancementText({ method: 'percent', value: 50 }), 'Дээд 50% дараагийн раундад');
eq('a fractional percent is shown as stored', advancementText({ method: 'percent', value: 12.5 }), 'Дээд 12.5% дараагийн раундад');

console.log('\n  -- ТӨРЛҮҮД: one row per event+round --');
const EVENTS = [
  {
    eventId: '333', label: '3x3x3', rounds: 3, resultFormat: 'ao5', timeLimitCs: 60000,
    cutoffs: [{ round: 1, cutoffCs: 3000 }, { round: 2, cutoffCs: 2500 }],
    advancement: [{ fromRound: 1, method: 'percent', value: 50 }, { fromRound: 2, method: 'count', value: 12 }],
    surchargeMnt: null,
  },
  {
    eventId: '222', label: '2x2x2', rounds: 1, resultFormat: 'mo3', timeLimitCs: null,
    cutoffs: [], advancement: [], surchargeMnt: null,
  },
];
{
  const { rows, usesLimit, usesCutoff } = eventRoundRows(EVENTS);
  eq('four rows: three rounds + one', rows.length, 4);
  eq('the event label is on its FIRST row only', col(rows, 'eventLabel'), '3x3x3 | null | null | 2x2x2');
  eq('round labels, with Финал on each event’s last', col(rows, 'roundLabel'), 'Раунд 1 | Раунд 2 | Финал | Финал');
  eq('format is per EVENT, repeated per row', col(rows, 'format'), 'Ao5 | Ao5 | Ao5 | Mo3');
  eq('limit is per EVENT, "—" when unset', col(rows, 'limit'), '10:00 | 10:00 | 10:00 | —');
  // Cutoffs are keyed PER ROUND — round 3 has none even though 1 and 2 do.
  eq('cutoff is per ROUND', col(rows, 'cutoff'), '0:30 | 0:25 | — | —');
  // The plan OUT of a round: round 1's plan says how many reach round 2.
  eq('next is the plan OUT of this round, blank on the final', col(rows, 'next'),
    'Дээд 50% дараагийн раундад | Дээд 12 дараагийн раундад |  | ');
  eq('usesLimit', usesLimit, true);
  eq('usesCutoff', usesCutoff, true);
  eq('keys are unique', new Set(rows.map((r) => r.key)).size, rows.length);
}
{
  // A non-final round with NO plan declared is a different fact from the
  // final round, which has no next round at all.
  const { rows } = eventRoundRows([{ eventId: '444', label: '4x4x4', rounds: 2, resultFormat: 'ao5', timeLimitCs: null, cutoffs: [], advancement: [], surchargeMnt: null }]);
  eq('an undeclared plan on a non-final round reads "—"', rows[0].next, '—');
  eq('  ...and the final is still blank', rows[1].next, '');
}
{
  const { usesLimit, usesCutoff } = eventRoundRows([EVENTS[1]]);
  eq('no limit anywhere -> no ЛИМИТ block', usesLimit, false);
  eq('no cutoff anywhere -> no CUTOFF block', usesCutoff, false);
}
{
  const { usesLimit, usesCutoff } = eventRoundRows([{ ...EVENTS[1], timeLimitCs: 30000 }]);
  eq('a limit alone shows ЛИМИТ', usesLimit, true);
  eq('  ...but not CUTOFF', usesCutoff, false);
}
eq('no events, no rows', eventRoundRows([]).rows.length, 0);
eq('an absent resultFormat reads Ao5',
  eventRoundRows([{ eventId: '333', label: '3x3x3', rounds: 1 }]).rows[0].format, 'Ao5');
eq('a cutoff for a round the event does not have never shows',
  col(eventRoundRows([{ ...EVENTS[1], cutoffs: [{ round: 5, cutoffCs: 100 }] }]).rows, 'cutoff'), '—');
eq('every format label is the ao5.ts one',
  ['ao5', 'mo3', 'bo3', 'bo2', 'bo1'].map((f) => eventRoundRows([{ eventId: 'x', label: 'x', rounds: 1, resultFormat: f }]).rows[0].format).join(','),
  'Ao5,Mo3,Bo3,Bo2,Bo1');

console.log('\n  -- ХУВААРЬ: times are recomputed from startAt + durations --');
const at = (h, m = 0) => new Date(2026, 2, 25, h, m).getTime();
const SCHED = [
  { id: 'a', startMin: 600, durationMin: 30, kind: 'other', label: 'Бүртгэл / танилцуулга', note: '' },
  { id: 'b', startMin: 630, durationMin: 60, kind: 'round', eventId: '333', round: 1, note: 'Шүүгч: Б.Ууганбаяр' },
  { id: 'c', startMin: 690, durationMin: 45, kind: 'round', eventId: '333', round: 3 },
  { id: 'd', startMin: 735, durationMin: 30, kind: 'round', eventId: '222', round: 1 },
];
{
  const { rows, storedStartsDisagree } = scheduleRows(SCHED, EVENTS, at(10));
  eq('start times accumulate from 10:00', col(rows, 'start'), '10:00 | 10:30 | 11:30 | 12:15');
  eq('end times are start + duration', col(rows, 'end'), '10:30 | 11:30 | 12:15 | 12:45');
  eq('stored startMin that AGREE raise no flag', storedStartsDisagree, false);
  eq('row kinds', col(rows, 'kind'), 'other | round | round | round');
  eq('an other row shows its own label', rows[0].label, 'Бүртгэл / танилцуулга');
  eq('a round row shows "{event} · Раунд N"', rows[1].label, '3x3x3 · Раунд 1');
  eq('the last round of an event reads Финал', rows[2].label, '3x3x3 · Финал');
  eq('a one-round event reads Финал', rows[3].label, '2x2x2 · Финал');
  eq('a note is carried', rows[1].note, 'Шүүгч: Б.Ууганбаяр');
  eq('an empty note is null, not ""', rows[0].note, null);
  eq('a missing note is null', rows[2].note, null);
  eq('keys are the stable ids', col(rows, 'key'), 'a | b | c | d');
}
{
  // Moving the competition's start moves every row with it — the reason
  // the times are recomputed rather than read.
  const { rows, storedStartsDisagree } = scheduleRows(SCHED, EVENTS, at(9));
  eq('a 09:00 start shifts every row an hour earlier', col(rows, 'start'), '09:00 | 09:30 | 10:30 | 11:15');
  eq('  ...and the stored (10:00-based) starts are flagged as disagreeing', storedStartsDisagree, true);
}
{
  // A hand-edited document whose stored starts overlap. The durations win.
  const edited = SCHED.map((e, i) => (i === 2 ? { ...e, startMin: 640 } : e));
  const { rows, storedStartsDisagree } = scheduleRows(edited, EVENTS, at(10));
  eq('a drifted stored startMin is NOT rendered', rows[2].start, '11:30');
  eq('  ...and it IS reported', storedStartsDisagree, true);
}
{
  const { rows, storedStartsDisagree } = scheduleRows(SCHED, EVENTS, null);
  eq('no startAt: no clock at all, not a midnight one', col(rows, 'start'), 'null | null | null | null');
  eq('no startAt: no end either', rows[0].end, null);
  eq('no startAt: nothing to disagree with', storedStartsDisagree, false);
  eq('no startAt: the labels still render', rows[1].label, '3x3x3 · Раунд 1');
}
{
  // Past midnight the clock keeps counting and says so.
  const { rows } = scheduleRows(
    [{ id: 'x', startMin: 1380, durationMin: 120, kind: 'other', label: 'Шөнийн' }],
    EVENTS,
    at(23),
  );
  eq('a slot crossing midnight marks the next day', `${rows[0].start} – ${rows[0].end}`, '23:00 – 01:00 (+1)');
}

console.log('\n  -- ХУВААРЬ: an event the competition no longer has --');
{
  const withStale = [
    ...SCHED.slice(0, 2),
    { id: 'gone', startMin: 690, durationMin: 45, kind: 'round', eventId: '444', round: 1 },
    { id: 'beyond', startMin: 735, durationMin: 30, kind: 'round', eventId: '333', round: 5 },
    { id: 'after', startMin: 765, durationMin: 30, kind: 'other', label: 'Шагнал гардуулах' },
  ];
  const { rows } = scheduleRows(withStale, EVENTS, at(10));
  eq('a removed event’s row is KEPT as stale', rows[2].kind, 'stale');
  eq('  ...labelled from the catalogue with its round number', rows[2].label, '4x4x4 · Раунд 1');
  eq('a round beyond the event’s count is stale too', rows[3].kind, 'stale');
  eq('  ...and says "Раунд 5", never "Финал"', rows[3].label, '3x3x3 · Раунд 5');
  // The point of keeping it: nothing after it moves.
  eq('the row AFTER the stale ones keeps its announced time', rows[4].start, '12:45');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
