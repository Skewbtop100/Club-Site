// ── Publish readiness ───────────────────────────────────────────────────
// Pure unit tests for evaluateReadiness — the Хянах tab's checklist and
// the gate on Зарлах. No emulator, no Firestore, no React: the function
// takes plain values and returns plain values, which is why the logic
// lives in lib/ rather than inside CompetitionEditor.
//
// The load-bearing group is BLOCKING vs NOT: a competition with no poster
// MUST stay publishable. If that flips, every admin is stopped from
// announcing a competition over a missing image.
//
// Run: npm run test:readiness

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-readiness-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/publish-readiness.ts',
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

const { evaluateReadiness, READY_WORD } = require(path.join(OUT, 'publish-readiness.js'));

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

/** A competition with every requirement met. Each case below takes this
 *  and removes exactly one thing, so a failure names the thing removed. */
const COMPLETE = {
  name: 'Улаанбаатар Онлайн 2026',
  startAt: 1_770_000_000_000,
  registrationDeadline: 1_769_000_000_000,
  posterUrl: 'https://res.cloudinary.com/x/poster.jpg',
  bannerUrl: 'https://res.cloudinary.com/x/banner.jpg',
  events: [
    { eventId: '333', label: '3x3x3', rounds: 2 },
    { eventId: '222', label: '2x2x2', rounds: 1 },
  ],
};
const withOut = (patch) => evaluateReadiness({ ...COMPLETE, ...patch });
const req = (r, key) => r.requirements.find((x) => x.key === key);

console.log('\n  -- everything met --');
{
  const r = evaluateReadiness(COMPLETE);
  eq('three requirements, in declaration order', r.requirements.map((x) => x.key).join(','), 'general,images,events');
  ok('all three met', r.requirements.every((x) => x.met));
  ok('all three read БЭЛЭН', r.requirements.every((x) => x.status === READY_WORD));
  eq('READY_WORD is БЭЛЭН', READY_WORD, 'БЭЛЭН');
  eq('canPublish', r.canPublish, true);
  eq('no blockedReason', r.blockedReason, null);
}

console.log('\n  -- Ерөнхий: each field individually unmet --');
{
  const r = withOut({ name: '' });
  eq('no name: status names НЭР', req(r, 'general').status, 'НЭР ДУТУУ');
  eq('no name: general unmet', req(r, 'general').met, false);
  eq('no name: blocks publishing', r.canPublish, false);
  ok('no name: other two still met', req(r, 'images').met && req(r, 'events').met);
}
eq('whitespace-only name counts as no name', withOut({ name: '   ' }).canPublish, false);
{
  const r = withOut({ startAt: null });
  eq('no start: status names ЭХЛЭХ ЦАГ', req(r, 'general').status, 'ЭХЛЭХ ЦАГ ДУТУУ');
  eq('no start: blocks publishing', r.canPublish, false);
}
{
  const r = withOut({ registrationDeadline: null });
  eq('no deadline: status names it', req(r, 'general').status, 'БҮРТГЭЛ ХААХ ЦАГ ДУТУУ');
  eq('no deadline: blocks publishing', r.canPublish, false);
}
{
  // The state a brand-new competition is in: nothing typed at all.
  const r = withOut({ name: '', startAt: null, registrationDeadline: null });
  eq(
    'all three missing: every one is named, ДУТУУ said once',
    req(r, 'general').status,
    'НЭР · ЭХЛЭХ ЦАГ · БҮРТГЭЛ ХААХ ЦАГ ДУТУУ',
  );
}
// 0 is a real timestamp (1970) and must not be read as "unset" — only
// null is unset. A regression here would silently block a valid publish.
eq('startAt of 0 is a set time, not unset', withOut({ startAt: 0, registrationDeadline: 0 }).canPublish, true);

console.log('\n  -- Зураг: unmet, but NOT blocking --');
{
  const r = withOut({ posterUrl: null });
  eq('no poster: status names ПОСТЕР', req(r, 'images').status, 'ПОСТЕР ДУТУУ');
  eq('no poster: images unmet', req(r, 'images').met, false);
  eq('NO POSTER IS STILL PUBLISHABLE', r.canPublish, true);
  eq('no poster: nothing blocks, so no reason', r.blockedReason, null);
}
eq('no banner: status names БАННЕР', withOut({ bannerUrl: null }).requirements[1].status, 'БАННЕР ДУТУУ');
{
  const r = withOut({ posterUrl: null, bannerUrl: null });
  eq('neither image: both named', req(r, 'images').status, 'ПОСТЕР · БАННЕР ДУТУУ');
  eq('neither image: STILL PUBLISHABLE', r.canPublish, true);
}
eq('images is declared non-blocking', evaluateReadiness(COMPLETE).requirements[1].blocking, false);
eq('empty-string url counts as no image', withOut({ posterUrl: '' }).requirements[1].met, false);

console.log('\n  -- Төрөл: unmet --');
{
  const r = withOut({ events: [] });
  eq('no events: status says ТӨРӨЛ ОРООГҮЙ', req(r, 'events').status, 'ТӨРӨЛ ОРООГҮЙ');
  eq('no events: blocks publishing', r.canPublish, false);
}
{
  const r = withOut({
    events: [
      { eventId: '333', label: '3x3x3', rounds: 2 },
      { eventId: '444', label: '4x4x4', rounds: 0 },
    ],
  });
  eq('a roundless event is NAMED', req(r, 'events').status, '4x4x4 РАУНДГҮЙ');
  eq('a roundless event blocks publishing', r.canPublish, false);
}
eq(
  'several roundless events are all named',
  withOut({
    events: [
      { eventId: '444', label: '4x4x4', rounds: 0 },
      { eventId: '555', label: '5x5x5', rounds: 0 },
    ],
  }).requirements[2].status,
  '4x4x4 · 5x5x5 РАУНДГҮЙ',
);
eq('one round is enough', withOut({ events: [{ eventId: '333', label: '3x3x3', rounds: 1 }] }).canPublish, true);

console.log('\n  -- blocking-ness is a property, not a special case --');
{
  const r = evaluateReadiness(COMPLETE);
  eq('general blocks', req(r, 'general').blocking, true);
  eq('images does not', req(r, 'images').blocking, false);
  eq('events blocks', req(r, 'events').blocking, true);
  // canPublish is exactly "no blocking requirement is unmet" — checked
  // against the requirement list itself rather than against a repeated
  // list of keys, so adding a fourth requirement cannot make them drift.
  for (const [label, input] of [
    ['complete', COMPLETE],
    ['no name', { ...COMPLETE, name: '' }],
    ['no images', { ...COMPLETE, posterUrl: null, bannerUrl: null }],
    ['no events', { ...COMPLETE, events: [] }],
    ['nothing at all', { name: '', startAt: null, registrationDeadline: null, posterUrl: null, bannerUrl: null, events: [] }],
  ]) {
    const out = evaluateReadiness(input);
    const derived = out.requirements.every((x) => x.met || !x.blocking);
    eq(`${label}: canPublish agrees with the blocking flags`, out.canPublish, derived);
    eq(`${label}: blockedReason present iff blocked`, out.blockedReason === null, out.canPublish);
  }
}

console.log('\n  -- the disabled-button reason names the offenders --');
{
  const r = withOut({ name: '', events: [] });
  const reason = r.blockedReason;
  ok('names the Ерөнхий requirement', reason.includes('Ерөнхий мэдээлэл'), reason);
  ok('names the missing field', reason.includes('НЭР'), reason);
  ok('names the Төрөл requirement', reason.includes('Төрөл ба раунд'), reason);
  ok('names the missing events', reason.includes('ТӨРӨЛ ОРООГҮЙ'), reason);
}
{
  // A non-blocking gap never appears in the reason — it is not why the
  // button is off, and listing it would send the admin to fix the wrong
  // thing.
  const reason = withOut({ name: '', posterUrl: null, bannerUrl: null }).blockedReason;
  ok('a non-blocking gap is NOT in the reason', !reason.includes('Постер'), reason);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
