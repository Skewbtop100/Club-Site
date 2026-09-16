import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteField, serverTimestamp, runTransaction, Timestamp } from 'firebase/firestore';

// ── The registration window, against the REAL rules ─────────────────────
// A registration (or a change of its events or note) is refused unless the
// competition is public — 'upcoming' or 'live', no deletion under way — and
// the server's clock is inside [registrationOpensAt, registrationDeadline).
// Anything unreadable or unset refuses.
//
// Times are set relative to NOW (the emulator's request.time), an hour or a
// day either side, so the tests do not depend on the machine's clock being
// exact.
//
// Run: npm run test:regwindow   (or as part of npm run test:rules)

const require = createRequire(import.meta.url);
const OUT = path.resolve('.tmp-regwindow-rules');
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/registration-shape.ts',
    '--outDir', OUT,
    '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node',
    '--strict', '--skipLibCheck', '--esModuleInterop',
  ],
  { stdio: 'inherit' },
);
const { buildRegistrationWrite } = require(path.join(OUT, 'registration-shape.js'));

const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const UID = 'athlete1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'registration-window-check',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

const ts = (offsetMs) => Timestamp.fromMillis(Date.now() + offsetMs);
const athleteDb = () => testEnv.authenticatedContext(UID, { email: 'a@example.com', email_verified: true }).firestore();

async function seed(competition, registration) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    if (competition) await setDoc(doc(db, 'onlineCompetitions', 'comp1'), { name: 'Тэмцээн', ...competition });
    // Registering also needs a VERIFIED profile now (see the
    // registration-verification suite, which is where that gate is tested).
    // Seeded here so this suite keeps testing only the window.
    await setDoc(doc(db, 'onlineParticipants', UID), {
      detailsStatus: 'approved', photoStatus: 'approved', profileStatus: 'approved',
    });
    if (registration) await setDoc(doc(db, 'onlineParticipants', UID, 'registrations', 'comp1'), registration);
  });
}

/** registerForCompetition in data.ts, exactly: the builder, in a transaction. */
async function register(db, events = ['333'], note = '') {
  const ref = doc(db, 'onlineParticipants', UID, 'registrations', 'comp1');
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

async function check(name, expect, competition, write, registration = null) {
  let good = true;
  let detail;
  try {
    await seed(competition, registration);
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

const OPEN = { status: 'upcoming', registrationOpensAt: ts(-DAY), registrationDeadline: ts(DAY) };
const EXISTING = { competitionId: 'comp1', events: ['333'], status: 'pending', registeredAt: ts(-2 * DAY), updatedAt: ts(-2 * DAY) };
const mine = (db) => doc(db, 'onlineParticipants', UID, 'registrations', 'comp1');

console.log('\n=== registration window: creating a registration ===\n');

await check('BEFORE registration opens: refused', 'DENY',
  { ...OPEN, registrationOpensAt: ts(HOUR), registrationDeadline: ts(DAY) }, (db) => register(db));
await check('INSIDE the window: accepted', 'ALLOW', OPEN, (db) => register(db));
await check('AFTER registration closes: refused', 'DENY',
  { ...OPEN, registrationOpensAt: ts(-2 * DAY), registrationDeadline: ts(-HOUR) }, (db) => register(db));
await check('a DRAFT competition, inside its window: refused', 'DENY', { ...OPEN, status: 'draft' }, (db) => register(db));
await check('a FINISHED competition, inside its window: refused', 'DENY', { ...OPEN, status: 'finished' }, (db) => register(db));
await check('a LIVE competition, inside its window: accepted', 'ALLOW', { ...OPEN, status: 'live' }, (db) => register(db));

console.log('\n=== fail closed ===\n');

await check('no competition document at all: refused', 'DENY', null, (db) => register(db));
await check('no registrationOpensAt: refused', 'DENY',
  { status: 'upcoming', registrationDeadline: ts(DAY) }, (db) => register(db));
await check('no registrationDeadline: refused', 'DENY',
  { status: 'upcoming', registrationOpensAt: ts(-DAY) }, (db) => register(db));
await check('the window stored as numbers, not Timestamps: refused', 'DENY',
  { status: 'upcoming', registrationOpensAt: Date.now() - DAY, registrationDeadline: Date.now() + DAY }, (db) => register(db));
await check('no status: refused', 'DENY',
  { registrationOpensAt: ts(-DAY), registrationDeadline: ts(DAY) }, (db) => register(db));
await check('a legacy status spelling ("active"): refused', 'DENY', { ...OPEN, status: 'active' }, (db) => register(db));
await check('a deletion under way: refused', 'DENY', { ...OPEN, deletion: { startedAtMs: Date.now() } }, (db) => register(db));
await check('a hand-written create outside the window (no transaction): refused', 'DENY',
  { ...OPEN, registrationOpensAt: ts(HOUR) },
  (db) => setDoc(mine(db), { competitionId: 'comp1', events: ['333'], status: 'pending', registeredAt: serverTimestamp(), updatedAt: serverTimestamp() }));

console.log('\n=== editing an existing registration ===\n');

const CLOSED = { ...OPEN, registrationOpensAt: ts(-3 * DAY), registrationDeadline: ts(-HOUR) };
await check('changing the events inside the window: accepted', 'ALLOW', OPEN,
  (db) => register(db, ['333', '222']), EXISTING);
await check('changing the events after the deadline: refused', 'DENY', CLOSED,
  (db) => register(db, ['333', '222']), EXISTING);
await check('changing the note after the deadline: refused', 'DENY', CLOSED,
  (db) => updateDoc(mine(db), { note: 'хожуу', updatedAt: serverTimestamp() }), EXISTING);
await check('changing the events before opening (an early registration): refused', 'DENY',
  { ...OPEN, registrationOpensAt: ts(HOUR) }, (db) => register(db, ['222']), EXISTING);
await check('the solve page\'s result write after the deadline: still accepted', 'ALLOW', { ...CLOSED, status: 'live' },
  (db) => setDoc(mine(db),
    { results: { '333': { ao5: 1234, attempts: [1200, 1234, 1300, 1250, 1180], submittedAt: serverTimestamp() } } },
    { mergeFields: ['results.333'] }),
  { ...EXISTING, status: 'approved' });

console.log('\n=== the Admin SDK ===\n');
{
  let good = true;
  let detail;
  try {
    await seed({ ...OPEN, registrationOpensAt: ts(HOUR) });
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'onlineParticipants', UID, 'registrations', 'comp1'), EXISTING));
  } catch (e) {
    good = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  the Admin SDK bypasses rules, so the window never constrains it (no admin route creates registrations)`);
  if (!good) console.log(`          -> ${detail}`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
