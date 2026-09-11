// ── The athlete's identity on a public route ────────────────────────────
// What CAN be tested here: bearerToken, which is pure. What CANNOT:
// verifyIdToken itself. It checks a real RSA signature against Google's
// published keys for a real project, and the Firestore emulator has no
// part in it — there is no fake token that passes and no way to mint a
// real one in this harness. The verification path is therefore verified BY
// READING, and what the tests below hold in place is everything around it:
// the parsing, and the call sites that must not reintroduce a uid
// parameter.
//
// Why it matters: both routes took the athlete's uid from the query string
// and never checked it, so anyone could fetch another athlete's official
// scramble before they solved it, or probe who had qualified.
//
// Run: npm run test:athleteauth

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-athleteauth-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/athlete-auth.ts',
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

const { bearerToken, AthleteAuthError } = require(path.join(OUT, 'athlete-auth.js'));

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

const JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';

console.log('\n  -- reading the Authorization header --');
eq('a bearer token', bearerToken(`Bearer ${JWT}`), JWT);
// RFC 7235 says the scheme is case-insensitive and clients differ.
eq('the scheme is case-insensitive', bearerToken(`bearer ${JWT}`), JWT);
eq('  ...including odd casing', bearerToken(`BEARER ${JWT}`), JWT);
eq('extra spaces between scheme and token', bearerToken(`Bearer    ${JWT}`), JWT);
eq('a tab separator', bearerToken(`Bearer\t${JWT}`), JWT);
eq('surrounding whitespace is trimmed', bearerToken(`  Bearer ${JWT}  `), JWT);
eq('trailing whitespace after the token', bearerToken(`Bearer ${JWT}  `), JWT);

console.log('\n  -- what is NOT a token --');
eq('no header at all', bearerToken(null), null);
eq('an empty header', bearerToken(''), null);
eq('the scheme with nothing after it', bearerToken('Bearer'), null);
eq('the scheme and only spaces', bearerToken('Bearer   '), null);
eq('a different scheme', bearerToken(`Basic ${JWT}`), null);
// "Bearer" as a prefix of another scheme name must not match.
eq('a scheme that merely starts with Bearer', bearerToken(`BearerToken ${JWT}`), null);
eq('a bare token with no scheme', bearerToken(JWT), null);
// Two tokens is a malformed header, not a token with a space in it.
eq('two values', bearerToken(`Bearer ${JWT} ${JWT}`), null);

console.log('\n  -- the error carries a reason the client can act on --');
{
  const e = new AthleteAuthError('bad-token', 'x');
  eq('401', e.status, 401);
  eq('the reason', e.reason, 'bad-token');
  ok('it is an Error', e instanceof Error);
}

console.log('\n  -- the routes verify, and no uid parameter survives --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const scramble = src('app/api/online-competition/scramble/route.ts');
  const roundAccess = src('app/api/online-competition/round-access/route.ts');
  const auth = src('lib/online-competition/athlete-auth.ts');

  for (const [name, route] of [['scramble', scramble], ['round-access', roundAccess]]) {
    ok(`${name}: the uid comes from the verified token`, route.includes('uid = await requireAthlete(req)'));
    // THE POINT: not cross-checked against a parameter — gone.
    ok(`${name}: no uid query parameter is read at all`, !route.includes("searchParams.get('uid')"));
    ok(`${name}: an auth failure is a 401 with a reason and NO message`,
      route.includes('{ error: e.reason }, { status: e.status }'));
    // firebase-admin cannot run on edge; both routes need it.
    ok(`${name}: pinned to the Node runtime`, route.includes("export const runtime = 'nodejs';"));
  }

  // The unauthenticated path around the round gate.
  ok('the scramble route’s generator-only mode is gone',
    scramble.includes("error: 'Missing competitionId param'") && !scramble.includes('round = 1;'));
  ok('  ...so every request is gated', /const access = await resolveRoundAccess\(/.test(scramble));

  // Anonymous sessions mint valid tokens; the solve page already treats
  // them as signed-out and the route has to agree.
  ok('anonymous sessions are refused', auth.includes("sign_in_provider === 'anonymous'"));
  ok('the token is read from the header, never a query string',
    auth.includes("req.headers.get('authorization')") && !auth.includes('searchParams'));
  ok('revocation checking is deliberately off (a per-request user lookup)',
    auth.includes('checkRevoked is deliberately off'));
}

console.log('\n  -- the client sends a header, not a uid --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const fetcher = src('lib/online-competition/authed-fetch.ts');
  ok('the token is attached as a Bearer header',
    fetcher.includes('Authorization: `Bearer ${token}`'));
  // The SECOND named app. A token from the club site's default app would
  // carry a club member's identity.
  ok('  ...minted by the online-competition app, not the club’s default',
    fetcher.includes("from './firebase'") && fetcher.includes('onlineCompAuth.currentUser'));
  ok('anonymous sessions never even send a request', fetcher.includes('user.isAnonymous'));
  ok('a 401 is retried ONCE with a freshly minted token',
    fetcher.includes('if (first.status !== 401) return first;') &&
      fetcher.includes('authedFetch(url, { forceRefresh: true })'));

  for (const rel of [
    'app/online-competition/dashboard/_components/LiveCard.tsx',
    'app/online-competition/[competitionId]/details/page.tsx',
    'app/online-competition/[competitionId]/solve/[eventId]/page.tsx',
  ]) {
    const s = src(rel);
    ok(`${path.basename(rel)}: calls through authedFetch`, s.includes('authedFetchWithRetry('));
    ok(`  ...and sends no uid parameter`, !/uid=\$\{encodeURIComponent/.test(s) && !s.includes("qs.set('uid'"));
  }

  // FAILING SOFT: a 401 mid-run must not reach the blocked screen, which
  // replaces the run and takes an unfiled attempt with it.
  const solve = src('app/online-competition/[competitionId]/solve/[eventId]/page.tsx');
  ok('a 401 routes to the retryable wait stage, never the blocked screen',
    /if \(res\.status === 401\) \{[\s\S]{0,400}?setScrambleError\(/.test(solve));
  ok('  ...checked BEFORE the round-refusal branch that can block',
    solve.indexOf('res.status === 401') < solve.indexOf('setBlockedMessage(body.message)'));
  ok('  ...and a lost session lands there too, not on an error screen',
    solve.includes('e instanceof NotSignedInError'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
