// ── Mobile bottom navigation ─────────────────────────────────────────────
// REAL unit tests for active-competition.ts (pure — where ОРОЛДЛОГО goes),
// plus source checks on the bar, the header and the mobile CSS.
//
// Run: npm run test:bottomnav

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-bottomnav-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/active-competition.ts',
    '--outDir', path.basename(OUT),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
const { pickAttemptsTarget, DASHBOARD_HREF, liveViewHref } = require(path.join(OUT, 'active-competition.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}
// Line endings normalised: the CSS assertions match multi-line rules, and a
// CRLF checkout must not fail them.
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const c = (id, over = {}) => ({ competitionId: id, startAtMs: 1000, events: ['333'], liveRounds: { 333: null }, ...over });

console.log('\n  -- where ОРОЛДЛОГО goes --');
{
  const t = pickAttemptsTarget([c('a', { liveRounds: { 333: 1 } })]);
  ok('a round open for a registered event: ACTIVE, to that live view',
    t.kind === 'active' && t.href === liveViewHref('a') && t.href === '/online-competition/a/live', JSON.stringify(t));
}
{
  const t = pickAttemptsTarget([c('late', { startAtMs: 5000, liveRounds: { 333: 2 } }), c('early', { startAtMs: 1000, liveRounds: { 333: 1 } })]);
  ok('several active: the one that started first', t.kind === 'active' && t.competitionId === 'early', JSON.stringify(t));
}
{
  const t = pickAttemptsTarget([c('idle'), c('open', { startAtMs: 9000, liveRounds: { 333: 1 } })]);
  ok('an active competition wins over an earlier one with nothing open', t.kind === 'active' && t.competitionId === 'open');
}
{
  const t = pickAttemptsTarget([c('x', { events: ['222'], liveRounds: { 333: 1, 222: null } })]);
  ok('a round open only for an event they did NOT register for is not active',
    t.kind === 'live-no-round' && t.href === liveViewHref('x'), JSON.stringify(t));
}
{
  const t = pickAttemptsTarget([c('x')]);
  ok('approved for a live competition, no round open: routed to its live view, not lit',
    t.kind === 'live-no-round' && t.href === liveViewHref('x'));
}
{
  const t = pickAttemptsTarget([c('x', { liveRounds: null })]);
  ok('the gate could not be read: routed to the live view, never shown as active', t.kind === 'live-no-round');
}
{
  const t = pickAttemptsTarget([]);
  ok('nothing live: routed to the dashboard, not disabled', t.kind === 'none' && t.href === DASHBOARD_HREF);
}

console.log('\n  -- the data behind it --');
{
  const hook = src('app/online-competition/_components/hub/v3/useAttemptsTarget.ts');
  ok('only APPROVED registrations count', hook.includes('.filter((r) => isCompetingRegistration(r.status))'));
  ok('  ...for LIVE competitions', hook.includes("j.competition?.status === 'live'"));
  ok('  ...asking the same round-access gate the solve route enforces with', hook.includes('/api/online-competition/round-access?competitionId='));
  ok('  ...decided by pickAttemptsTarget', hook.includes('return pickAttemptsTarget(candidates);'));
}

console.log('\n  -- the bar --');
const bar = src('app/online-competition/_components/hub/v3/BottomNav.tsx');
{
  const order = ['label="НҮҮР"', 'label="ТЭМЦЭЭН"', 'label="ОРОЛДЛОГО"', '>МЭДЭГДЭЛ<'].map((s) => bar.indexOf(s));
  ok('four items, left to right: НҮҮР, ТЭМЦЭЭН, ОРОЛДЛОГО, МЭДЭГДЭЛ',
    order.every((i) => i > -1) && order.every((i, k) => k === 0 || i > order[k - 1]), order.join(','));
  ok('НҮҮР -> home, ТЭМЦЭЭН -> the competitions list',
    bar.includes("const HUB = '/online-competition';") && bar.includes("const COMPETITIONS = '/online-competition/competitions';"));
  ok('ОРОЛДЛОГО -> the resolved target', bar.includes('href={target.href}'));
  ok('МЭДЭГДЭЛ carries the unread count as a badge', bar.includes('{unread > 0 && <UnreadBadge count={unread}'));
  ok('  ...and opens the same list the bell shows', bar.includes('<NotificationList uid={uid} items={notifications}'));
  ok('fixed to the bottom, padded for the home indicator',
    bar.includes("position: 'fixed'") && bar.includes('bottom: 0,') && bar.includes("paddingBottom: 'env(safe-area-inset-bottom, 0px)'"));
  ok('the current item is marked (aria-current + volt line)', bar.includes("aria-current={current ? 'page' : undefined}") && bar.includes('<Indicator on={current} />'));
}

console.log('\n  -- the header and the CSS --');
{
  const nav = src('app/online-competition/_components/hub/v3/HubNav.tsx');
  ok('the header renders the bar', nav.includes('<BottomNav'));
  ok('  ...with one notification subscription shared by bell and bar',
    nav.includes('useNotifications(') && nav.includes('items={notifications}') && nav.includes('notifications={notifications}'));
  const bell = src('app/online-competition/_components/hub/v3/NotificationBell.tsx');
  ok('  ...the bell no longer subscribes on its own', !/export default function NotificationBell[\s\S]*subscribeToNotifications\(uid/.test(bell.slice(bell.indexOf('export default function NotificationBell'))));

  const css = src('app/online-competition/theme.css');
  const base = css.indexOf('.oc-v3-bottomnav {\n  display: none;\n}');
  const mobile = css.slice(css.indexOf('/* ── Bottom navigation replaces the tab strip'), css.indexOf('/* ── Touch targets'));
  ok('DESKTOP: the bar is display:none outside any media query', base > -1);
  ok('MOBILE (640px): the bar shows, the tab strip and bell go',
    mobile.includes('.oc-v3-bottomnav {\n    display: grid;') && /\.oc-v3-tabs,\s*\.oc-v3-nav-bell \{\s*display: none;/.test(mobile));
  ok('  ...inside the header\'s existing 640px block',
    css.lastIndexOf('@media (max-width: 640px) {', css.indexOf('/* ── Bottom navigation replaces the tab strip')) > css.indexOf('.oc-v3-nav-auth {'));
  ok('  ...the avatar is round', /\.oc-v3-userbtn \.oc-v3-avatar \{[^}]*border-radius: 50%/.test(mobile));
  ok('  ...content is padded clear of the bar and the home indicator',
    mobile.includes('padding-bottom: calc(61px + env(safe-area-inset-bottom, 0px));'));

  const solve = src('app/online-competition/[competitionId]/solve/[eventId]/page.tsx');
  ok('THE SOLVE PAGE has no header and so no bar', !solve.includes('HubNav') && !solve.includes('BottomNav'));
  ok('the live view marks ОРОЛДЛОГО', src('app/online-competition/[competitionId]/live/page.tsx').includes('section="attempts"'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
