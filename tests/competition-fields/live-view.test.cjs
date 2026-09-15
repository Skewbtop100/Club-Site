// ── The athlete's live competition view ─────────────────────────────────
// REAL unit tests — live-view.ts is pure. What they pin, above all:
//   · only an APPROVED attempt is ever shown as a time;
//   · the standings count a judge's DNF (a REJECTED submission) as a DNF,
//     exactly as the qualifier ranking does, and leave PENDING out;
//   · the header's average follows the athlete's own standings row.
//
// The source assertions at the end pin the wiring that cannot be run here:
// the route's query, the entry points that land on the live view, and the
// solve flow's way back to it.
//
// Run: npm run test:live

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-liveview-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/live-view.ts',
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

const lv = require(path.join(OUT, 'live-view.js'));

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

const AO5 = { format: 'ao5', attempts: 5, timeLimitCs: null, cutoffCs: null };
const MO3 = { format: 'mo3', attempts: 3, timeLimitCs: null, cutoffCs: null };
const BO3 = { format: 'bo3', attempts: 3, timeLimitCs: null, cutoffCs: null };
let t = 0;
const sub = (uid, attempt, status, reportedTime, extra = {}) => ({
  uid,
  event: '333',
  competitionRound: 1,
  attempt,
  status,
  reportedTime,
  isDnf: false,
  penalty: status === 'rejected' ? 'DNF' : null,
  createdAt: ++t,
  ...extra,
});
const names = { a: 'Бат', b: 'Солонго', c: 'Номин', d: 'Энхжин', me: 'Ууганбаяр' };
const nameOf = (uid) => names[uid] ?? uid;
const board = (subs, rules = AO5) => lv.rankJudgedStandings(subs, rules, nameOf, 'me');
const header = (subs, rules = AO5) =>
  lv.ownRoundStats(lv.attemptSlots(subs.filter((s) => s.uid === 'me'), rules), board(subs, rules), rules);

console.log('\n  -- own slots --');
{
  const slots = lv.attemptSlots(
    [
      sub('me', 1, 'approved', 1247),
      sub('me', 2, 'approved', 1306, { penalty: '+2' }),
      sub('me', 3, 'pending', 1188),
      sub('me', 4, 'rejected', 900),
    ],
    AO5,
  );
  eq('approved is a time', slots[0], { attempt: 1, state: 'time', timeCs: 1247 });
  eq('a judge +2 is applied', slots[1].timeCs, 1506);
  eq('pending is SUBMITTED and carries no time', slots[2], { attempt: 3, state: 'submitted', timeCs: null });
  eq('rejected is a DNF, never its reported time', slots[3], { attempt: 4, state: 'dnf', timeCs: null });
  eq('an unfiled slot is empty', slots[4], { attempt: 5, state: 'empty', timeCs: null });
  ok('no slot state other than "time" ever holds a number', slots.every((s) => (s.state === 'time') === (s.timeCs !== null)));

  const limited = lv.attemptSlots([sub('me', 1, 'approved', 5000)], { ...AO5, timeLimitCs: 4000 });
  eq('over the time limit is a DNF', limited[0].state, 'dnf');

  const rerun = lv.attemptSlots(
    [sub('me', 1, 'approved', 1000, { createdAt: 50 }), sub('me', 1, 'approved', 800, { createdAt: 10 })],
    AO5,
  );
  eq('first run counts: the oldest submission in a slot wins', rerun[0].timeCs, 800);
  eq('slots follow the format', lv.attemptSlots([], MO3).length, 3);
}

console.log('\n  -- standings: judged, as the qualifier ranking counts them --');
{
  const subs = [
    // a: full approved Ao5
    ...[1000, 1100, 1200, 1300, 1400].map((v, i) => sub('a', i + 1, 'approved', v)),
    // b: pending only — undecided, so not on the board
    sub('b', 1, 'pending', 500),
    // c: two approved, one pending
    sub('c', 1, 'approved', 1500),
    sub('c', 2, 'approved', 1600),
    sub('c', 3, 'pending', 100),
    // me: four approved and a judge's DNF on the fifth
    ...[1250, 1260, 1270, 1280].map((v, i) => sub('me', i + 1, 'approved', v)),
    sub('me', 5, 'rejected', 1),
    // d: a judge's DNF and nothing else
    sub('d', 1, 'rejected', 700),
  ];
  const rows = board(subs);

  eq('pending-only is not on the board; a judge DNF is', rows.map((r) => r.name), ['Бат', 'Ууганбаяр', 'Номин', 'Энхжин']);
  const a = rows[0];
  eq('a complete approved Ao5 has its result', [a.hasResult, a.value], [true, 1200]);
  eq('  ...and greys the best and worst', a.excluded.slice().sort(), [0, 4]);

  const me = rows.find((r) => r.isMe);
  eq('a judge DNF fills its slot as DNF', me.cells[4], 'DNF');
  // WCA: one DNF is the worst attempt, dropped. The mean of 1260/1270/1280.
  // This is the number collectRoundResults qualifies the athlete on.
  eq('  ...and the Ao5 is complete, with that DNF dropped as the worst', [me.hasResult, me.value], [true, 1270]);
  eq('  ...greying the DNF as the worst attempt', me.excluded.slice().sort(), [0, 4]);

  const c = rows.find((r) => r.name === 'Номин');
  eq('a pending slot is empty in the standings', c.cells, [1500, 1600, null, null, null]);
  ok('no pending reported time reaches any cell', rows.every((r) => !r.cells.includes(100) && !r.cells.includes(500)));
  ok('no rejected reported time reaches any cell', rows.every((r) => !r.cells.includes(700) && !r.cells.includes(1)));

  const d = rows.find((r) => r.name === 'Энхжин');
  eq('an athlete with only a judge DNF: a DNF cell, no single, last', [d.cells[0], d.best, d.rank], ['DNF', null, 4]);
  eq('ranks are 1..n', rows.map((r) => r.rank), [1, 2, 3, 4]);

  const slot = board([sub('a', 1, 'rejected', 900, { createdAt: 5 }), sub('a', 1, 'approved', 800, { createdAt: 9 })]);
  eq('first run counts across verdicts: an older judge DNF is not replaced by a re-run', slot[0].cells[0], 'DNF');
}

console.log('\n  -- standings: DNF results, ties, cutoffs --');
{
  const twoJudgeDnfs = [
    sub('d', 1, 'rejected', 900),
    sub('d', 2, 'approved', 900, { isDnf: true }),
    ...[1000, 1100, 1200].map((v, i) => sub('d', i + 3, 'approved', v)),
  ];
  const full = (uid, base) => [0, 1, 2, 3, 4].map((i) => sub(uid, i + 1, 'approved', base + i * 10));
  const rows = board([...twoJudgeDnfs, ...full('a', 2000), ...full('b', 2000)]);
  eq('a DNF average ranks below every rankable result', rows.map((r) => r.name), ['Бат', 'Солонго', 'Энхжин']);
  eq('  ...with a result that is a DNF', [rows[2].hasResult, rows[2].value], [true, null]);
  eq('identical result and single share a rank', rows.map((r) => r.rank), [1, 1, 3]);

  const CUT = { ...AO5, cutoffCs: 1000 };
  const cut = board([sub('a', 1, 'approved', 1500), sub('a', 2, 'rejected', 0), sub('a', 3, 'approved', 900)], CUT);
  eq('a missed cutoff (a judge DNF counts toward it) ends the round', [cut[0].hasResult, cut[0].cutOff, cut[0].value], [true, true, null]);
  eq('  ...and a redo past the phase is not shown', cut[0].cells, [1500, 'DNF', null, null, null]);
}

console.log('\n  -- the header numbers follow the standings row --');
{
  const s = header([sub('me', 1, 'approved', 1200), sub('me', 2, 'approved', 1300), sub('me', 3, 'pending', 1), sub('a', 1, 'approved', 900)]);
  eq('progress counts filed attempts, judged or not', [s.filed, s.attempts], [3, 5]);
  eq('a provisional average uses judged times, not pending ones', s.average, 1250);
  eq('rank is read off the board', [s.rank, s.ranked], [2, 2]);

  const complete = [...[1250, 1260, 1270, 1280].map((v, i) => sub('me', i + 1, 'approved', v)), sub('me', 5, 'rejected', 1)];
  const meRow = board(complete).find((r) => r.isMe);
  eq('a complete round with a judge DNF: the header shows the board’s result', header(complete).average, meRow.value);

  eq('one judge DNF so far in an Ao5: left out, as the worst will be',
    header([sub('me', 1, 'approved', 1200), sub('me', 2, 'rejected', 1), sub('me', 3, 'approved', 1300)]).average, 1250);
  eq('two judge DNFs in an Ao5 already make it a DNF',
    header([sub('me', 1, 'approved', 1200), sub('me', 2, 'rejected', 1), sub('me', 3, 'rejected', 1)]).average, 'DNF');
  eq('any judge DNF in a Mo3 already makes it a DNF',
    header([sub('me', 1, 'approved', 1200), sub('me', 2, 'rejected', 1)], MO3).average, 'DNF');
  eq('nothing judged: no average, no rank',
    [header([sub('me', 1, 'pending', 999)]).average, header([sub('me', 1, 'pending', 999)]).rank], [null, null]);

  const bo3 = header([sub('me', 1, 'approved', 1200), sub('me', 2, 'rejected', 1), sub('me', 3, 'approved', 1100)], BO3);
  eq('a bo-N round reports its best single, a judge DNF never being it', [bo3.averageKind, bo3.average], ['single', 1100]);
  eq('a cut-off Ao5 has no average in the header either',
    header([sub('me', 1, 'approved', 1500), sub('me', 2, 'rejected', 0)], { ...AO5, cutoffCs: 1000 }).average, null);
}

console.log('\n  -- round states --');
{
  const access = (reason, liveRound) => ({ liveRound, allowed: reason === 'ok', reason });
  const me = (reason, liveRound, planKind = 'fresh', canCompete = true) => ({ canCompete, access: access(reason, liveRound), planKind });
  const R = (round, status, qualified = null) => ({ round, status, qualified });

  eq('a done round is finished', lv.roundRowState(R(1, 'done'), me('no-live-round', null)), 'finished');
  eq('live and admitted: open', lv.roundRowState(R(1, 'live'), me('ok', 1)), 'open');
  eq('live and every attempt filed: open-done', lv.roundRowState(R(1, 'live'), me('ok', 1, 'complete')), 'open-done');
  eq('live but not qualified says so', lv.roundRowState(R(2, 'live', false), me('not-qualified', 2)), 'notqualified');
  eq('live, signed out: view only', lv.roundRowState(R(1, 'live'), null), 'open-view');
  eq('live, registration not approved: view only', lv.roundRowState(R(1, 'live'), me('ok', 1, 'fresh', false)), 'open-view');
  eq('closed, and the cut already excluded them', lv.roundRowState(R(3, 'closed', false), me('ok', 1)), 'notqualified');
  eq('closed otherwise: not open', lv.roundRowState(R(2, 'closed', true), me('ok', 1)), 'notopen');

  const payload = (overrides = {}) => ({
    competitionId: 'c',
    status: 'live',
    signedIn: true,
    registration: { status: 'approved', events: ['333', '222'] },
    events: [
      {
        eventId: '333', label: '3x3x3', format: 'ao5', attempts: 5,
        rounds: [R(1, 'live'), R(2, 'closed')],
        me: { registered: true, access: access('ok', 1), planKind: 'complete', nextAttempt: 6, slotsByRound: {} },
      },
      {
        eventId: '222', label: '2x2x2', format: 'ao5', attempts: 5,
        rounds: [R(1, 'live')],
        me: { registered: true, access: access('ok', 1), planKind: 'resume', nextAttempt: 3, slotsByRound: {} },
      },
    ],
    ...overrides,
  });
  eq('the current round prefers one the athlete can still start', lv.pickCurrentRound(payload()), { eventId: '222', round: 1 });
  const allDone = payload();
  allDone.events[1].me.planKind = 'complete';
  eq('  ...falling back to one they finished filing', lv.pickCurrentRound(allDone), { eventId: '333', round: 1 });
  eq('signed out: no current round', lv.pickCurrentRound(payload({ signedIn: false, registration: null, events: payload().events.map((e) => ({ ...e, me: null })) })), null);

  eq('idle: a finished competition says so first', lv.idleReason(payload({ status: 'finished', signedIn: false })), 'finished');
  eq('idle: signed out', lv.idleReason(payload({ signedIn: false })), 'signed-out');
  eq('idle: not registered', lv.idleReason(payload({ registration: null })), 'not-registered');
  eq('idle: registration under review', lv.idleReason(payload({ registration: { status: 'pending', events: ['333'] } })), 'gate');
  const upcoming = payload({ status: 'upcoming' });
  upcoming.events.forEach((e) => e.rounds.forEach((r) => { r.status = 'closed'; }));
  eq('idle: nothing opened on an upcoming competition', lv.idleReason(upcoming), 'not-started');
}

console.log('\n  -- the athlete’s own rounds --');
{
  const R = (round, status, qualified = null) => ({ round, status, qualified, label: `R${round}`, scheduledAt: null, standings: [] });
  const ev = (me, rounds) => ({ rounds, me });
  const mine = (registered) => ({ registered, access: null, planKind: null, nextAttempt: null, slotsByRound: {} });
  const reached = (e) => lv.roundsReached(e).map((r) => r.round);

  eq('signed out: nothing', reached(ev(null, [R(1, 'live')])), []);
  eq('not registered for the event: nothing', reached(ev(mine(false), [R(1, 'live'), R(2, 'closed', true)])), []);
  eq('registered: round 1, and no later round before the cut',
    reached(ev(mine(true), [R(1, 'live'), R(2, 'closed', null), R(3, 'closed', null)])), [1]);
  eq('qualified into round 2: listed', reached(ev(mine(true), [R(1, 'done'), R(2, 'live', true), R(3, 'closed', null)])), [1, 2]);
  eq('did not qualify: that round is not listed at all',
    reached(ev(mine(true), [R(1, 'done'), R(2, 'live', false)])), [1]);
  eq('a later round never skips an unreached one',
    reached(ev(mine(true), [R(1, 'done'), R(2, 'done', false), R(3, 'closed', true)])), [1]);
}

console.log('\n  -- schedule --');
{
  const start = new Date(2026, 8, 20, 10, 0).getTime();
  const starts = lv.scheduledRoundStarts(
    [
      { kind: 'other', durationMin: 30 },
      { kind: 'round', eventId: '333', round: 1, durationMin: 60 },
      { kind: 'round', eventId: '222', round: 1, durationMin: 30 },
    ],
    start,
  );
  eq('rounds get their accumulated start', [starts.get('333_1'), starts.get('222_1')], ['10:30', '11:30']);
  eq('no start time, no clock', lv.scheduledRoundStarts([{ kind: 'round', eventId: '333', round: 1, durationMin: 30 }], null).size, 0);
}

console.log('\n  -- the wiring --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const route = src('app/api/online-competition/competitions/[id]/live/route.ts');
  const JUDGED_QUERY = ".where('status', 'in', ['approved', 'rejected'])";
  ok('the standings query asks for judged submissions', route.includes(JUDGED_QUERY));
  ok('  ...the very set the qualifier ranking queries', src('lib/online-competition/round-results.ts').includes(JUDGED_QUERY));
  ok('the standings are built by the tested function', route.includes('rankJudgedStandings('));
  ok('own slots are built by the tested function', route.includes('attemptSlots('));
  ok('access comes from the solve gate itself', route.includes('resolveRoundAccess('));
  ok('the payload is never cached where another viewer could get it', route.includes("'Cache-Control': 'private, no-store'"));
  ok('no qualifier list is part of the payload shape', !src('lib/online-competition/live-view.ts').includes('uids'));

  const liveHref = /\/live[`'"]/;
  for (const rel of [
    'app/online-competition/_components/hub/v3/HubNav.tsx',
    'app/online-competition/_components/hub/v3/LiveMiniCard.tsx',
    'app/online-competition/dashboard/_components/LiveCard.tsx',
    'app/online-competition/[competitionId]/details/_components/StartRoundPanel.tsx',
  ]) {
    ok(`${path.basename(rel)} lands on the live view`, liveHref.test(src(rel)));
  }
  ok('the dashboard no longer drops straight into the solve flow',
    !src('app/online-competition/dashboard/_components/LiveCard.tsx').includes('/solve/'));
  ok('the solve flow is reached from the live view', src('app/online-competition/[competitionId]/live/_components/ui.tsx').includes('/solve/'));

  // ── the page ──
  const LIVE_DIR = 'app/online-competition/[competitionId]/live';
  const livePage = src(`${LIVE_DIR}/page.tsx`);
  const schedule = src(`${LIVE_DIR}/_components/SchedulePanel.tsx`);
  const theme = src('app/online-competition/theme.css');
  ok('the header banner is gone', !fs.existsSync(path.join(ROOT, LIVE_DIR, '_components/LiveHeader.tsx')) && !livePage.includes('LiveHeader'));
  ok('  ...its three numbers kept', livePage.includes('<LiveStats stats={derived.stats} />'));
  ok('the schedule lists only rounds the athlete reached', livePage.includes('return roundsReached(e)'));
  ok('  ...and is not rendered when that leaves nothing', livePage.includes('derived.scheduleItems.length > 0 && ('));
  ok('  ...and never labels a round they missed', !schedule.includes('ШАЛГАРААГҮЙ'));
  ok('the tab opens on ОРОЛДЛОГО', livePage.includes("useState<LiveTab>('attempts')"));
  ok('  ...and is held by the page, not by a child that remounts', livePage.includes('data-tab={tab}'));
  ok('the tabs exist only below 900px',
    /\.oc-live-tabs \{\s*display: none;/.test(theme) &&
      /@media \(max-width: 899px\) \{[\s\S]{0,400}?\.oc-live-tabs \{\s*display: flex;/.test(theme) &&
      theme.includes(".oc-live-grid[data-tab='attempts'] > .oc-live-col-standings"));

  // ── and back again ──
  const SOLVE = 'app/online-competition/[competitionId]/solve/[eventId]';
  const page = src(`${SOLVE}/page.tsx`);
  const sent = src(`${SOLVE}/_components/SentStage.tsx`);
  const LIVE = '`/online-competition/${competitionId}/live`';
  ok('the finished run returns to this competition’s live view', sent.includes(`href={${LIVE}}`));
  ok('  ...given the competition by the page', page.includes('<SentStage ao5={finalAo5} competitionId={competitionId} />'));
  ok('ГАРАХ returns there too', /function exitRun\(\) \{[\s\S]{0,300}?router\.push\(`\/online-competition\/\$\{competitionId\}\/live`\)/.test(page));
  ok('  ...and so does the refused-round screen', page.includes(`href={${LIVE}}`));
  const solveFiles = [`${SOLVE}/page.tsx`, ...fs.readdirSync(path.join(ROOT, SOLVE, '_components')).map((f) => `${SOLVE}/_components/${f}`)];
  ok('nothing in the solve flow still sends the athlete to the dashboard',
    solveFiles.every((f) => !src(f).includes('/online-competition/dashboard')));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
