// ── Which competition the hub features ──────────────────────────────────
// Pure unit tests for pickFeatured. No emulator, no Firestore, no React.
//
// Two groups carry weight:
//   THE GATE     — featuredHeading / featuredCtaLabel / featuredUntil
//                  deliberately SURVIVE `featured` being switched off, so
//                  a competition with banner copy and featured:false must
//                  never be picked. If that flips, unticking the box stops
//                  taking the banner down.
//   DETERMINISM  — writeCompetitionDoc enforces exclusivity in a
//                  transaction, so two featured competitions should be
//                  impossible. If two ever exist, the same data must still
//                  produce the same banner on every load, in any input
//                  order — otherwise the hub flickers between two banners
//                  with nothing in the logs.
//
// Run: npm run test:featured

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-featured-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/featured.ts',
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

const { pickFeatured } = require(path.join(OUT, 'featured.js'));

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

const NOW = Date.UTC(2026, 2, 25, 12, 0);
const HOUR = 3_600_000;

const comp = (id, over = {}) => ({ id, featured: true, featuredUntilMs: null, createdAtMs: 1000, ...over });
const pickId = (list, now = NOW) => pickFeatured(list, now)?.id ?? null;

console.log('\n  -- the gate: `featured`, and nothing else --');
eq('a featured competition is picked', pickId([comp('a')]), 'a');
eq('an empty list gives null', pickId([]), null);
eq('nothing featured gives null', pickId([comp('a', { featured: false })]), null);
eq('an ABSENT featured flag is not featured', pickId([{ id: 'a', featuredUntilMs: null, createdAtMs: 1 }]), null);
// The rule the whole module exists for: the banner copy persists when the
// flag is switched off, so copy must never imply "show this".
eq(
  'banner COPY with featured:false is NOT picked',
  pickId([comp('a', { featured: false, featuredHeading: 'СЕЗОН 3 · БҮРТГЭЛ НЭЭЛТТЭЙ', featuredCtaLabel: 'Бүртгүүлэх' })]),
  null,
);
eq(
  'a future featuredUntil with featured:false is still NOT picked',
  pickId([comp('a', { featured: false, featuredUntilMs: NOW + 100 * HOUR })]),
  null,
);
// Strict === true: a hand-edited document holding a truthy non-boolean is
// not a decision the admin made in the form.
for (const truthy of [1, 'true', 'yes', {}]) {
  eq(`featured: ${JSON.stringify(truthy)} is not === true`, pickId([comp('a', { featured: truthy })]), null);
}
eq('the featured one is picked out of a crowd of unfeatured ones',
  pickId([comp('a', { featured: false }), comp('b'), comp('c', { featured: false })]), 'b');

console.log('\n  -- featuredUntil: absent means NO EXPIRY --');
eq('null featuredUntil shows indefinitely', pickId([comp('a', { featuredUntilMs: null })]), 'a');
eq('  ...even far in the future', pickId([comp('a', { featuredUntilMs: null })], NOW + 10_000 * HOUR), 'a');
eq('a FUTURE featuredUntil shows', pickId([comp('a', { featuredUntilMs: NOW + HOUR })]), 'a');
eq('a PAST featuredUntil does NOT show', pickId([comp('a', { featuredUntilMs: NOW - HOUR })]), null);
eq('one millisecond past is expired', pickId([comp('a', { featuredUntilMs: NOW - 1 })]), null);
// The boundary: an expiry exactly at this instant still shows, so a banner
// does not blink out mid-second.
eq('an expiry EXACTLY now still shows', pickId([comp('a', { featuredUntilMs: NOW })]), 'a');
eq('one millisecond ahead still shows', pickId([comp('a', { featuredUntilMs: NOW + 1 })]), 'a');
// Expiry is evaluated against the passed instant, never a real clock.
eq('the same data expires as the passed clock moves past it',
  pickId([comp('a', { featuredUntilMs: NOW })], NOW + 1), null);
eq('an expired one does not shadow a live one',
  pickId([comp('old', { featuredUntilMs: NOW - HOUR }), comp('live')]), 'live');

console.log('\n  -- more than one featured: deterministic, never first-returned --');
{
  // Should be impossible (writeCompetitionDoc's transaction), so the only
  // requirement is that it is STABLE and explicable: newest first.
  const two = [comp('older', { createdAtMs: 1000 }), comp('newer', { createdAtMs: 2000 })];
  eq('the most recently created wins', pickId(two), 'newer');
  eq('  ...whatever order they arrive in', pickId(two.slice().reverse()), 'newer');
}
{
  // Same createdAt: the id tie-break is what makes the order TOTAL. Without
  // it the result depends on the input order, which is the bug.
  const tie = [comp('zebra', { createdAtMs: 5000 }), comp('alpha', { createdAtMs: 5000 })];
  eq('an identical createdAt falls back to the id', pickId(tie), 'alpha');
  eq('  ...in either input order', pickId(tie.slice().reverse()), 'alpha');
}
{
  // A document with no createdAt (the original seed predates the field)
  // must not win over one that has one.
  const mixed = [comp('nostamp', { createdAtMs: null }), comp('stamped', { createdAtMs: 1 })];
  eq('a null createdAt sorts LAST', pickId(mixed), 'stamped');
  eq('  ...in either input order', pickId(mixed.slice().reverse()), 'stamped');
}
eq('two nulls still tie-break by id',
  pickId([comp('b', { createdAtMs: null }), comp('a', { createdAtMs: null })]), 'a');
// Expiry is applied BEFORE the tie-break, so a newer-but-expired banner
// does not beat an older live one.
eq('an expired newer one loses to a live older one',
  pickId([comp('newer', { createdAtMs: 9000, featuredUntilMs: NOW - 1 }), comp('older', { createdAtMs: 1 })]),
  'older');
{
  // Stability under every permutation of a three-way collision.
  const three = [comp('c', { createdAtMs: 5 }), comp('a', { createdAtMs: 5 }), comp('b', { createdAtMs: 5 })];
  const perms = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  ok('every input permutation gives the same answer',
    perms.every((p) => pickId(p.map((i) => three[i])) === 'a'),
    perms.map((p) => pickId(p.map((i) => three[i]))).join(','));
}

console.log('\n  -- the input is not mutated --');
{
  const list = [comp('b', { createdAtMs: 1 }), comp('a', { createdAtMs: 9 })];
  const before = list.map((c) => c.id).join(',');
  pickFeatured(list, NOW);
  eq('the caller’s array order is untouched', list.map((c) => c.id).join(','), before);
}
{
  // The picked object is the CALLER'S object, so the hub can carry extra
  // fields (the whole OnlineCompetition) through the pick.
  const rich = { ...comp('a'), name: 'Хором Оупен 2026', bannerUrl: 'https://x/b.jpg' };
  const got = pickFeatured([rich], NOW);
  ok('the caller’s own object comes back, extra fields intact',
    got === rich && got.name === 'Хором Оупен 2026' && got.bannerUrl === 'https://x/b.jpg');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
