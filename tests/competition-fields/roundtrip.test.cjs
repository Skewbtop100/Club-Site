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

const {
  validateCompetitionInput,
  writeCompetitionDoc,
  normalizeStoredSections,
  normalizeStoredEvents,
  normalizeStoredSchedule,
  countRegistrationsFor,
} = require(path.join(OUT, 'admin-competitions.js'));
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


  // ── events[].resultFormat ─────────────────────────────────────────────
  // Same rebuild trap as advancement: validateCompetitionInput reconstructs
  // each event field by field, so an unlisted property is silently dropped.
  const FMT_EVENT = (over = {}) => ({ eventId: '333', label: '3x3x3', rounds: 1, ...over });

  const vFmt = validateCompetitionInput(
    body({ events: [FMT_EVENT({ resultFormat: 'mo3' })], status: 'upcoming' }),
  );
  ok('resultFormat survives validation', vFmt.ok && vFmt.data.events[0].resultFormat === 'mo3',
    vFmt.ok ? String(vFmt.data.events[0].resultFormat) : vFmt.error);

  const fmtId = await writeCompetitionDoc(db, null, vFmt.data);
  ok('resultFormat round-trips through Firestore',
    (await read(fmtId)).events?.[0]?.resultFormat === 'mo3',
    JSON.stringify((await read(fmtId)).events?.[0]));

  for (const f of ['ao5', 'mo3', 'bo3', 'bo2', 'bo1']) {
    const r = validateCompetitionInput(body({ events: [FMT_EVENT({ resultFormat: f })], status: 'upcoming' }));
    ok(`accepts resultFormat '${f}'`, r.ok && r.data.events[0].resultFormat === f, r.ok ? '' : r.error);
  }

  // Absent -> 'ao5' at write time; no backfill needed for legacy events.
  const vNoFmt = validateCompetitionInput(body({ events: [FMT_EVENT()], status: 'upcoming' }));
  ok('omitted resultFormat defaults to ao5', vNoFmt.ok && vNoFmt.data.events[0].resultFormat === 'ao5',
    vNoFmt.ok ? String(vNoFmt.data.events[0].resultFormat) : vNoFmt.error);

  // A PRESENT but bogus value is refused rather than silently defaulted —
  // quietly rewriting an admin's choice is worse than saying it was wrong.
  for (const bad of ['ao3', 'AO5', '', 5, null, {}]) {
    const r = validateCompetitionInput(body({ events: [FMT_EVENT({ resultFormat: bad })], status: 'upcoming' }));
    // null/undefined are "absent" and legal; everything else must fail.
    const shouldPass = bad === null;
    ok(`resultFormat ${JSON.stringify(bad)} is ${shouldPass ? 'treated as absent' : 'REJECTED'}`,
      r.ok === shouldPass, r.ok ? 'accepted' : r.error);
  }

  // ── the format lock ───────────────────────────────────────────────────
  // An event's resultFormat may not change once a JUDGED submission exists
  // for it. Enforced in writeCompetitionDoc, inside the same transaction
  // that performs the write.
  const LOCK = 'comp-lock';
  const lockEvents = (fmt) => [
    { eventId: '333', label: '3x3x3', rounds: 1, resultFormat: fmt },
    { eventId: '222', label: '2x2x2', rounds: 1, resultFormat: 'ao5' },
  ];
  const saveLock = async (fmt) => {
    const r = validateCompetitionInput(body({ events: lockEvents(fmt), status: 'upcoming' }));
    if (!r.ok) throw new Error(r.error);
    return writeCompetitionDoc(db, LOCK, r.data);
  };

  await db.collection('onlineCompetitions').doc(LOCK).set({ name: 'lock', status: 'draft', events: [] });
  await saveLock('ao5');
  ok('lock: format is freely changeable while nothing is judged',
    await saveLock('mo3').then(() => true).catch((e) => e.message));
  ok('  ...and the change actually landed', (await read(LOCK)).events?.[0]?.resultFormat === 'mo3',
    JSON.stringify((await read(LOCK)).events?.[0]));
  await saveLock('ao5');

  // A PENDING submission must NOT lock — nothing has been derived from it.
  const pendingRef = await db.collection('onlineSubmissions').add({
    competitionId: LOCK, uid: 'u1', event: '333', round: 1, competitionRound: 1,
    reportedTime: 1000, penalty: null, status: 'pending',
  });
  ok('lock: a PENDING submission does not lock the format',
    await saveLock('bo3').then(() => true).catch((e) => e.message));
  await saveLock('ao5');

  // An APPROVED submission locks it.
  const approvedRef = await db.collection('onlineSubmissions').add({
    competitionId: LOCK, uid: 'u1', event: '333', round: 1, competitionRound: 1,
    reportedTime: 1000, penalty: null, status: 'approved',
  });
  let refused = null;
  try { await saveLock('mo3'); } catch (e) { refused = e; }
  ok('lock: an APPROVED submission REFUSES a format change', refused !== null, 'change was allowed');
  ok('  ...with a CompetitionWriteError', refused?.constructor?.name === 'CompetitionWriteError', refused?.constructor?.name);
  ok('  ...naming the event', /333/.test(refused?.message ?? ''), refused?.message);
  ok('  ...and the stored format is untouched', (await read(LOCK)).events?.[0]?.resultFormat === 'ao5',
    JSON.stringify((await read(LOCK)).events?.[0]));

  // The whole write is refused, so the sibling event's edit is rolled back
  // too — the transaction is all-or-nothing, not a partial save.
  ok('lock: an unrelated event in the same save is unchanged',
    (await read(LOCK)).events?.[1]?.resultFormat === 'ao5',
    JSON.stringify((await read(LOCK)).events?.[1]));

  // Saving WITHOUT changing the locked format still works — an admin must
  // still be able to edit everything else about a running competition.
  ok('lock: re-saving the same format is allowed',
    await saveLock('ao5').then(() => true).catch((e) => e.message));

  // A REJECTED submission locks it too: a rejected attempt is a DNF that
  // counts toward a result, so it is just as much at risk.
  await approvedRef.delete();
  await db.collection('onlineSubmissions').add({
    competitionId: LOCK, uid: 'u1', event: '333', round: 1, competitionRound: 1,
    reportedTime: 0, penalty: 'DNF', status: 'rejected',
  });
  let refusedRejected = null;
  try { await saveLock('bo1'); } catch (e) { refusedRejected = e; }
  ok('lock: a REJECTED submission also refuses a format change', refusedRejected !== null, 'change was allowed');

  // A judged submission for a DIFFERENT event does not lock this one.
  ok('lock: only the event with results is locked',
    await (async () => {
      const r = validateCompetitionInput(body({
        events: [
          { eventId: '333', label: '3x3x3', rounds: 1, resultFormat: 'ao5' },
          { eventId: '222', label: '2x2x2', rounds: 1, resultFormat: 'bo3' },
        ],
        status: 'upcoming',
      }));
      return writeCompetitionDoc(db, LOCK, r.data).then(() => true).catch((e) => e.message);
    })());

  await pendingRef.delete();




  // ── baseFeeMnt + events[].surchargeMnt ────────────────────────────────
  // Two new fields, one top-level and one NESTED on events[]. The nested
  // one goes through the same field-by-field rebuild that ate
  // `advancement` and nearly ate `resultFormat`, so these pin that it is
  // actually carried — and that EVENT_FIELDS now makes a forgotten field a
  // loud refusal instead of a silent drop.
  const FEE_EVENTS = [
    { eventId: '333', label: '3x3x3', rounds: 1 },
    { eventId: '222', label: '2x2x2', rounds: 1, surchargeMnt: null },
    { eventId: '444', label: '4x4x4', rounds: 1, surchargeMnt: 5000 },
  ];
  const feeBody = (over = {}) => body({ paid: true, baseFeeMnt: 15000, events: FEE_EVENTS, status: 'upcoming', ...over });

  const vFee = validateCompetitionInput(feeBody());
  ok('the fee payload validates', vFee.ok, vFee.ok ? '' : vFee.error);
  ok('baseFeeMnt survives validation', vFee.ok && vFee.data.baseFeeMnt === 15000,
    vFee.ok ? String(vFee.data.baseFeeMnt) : '');
  ok('surchargeMnt survives the per-event rebuild', vFee.ok && vFee.data.events[2].surchargeMnt === 5000,
    vFee.ok ? JSON.stringify(vFee.data.events[2]) : '');
  ok('an OMITTED surchargeMnt becomes an explicit null (included)',
    vFee.ok && vFee.data.events[0].surchargeMnt === null, vFee.ok ? JSON.stringify(vFee.data.events[0]) : '');
  ok('an explicit null surchargeMnt stays null', vFee.ok && vFee.data.events[1].surchargeMnt === null);

  const feeId = await writeCompetitionDoc(db, null, vFee.data);
  const dFee = await read(feeId);
  ok('baseFeeMnt round-trips through Firestore', dFee.baseFeeMnt === 15000, String(dFee.baseFeeMnt));
  ok('surchargeMnt round-trips through Firestore', dFee.events?.[2]?.surchargeMnt === 5000,
    JSON.stringify(dFee.events?.[2]));
  ok('  ...and the included events store null, not undefined',
    dFee.events?.[0]?.surchargeMnt === null && dFee.events?.[1]?.surchargeMnt === null,
    JSON.stringify(dFee.events?.map((e) => e.surchargeMnt)));
  ok('normalizeStoredEvents reads the surcharge back',
    normalizeStoredEvents(dFee.events)[2].surchargeMnt === 5000,
    JSON.stringify(normalizeStoredEvents(dFee.events).map((e) => e.surchargeMnt)));

  // ── the fee is NOT gated on `paid` ────────────────────────────────────
  // The Төлбөр tab hides its contents when Төлбөргүй but never clears
  // them, so toggling back must restore what was configured — exactly the
  // treatment the featured banner copy gets.
  await writeCompetitionDoc(db, feeId, validateCompetitionInput(feeBody({ paid: false })).data);
  const dUnpaid = await read(feeId);
  ok('switching to Төлбөргүй does NOT clear baseFeeMnt', dUnpaid.paid === false && dUnpaid.baseFeeMnt === 15000,
    String(dUnpaid.baseFeeMnt));
  ok('  ...nor the per-event surcharges', dUnpaid.events?.[2]?.surchargeMnt === 5000,
    JSON.stringify(dUnpaid.events?.[2]));
  await writeCompetitionDoc(db, feeId, validateCompetitionInput(feeBody({ paid: true })).data);
  ok('switching back to Төлбөртэй finds the fee still there', (await read(feeId)).baseFeeMnt === 15000);

  // ── removing an event takes its surcharge with it ─────────────────────
  // The surcharge is NESTED on the event, so there is no orphan to clean
  // up: deleting the event on the Төрөл tab deletes the fee that was
  // attached to it. A parallel surcharges-by-eventId map would strand one.
  await writeCompetitionDoc(db, feeId, validateCompetitionInput(feeBody({
    events: [{ eventId: '333', label: '3x3x3', rounds: 1 }],
  })).data);
  const dDropped = await read(feeId);
  ok('removing the surcharged event leaves NO trace of its surcharge',
    dDropped.events?.length === 1 &&
      dDropped.events[0].eventId === '333' &&
      dDropped.events.every((e) => e.surchargeMnt === null),
    JSON.stringify(dDropped.events));
  // And re-adding it comes back included, not silently still charging.
  await writeCompetitionDoc(db, feeId, validateCompetitionInput(feeBody({
    events: [{ eventId: '333', label: '3x3x3', rounds: 1 }, { eventId: '444', label: '4x4x4', rounds: 1 }],
  })).data);
  ok('re-adding the event comes back INCLUDED, not still surcharged',
    (await read(feeId)).events?.[1]?.surchargeMnt === null,
    JSON.stringify((await read(feeId)).events?.[1]));

  // ── defaults ──────────────────────────────────────────────────────────
  const vNoFee = validateCompetitionInput({ name: 'legacy', status: 'draft', events: [] });
  ok('omitted baseFeeMnt defaults to null', vNoFee.ok && vNoFee.data.baseFeeMnt === null);
  ok('null baseFeeMnt stays null', validateCompetitionInput(body({ baseFeeMnt: null })).data.baseFeeMnt === null);
  ok('a baseFeeMnt of 0 is kept as 0, NOT flattened to null',
    validateCompetitionInput(body({ baseFeeMnt: 0 })).data.baseFeeMnt === 0,
    String(validateCompetitionInput(body({ baseFeeMnt: 0 })).data.baseFeeMnt));
  ok('a legacy event with no surchargeMnt reads as null',
    normalizeStoredEvents([{ eventId: '333', label: '3x3x3', rounds: 1 }])[0].surchargeMnt === null);

  // ── malformed fees are REFUSED ────────────────────────────────────────
  const rejectFee = (name, over) => {
    const r = validateCompetitionInput(feeBody(over));
    ok(name, !r.ok, r.ok ? 'accepted!' : r.error);
  };
  rejectFee('rejects a negative baseFeeMnt', { baseFeeMnt: -1 });
  rejectFee('rejects a fractional baseFeeMnt', { baseFeeMnt: 15000.5 });
  rejectFee('rejects a string baseFeeMnt', { baseFeeMnt: '15000' });
  rejectFee('rejects NaN baseFeeMnt', { baseFeeMnt: NaN });
  rejectFee('rejects Infinity baseFeeMnt', { baseFeeMnt: Infinity });

  const rejectSur = (name, surchargeMnt) =>
    rejectFee(name, { events: [{ eventId: '333', label: '3x3x3', rounds: 1, surchargeMnt }] });
  // 0 is the load-bearing one: "costs nothing extra" is already spelled
  // null, and accepting both would give one fact two representations.
  rejectSur('rejects a surchargeMnt of 0 (null already means included)', 0);
  rejectSur('rejects a negative surchargeMnt', -5000);
  rejectSur('rejects a fractional surchargeMnt', 2500.5);
  rejectSur('rejects a string surchargeMnt', '5000');
  rejectSur('rejects NaN surchargeMnt', NaN);

  // ── the events allow-list ─────────────────────────────────────────────
  // EVENT_FIELDS turns the rebuild trap inside out: a per-event key that
  // is not registered is now a REFUSED WRITE naming the field, not a value
  // that vanishes on reload. This is the assertion that would have caught
  // the advancement and resultFormat drops.
  const unknownField = validateCompetitionInput(feeBody({
    events: [{ eventId: '333', label: '3x3x3', rounds: 1, surchargeUsd: 5 }],
  }));
  ok('an UNKNOWN per-event field is REFUSED, not silently dropped', !unknownField.ok,
    unknownField.ok ? 'accepted!' : unknownField.error);
  ok('  ...and the refusal names the field', /surchargeUsd/.test(unknownField.error ?? ''), unknownField.error);
  // Every registered field still passes together, in one event.
  const allFields = validateCompetitionInput(feeBody({
    events: [{
      eventId: '333', label: '3x3x3', rounds: 2, resultFormat: 'ao5', timeLimitCs: 60000,
      cutoffs: [{ round: 1, cutoffCs: 30000 }],
      advancement: [{ fromRound: 1, method: 'count', value: 8 }],
      surchargeMnt: 5000,
    }],
  }));
  ok('every registered per-event field survives together', allFields.ok, allFields.ok ? '' : allFields.error);
  ok('  ...all seven of them', allFields.ok &&
    allFields.data.events[0].resultFormat === 'ao5' &&
    allFields.data.events[0].timeLimitCs === 60000 &&
    allFields.data.events[0].cutoffs.length === 1 &&
    allFields.data.events[0].advancement.length === 1 &&
    allFields.data.events[0].surchargeMnt === 5000 &&
    allFields.data.events[0].rounds === 2 &&
    allFields.data.events[0].label === '3x3x3',
    allFields.ok ? JSON.stringify(allFields.data.events[0]) : '');

  // ── a competition with no fee is unchanged ────────────────────────────
  const plainFeeId = await writeCompetitionDoc(db, null, validateCompetitionInput(body()).data);
  const dPlainFee = await read(plainFeeId);
  ok('a competition with no fee stores baseFeeMnt: null', dPlainFee.baseFeeMnt === null, String(dPlainFee.baseFeeMnt));
  ok('  ...and paid stays false', dPlainFee.paid === false);

  // ── countRegistrationsFor — what the fee-change warning counts ────────
  const REG = 'comp-fee-reg';
  await db.collection('onlineCompetitions').doc(REG).set({ name: 'reg', status: 'upcoming', events: [] });
  ok('no registrations -> 0', (await countRegistrationsFor(db, REG)) === 0);
  await db.collection('onlineParticipants').doc('p1').collection('registrations').doc(REG)
    .set({ competitionId: REG, events: ['333'], status: 'registered' });
  await db.collection('onlineParticipants').doc('p2').collection('registrations').doc(REG)
    .set({ competitionId: REG, events: ['333', '444'], status: 'registered' });
  ok('two registrations -> 2', (await countRegistrationsFor(db, REG)) === 2,
    String(await countRegistrationsFor(db, REG)));
  // Another competition's registrations must not be counted.
  await db.collection('onlineParticipants').doc('p1').collection('registrations').doc('other')
    .set({ competitionId: 'other', events: ['333'], status: 'registered' });
  ok('another competition’s registrations are not counted', (await countRegistrationsFor(db, REG)) === 2);
  // The grandparent guard: an unrelated top-level `registrations`
  // collection exists in this database and the same collectionGroup query
  // pulls it in without the check.
  await db.collection('registrations').doc('decoy').set({ competitionId: REG });
  ok('a top-level registrations doc is EXCLUDED by the grandparent guard',
    (await countRegistrationsFor(db, REG)) === 2, String(await countRegistrationsFor(db, REG)));


  // ── sections[] — admin-authored custom tabs ───────────────────────────
  // The THIRD nested structure through validateCompetitionInput, and the
  // first with two levels of nesting. The rebuild trap that ate
  // `advancement` and nearly ate `resultFormat` applies at BOTH levels
  // here, so these pin: every field survives at both levels, ids survive a
  // reorder, array order is the stored order, and each malformed shape is
  // refused rather than quietly dropped.
  const SEC_IMG = 'https://res.cloudinary.com/x/image/upload/sec.jpg';
  const SECTIONS = () => [
    {
      id: 'sec-a',
      title: 'Шагнал',
      blocks: [
        { id: 'blk-1', type: 'text', text: '  1-р байр: 500,000₮  ' },
        { id: 'blk-2', type: 'image', imageUrl: SEC_IMG, imagePublicId: 'comp/sec_abc' },
        { id: 'blk-3', type: 'video', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42' },
      ],
    },
    { id: 'sec-b', title: 'Дүрэм', blocks: [{ id: 'blk-4', type: 'text', text: 'WCA дүрэм үйлчилнэ.' }] },
  ];
  const secBody = (sections) => body({ sections });
  const vSec = validateCompetitionInput(secBody(SECTIONS()));
  ok('sections survive validation', vSec.ok, vSec.ok ? '' : vSec.error);
  ok('  ...both sections, in order', vSec.ok && vSec.data.sections.map((s) => s.title).join(',') === 'Шагнал,Дүрэм',
    vSec.ok ? JSON.stringify(vSec.data.sections.map((s) => s.title)) : '');
  ok('  ...section ids are preserved verbatim',
    vSec.ok && vSec.data.sections.map((s) => s.id).join(',') === 'sec-a,sec-b');
  ok('  ...block order within a section is preserved',
    vSec.ok && vSec.data.sections[0].blocks.map((b) => b.id).join(',') === 'blk-1,blk-2,blk-3',
    vSec.ok ? JSON.stringify(vSec.data.sections[0].blocks.map((b) => b.id)) : '');
  ok('  ...block types are preserved',
    vSec.ok && vSec.data.sections[0].blocks.map((b) => b.type).join(',') === 'text,image,video');

  // The per-type payload fields: the exact thing the rebuild trap eats.
  const blk = (i) => (vSec.ok ? vSec.data.sections[0].blocks[i] : {});
  ok('a text block keeps `text` VERBATIM (not trimmed)', blk(0).text === '  1-р байр: 500,000₮  ',
    JSON.stringify(blk(0).text));
  ok('an image block keeps imageUrl', blk(1).imageUrl === SEC_IMG, String(blk(1).imageUrl));
  ok('an image block keeps imagePublicId', blk(1).imagePublicId === 'comp/sec_abc', String(blk(1).imagePublicId));
  ok('a video block keeps videoUrl (query string and all)',
    blk(2).videoUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', String(blk(2).videoUrl));
  // No block carries a key belonging to another type, and no undefined
  // sneaks in — Firestore refuses undefined values outright.
  ok('a text block carries ONLY id/type/text', Object.keys(blk(0)).sort().join(',') === 'id,text,type',
    Object.keys(blk(0)).join(','));
  ok('a video block carries ONLY id/type/videoUrl', Object.keys(blk(2)).sort().join(',') === 'id,type,videoUrl',
    Object.keys(blk(2)).join(','));

  // ── the Firestore round trip ──────────────────────────────────────────
  const secId = await writeCompetitionDoc(db, null, vSec.data);
  const dSec = await read(secId);
  ok('sections round-trip through Firestore byte-identical',
    JSON.stringify(dSec.sections) === JSON.stringify(vSec.data.sections),
    JSON.stringify(dSec.sections));
  ok('  ...with block order intact after the round trip',
    dSec.sections?.[0]?.blocks?.map((b) => b.id).join(',') === 'blk-1,blk-2,blk-3');
  ok('  ...and the read normaliser returns the same thing',
    JSON.stringify(normalizeStoredSections(dSec.sections)) === JSON.stringify(vSec.data.sections),
    JSON.stringify(normalizeStoredSections(dSec.sections)));

  // ── ids survive a reorder ─────────────────────────────────────────────
  // What the ids exist for. The editor's moveItem moves the ELEMENT, so a
  // reordered save carries the same ids in a new order — never the same
  // order with swapped contents, which is what index-keying would produce.
  const reordered = SECTIONS();
  reordered[0].blocks = [reordered[0].blocks[2], reordered[0].blocks[0], reordered[0].blocks[1]];
  reordered.reverse();
  const vMove = validateCompetitionInput(secBody(reordered));
  ok('a reorder validates', vMove.ok, vMove.ok ? '' : vMove.error);
  ok('reordering SECTIONS keeps their ids, in the new order',
    vMove.ok && vMove.data.sections.map((s) => s.id).join(',') === 'sec-b,sec-a',
    vMove.ok ? JSON.stringify(vMove.data.sections.map((s) => s.id)) : '');
  ok('reordering BLOCKS keeps their ids, in the new order',
    vMove.ok && vMove.data.sections[1].blocks.map((b) => b.id).join(',') === 'blk-3,blk-1,blk-2',
    vMove.ok ? JSON.stringify(vMove.data.sections[1].blocks.map((b) => b.id)) : '');
  ok('  ...and each id still carries its OWN content (not the one that was in its slot)',
    vMove.ok &&
      vMove.data.sections[1].blocks[0].videoUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42' &&
      vMove.data.sections[1].blocks[1].text === '  1-р байр: 500,000₮  ' &&
      vMove.data.sections[1].blocks[2].imageUrl === SEC_IMG);
  await writeCompetitionDoc(db, secId, vMove.data);
  const dMove = await read(secId);
  ok('the reorder PERSISTS (merge:true replaces the array, not element-wise)',
    dMove.sections?.map((s) => s.id).join(',') === 'sec-b,sec-a',
    JSON.stringify(dMove.sections?.map((s) => s.id)));

  // Deleting a section must shorten the stored array, not leave a tail.
  await writeCompetitionDoc(db, secId, validateCompetitionInput(secBody([SECTIONS()[1]])).data);
  const dDel = await read(secId);
  ok('deleting a section shortens the stored array', dDel.sections?.length === 1, JSON.stringify(dDel.sections));
  ok('  ...leaving the right one', dDel.sections?.[0]?.id === 'sec-b');

  // ── absent / empty defaults cleanly ───────────────────────────────────
  for (const [label, raw] of [['omitted', undefined], ['null', null], ['empty array', []]]) {
    const r = validateCompetitionInput(secBody(raw));
    ok(`${label} sections defaults to []`, r.ok && Array.isArray(r.data.sections) && r.data.sections.length === 0,
      r.ok ? JSON.stringify(r.data.sections) : r.error);
  }
  const vLegacy = validateCompetitionInput({ name: 'legacy', status: 'draft', events: [] });
  ok('a payload with no sections key at all validates', vLegacy.ok && vLegacy.data.sections.length === 0);
  ok('normalizeStoredSections([]) is []', normalizeStoredSections([]).length === 0);
  ok('normalizeStoredSections(undefined) is [] (a legacy doc)', normalizeStoredSections(undefined).length === 0);
  ok('normalizeStoredSections of junk is []', normalizeStoredSections('nope').length === 0);

  // ── a competition with no sections is BYTE-IDENTICAL to before ────────
  // The whole point of "absent/empty = no custom sections": adding this
  // field must not change a single existing document beyond an empty
  // array, and must not perturb any other field.
  // EVERY key toFirestoreDoc writes, listed once. Asserted as an exact set
  // rather than as "one more than last time": a field that silently
  // appears is as much a bug as one that silently vanishes, and this
  // catches both without needing an edit per changeset.
  const DOC_KEYS = [
    'name', 'description', 'startAt', 'registrationDeadline', 'participantLimit', 'events', 'status',
    'season', 'registrationOpensAt', 'endAt', 'format', 'featured', 'featuredHeading', 'featuredCtaLabel',
    'featuredUntil', 'instructions', 'paid', 'baseFeeMnt', 'posterUrl', 'posterPublicId', 'bannerUrl',
    'bannerPublicId', 'sections', 'schedule',
  ];
  // The subset that predates custom sections and fees — what "unchanged
  // for a competition that uses neither" means.
  const beforeKeys = DOC_KEYS.filter((k) => k !== 'sections' && k !== 'baseFeeMnt' && k !== 'schedule');
  const plainId = await writeCompetitionDoc(db, null, validateCompetitionInput(body()).data);
  const dPlain = await read(plainId);
  ok('a competition with no sections stores sections: []',
    Array.isArray(dPlain.sections) && dPlain.sections.length === 0, JSON.stringify(dPlain.sections));
  ok('  ...and every pre-existing field is untouched',
    beforeKeys.every((k) => JSON.stringify(dPlain[k]) === JSON.stringify(dSec[k]) || k === 'sections'),
    beforeKeys.filter((k) => JSON.stringify(dPlain[k]) !== JSON.stringify(dSec[k])).join(','));
  ok('  ...and the stored key set is EXACTLY the documented one',
    Object.keys(dPlain).filter((k) => k !== 'createdAt').sort().join(',') === DOC_KEYS.slice().sort().join(','),
    `unexpected: ${Object.keys(dPlain).filter((k) => k !== 'createdAt' && !DOC_KEYS.includes(k)).join(',') || 'none'}` +
      ` / missing: ${DOC_KEYS.filter((k) => !(k in dPlain)).join(',') || 'none'}`);
  ok('  ...and the later additions are the only ones beyond the old shape',
    Object.keys(dPlain).filter((k) => k !== 'createdAt' && !beforeKeys.includes(k)).sort().join(',') ===
      'baseFeeMnt,schedule,sections',
    Object.keys(dPlain).filter((k) => k !== 'createdAt' && !beforeKeys.includes(k)).join(','));

  // ── malformed sections are REFUSED, never dropped ─────────────────────
  const rejectSec = (name, sections) => {
    const r = validateCompetitionInput(secBody(sections));
    ok(name, !r.ok, r.ok ? `accepted! -> ${JSON.stringify(r.data.sections)}` : r.error);
  };
  const oneSec = (over = {}) => [{ id: 'sec-a', title: 'Шагнал', blocks: [], ...over }];
  const oneBlk = (block) => [{ id: 'sec-a', title: 'Шагнал', blocks: [block] }];

  rejectSec('rejects a non-array sections', 'nope');
  rejectSec('rejects a non-object section', [42]);
  rejectSec('rejects a section with NO title', oneSec({ title: '' }));
  rejectSec('rejects a whitespace-only title', oneSec({ title: '   ' }));
  rejectSec('rejects a missing title', [{ id: 'sec-a', blocks: [] }]);
  rejectSec('rejects a non-string title', oneSec({ title: 7 }));
  rejectSec('rejects a section with no id', [{ title: 'Шагнал', blocks: [] }]);
  rejectSec('rejects duplicate section ids', [
    { id: 'same', title: 'A', blocks: [] },
    { id: 'same', title: 'B', blocks: [] },
  ]);
  rejectSec('rejects an unknown section field', oneSec({ colour: 'red' }));
  rejectSec('rejects non-array blocks', oneSec({ blocks: 'nope' }));

  rejectSec('rejects an unknown block type', oneBlk({ id: 'b', type: 'audio', text: 'x' }));
  rejectSec('rejects a block with no type', oneBlk({ id: 'b', text: 'x' }));
  rejectSec('rejects a block with no id', oneBlk({ type: 'text', text: 'x' }));
  rejectSec('rejects duplicate block ids', [
    { id: 'sec-a', title: 'A', blocks: [{ id: 'b', type: 'text', text: '1' }, { id: 'b', type: 'text', text: '2' }] },
  ]);
  rejectSec('rejects an unknown block field', oneBlk({ id: 'b', type: 'text', text: 'x', align: 'left' }));

  // Type/payload mismatch — the case the manifest exists to catch.
  rejectSec('rejects a text block carrying imageUrl', oneBlk({ id: 'b', type: 'text', text: 'x', imageUrl: SEC_IMG }));
  rejectSec('rejects a text block carrying videoUrl',
    oneBlk({ id: 'b', type: 'text', text: 'x', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }));
  rejectSec('rejects an image block carrying text', oneBlk({ id: 'b', type: 'image', imageUrl: SEC_IMG, text: 'x' }));
  rejectSec('rejects a video block carrying imagePublicId',
    oneBlk({ id: 'b', type: 'video', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', imagePublicId: 'x' }));
  rejectSec('rejects a text block with a videoUrl payload and no text',
    oneBlk({ id: 'b', type: 'text', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }));

  // Required payloads.
  rejectSec('rejects an image block with NO imageUrl', oneBlk({ id: 'b', type: 'image' }));
  rejectSec('rejects an image block with an empty imageUrl', oneBlk({ id: 'b', type: 'image', imageUrl: '   ' }));
  rejectSec('rejects a video block with NO videoUrl', oneBlk({ id: 'b', type: 'video' }));
  rejectSec('rejects a text block with a non-string text', oneBlk({ id: 'b', type: 'text', text: 42 }));

  // Video urls: the same parser the editor reads back with.
  rejectSec('rejects a non-video url', oneBlk({ id: 'b', type: 'video', videoUrl: 'https://example.com/v.mp4' }));
  rejectSec('rejects a YouTube CHANNEL url',
    oneBlk({ id: 'b', type: 'video', videoUrl: 'https://youtube.com/@somechannel' }));
  rejectSec('rejects a YouTube PLAYLIST url (a real link that is not a video)',
    oneBlk({ id: 'b', type: 'video', videoUrl: 'https://youtube.com/playlist?list=PL123456' }));
  rejectSec('rejects a truncated YouTube id',
    oneBlk({ id: 'b', type: 'video', videoUrl: 'https://youtu.be/short' }));

  // Ceilings.
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `T${i}`, blocks: [] }));
  ok('exactly 20 sections is accepted', validateCompetitionInput(secBody(many(20))).ok);
  rejectSec('rejects 21 sections', many(21));
  const manyBlocks = (n) => [
    { id: 'sec-a', title: 'A', blocks: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, type: 'text', text: '' })) },
  ];
  ok('exactly 50 blocks is accepted', validateCompetitionInput(secBody(manyBlocks(50))).ok);
  rejectSec('rejects 51 blocks in one section', manyBlocks(51));

  // ── accepted video urls ───────────────────────────────────────────────
  const acceptVideo = (url) => {
    const r = validateCompetitionInput(secBody(oneBlk({ id: 'b', type: 'video', videoUrl: url })));
    ok(`accepts ${url}`, r.ok, r.ok ? '' : r.error);
  };
  acceptVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  acceptVideo('https://youtu.be/dQw4w9WgXcQ');
  acceptVideo('https://www.youtube.com/embed/dQw4w9WgXcQ');
  acceptVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  acceptVideo('youtube.com/watch?v=dQw4w9WgXcQ');
  acceptVideo('https://vimeo.com/123456789');
  acceptVideo('https://player.vimeo.com/video/123456789');
  acceptVideo('https://vimeo.com/groups/cubing/videos/123456789');

  // An empty section — a title and no blocks — is ACCEPTED, deliberately.
  // The editor warns about it in place; dropping it on save would delete
  // the title the admin just typed on their way to filling it in.
  const vEmptySec = validateCompetitionInput(secBody([{ id: 'e', title: 'Хоосон', blocks: [] }]));
  ok('an EMPTY section is accepted (warned in the editor, never dropped)',
    vEmptySec.ok && vEmptySec.data.sections.length === 1 && vEmptySec.data.sections[0].blocks.length === 0,
    vEmptySec.ok ? JSON.stringify(vEmptySec.data.sections) : vEmptySec.error);
  const vNoBlocks = validateCompetitionInput(secBody([{ id: 'e', title: 'Хоосон' }]));
  ok('  ...and an omitted blocks key becomes []',
    vNoBlocks.ok && Array.isArray(vNoBlocks.data.sections[0].blocks) && vNoBlocks.data.sections[0].blocks.length === 0);

  // ── the read normaliser is FORGIVING where the writer is strict ───────
  // A write is refused when malformed; a READ must still open, or the
  // admin cannot get in to fix the document.
  const messy = normalizeStoredSections([
    { title: 'Гарчиггүй ID', blocks: [{ type: 'text', text: 'x' }] },
    { id: 'ok', title: 'Зөв', blocks: [{ id: 'b1', type: 'nope' }, { id: 'b2', type: 'image' }, { id: 'b3', type: 'text' }] },
    { id: 'no-title', title: '  ', blocks: [] },
    'junk',
  ]);
  ok('read: a section with no id gets a positional fallback', messy[0]?.id === 's1', JSON.stringify(messy[0]));
  ok('read: a block with no id gets a positional fallback', messy[0]?.blocks?.[0]?.id === 's1-b1',
    JSON.stringify(messy[0]?.blocks));
  ok('read: an unknown block type is dropped, not thrown on',
    messy[1]?.blocks?.every((b) => b.id !== 'b1'), JSON.stringify(messy[1]?.blocks));
  ok('read: an image block with no image is dropped', messy[1]?.blocks?.every((b) => b.id !== 'b2'));
  ok('read: a text block with no text becomes text: ""',
    messy[1]?.blocks?.find((b) => b.id === 'b3')?.text === '');
  ok('read: a section with no title is dropped (it could not be saved back)',
    messy.every((s) => s.id !== 'no-title'), JSON.stringify(messy.map((s) => s.id)));
  ok('read: junk entries are dropped', messy.length === 2, String(messy.length));



  // ── schedule[] — the announced programme ──────────────────────────────
  // The fourth structure through validateCompetitionInput and the third to
  // use the manifest, this time per-KIND: a 'round' entry and an 'other'
  // entry carry different payloads, and a key belonging to the other kind
  // is what "kind does not match its payload" means.
  const SCHEDULE = () => [
    { id: 'sch-1', startMin: 600, durationMin: 30, kind: 'other', label: 'Бүртгэл / танилцуулга', note: '' },
    { id: 'sch-2', startMin: 630, durationMin: 60, kind: 'round', eventId: '333', round: 1, note: 'Шүүгч: Б.Ууганбаяр' },
    { id: 'sch-3', startMin: 690, durationMin: 45, kind: 'round', eventId: '222', round: 2 },
  ];
  const schBody = (schedule) => body({ schedule });

  const vSch = validateCompetitionInput(schBody(SCHEDULE()));
  ok('the schedule validates', vSch.ok, vSch.ok ? '' : vSch.error);
  ok('  ...all three rows, in order',
    vSch.ok && vSch.data.schedule.map((r) => r.id).join(',') === 'sch-1,sch-2,sch-3',
    vSch.ok ? JSON.stringify(vSch.data.schedule.map((r) => r.id)) : '');
  ok('  ...startMin survives', vSch.ok && vSch.data.schedule[1].startMin === 630);
  ok('  ...durationMin survives', vSch.ok && vSch.data.schedule[1].durationMin === 60);
  ok('  ...eventId and round survive the per-kind rebuild',
    vSch.ok && vSch.data.schedule[1].eventId === '333' && vSch.data.schedule[1].round === 1,
    vSch.ok ? JSON.stringify(vSch.data.schedule[1]) : '');
  ok('  ...label survives on an other row', vSch.ok && vSch.data.schedule[0].label === 'Бүртгэл / танилцуулга');
  ok('  ...note survives', vSch.ok && vSch.data.schedule[1].note === 'Шүүгч: Б.Ууганбаяр');
  ok('  ...an empty note is kept as ""', vSch.ok && vSch.data.schedule[0].note === '');
  ok('  ...an omitted note is simply absent (never undefined)',
    vSch.ok && !('note' in vSch.data.schedule[2]), JSON.stringify(vSch.data.schedule[2]));
  // No key from the other kind, and no undefined — Firestore refuses one.
  ok('a round row carries ONLY its own keys',
    vSch.ok && Object.keys(vSch.data.schedule[2]).sort().join(',') === 'durationMin,eventId,id,kind,round,startMin',
    vSch.ok ? Object.keys(vSch.data.schedule[2]).join(',') : '');
  ok('an other row carries ONLY its own keys',
    vSch.ok && Object.keys(vSch.data.schedule[0]).sort().join(',') === 'durationMin,id,kind,label,note,startMin',
    vSch.ok ? Object.keys(vSch.data.schedule[0]).join(',') : '');

  // ── the Firestore round trip ──────────────────────────────────────────
  const schId = await writeCompetitionDoc(db, null, vSch.data);
  const dSch = await read(schId);
  ok('the schedule round-trips byte-identical',
    JSON.stringify(dSch.schedule) === JSON.stringify(vSch.data.schedule), JSON.stringify(dSch.schedule));
  ok('  ...with row order intact', dSch.schedule?.map((r) => r.id).join(',') === 'sch-1,sch-2,sch-3');
  ok('  ...and the read normaliser agrees',
    JSON.stringify(normalizeStoredSchedule(dSch.schedule)) === JSON.stringify(vSch.data.schedule),
    JSON.stringify(normalizeStoredSchedule(dSch.schedule)));

  // ── ids survive a reorder ─────────────────────────────────────────────
  // The same property sections and blocks have, for the same reason: the
  // editor's moveItem moves the ELEMENT, so an id travels with its own
  // programme and note rather than being reassigned to a new slot.
  const schMoved = SCHEDULE();
  schMoved.reverse();
  const vSchMove = validateCompetitionInput(schBody(schMoved));
  ok('a reorder validates', vSchMove.ok, vSchMove.ok ? '' : vSchMove.error);
  ok('reordering keeps the ids, in the new order',
    vSchMove.ok && vSchMove.data.schedule.map((r) => r.id).join(',') === 'sch-3,sch-2,sch-1',
    vSchMove.ok ? JSON.stringify(vSchMove.data.schedule.map((r) => r.id)) : '');
  ok('  ...and each id still carries its OWN programme',
    vSchMove.ok &&
      vSchMove.data.schedule[0].eventId === '222' &&
      vSchMove.data.schedule[1].eventId === '333' &&
      vSchMove.data.schedule[2].label === 'Бүртгэл / танилцуулга',
    vSchMove.ok ? JSON.stringify(vSchMove.data.schedule) : '');
  await writeCompetitionDoc(db, schId, vSchMove.data);
  ok('the reorder PERSISTS (the array is replaced, not merged element-wise)',
    (await read(schId)).schedule?.map((r) => r.id).join(',') === 'sch-3,sch-2,sch-1',
    JSON.stringify((await read(schId)).schedule?.map((r) => r.id)));
  // Rows are NOT re-sorted by startMin: the accumulation is what produces
  // startMin, so sorting by it would be circular, and a half-edited
  // schedule must not be silently rearranged under the admin.
  ok('rows are NOT re-sorted by startMin',
    vSchMove.ok && vSchMove.data.schedule.map((r) => r.startMin).join(',') === '690,630,600',
    vSchMove.ok ? JSON.stringify(vSchMove.data.schedule.map((r) => r.startMin)) : '');

  // Deleting rows shortens the stored array rather than leaving a tail.
  await writeCompetitionDoc(db, schId, validateCompetitionInput(schBody([SCHEDULE()[0]])).data);
  const dSchDel = await read(schId);
  ok('deleting rows shortens the stored array', dSchDel.schedule?.length === 1, JSON.stringify(dSchDel.schedule));
  ok('  ...leaving the right one', dSchDel.schedule?.[0]?.id === 'sch-1');

  // ── absent / empty defaults cleanly ───────────────────────────────────
  for (const [label, raw] of [['omitted', undefined], ['null', null], ['empty array', []]]) {
    const r = validateCompetitionInput(schBody(raw));
    ok(`${label} schedule defaults to []`,
      r.ok && Array.isArray(r.data.schedule) && r.data.schedule.length === 0,
      r.ok ? JSON.stringify(r.data.schedule) : r.error);
  }
  ok('a payload with no schedule key at all validates',
    validateCompetitionInput({ name: 'legacy', status: 'draft', events: [] }).data.schedule.length === 0);
  ok('normalizeStoredSchedule(undefined) is [] (a legacy doc)', normalizeStoredSchedule(undefined).length === 0);
  ok('normalizeStoredSchedule of junk is []', normalizeStoredSchedule('nope').length === 0);
  const dNoSch = await read(await writeCompetitionDoc(db, null, validateCompetitionInput(body()).data));
  ok('a competition with no schedule stores schedule: []',
    Array.isArray(dNoSch.schedule) && dNoSch.schedule.length === 0, JSON.stringify(dNoSch.schedule));

  // ── malformed rows are REFUSED, never dropped ─────────────────────────
  const rejectSch = (name, schedule) => {
    const r = validateCompetitionInput(schBody(schedule));
    ok(name, !r.ok, r.ok ? `accepted! -> ${JSON.stringify(r.data.schedule)}` : r.error);
  };
  const oneRound = (over = {}) => [{ id: 's', startMin: 600, durationMin: 30, kind: 'round', eventId: '333', round: 1, ...over }];
  const oneOther = (over = {}) => [{ id: 's', startMin: 600, durationMin: 30, kind: 'other', label: 'Бүртгэл', ...over }];

  rejectSch('rejects a non-array schedule', 'nope');
  rejectSch('rejects a non-object row', [42]);
  rejectSch('rejects an unknown kind', [{ id: 's', startMin: 600, durationMin: 30, kind: 'lunch', label: 'x' }]);
  rejectSch('rejects a row with no kind', [{ id: 's', startMin: 600, durationMin: 30, label: 'x' }]);
  rejectSch('rejects a row with no id', [{ startMin: 600, durationMin: 30, kind: 'other', label: 'x' }]);
  rejectSch('rejects duplicate ids', [...oneOther(), ...oneOther()]);
  rejectSch('rejects an unknown schedule field', oneRound({ colour: 'red' }));

  // The two the brief calls out by name.
  rejectSch('rejects a ROUND row with NO eventId',
    [{ id: 's', startMin: 600, durationMin: 30, kind: 'round', round: 1 }]);
  rejectSch('rejects an OTHER row with NO label',
    [{ id: 's', startMin: 600, durationMin: 30, kind: 'other' }]);
  rejectSch('rejects a round row with no round', [{ id: 's', startMin: 600, durationMin: 30, kind: 'round', eventId: '333' }]);
  rejectSch('rejects an other row with an empty label', oneOther({ label: '   ' }));
  rejectSch('rejects a round row with an empty eventId', oneRound({ eventId: '  ' }));

  // Kind/payload mismatch — what the per-kind manifest exists to catch.
  rejectSch('rejects a round row carrying label', oneRound({ label: 'Бүртгэл' }));
  rejectSch('rejects an other row carrying eventId', oneOther({ eventId: '333' }));
  rejectSch('rejects an other row carrying round', oneOther({ round: 1 }));

  // Numbers.
  rejectSch('rejects a negative startMin', oneRound({ startMin: -1 }));
  rejectSch('rejects a fractional startMin', oneRound({ startMin: 600.5 }));
  rejectSch('rejects a string startMin', oneRound({ startMin: '600' }));
  rejectSch('rejects a missing startMin', [{ id: 's', durationMin: 30, kind: 'other', label: 'x' }]);
  rejectSch('rejects an implausibly distant startMin', oneRound({ startMin: 1440 * 15 }));
  rejectSch('rejects a durationMin of 0', oneRound({ durationMin: 0 }));
  rejectSch('rejects a negative durationMin', oneRound({ durationMin: -30 }));
  rejectSch('rejects a fractional durationMin', oneRound({ durationMin: 30.5 }));
  rejectSch('rejects a durationMin longer than a day', oneRound({ durationMin: 1441 }));
  rejectSch('rejects a round of 0', oneRound({ round: 0 }));
  rejectSch('rejects a fractional round', oneRound({ round: 1.5 }));
  rejectSch('rejects a string round', oneRound({ round: '1' }));
  rejectSch('rejects a non-string note', oneRound({ note: 42 }));

  // Ceiling.
  const manyRows = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, startMin: i * 10, durationMin: 10, kind: 'other', label: `T${i}` }));
  ok('exactly 120 schedule rows is accepted', validateCompetitionInput(schBody(manyRows(120))).ok);
  rejectSch('rejects 121 schedule rows', manyRows(121));

  // ── accepted edge shapes ──────────────────────────────────────────────
  ok('startMin 0 (a midnight anchor) is accepted', validateCompetitionInput(schBody(oneRound({ startMin: 0 }))).ok);
  ok('a startMin past midnight is accepted — a schedule may run overnight',
    validateCompetitionInput(schBody(oneRound({ startMin: 1830 }))).ok);
  ok('a round row naming an event the competition does not have is ACCEPTED',
    validateCompetitionInput(schBody(oneRound({ eventId: '777' }))).ok,
    'a draft programme legitimately precedes the Төрөл tab');
  ok('a duration of exactly a day is accepted', validateCompetitionInput(schBody(oneRound({ durationMin: 1440 }))).ok);

  // ── the read normaliser is FORGIVING where the writer is strict ───────
  const messySch = normalizeStoredSchedule([
    { startMin: 600, durationMin: 30, kind: 'other', label: 'ID-гүй' },
    { id: 'x', durationMin: 30, kind: 'round', eventId: '333', round: 1 },
    { id: 'bad-kind', startMin: 600, durationMin: 30, kind: 'lunch' },
    { id: 'no-label', startMin: 600, durationMin: 30, kind: 'other' },
    { id: 'no-event', startMin: 600, durationMin: 30, kind: 'round', round: 1 },
    { id: 'no-duration', startMin: 600, kind: 'other', label: 'x' },
    'junk',
  ]);
  ok('read: a row with no id gets a positional fallback', messySch[0]?.id === 'sch1', JSON.stringify(messySch[0]));
  ok('read: a missing startMin reads as 0 rather than dropping the row',
    messySch[1]?.startMin === 0 && messySch[1]?.id === 'x', JSON.stringify(messySch[1]));
  ok('read: an unknown kind is dropped, not thrown on', messySch.every((r) => r.id !== 'bad-kind'));
  ok('read: an other row with no label is dropped', messySch.every((r) => r.id !== 'no-label'));
  ok('read: a round row with no eventId is dropped', messySch.every((r) => r.id !== 'no-event'));
  ok('read: a row with no duration is dropped', messySch.every((r) => r.id !== 'no-duration'));
  ok('read: junk entries are dropped', messySch.length === 2, String(messySch.length));


  // ── scramble route: the attempt bound ─────────────────────────────────
  // The route's official-scramble lookup used to return null for an
  // out-of-range attempt, and the caller treated null as "no official
  // scramble applies" and fell through to RANDOM cstimer generation —
  // silently handing an athlete an unofficial scramble in an official
  // round. With a fixed 5 that was nearly unreachable; with per-event
  // formats an off-by-one is a real possibility.
  //
  // The route itself needs Next's request plumbing, so what is exercised
  // here is the stored shape the bound reads: the group's scramble count
  // per (event, round). If this drifts, the bound is wrong.
  const BOUND = 'comp-bound';
  await db.collection('onlineCompetitions').doc(BOUND).set({
    name: 'bound', status: 'upcoming', season: 's1',
    events: [{ eventId: '333', label: '3x3x3', rounds: 1, resultFormat: 'mo3' }],
  });
  await db.collection('onlineCompetitions').doc(BOUND).collection('scrambleData').doc('333_1').set({
    eventId: '333', round: 1,
    groups: [{ label: 'A', scrambles: ["R U R'", "U R U'", "F R F'"] }],
  });
  await db.collection('onlineCompetitions').doc(BOUND).collection('groupAssignments').doc('333_1').set({
    assignments: { u1: 0 },
  });

  const groupSnap = await db.collection('onlineCompetitions').doc(BOUND).collection('scrambleData').doc('333_1').get();
  const group = groupSnap.get('groups')[0];
  ok('bound: an Mo3 round stores exactly 3 scrambles', group.scrambles.length === 3, String(group.scrambles.length));
  ok('bound: attempt 3 is in range', group.scrambles[3 - 1] !== undefined);
  ok('bound: attempt 4 is OUT of range (would have gone random before)',
    group.scrambles[4 - 1] === undefined && 4 > group.scrambles.length);
  ok('bound: the assignment resolves to that group',
    (await db.collection('onlineCompetitions').doc(BOUND).collection('groupAssignments').doc('333_1').get())
      .get('assignments').u1 === 0);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
});
