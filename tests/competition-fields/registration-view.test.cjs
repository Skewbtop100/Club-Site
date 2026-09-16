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

const {
  registrationWindow,
  feeView,
  profileGateCopy,
  verificationNoticeCopy,
  registrationStatusCopy,
  competeGateCopy,
  opensInLabel,
  fmtRegistrationMoment,
  registrationClosedCopy,
} = require(path.join(OUT, 'registration-view.js'));

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
const DAY = 24 * HOUR;
const win = (status, opens, deadline, now = NOW) =>
  registrationWindow({ status, registrationOpensAtMs: opens, registrationDeadlineMs: deadline }, now);

console.log('\n  -- registrationWindow: the same rule firestore.rules enforce --');
eq('upcoming, inside the window: OPEN', j(win('upcoming', NOW - HOUR, NOW + HOUR)), j({ open: true }));
eq('live, inside the window: OPEN', win('live', NOW - HOUR, NOW + HOUR).open, true);
eq('BEFORE the opening time: not yet open, with when',
  j(win('upcoming', NOW + HOUR, NOW + DAY)), j({ open: false, reason: 'not-yet-open', opensAtMs: NOW + HOUR }));
eq('the opening millisecond itself is OPEN', win('upcoming', NOW, NOW + DAY).open, true);
eq('one millisecond before opening is still closed', win('upcoming', NOW + 1, NOW + DAY).open, false);
eq('AFTER the deadline: CLOSED', j(win('upcoming', NOW - DAY, NOW - HOUR)), j({ open: false, reason: 'deadline-passed' }));
// The boundary matches the header countdown, which reads БҮРТГЭЛ ХААГДСАН
// from remaining <= 0 — so the two can never disagree.
eq('the deadline millisecond itself is CLOSED', win('upcoming', NOW - DAY, NOW).open, false);
eq('one millisecond before the deadline is still OPEN', win('upcoming', NOW - DAY, NOW + 1).open, true);
eq('finished: CLOSED even inside the window', j(win('finished', NOW - HOUR, NOW + HOUR)), j({ open: false, reason: 'finished' }));
eq('draft: CLOSED even inside the window', j(win('draft', NOW - HOUR, NOW + HOUR)), j({ open: false, reason: 'not-public' }));
// Fail closed: an unset time is no longer "no limit".
eq('no opening time: CLOSED', j(win('upcoming', null, NOW + DAY)), j({ open: false, reason: 'no-window' }));
eq('no deadline: CLOSED', j(win('upcoming', NOW - DAY, null)), j({ open: false, reason: 'no-window' }));
eq('neither: CLOSED', win('live', null, null).open, false);
eq('opening after the deadline (misconfigured): CLOSED as passed', win('upcoming', NOW + HOUR, NOW - HOUR).open, false);
eq('the same competition opens as the passed clock moves', win('upcoming', NOW + HOUR, NOW + DAY, NOW + 2 * HOUR).open, true);

console.log('\n  -- the countdown and the closed copy --');
eq('countdown inside the last day', opensInLabel(3 * HOUR + 14 * 60_000 + 9_000), '03:14:09');
eq('countdown with days', opensInLabel(2 * DAY + 3 * HOUR + 14 * 60_000 + 9_000), '2 ӨДӨР 03:14:09');
eq('rounded UP: never 00:00:00 while still closed', opensInLabel(1), '00:00:01');
eq('nothing left', opensInLabel(-5), '00:00:00');
{
  const at = new Date(2026, 8, 16, 23, 0).getTime();
  eq('the opening moment, in the viewer\'s zone', fmtRegistrationMoment(at), '2026.09.16 23:00');
  const c = registrationClosedCopy({ open: false, reason: 'not-yet-open', opensAtMs: at });
  eq('not yet open: when it opens', c.body, 'Бүртгэл 2026.09.16 23:00-д нээгдэнэ.');
  eq('  ...title', c.title, 'Бүртгэл нээгдээгүй');
}
eq('after the deadline: the existing closed wording',
  j(registrationClosedCopy({ open: false, reason: 'deadline-passed' })),
  j({ title: 'Бүртгэл хаагдсан', body: 'Бүртгэлийн хугацаа дууссан.', savedLine: 'Бүртгэлийн хугацаа дууссан. Сонголтоо өөрчлөх боломжгүй.' }));
eq('finished: the existing closed wording', registrationClosedCopy({ open: false, reason: 'finished' }).body, 'Тэмцээн дууссан тул бүртгэл хаагдсан.');
{
  const panel = fs.readFileSync(path.join(ROOT, 'app/online-competition/[competitionId]/details/_components/RegistrationPanel.tsx'), 'utf8');
  ok('the panel passes the opening time into the window', panel.includes('registrationOpensAtMs: opensAtMs'));
  ok('  ...ticks every second while counting down', panel.includes('countingDown ? COUNTDOWN_TICK_MS : WINDOW_TICK_MS') && panel.includes('const COUNTDOWN_TICK_MS = 1_000;'));
  ok('  ...shows a DISABLED register button with the countdown',
    /disabled\s+aria-label=\{copy\.body\}[\s\S]{0,120}НЭЭГДЭХЭД \{opensInLabel\(regWindow\.opensAtMs - now\)\}/.test(panel));
  ok('  ...re-checks the window against the clock at save', panel.includes('registrationWindow(windowInput, Date.now())'));
}

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
  ok('the three actions are all different', new Set([inc.action, pen.action, rej.action]).size === 3);
  eq('incomplete: sent to fill the profile', inc.action, 'Профайл бөглөх →');
  // This was `null` — "nothing to do but wait" — which left the gate with no
  // way out and was part of why an unverified athlete read the page as
  // broken. A pending athlete still has nothing to FIX, so the label is
  // харах and not засах, but they can now reach what they submitted.
  eq('pending: a way to SEE the submission, not to redo it', pen.action, 'Профайл харах →');
  ok('pending: says it is being reviewed', /шалгаж/.test(pen.body), pen.body);
  eq('rejected: sent to fix the profile', rej.action, 'Профайл засах →');
  ok(
    'rejected: carries the admin reason',
    /Шалтгаан: Царай/.test(profileGateCopy('rejected', 'Царай харагдахгүй').body),
    profileGateCopy('rejected', 'Царай харагдахгүй').body,
  );
}

console.log('\n  -- verificationNoticeCopy: the standing notice --');
{
  const inc = verificationNoticeCopy('incomplete', null);
  const pen = verificationNoticeCopy('pending', null);
  const rej = verificationNoticeCopy('rejected', 'Царай харагдахгүй');
  ok('the three labels are all different', new Set([inc.label, pen.label, rej.label]).size === 3);
  ok('the three bodies are all different', new Set([inc.body, pen.body, rej.body]).size === 3);
  // THE POINT OF THE NOTICE: every state says what it PREVENTS. An athlete
  // reading "your profile is being reviewed" must not have to work out for
  // themselves that it also means they cannot enter a competition yet.
  const states = [['incomplete', inc], ['pending', pen], ['rejected', rej]];
  for (const [name, c] of states) {
    ok(`${name}: names the consequence`, /бүртгүүлэх боломжгүй/.test(c.body), c.body);
    // ONE SENTENCE FOR BOTH GATES: the practice page renders this same copy,
    // so it has to name both things verification unlocks.
    ok(`${name}: names practice too`, /туршилт хийх/.test(c.body), c.body);
    ok(`${name}: offers a route to the form`, typeof c.action === 'string' && c.action.length > 0, c.action);
  }
  ok('rejected: carries the admin reason', /Царай харагдахгүй/.test(rej.body), rej.body);
  ok(
    'rejected with no reason still says what to do',
    /дахин илгээнэ үү/.test(verificationNoticeCopy('rejected', null).body),
    verificationNoticeCopy('rejected', null).body,
  );
}
ok('rejected WITH a reason shows it', /Зураг тод биш/.test(profileGateCopy('rejected', 'Зураг тод биш').body));
eq('rejected with a blank reason does not print "Шалтгаан: ."',
  /Шалтгаан/.test(profileGateCopy('rejected', '   ').body), false);

console.log('\n  -- registrationStatusCopy: what the athlete is told --');
{
  const pending = registrationStatusCopy('pending');
  eq('pending, in full: a REQUEST was sent', pending.headline, 'ТА БҮРТГҮҮЛЭХ ХҮСЭЛТ ИЛГЭЭСЭН');
  eq('  ...its badge, the short form', `${pending.label} · ${pending.detail}`, 'ХҮСЭЛТ ИЛГЭЭСЭН · Зохион байгуулагч хянаж байна');
  eq('pending: amber', pending.tone, 'amber');
  const approved = registrationStatusCopy('approved');
  eq('approved, in full', approved.headline, 'БҮРТГЭЛ БАТАЛГААЖСАН');
  eq('  ...and on the badge, green, no detail', `${approved.label}|${approved.detail}|${approved.tone}`, 'БҮРТГЭЛ БАТАЛГААЖСАН|null|green');
  eq('waitlisted: amber', registrationStatusCopy('waitlisted').tone, 'amber');
  // No notification mechanism exists, so the copy must not promise one.
  ok('waitlisted copy promises no notification', !/мэдэгдэ/.test(registrationStatusCopy('waitlisted').detail));
  eq('rejected: red', registrationStatusCopy('rejected').tone, 'red');
  eq('cancelled: muted', registrationStatusCopy('cancelled').tone, 'muted');
}
{
  // An edit never changes the status, so editing a cancelled or rejected
  // registration would change nothing that matters.
  const can = (s) => registrationStatusCopy(s).canEdit;
  eq('pending, waitlisted and approved can edit', [can('pending'), can('waitlisted'), can('approved')].join(','), 'true,true,true');
  eq('cancelled and rejected cannot', [can('cancelled'), can('rejected')].join(','), 'false,false');
}
{
  const all = ['pending', 'waitlisted', 'approved', 'cancelled', 'rejected'];
  const labels = all.map((s) => registrationStatusCopy(s).label);
  ok('all five labels are distinct', new Set(labels).size === 5, labels.join(' / '));
  const headlines = all.map((s) => registrationStatusCopy(s).headline);
  ok('all five headlines are distinct', new Set(headlines).size === 5, headlines.join(' / '));
  ok('no status is worded "ТА БҮРТГҮҮЛСЭН" or "ТА ОРОЛЦОЖ БАЙНА"',
    [...labels, ...headlines].every((w) => w !== 'ТА БҮРТГҮҮЛСЭН' && w !== 'ТА ОРОЛЦОЖ БАЙНА' && w !== 'БҮРТГҮҮЛСЭН'));
  ok('only APPROVED says БАТАЛГААЖСАН', all.every((s) => /БАТАЛГААЖСАН/.test(registrationStatusCopy(s).headline) === (s === 'approved')));
}

console.log('\n  -- the wording on screen --');
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
  const panel = read('app/online-competition/[competitionId]/details/_components/RegistrationPanel.tsx');
  const banner = read('app/online-competition/[competitionId]/details/_components/StartRoundPanel.tsx');
  const hub = read('app/online-competition/_components/hub/v3/MyCompetitions.tsx');
  ok('the event picker reads ОРОЛЦОХ ТӨРӨЛ', panel.includes('<span className="oc-rp-label">ОРОЛЦОХ ТӨРӨЛ</span>') && !panel.includes('ЯМАР ТӨРӨЛД ОРОХ'));
  ok('the note is headed ТАЙЛБАР alone', /htmlFor="oc-rp-note">\s*ТАЙЛБАР\s*<\/label>/.test(panel) && !panel.includes('СОНГОЛТТОЙ'));
  ok('  ...and its textarea has no placeholder', !/<textarea[^>]*placeholder=/.test(panel) && !panel.includes('Зохион байгуулагчид хүргэх'));
  // Code, not prose: the comments quote the old wording to say why it went.
  const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the panel heading is the status headline, ticked only when approved',
    panel.includes('{heading.headline}') && panel.includes("{status === 'approved' && <span aria-hidden>✓ </span>}") &&
      !code(panel).includes('ТА БҮРТГҮҮЛСЭН'));
  ok('the panel says nothing about starting while pending', panel.includes("{status !== 'pending' && ("));
  ok('the banner heading is the status headline',
    banner.includes('{registrationStatusCopy(registration.status).headline}') && !code(banner).includes('ТА ОРОЛЦОЖ БАЙНА'));
  ok('  ...pending: the requested events, not the "cannot start" message',
    /registration\.status === 'pending' \? \([\s\S]{0,700}mine\.map[\s\S]{0,400}\) : gate \? \(\s*<p className="oc-cd-start-note">\{gate\.message\}<\/p>/.test(banner));
  ok('the hub row no longer says БҮРТГҮҮЛСЭН; its heading is Миний тэмцээнүүд',
    !hub.includes("label: 'БҮРТГҮҮЛСЭН'") && hub.includes('<span className="oc-v3-label">Миний тэмцээнүүд</span>'));
  const css = read('app/online-competition/theme.css');
  ok('a long status badge wraps below the sidebar label instead of covering it',
    /\.oc-cd-side-item \{[^}]*flex-wrap: wrap;/.test(css) && /\.oc-cd-side-label \{[^}]*flex: 1 0 auto;/.test(css));
}

console.log('\n  -- competeGateCopy: who may start solving (D7) --');
// APPROVED ONLY. This is the single answer the dashboard's Эхлүүлэх
// button, the upcoming card's reminder line and the panel's "the button
// will open" promise all read — so the three cannot contradict each other.
eq('approved: NO gate, the button appears', competeGateCopy('approved'), null);
for (const s of ['pending', 'waitlisted', 'cancelled', 'rejected']) {
  ok(`${s}: gated — no start button`, competeGateCopy(s) !== null);
}
{
  const g = (s) => competeGateCopy(s);
  // The row chip is the status badge's own word: the badge above it and
  // the chip in the button's place must not say different things.
  for (const s of ['pending', 'waitlisted', 'cancelled', 'rejected']) {
    eq(`${s}: the chip is the status label`, g(s).label, registrationStatusCopy(s).label);
  }
  const messages = ['pending', 'waitlisted', 'cancelled', 'rejected'].map((s) => g(s).message);
  ok('all four reasons are different', new Set(messages).size === 4, messages.join(' / '));
  // A pending athlete must be told it is the REVIEW, not a fault of
  // theirs and not a bug.
  ok('pending names the review', /хянаж/.test(g('pending').message), g('pending').message);
  ok('waitlisted names the place opening up', /Орон тоо/.test(g('waitlisted').message), g('waitlisted').message);
  // Cancelled and rejected are final: they must not suggest waiting for
  // something that is not coming.
  for (const s of ['cancelled', 'rejected']) {
    ok(`${s} does not promise a button later`, !/нээгдэнэ/.test(g(s).message), g(s).message);
  }
  // No mechanism notifies anyone — the copy must not claim one.
  ok('no reason promises a notification',
    messages.every((m) => !/мэдэгдэ|сануулга/.test(m)), messages.join(' / '));
}
// The gate and the edit button are separate questions: a pending athlete
// may still change their events, they just may not solve.
ok('pending: gated from solving but still allowed to edit',
  competeGateCopy('pending') !== null && registrationStatusCopy('pending').canEdit === true);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
