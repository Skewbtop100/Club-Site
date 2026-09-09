// ── Competition write-path round trip ───────────────────────────────────
// Proves that every field the admin editor sends survives validation, gets
// written to Firestore in the right shape, and comes back unchanged.
//
// Why this exists: adding a field to a competition means touching SEVEN
// places (types.ts x3, validateCompetitionInput, toFirestoreDoc, and the
// two API route mappers, which each hand-map every field). Miss one and the
// field silently never saves — no error, no runtime type complaint, just a
// value that vanishes on reload. This exercises the real modules rather
// than restating their contents, so a missed mapping fails loudly.
//
// The two GET mappers are NOT covered here (they live in Next route
// handlers that import next/server and cannot be isolated cheaply). The
// compiler covers them instead: OnlineCompetitionAdminView types every
// field as REQUIRED, so a mapper that omits one fails `tsc`.
//
// Run: npm run test:fields   (wraps the Firestore emulator)

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
// Matches the .gitignore'd `.tmp-*-build/` convention already used for
// one-off `npx tsc` output elsewhere in this repo.
const OUT = path.join(ROOT, '.tmp-fields-build');

// The modules under test are TypeScript, and Node cannot import them
// directly: their relative imports are extensionless, which ESM type
// stripping will not resolve. Compile to CommonJS (whose require() does do
// extension resolution) INSIDE the project, so `require('firebase-admin/…')`
// still resolves against the repo's node_modules.
function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  // Invoke tsc's own entry script under this Node, rather than the `npx`
  // shim: Node refuses to spawn a .cmd without a shell (Windows), and
  // resolving the binary directly sidesteps that and any PATH surprises.
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/admin-competitions.ts',
      '--outDir', path.basename(OUT),
      '--module', 'commonjs',
      '--target', 'es2022',
      '--moduleResolution', 'node',
      '--skipLibCheck',
      '--esModuleInterop',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
compile();

const { validateCompetitionInput, writeCompetitionDoc } = require(path.join(OUT, 'admin-competitions.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-fields' }, 'rt'));
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
    if (detail) console.log(`          -> ${detail}`);
  }
}

const OPENS = Date.UTC(2026, 2, 1, 9, 0);
const DEADLINE = Date.UTC(2026, 2, 20, 9, 0);
const START = Date.UTC(2026, 2, 25, 9, 0);
const END = Date.UTC(2026, 2, 27, 18, 0);
const UNTIL = Date.UTC(2026, 3, 5, 0, 0);

const HEADING = 'СЕЗОН 3 · БҮРТГЭЛ НЭЭЛТТЭЙ';
const CTA = 'Бүртгүүлэх';
const INSTRUCTIONS = 'Заавар текст';

/** The exact JSON body CompetitionEditor sends. */
const body = (over = {}) => ({
  name: 'Round-trip тэмцээн',
  description: 'тайлбар',
  startAt: START,
  registrationDeadline: DEADLINE,
  registrationOpensAt: OPENS,
  endAt: END,
  participantLimit: 64,
  events: [],
  status: 'draft',
  season: '2026-spring',
  format: 'online-video',
  featured: false,
  featuredHeading: HEADING,
  featuredCtaLabel: CTA,
  featuredUntil: UNTIL,
  instructions: INSTRUCTIONS,
  paid: false,
  ...over,
});

const read = async (id) => (await db.collection(COL).doc(id).get()).data();

(async () => {
  console.log('\n=== competition write path: field round trip ===\n');

  // ── validation preserves every field ──────────────────────────────────
  const v = validateCompetitionInput(body());
  ok('validateCompetitionInput accepts the editor payload', v.ok, v.ok ? '' : v.error);

  const KEPT = [
    ['registrationOpensAt', OPENS],
    ['endAt', END],
    ['format', 'online-video'],
    ['featured', false],
    ['featuredHeading', HEADING],
    ['featuredCtaLabel', CTA],
    ['featuredUntil', UNTIL],
    ['instructions', INSTRUCTIONS],
    ['paid', false],
  ];
  for (const [k, want] of KEPT) {
    ok(`  ...keeps ${k}`, v.ok && v.data[k] === want, v.ok ? String(v.data[k]) : '');
  }

  // ── CREATE stores everything ──────────────────────────────────────────
  const id = await writeCompetitionDoc(db, null, v.data);
  const d = await read(id);
  ok('CREATE stores registrationOpensAt as a Timestamp', d.registrationOpensAt?.toMillis?.() === OPENS);
  ok('CREATE stores endAt as a Timestamp', d.endAt?.toMillis?.() === END);
  ok('CREATE stores format', d.format === 'online-video', String(d.format));
  ok('CREATE stores featured', d.featured === false, String(d.featured));
  ok('CREATE stores featuredHeading', d.featuredHeading === HEADING, String(d.featuredHeading));
  ok('CREATE stores featuredCtaLabel', d.featuredCtaLabel === CTA, String(d.featuredCtaLabel));
  ok('CREATE stores featuredUntil as a Timestamp', d.featuredUntil?.toMillis?.() === UNTIL, String(d.featuredUntil));
  ok('CREATE stores instructions', d.instructions === INSTRUCTIONS, String(d.instructions));
  ok('CREATE stores paid', d.paid === false, String(d.paid));
  ok('CREATE stamps createdAt', d.createdAt != null);
  ok(
    'CREATE keeps the pre-existing fields too',
    d.name === 'Round-trip тэмцээн' &&
      d.startAt?.toMillis?.() === START &&
      d.registrationDeadline?.toMillis?.() === DEADLINE &&
      d.participantLimit === 64 &&
      d.status === 'draft' &&
      d.season === '2026-spring' &&
      d.description === 'тайлбар',
  );

  // ── UPDATE changes everything ─────────────────────────────────────────
  const v2 = validateCompetitionInput(
    body({
      registrationOpensAt: null,
      endAt: START + 1,
      format: 'custom-thing',
      featured: true,
      featuredHeading: 'ШИНЭ ГАРЧИГ',
      featuredCtaLabel: 'Одоо бүртгүүлэх',
      featuredUntil: null,
      instructions: 'Шинэчилсэн заавар',
      paid: true,
    }),
  );
  await writeCompetitionDoc(db, id, v2.data);
  const d2 = await read(id);
  ok('UPDATE clears registrationOpensAt to null', d2.registrationOpensAt === null, String(d2.registrationOpensAt));
  ok('UPDATE changes endAt', d2.endAt?.toMillis?.() === START + 1);
  ok('UPDATE keeps an unrecognised format verbatim', d2.format === 'custom-thing', String(d2.format));
  ok('UPDATE sets featured', d2.featured === true);
  ok('UPDATE changes featuredHeading', d2.featuredHeading === 'ШИНЭ ГАРЧИГ', String(d2.featuredHeading));
  ok('UPDATE changes featuredCtaLabel', d2.featuredCtaLabel === 'Одоо бүртгүүлэх', String(d2.featuredCtaLabel));
  ok('UPDATE clears featuredUntil to null', d2.featuredUntil === null, String(d2.featuredUntil));
  ok('UPDATE changes instructions', d2.instructions === 'Шинэчилсэн заавар', String(d2.instructions));
  ok('UPDATE sets paid', d2.paid === true);
  ok('UPDATE preserves createdAt (merge)', d2.createdAt?.toMillis() === d.createdAt.toMillis());

  // ── the banner copy is NOT tied to the featured flag ──────────────────
  // The editor hides these three when `featured` is off but never clears
  // them, so unticking and saving must leave the text in Firestore intact
  // — that is what makes re-ticking restore it.
  const v3 = validateCompetitionInput(
    body({ featured: false, featuredHeading: 'ХАДГАЛАГДСАН', featuredCtaLabel: 'Үлдсэн', featuredUntil: UNTIL }),
  );
  await writeCompetitionDoc(db, id, v3.data);
  const d3 = await read(id);
  ok(
    'unfeaturing does NOT clear featuredHeading',
    d3.featured === false && d3.featuredHeading === 'ХАДГАЛАГДСАН',
    String(d3.featuredHeading),
  );
  ok('unfeaturing does NOT clear featuredCtaLabel', d3.featuredCtaLabel === 'Үлдсэн', String(d3.featuredCtaLabel));
  ok('unfeaturing does NOT clear featuredUntil', d3.featuredUntil?.toMillis?.() === UNTIL, String(d3.featuredUntil));

  // ── featured exclusivity (the transaction in writeCompetitionDoc) ─────
  const a = await writeCompetitionDoc(db, null, validateCompetitionInput(body({ name: 'A', featured: true })).data);
  ok('featuring A sets A.featured', (await read(a)).featured === true);
  ok('featuring A clears the previously featured competition', (await read(id)).featured === false);

  const b = await writeCompetitionDoc(db, null, validateCompetitionInput(body({ name: 'B', featured: true })).data);
  ok('featuring B clears A', (await read(a)).featured === false);
  ok('featuring B sets B', (await read(b)).featured === true);
  const featuredNow = await db.collection(COL).where('featured', '==', true).get();
  ok('exactly ONE competition is featured collection-wide', featuredNow.size === 1, `got ${featuredNow.size}`);

  await writeCompetitionDoc(db, b, validateCompetitionInput(body({ name: 'B', featured: true })).data);
  ok('re-saving the featured competition keeps its own flag', (await read(b)).featured === true);

  // ── events: empty allowed for a draft only ────────────────────────────
  ok('draft with events: [] is accepted', validateCompetitionInput(body({ events: [] })).ok);
  const nonDraft = validateCompetitionInput(body({ events: [], status: 'upcoming' }));
  ok('non-draft with events: [] is REJECTED', !nonDraft.ok, nonDraft.ok ? 'accepted!' : nonDraft.error);
  ok(
    'non-draft WITH an event is accepted',
    validateCompetitionInput(body({ events: [{ eventId: '333', label: '3x3x3', rounds: 1 }], status: 'upcoming' })).ok,
  );

  // ── defaults when a payload omits the newer fields ────────────────────
  const v4 = validateCompetitionInput({ name: 'legacy', status: 'draft', events: [] });
  ok('omitted format defaults to online-video', v4.ok && v4.data.format === 'online-video');
  ok('omitted featured defaults to false', v4.ok && v4.data.featured === false);
  ok('omitted dates default to null', v4.ok && v4.data.registrationOpensAt === null && v4.data.endAt === null);
  ok('omitted featuredUntil defaults to null', v4.ok && v4.data.featuredUntil === null);
  ok('omitted paid defaults to false', v4.ok && v4.data.paid === false);
  ok(
    'omitted text fields default to empty string',
    v4.ok && v4.data.featuredHeading === '' && v4.data.featuredCtaLabel === '' && v4.data.instructions === '',
  );

  // ── junk is coerced, never stored ─────────────────────────────────────
  const v5 = validateCompetitionInput(
    body({ featuredHeading: 42, instructions: null, paid: 'yes', featuredUntil: 'soon' }),
  );
  ok('junk featuredHeading coerces to empty string', v5.ok && v5.data.featuredHeading === '');
  ok('junk instructions coerces to empty string', v5.ok && v5.data.instructions === '');
  ok('truthy-but-not-true paid coerces to false', v5.ok && v5.data.paid === false, v5.ok ? String(v5.data.paid) : '');
  ok('junk featuredUntil coerces to null', v5.ok && v5.data.featuredUntil === null);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
});
