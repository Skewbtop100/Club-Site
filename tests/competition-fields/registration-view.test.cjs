// ── Registration panel: derived state ───────────────────────────────────
// Pure unit tests for registration-view.ts: registrationWindow, feeView,
// profileGateCopy. No emulator, no Firestore, no React.
//
// Two groups carry weight:
//   THE WINDOW — "Бүртгэл хаагдах хүртэл төрлөө сольж болно" is a promise
//               about the deadline. Before this changeset the deadline did
//               nothing at all; these pin that it now closes the panel, at
//               the exact millisecond the header countdown says it does.
//   THE FEE    — the first caller of athleteFeeMnt. `paid` is the gate,
//               never baseFeeMnt being set: fee fields persist when an
//               admin switches a competition back to Төлбөргүй.
//
// Run: npm run test:registration

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-regview-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/registration-view.ts',
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

const { registrationWindow, feeView, profileGateCopy } = require(path.join(OUT, 'registration-view.js'));

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
const j = (v) => JSON.stringify(v);

const NOW = Date.UTC(2026, 2, 20, 12, 0);
const HOUR = 3_600_000;
const win = (status, deadline, now = NOW) => registrationWindow({ status, registrationDeadlineMs: deadline }, now);

console.log('\n  -- registrationWindow --');
eq('upcoming, deadline ahead: OPEN', j(win('upcoming', NOW + HOUR)), j({ open: true }));
eq('upcoming, deadline passed: CLOSED', j(win('upcoming', NOW - HOUR)), j({ open: false, reason: 'deadline-passed' }));
// The boundary matches the header countdown, which reads БҮРТГЭЛ ХААГДСАН
// from remaining <= 0 — so the two can never disagree.
eq('the deadline millisecond itself is CLOSED', win('upcoming', NOW).open, false);
eq('one millisecond before is still OPEN', win('upcoming', NOW + 1).open, true);
eq('finished: CLOSED even with a deadline ahead', j(win('finished', NOW + HOUR)), j({ open: false, reason: 'finished' }));
eq('finished with no deadline: CLOSED', win('finished', null).open, false);
eq('live, deadline passed (the normal case): CLOSED', win('live', NOW - HOUR).open, false);
// A deadline left unset is what the admin configured: no closing time.
eq('no deadline set, upcoming: OPEN', win('upcoming', null).open, true);
eq('no deadline set, live: OPEN', win('live', null).open, true);
eq('the same competition closes as the passed clock moves', win('upcoming', NOW + HOUR, NOW + 2 * HOUR).open, false);

console.log('\n  -- feeView: free competitions show NOTHING --');
const EVENTS = [
  { eventId: '333', label: '3x3x3', surchargeMnt: null },
  { eventId: '222', label: '2x2x2', surchargeMnt: null },
  { eventId: '444', label: '4x4x4', surchargeMnt: 6000 },
  { eventId: '555', label: '5x5x5', surchargeMnt: 4000 },
];
eq('Төлбөргүй: nothing', j(feeView(false, 15000, EVENTS, ['444'])), j({ show: false }));
// The fee fields persist when the toggle is switched off, so a stored
// amount on a FREE competition must not surface.
eq('Төлбөргүй with a leftover base fee: still nothing', feeView(false, 15000, EVENTS, []).show, false);

console.log('\n  -- feeView: the total follows the selection --');
{
  const f = feeView(true, 15000, EVENTS, ['333', '222']);
  eq('included events only: the base alone', f.totalMnt, 15000);
  eq('  ...formatted', f.total, '15 000₮');
  eq('  ...breakdown says they are included', f.breakdown, 'Суурь 15 000₮ · сонгосон төрлүүд суурьд багтсан');
}
{
  const f = feeView(true, 15000, EVENTS, ['333', '444']);
  eq('one surcharged event: base + surcharge', f.totalMnt, 21000);
  eq('  ...formatted', f.total, '21 000₮');
  eq('  ...breakdown names ONLY what costs extra', f.breakdown, 'Суурь 15 000₮ · 4x4x4 +6 000₮');
}
{
  const f = feeView(true, 15000, EVENTS, ['333', '222', '444', '555']);
  eq('every event: base + every surcharge', f.totalMnt, 25000);
  eq('  ...breakdown lists both surcharges in event order', f.breakdown, 'Суурь 15 000₮ · 4x4x4 +6 000₮ · 5x5x5 +4 000₮');
}
{
  // Ticking a box changes the number — the same competition, two selections.
  const before = feeView(true, 15000, EVENTS, ['333']).totalMnt;
  const after = feeView(true, 15000, EVENTS, ['333', '555']).totalMnt;
  eq('ticking a surcharged event raises the total by its surcharge', after - before, 4000);
}
eq('nothing selected yet: the base (registering is what it buys)', feeView(true, 15000, EVENTS, []).totalMnt, 15000);
eq('a base of 0 with a surcharge: the surcharge alone', feeView(true, 0, EVENTS, ['444']).totalMnt, 6000);
eq('an event no longer configured is not charged', feeView(true, 15000, EVENTS, ['333', 'gone']).totalMnt, 15000);
{
  const f = feeView(true, null, EVENTS, ['444']);
  eq('paid with NO base fee set: no number shown', f.totalMnt, null);
  eq('  ...says so instead', f.note, 'Хураамжийн дүн удахгүй зарлагдана.');
}

console.log('\n  -- profileGateCopy: three states, three messages --');
{
  const inc = profileGateCopy('incomplete', null);
  const pen = profileGateCopy('pending', null);
  const rej = profileGateCopy('rejected', null);
  ok('the three titles are all different', new Set([inc.title, pen.title, rej.title]).size === 3);
  eq('incomplete: sent to fill the profile', inc.action, 'Профайл бөглөх →');
  // The old single message told a PENDING athlete to fill it in again.
  eq('pending: nothing to do but wait — NO action', pen.action, null);
  ok('pending: says it is being reviewed', /шалгаж/.test(pen.body), pen.body);
  eq('rejected: sent to fix the profile', rej.action, 'Профайл засах →');
}
ok('rejected WITH a reason shows it', /Зураг тод биш/.test(profileGateCopy('rejected', 'Зураг тод биш').body));
eq('rejected with a blank reason does not print "Шалтгаан: ."',
  /Шалтгаан/.test(profileGateCopy('rejected', '   ').body), false);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
