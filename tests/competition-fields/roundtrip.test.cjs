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
      // --strict to match tsconfig.json. Without it, strictNullChecks is
      // off and true/false literal types stop discriminating a union, so
      // this compile can fail on code the real build accepts (and, worse,
      // could pass code it rejects).
      '--strict',
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
const POSTER = 'https://res.cloudinary.com/x/image/upload/poster.jpg';
const POSTER_ID = 'comp/poster_abc';
const BANNER = 'https://res.cloudinary.com/x/image/upload/banner.jpg';
const BANNER_ID = 'comp/banner_xyz';

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
  posterUrl: POSTER,
  posterPublicId: POSTER_ID,
  bannerUrl: BANNER,
  bannerPublicId: BANNER_ID,
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
    ['posterUrl', POSTER],
    ['posterPublicId', POSTER_ID],
    ['bannerUrl', BANNER],
    ['bannerPublicId', BANNER_ID],
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
  ok('CREATE stores posterUrl', d.posterUrl === POSTER, String(d.posterUrl));
  ok('CREATE stores posterPublicId', d.posterPublicId === POSTER_ID, String(d.posterPublicId));
  ok('CREATE stores bannerUrl', d.bannerUrl === BANNER, String(d.bannerUrl));
  ok('CREATE stores bannerPublicId', d.bannerPublicId === BANNER_ID, String(d.bannerPublicId));
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
      posterUrl: 'https://res.cloudinary.com/x/image/upload/poster2.jpg',
      posterPublicId: 'comp/poster_def',
      // Removing an image: the editor's УСТГАХ sets both to null.
      bannerUrl: null,
      bannerPublicId: null,
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
  ok('UPDATE replaces posterUrl', d2.posterUrl === 'https://res.cloudinary.com/x/image/upload/poster2.jpg', String(d2.posterUrl));
  ok('UPDATE replaces posterPublicId', d2.posterPublicId === 'comp/poster_def', String(d2.posterPublicId));
  // The one that matters most: a merge:true write must actually overwrite
  // the old value with null, not skip the field and leave a stale URL that
  // would keep rendering an image the admin thinks they deleted.
  ok('REMOVING an image writes null, not a stale URL — bannerUrl', d2.bannerUrl === null, String(d2.bannerUrl));
  ok('REMOVING an image writes null — bannerPublicId', d2.bannerPublicId === null, String(d2.bannerPublicId));
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
  ok(
    'omitted image fields default to null (not empty string)',
    v4.ok &&
      v4.data.posterUrl === null &&
      v4.data.posterPublicId === null &&
      v4.data.bannerUrl === null &&
      v4.data.bannerPublicId === null,
  );

  // ── junk is coerced, never stored ─────────────────────────────────────
  const v5 = validateCompetitionInput(
    body({ featuredHeading: 42, instructions: null, paid: 'yes', featuredUntil: 'soon' }),
  );
  ok('junk featuredHeading coerces to empty string', v5.ok && v5.data.featuredHeading === '');
  ok('junk instructions coerces to empty string', v5.ok && v5.data.instructions === '');
  ok('truthy-but-not-true paid coerces to false', v5.ok && v5.data.paid === false, v5.ok ? String(v5.data.paid) : '');
  ok('junk featuredUntil coerces to null', v5.ok && v5.data.featuredUntil === null);

  // '' must normalise to null so "no image" has ONE representation in the
  // document rather than two for readers to handle.
  const v6 = validateCompetitionInput(body({ posterUrl: '', posterPublicId: '   ', bannerUrl: 7 }));
  ok('empty-string posterUrl normalises to null', v6.ok && v6.data.posterUrl === null, v6.ok ? String(v6.data.posterUrl) : '');
  ok('whitespace-only posterPublicId normalises to null', v6.ok && v6.data.posterPublicId === null);
  ok('non-string bannerUrl normalises to null', v6.ok && v6.data.bannerUrl === null);

  // A URL that survives a full write/read cycle unchanged — no trimming
  // surprises on a real Cloudinary secure_url.
  const idImg = await writeCompetitionDoc(db, null, validateCompetitionInput(body()).data);
  const dImg = await read(idImg);
  ok('a Cloudinary secure_url round-trips byte-identical', dImg.posterUrl === POSTER, String(dImg.posterUrl));


  // ── events[].advancement — the planned cut per round transition ───────
  // validateCompetitionInput REBUILDS each event object field by field, so
  // a per-event field it does not name is silently dropped. These pin that
  // advancement is actually carried, and that a malformed plan is refused
  // by the same rules the qualify route applies to a real cut.
  const ADV_EVENT = (over = {}) => ({
    eventId: '333',
    label: '3x3x3',
    rounds: 3,
    advancement: [
      { fromRound: 1, method: 'percent', value: 50 },
      { fromRound: 2, method: 'count', value: 12 },
    ],
    ...over,
  });

  const vAdv = validateCompetitionInput(body({ events: [ADV_EVENT()], status: 'upcoming' }));
  ok('advancement survives validation', vAdv.ok, vAdv.ok ? '' : vAdv.error);
  ok(
    '  ...with both transitions intact',
    vAdv.ok &&
      vAdv.data.events[0].advancement.length === 2 &&
      vAdv.data.events[0].advancement[0].fromRound === 1 &&
      vAdv.data.events[0].advancement[0].method === 'percent' &&
      vAdv.data.events[0].advancement[0].value === 50 &&
      vAdv.data.events[0].advancement[1].fromRound === 2 &&
      vAdv.data.events[0].advancement[1].method === 'count' &&
      vAdv.data.events[0].advancement[1].value === 12,
    vAdv.ok ? JSON.stringify(vAdv.data.events[0].advancement) : '',
  );

  const advId = await writeCompetitionDoc(db, null, vAdv.data);
  const dAdv = await read(advId);
  ok(
    'advancement round-trips through Firestore',
    JSON.stringify(dAdv.events?.[0]?.advancement) ===
      JSON.stringify([
        { fromRound: 1, method: 'percent', value: 50 },
        { fromRound: 2, method: 'count', value: 12 },
      ]),
    JSON.stringify(dAdv.events?.[0]?.advancement),
  );

  // Entries are normalised into fromRound order regardless of input order.
  const vSort = validateCompetitionInput(
    body({
      events: [
        ADV_EVENT({
          advancement: [
            { fromRound: 2, method: 'count', value: 12 },
            { fromRound: 1, method: 'percent', value: 50 },
          ],
        }),
      ],
      status: 'upcoming',
    }),
  );
  ok(
    'advancement is sorted by fromRound',
    vSort.ok && vSort.data.events[0].advancement.map((a) => a.fromRound).join(',') === '1,2',
  );

  // Absent / empty is legal: a single-round event has no transition, and a
  // competition saved before this field existed has none.
  ok(
    'a single-round event with no advancement is accepted',
    validateCompetitionInput(
      body({ events: [{ eventId: '222', label: '2x2x2', rounds: 1 }], status: 'upcoming' }),
    ).ok,
  );
  const vEmpty = validateCompetitionInput(
    body({ events: [ADV_EVENT({ advancement: undefined })], status: 'upcoming' }),
  );
  ok('omitted advancement defaults to []', vEmpty.ok && Array.isArray(vEmpty.data.events[0].advancement) && vEmpty.data.events[0].advancement.length === 0);

  // ── malformed plans are refused ───────────────────────────────────────
  const reject = (name, advancement, rounds = 3) => {
    const r = validateCompetitionInput(
      body({ events: [ADV_EVENT({ advancement, rounds })], status: 'upcoming' }),
    );
    ok(name, !r.ok, r.ok ? 'accepted!' : r.error);
  };
  reject('rejects method not in the enum', [{ fromRound: 1, method: 'top', value: 5 }]);
  reject('rejects value 0', [{ fromRound: 1, method: 'count', value: 0 }]);
  reject('rejects a negative value', [{ fromRound: 1, method: 'count', value: -3 }]);
  reject('rejects percent > 100', [{ fromRound: 1, method: 'percent', value: 150 }]);
  reject('rejects a non-integer count', [{ fromRound: 1, method: 'count', value: 2.5 }]);
  // fromRound must be a transition the event actually has: 1..rounds-1.
  reject('rejects fromRound equal to the last round', [{ fromRound: 3, method: 'count', value: 5 }]);
  reject('rejects fromRound beyond the round count', [{ fromRound: 9, method: 'count', value: 5 }]);
  reject('rejects fromRound 0', [{ fromRound: 0, method: 'count', value: 5 }]);
  reject('rejects any advancement on a 1-round event', [{ fromRound: 1, method: 'count', value: 5 }], 1);
  reject('rejects a duplicate fromRound', [
    { fromRound: 1, method: 'count', value: 5 },
    { fromRound: 1, method: 'percent', value: 50 },
  ]);
  reject('rejects a non-array advancement', 'nope');
  reject('rejects a non-object entry', [42]);
  reject('rejects a non-number value', [{ fromRound: 1, method: 'count', value: '5' }]);

  // A 2.5 count is rejected but a 2.5 PERCENT is legal — mirroring
  // validateQualifierInput, which only demands integers for a count.
  ok(
    'accepts a fractional percent (matches validateQualifierInput)',
    validateCompetitionInput(
      body({ events: [ADV_EVENT({ advancement: [{ fromRound: 1, method: 'percent', value: 12.5 }] })], status: 'upcoming' }),
    ).ok,
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
});
