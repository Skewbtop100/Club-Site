// ── The featured flag's write path ──────────────────────────────────────
// setCompetitionFeatured is what the admin list's ★ calls. It is the second
// writer of `featured` (writeCompetitionDoc, the editor form, is the first),
// and both have to keep the SAME invariant: at most one competition is
// featured at a time.
//
// This runs the real module against the Firestore emulator, because every
// interesting property here is transactional — exclusivity, and touching one
// field of a document without disturbing the rest — and none of it is
// visible to a pure test.
//
// pickFeatured (featured.ts) has its own pure suite; the last case below
// joins the two, so "the star was set" and "the hub would show it" are
// asserted as one fact rather than two hopes.
//
// Run: npm run test:featuredwrite   (wraps the Firestore emulator)

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-featuredwrite-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/admin-competitions.ts',
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
}

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
compile();

const { setCompetitionFeatured, CompetitionWriteError } = require(path.join(OUT, 'admin-competitions.js'));
const { pickFeatured } = require(path.join(OUT, 'featured.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'featured-write' }, 'fw'));
const COL = 'onlineCompetitions';

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

async function wipe() {
  const snap = await db.collection(COL).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

/** A competition with enough on it to notice if the toggle disturbs it. */
function comp(name, extra = {}) {
  return {
    name,
    status: 'upcoming',
    description: 'тайлбар',
    events: [{ eventId: '333', label: '3x3x3', rounds: 1, resultFormat: 'ao5' }],
    participantLimit: 10,
    featured: false,
    featuredHeading: 'ОНЦЛОХ ГАРЧИГ',
    featuredCtaLabel: 'БҮРТГҮҮЛЭХ',
    ...extra,
  };
}

const read = async (id) => (await db.collection(COL).doc(id).get()).data();

async function main() {
  console.log('\n=== setCompetitionFeatured ===\n');

  // ── setting and clearing ────────────────────────────────────────────
  await wipe();
  await db.collection(COL).doc('a').set(comp('A'));
  await setCompetitionFeatured(db, 'a', true);
  ok('setting the flag stores featured: true', (await read('a')).featured === true);

  await setCompetitionFeatured(db, 'a', false);
  ok('clearing it stores featured: false', (await read('a')).featured === false);

  // ── nothing else moves ──────────────────────────────────────────────
  await wipe();
  await db.collection(COL).doc('a').set(comp('A'));
  const before = await read('a');
  await setCompetitionFeatured(db, 'a', true);
  const after = await read('a');
  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  ok('ONLY `featured` changes — no field is dropped or rewritten',
    changed.length === 1 && changed[0] === 'featured', `changed: ${changed.join(', ') || 'nothing'}`);
  // The banner copy survives the flag, which featured.ts depends on: it
  // gates on `featured` alone precisely because this copy persists.
  ok('the banner copy survives being featured', after.featuredHeading === 'ОНЦЛОХ ГАРЧИГ');

  // ── EXCLUSIVITY, the invariant both writers share ───────────────────
  await wipe();
  await db.collection(COL).doc('a').set(comp('A', { featured: true }));
  await db.collection(COL).doc('b').set(comp('B'));
  await setCompetitionFeatured(db, 'b', true);
  ok('featuring one CLEARS the other', (await read('a')).featured === false);
  ok('...and sets the new one', (await read('b')).featured === true);

  // Three at once, hand-written as a corrupted state would be.
  await wipe();
  for (const id of ['a', 'b', 'c']) {
    await db.collection(COL).doc(id).set(comp(id.toUpperCase(), { featured: true }));
  }
  await setCompetitionFeatured(db, 'c', true);
  const flags = await Promise.all(['a', 'b', 'c'].map(async (id) => (await read(id)).featured));
  ok('featuring one clears EVERY other, not just the first found',
    JSON.stringify(flags) === JSON.stringify([false, false, true]), JSON.stringify(flags));

  // Clearing touches nobody else — there is nothing to make exclusive.
  await wipe();
  await db.collection(COL).doc('a').set(comp('A', { featured: true }));
  await db.collection(COL).doc('b').set(comp('B'));
  await setCompetitionFeatured(db, 'a', false);
  ok('clearing leaves other competitions alone', (await read('b')).featured === false);

  // ── a draft cannot be featured ──────────────────────────────────────
  await wipe();
  await db.collection(COL).doc('d').set(comp('D', { status: 'draft' }));
  let refused = null;
  try {
    await setCompetitionFeatured(db, 'd', true);
  } catch (e) {
    refused = e;
  }
  ok('featuring a DRAFT is refused', refused instanceof CompetitionWriteError, String(refused));
  ok('...with a reason that says why', /Ноорог/.test(String(refused?.message)), refused?.message);
  ok('...and the flag is untouched', (await read('d')).featured === false);

  // The public list never contains a draft, so a featured one could never
  // reach the banner — which is the whole reason it is refused rather than
  // written.
  ok('a featured draft would be invisible anyway (pickFeatured over the public list)',
    pickFeatured([], Date.now()) === null);

  // But un-starring one must always work, or a competition moved back to
  // draft while featured could never be un-featured.
  await wipe();
  await db.collection(COL).doc('d').set(comp('D', { status: 'draft', featured: true }));
  await setCompetitionFeatured(db, 'd', false);
  ok('UN-featuring a draft is allowed', (await read('d')).featured === false);

  // ── a competition that does not exist ───────────────────────────────
  await wipe();
  let missing = null;
  try {
    await setCompetitionFeatured(db, 'nope', true);
  } catch (e) {
    missing = e;
  }
  ok('a competition id that does not exist is refused',
    missing instanceof CompetitionWriteError, String(missing));
  ok('...and no document is created for it',
    (await db.collection(COL).doc('nope').get()).exists === false);

  // ── the star and the hub agree ──────────────────────────────────────
  // The point of the whole change: what the ★ writes is what pickFeatured
  // chooses. Read back through the same shape the hub builds.
  await wipe();
  await db.collection(COL).doc('a').set(comp('A'));
  await db.collection(COL).doc('b').set(comp('B'));
  await setCompetitionFeatured(db, 'b', true);
  const candidates = (await db.collection(COL).get()).docs.map((d) => ({
    id: d.id,
    featured: d.get('featured'),
    featuredUntilMs: null,
    createdAtMs: null,
  }));
  ok('the hub would show exactly the starred one', pickFeatured(candidates, Date.now())?.id === 'b');

  await setCompetitionFeatured(db, 'b', false);
  const none = (await db.collection(COL).get()).docs.map((d) => ({
    id: d.id,
    featured: d.get('featured'),
    featuredUntilMs: null,
    createdAtMs: null,
  }));
  ok('with none starred the hub shows NO hero', pickFeatured(none, Date.now()) === null);

  await wipe();
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
});
