import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, runTransaction, deleteField, Timestamp } from 'firebase/firestore';

// ── The verification gate, against the REAL rules ───────────────────────
// A registration — and any later change to its events or note — is refused
// unless the athlete's profile is VERIFIED: details AND photo both
// approved. Before this gate existed, the only thing stopping an unverified
// athlete was RegistrationPanel's own check, a branch in the browser.
//
// THE EXPECTED VALUE IS NOT HARDCODED. Every profile fixture below is run
// through the real resolveVerification() from
// lib/online-competition/verification.ts, and its `verified` is what the
// rules are then held to. The rules restate that function (they cannot
// import), so this is what stops the two drifting: a change to either that
// the other does not follow fails here rather than in production.
//
// The competition is always open and public, so the ONLY thing under test
// is the profile. The window has its own suite (registration-window).
//
// Run: npm run test:regverify   (or as part of npm run test:rules)

const require = createRequire(import.meta.url);
const OUT = path.resolve('.tmp-regverify-rules');
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/registration-shape.ts',
    'lib/online-competition/verification.ts',
    '--outDir', OUT,
    '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node',
    '--strict', '--skipLibCheck', '--esModuleInterop',
  ],
  { stdio: 'inherit' },
);
const { buildRegistrationWrite } = require(path.join(OUT, 'registration-shape.js'));
const { resolveVerification } = require(path.join(OUT, 'verification.js'));

const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const UID = 'athlete1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'registration-verification-check',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

const ts = (offsetMs) => Timestamp.fromMillis(Date.now() + offsetMs);
const athleteDb = () => testEnv.authenticatedContext(UID, { email: 'a@example.com', email_verified: true }).firestore();
const mine = (db) => doc(db, 'onlineParticipants', UID, 'registrations', 'comp1');

/** Open, public, plenty of room either side of now. */
const OPEN = { status: 'upcoming', registrationOpensAt: ts(-DAY), registrationDeadline: ts(DAY) };
const EXISTING = {
  competitionId: 'comp1',
  events: ['333'],
  status: 'pending',
  registeredAt: ts(-2 * DAY),
  updatedAt: ts(-2 * DAY),
};

/** `profile` null means NO participant document — the fail-closed case. */
async function seed(profile, registration = null) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'onlineCompetitions', 'comp1'), { name: 'Тэмцээн', ...OPEN });
    if (profile) await setDoc(doc(db, 'onlineParticipants', UID), profile);
    if (registration) await setDoc(doc(db, 'onlineParticipants', UID, 'registrations', 'comp1'), registration);
  });
}

/** registerForCompetition in data.ts, exactly: the builder, in a transaction. */
async function register(db, events = ['333'], note = '') {
  const ref = mine(db);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const write = buildRegistrationWrite(
      snap.exists(),
      { competitionId: 'comp1', events, note },
      { now: serverTimestamp(), remove: deleteField() },
      snap.exists() ? snap.data() : null,
    );
    if (write.kind === 'create') tx.set(ref, write.data);
    else tx.update(ref, write.data);
  });
}

async function check(name, expect, profile, write, registration = null) {
  let good = true;
  let detail;
  try {
    await seed(profile, registration);
    const attempt = write(athleteDb());
    if (expect === 'ALLOW') await assertSucceeds(attempt);
    else await assertFails(attempt);
  } catch (e) {
    good = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  [expected ${expect}] ${name}`);
  if (!good) console.log(`          -> ${detail}`);
}

/** The four states the brief names, plus the record shapes around them.
 *  `expect` is DERIVED from resolveVerification, never written by hand. */
const PROFILES = [
  ['never submitted (signed in, no status fields at all)', { email: 'a@example.com', displayName: 'Т' }],
  ['submitted, both parts awaiting review', { detailsStatus: 'pending', photoStatus: 'pending', profileStatus: 'pending' }],
  ['details approved, photo still pending', { detailsStatus: 'approved', photoStatus: 'pending', profileStatus: 'pending' }],
  ['photo approved, details still pending', { detailsStatus: 'pending', photoStatus: 'approved', profileStatus: 'pending' }],
  ['details rejected, photo approved', { detailsStatus: 'rejected', photoStatus: 'approved', profileStatus: 'rejected' }],
  ['photo rejected, details approved', { detailsStatus: 'approved', photoStatus: 'rejected', profileStatus: 'rejected' }],
  ['both parts rejected', { detailsStatus: 'rejected', photoStatus: 'rejected', profileStatus: 'rejected' }],
  ['BOTH PARTS APPROVED', { detailsStatus: 'approved', photoStatus: 'approved', profileStatus: 'approved' }],
  // Records decided under the single approval, before the two-part review.
  ['legacy: profileStatus approved, no part fields', { profileStatus: 'approved' }],
  ['legacy: profileStatus pending, no part fields', { profileStatus: 'pending' }],
  ['legacy: profileStatus rejected, no part fields', { profileStatus: 'rejected' }],
  // hasPartFields wants BOTH statuses valid; one alone reads the legacy way.
  ['one part field only, legacy status pending', { detailsStatus: 'approved', profileStatus: 'pending' }],
  ['one part field only, legacy status approved', { detailsStatus: 'rejected', profileStatus: 'approved' }],
  // Fail closed on anything unreadable.
  ['part statuses stored as nonsense, no legacy status', { detailsStatus: 'ok', photoStatus: 'ok' }],
  ['part statuses stored as booleans', { detailsStatus: true, photoStatus: true }],
  ['profileStatus stored as a number', { profileStatus: 1 }],
];

console.log('\n=== creating a registration: the profile decides ===\n');

for (const [name, profile] of PROFILES) {
  const expect = resolveVerification(profile).verified ? 'ALLOW' : 'DENY';
  await check(`${name} -> ${expect}`, expect, profile, (db) => register(db));
}

console.log('\n=== fail closed ===\n');

await check('NO participant document at all: refused', 'DENY', null, (db) => register(db));
await check('a hand-written create, no transaction, unverified: refused', 'DENY',
  { detailsStatus: 'pending', photoStatus: 'pending', profileStatus: 'pending' },
  (db) => setDoc(mine(db), {
    competitionId: 'comp1', events: ['333'], status: 'pending',
    registeredAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
await check('a hand-written create, no participant document: refused', 'DENY', null,
  (db) => setDoc(mine(db), {
    competitionId: 'comp1', events: ['333'], status: 'pending',
    registeredAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

console.log('\n=== editing an existing registration ===\n');

const VERIFIED = { detailsStatus: 'approved', photoStatus: 'approved', profileStatus: 'approved' };
const PENDING = { detailsStatus: 'pending', photoStatus: 'pending', profileStatus: 'pending' };
const REJECTED = { detailsStatus: 'approved', photoStatus: 'rejected', profileStatus: 'rejected' };

await check('verified: changing the events is accepted', 'ALLOW', VERIFIED,
  (db) => register(db, ['333', '222']), EXISTING);
await check('pending: changing the events is refused', 'DENY', PENDING,
  (db) => register(db, ['333', '222']), EXISTING);
await check('rejected: changing the events is refused', 'DENY', REJECTED,
  (db) => register(db, ['333', '222']), EXISTING);
await check('pending: changing the note is refused', 'DENY', PENDING,
  (db) => updateDoc(mine(db), { note: 'сайн уу', updatedAt: serverTimestamp() }), EXISTING);
await check('no participant document: changing the events is refused', 'DENY', null,
  (db) => register(db, ['333', '222']), EXISTING);

console.log('\n=== THE SOLVE FLOW IS NOT GATED ON THIS ===\n');
// A profile rejected or re-opened for review mid-competition must not break
// an athlete already approved into a round. The gate sits on the same clause
// as the registration window, which a results-only write does not touch.

const RESULT = {
  results: { '333': { ao5: 1234, attempts: [1200, 1234, 1300, 1250, 1180], submittedAt: serverTimestamp() } },
};
await check('a result write with the profile back to PENDING: still accepted', 'ALLOW', PENDING,
  (db) => setDoc(mine(db), RESULT, { mergeFields: ['results.333'] }),
  { ...EXISTING, status: 'approved' });
await check('a result write with the profile REJECTED: still accepted', 'ALLOW', REJECTED,
  (db) => setDoc(mine(db), RESULT, { mergeFields: ['results.333'] }),
  { ...EXISTING, status: 'approved' });
await check('a result write with NO participant document: still accepted', 'ALLOW', null,
  (db) => setDoc(mine(db), RESULT, { mergeFields: ['results.333'] }),
  { ...EXISTING, status: 'approved' });

console.log('\n=== what the gate cannot do ===\n');
{
  // The Admin SDK bypasses rules, so an admin route may still write a
  // registration for an unverified athlete. Pinned so the limit is a
  // recorded fact rather than an assumption.
  let good = true;
  let detail;
  try {
    await seed(PENDING);
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'onlineParticipants', UID, 'registrations', 'comp1'), EXISTING));
  } catch (e) {
    good = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  the Admin SDK bypasses rules, so the gate never constrains it`);
  if (!good) console.log(`          -> ${detail}`);
}
{
  // A registration written while the athlete WAS verified stays put when the
  // profile is later rejected: rules judge writes, never stored documents.
  // scripts/report-unverified-registrations.mjs is what finds these.
  let good = true;
  let detail;
  try {
    await seed(REJECTED, EXISTING);
    // Nothing is asserted about a write here — the point is that the stored
    // document is still readable and untouched by the gate.
    await assertSucceeds(
      (async () => {
        const db = athleteDb();
        await updateDoc(mine(db), { results: { '333': { ao5: 1 } } });
      })(),
    );
  } catch (e) {
    good = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  a registration stored BEFORE a rejection is not retracted by the gate`);
  if (!good) console.log(`          -> ${detail}`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
