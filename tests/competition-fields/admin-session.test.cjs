// ── The judges' admin session ───────────────────────────────────────────
// REAL unit tests — admin-session.ts and the decision half of
// admin-login-limit.ts are pure.
//
// THE HOLE THIS PINS: the admin cookie used to hold the literal 'true' and
// the check was `value === 'true'`, so anyone could set it and pass every
// admin route. A forged cookie, an expired token and a tampered token must
// all be refused; a genuine one accepted; and a missing secret must refuse
// everything.
//
// The source assertions at the end pin the wiring: every admin route goes
// through isOnlineCompAdmin, which goes through verifyAdminSession.
//
// Run: npm run test:adminsession

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-adminsession-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/admin-session.ts',
    'lib/online-competition/admin-login-limit.ts',
    '--outDir', path.basename(OUT),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--strict',
    '--skipLibCheck',
    '--esModuleInterop',
    '--types', 'node',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

const s = require(path.join(OUT, 'admin-session.js'));
const lim = require(path.join(OUT, 'admin-login-limit.js'));

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

const SECRET = 'x'.repeat(40);
const PASSWORD = 'judges-password';
const env = (over = {}) => ({ ONLINE_COMP_ADMIN_SESSION_SECRET: SECRET, ONLINE_COMP_ADMIN_PASSWORD: PASSWORD, ...over });
const NOW = Date.UTC(2026, 8, 15, 4, 0);
const HOUR = 3_600_000;
const TTL = s.ADMIN_SESSION_TTL_MS;

console.log('\n  -- configuration fails closed --');
{
  eq('no secret: no config', s.adminSessionConfig(env({ ONLINE_COMP_ADMIN_SESSION_SECRET: undefined })), null);
  eq('empty secret: no config', s.adminSessionConfig(env({ ONLINE_COMP_ADMIN_SESSION_SECRET: '' })), null);
  eq('a 31-character secret: no config', s.adminSessionConfig(env({ ONLINE_COMP_ADMIN_SESSION_SECRET: 'y'.repeat(31) })), null);
  eq('no password: no config', s.adminSessionConfig(env({ ONLINE_COMP_ADMIN_PASSWORD: undefined })), null);
  ok('a 32-character secret and a password: a config', s.adminSessionConfig(env({ ONLINE_COMP_ADMIN_SESSION_SECRET: 'z'.repeat(32) })) !== null);
  eq('the variable name', s.ADMIN_SESSION_SECRET_ENV, 'ONLINE_COMP_ADMIN_SESSION_SECRET');

  const genuine = s.signAdminSession(s.adminSessionConfig(env()), NOW);
  ok('a genuine token is refused when the config is missing', s.verifyAdminSession(genuine, null, NOW) === false);
}

console.log('\n  -- forged, expired, tampered: refused --');
{
  const config = s.adminSessionConfig(env());
  const token = s.signAdminSession(config, NOW);

  ok('THE OLD FORGERY: the literal "true" is refused', s.verifyAdminSession('true', config, NOW) === false);
  for (const junk of ['', 'false', '1', 'admin', 'v1', 'v1...', undefined, null, 42, {}, 'v1.' + 'a'.repeat(200)]) {
    ok(`  ...and so is ${JSON.stringify(junk)}`, s.verifyAdminSession(junk, config, NOW) === false);
  }

  ok('a valid token is ACCEPTED', s.verifyAdminSession(token, config, NOW) === true);
  ok('  ...until a millisecond before it expires', s.verifyAdminSession(token, config, NOW + TTL - 1) === true);
  ok('an EXPIRED token is refused, at the expiry instant', s.verifyAdminSession(token, config, NOW + TTL) === false);
  ok('  ...and after it', s.verifyAdminSession(token, config, NOW + TTL + HOUR) === false);

  const [v, exp, nonce, sig] = token.split('.');
  ok('the token is version.expiry.nonce.signature', v === 'v1' && Number(exp) === NOW + TTL && nonce.length === 22 && sig.length === 43);
  const flip = (str, i) => str.slice(0, i) + (str[i] === 'A' ? 'B' : 'A') + str.slice(i + 1);
  ok('a changed signature is refused', s.verifyAdminSession(`${v}.${exp}.${nonce}.${flip(sig, 5)}`, config, NOW) === false);
  ok('an extended expiry with the old signature is refused',
    s.verifyAdminSession(`${v}.${Number(exp) + HOUR}.${nonce}.${sig}`, config, NOW + TTL + 1) === false);
  ok('a changed nonce is refused', s.verifyAdminSession(`${v}.${exp}.${flip(nonce, 0)}.${sig}`, config, NOW) === false);

  const otherSecret = s.adminSessionConfig(env({ ONLINE_COMP_ADMIN_SESSION_SECRET: 'q'.repeat(40) }));
  ok('a token signed with another secret is refused', s.verifyAdminSession(s.signAdminSession(otherSecret, NOW), config, NOW) === false);
  const newPassword = s.adminSessionConfig(env({ ONLINE_COMP_ADMIN_PASSWORD: 'rotated' }));
  ok('changing the password invalidates existing sessions', s.verifyAdminSession(token, newPassword, NOW) === false);
  ok('a genuinely signed token with an expiry this server never issues is refused',
    s.verifyAdminSession(s.signAdminSession(config, NOW, 30 * 24 * HOUR), config, NOW) === false);
  ok('two tokens issued at the same instant differ', s.signAdminSession(config, NOW) !== s.signAdminSession(config, NOW));
}

console.log('\n  -- constant-time password comparison --');
{
  ok('the right password matches', s.passwordMatches(PASSWORD, PASSWORD) === true);
  ok('a wrong password does not', s.passwordMatches('judges-passworD', PASSWORD) === false);
  ok('a prefix does not', s.passwordMatches('judges', PASSWORD) === false);
  ok('a longer string does not', s.passwordMatches(PASSWORD + 'x', PASSWORD) === false);
  ok('a non-string does not', s.passwordMatches(undefined, PASSWORD) === false && s.passwordMatches(123, PASSWORD) === false);
  ok('nothing matches an unset password', s.passwordMatches('', '') === false && s.passwordMatches('x', undefined) === false);
  const src = fs.readFileSync(path.join(ROOT, 'lib/online-competition/admin-session.ts'), 'utf8');
  ok('  ...compared with timingSafeEqual over fixed-length hashes',
    /function passwordMatches[\s\S]{0,500}?createHash\('sha256'\)[\s\S]{0,200}?timingSafeEqual\(a, b\)/.test(src));
}

console.log('\n  -- cookie attributes --');
eq('httpOnly, secure, sameSite strict, whole site', s.ADMIN_COOKIE_OPTIONS, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });

console.log('\n  -- the login rate limit --');
{
  let w = null;
  const outcomes = [];
  for (let i = 0; i < 6; i++) {
    const d = lim.decideLoginAttempt(w, NOW + i * 1000);
    outcomes.push(d.allowed);
    if (d.allowed) w = d.next;
  }
  eq('five attempts are allowed, the sixth is not', outcomes, [true, true, true, true, true, false]);
  const denied = lim.decideLoginAttempt(w, NOW + 10_000);
  eq('  ...denial says how long is left', denied.retryAfterMs, lim.LOGIN_WINDOW_MS - 10_000);
  eq('  ...and does not extend the window', denied.next, w);
  const later = lim.decideLoginAttempt(w, NOW + lim.LOGIN_WINDOW_MS);
  eq('once the window has passed, a fresh one starts', [later.allowed, later.next.count], [true, 1]);
  eq('a corrupt stored counter is a fresh window, not a crash', lim.decideLoginAttempt({ count: NaN, windowStartMs: NaN }, NOW).allowed, true);

  eq('IPv4 as-is', lim.normalizeAddress('203.0.113.7'), '203.0.113.7');
  eq('IPv4-mapped IPv6 is its IPv4', lim.normalizeAddress('::ffff:203.0.113.7'), '203.0.113.7');
  eq('IPv6 is bucketed by /64', lim.normalizeAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  eq('  ...compressed forms land in the same bucket', lim.normalizeAddress('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64');
  eq('garbage is one shared bucket', lim.normalizeAddress('not-an-ip'), 'unknown');
  const h = (o) => new Headers(o);
  eq('x-real-ip first', lim.clientAddress(h({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.9' })), '198.51.100.1');
  eq('then the first x-forwarded-for entry', lim.clientAddress(h({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9');
  ok('the stored key is a hash, never the address', !lim.attemptDocId('203.0.113.7').includes('203') && lim.attemptDocId('203.0.113.7').length === 64);
}

console.log('\n  -- the wiring --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const auth = src('lib/online-competition/admin-auth.ts');
  ok('isOnlineCompAdmin verifies the signed token', auth.includes('verifyAdminSession(store.get(ADMIN_COOKIE_NAME)?.value, config, Date.now())'));
  ok('  ...refuses before reading the cookie when the config is missing', /if \(!config\) return false;[\s\S]*cookies\(\)/.test(auth));
  ok('  ...and no longer compares against a fixed value', !auth.includes("'true'"));

  const login = src('app/api/online-competition/admin-auth/route.ts');
  ok('login refuses with no signing config, before anything else', login.indexOf('if (!config)') < login.indexOf('reserveLoginAttempt('));
  ok('login reserves a rate-limit slot before comparing the password', login.indexOf('reserveLoginAttempt(') < login.indexOf('passwordMatches('));
  ok('  ...and refuses when the limiter cannot be reached', /catch \(e\) \{[\s\S]{0,200}?status: 503/.test(login));
  ok('login issues a signed token, with the strict cookie options', login.includes('signAdminSession(config, Date.now())') && login.includes('...ADMIN_COOKIE_OPTIONS'));
  ok('  ...never the old literal', !login.includes("'true'"));

  // EVERY route that reads the cookie, and every handler in it.
  const apiRoot = path.join(ROOT, 'app/api/online-competition');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name === 'route.ts' ? [path.join(dir, d.name)] : []);
  const guarded = walk(apiRoot)
    .map((f) => ({ rel: path.relative(ROOT, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }))
    .filter((f) => f.text.includes('isOnlineCompAdmin'));
  // 18 API route files today (the competition delete route was the 18th). A
  // new admin route raises this; a route that silently stops importing the
  // check lowers it and fails here.
  ok('all 18 admin API routes are found', guarded.length === 18, `${guarded.length} found`);
  for (const f of guarded) {
    const handlers = (f.text.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
    const checks = (f.text.match(/if \(!\(await isOnlineCompAdmin\(\)\)\) \{/g) ?? []).length;
    ok(`${f.rel}: all ${handlers} handler(s) check the session`, handlers > 0 && checks === handlers, `${checks} checks`);
  }
  const all = [...walk(apiRoot), ...walk(path.join(ROOT, 'app/online-competition'))
    .concat(fs.readdirSync(path.join(ROOT, 'app/online-competition/admin/_components')).map((n) => path.join(ROOT, 'app/online-competition/admin/_components', n)))];
  const readsCookieDirectly = all.filter((f) => /\.tsx?$/.test(f) && fs.readFileSync(f, 'utf8').includes('ADMIN_COOKIE_NAME'))
    .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
  eq('nothing but the login route touches the cookie by name', readsCookieDirectly, ['app/api/online-competition/admin-auth/route.ts']);
  ok('the admin page gate uses the same check', src('app/online-competition/admin/_components/AdminGate.tsx').includes('if (!(await isOnlineCompAdmin()))'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
