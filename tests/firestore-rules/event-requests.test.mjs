import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteField, serverTimestamp, runTransaction } from 'firebase/firestore';

// ── Added events on an approved registration, end to end ─────────────────
// The athlete's saves run through the REAL builder in a real client
// transaction under the REAL rules; the admin's decisions through the REAL
// decideEventRequest with the Admin SDK; and "can they solve it" is asked of
// the REAL scramble gate — the function the scramble route calls. One
// emulator, one project, both SDKs.
//
// Run: npm run test:eventrules   (or as part of npm run test:rules)

const require = createRequire(import.meta.url);
const OUT = path.resolve('.tmp-event-requests-rules');
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/registration-shape.ts',
    'lib/online-competition/scramble-gate.ts',
    'lib/online-competition/admin-registrations.ts',
    '--outDir', OUT,
    '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node',
    '--strict', '--skipLibCheck', '--esModuleInterop',
  ],
  { stdio: 'inherit' },
);
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const shape = require(path.join(OUT, 'registration-shape.js'));
const gate = require(path.join(OUT, 'scramble-gate.js'));
const adminReg = require(path.join(OUT, 'admin-registrations.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const PROJECT = 'event-requests-check';
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const UID = 'athlete1';
const COMP = 'comp1';
const DAY = 86_400_000;

let pass = 0;
let fail = 0;
function record(name, good, detail) {
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${name}`);
  if (!good && detail) console.log(`          -> ${detail}`);
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, String(e?.message ?? e).split('\n')[0]);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});
const adb = getFirestore(initializeApp({ projectId: PROJECT }, 'event-requests'));
const athleteDb = () => testEnv.authenticatedContext(UID, { email: 'a@example.com', email_verified: true }).firestore();
const regPath = `onlineParticipants/${UID}/registrations/${COMP}`;

async function seed(registration, { closed = false } = {}) {
  await testEnv.clearFirestore();
  const c = adb.collection('onlineCompetitions').doc(COMP);
  await c.set({
    name: 'Тэмцээн',
    status: 'live',
    registrationOpensAt: Timestamp.fromMillis(Date.now() - 2 * DAY),
    registrationDeadline: Timestamp.fromMillis(Date.now() + (closed ? -DAY / 24 : DAY)),
    events: ['333', '222', '444'].map((eventId) => ({ eventId, label: eventId, rounds: 1, resultFormat: 'ao5' })),
  });
  // Every event's round 1 is LIVE, so only the registration can refuse.
  for (const e of ['333', '222', '444']) {
    await c.collection('roundState').doc(`${e}_1`).set({ eventId: e, round: 1, status: 'live' });
  }
  if (registration) {
    await adb.doc(regPath).set({ competitionId: COMP, registeredAt: Timestamp.fromMillis(Date.now() - DAY), ...registration });
  }
}

/** registerForCompetition, exactly as data.ts runs it. */
async function save(events, note = '') {
  const db = athleteDb();
  const ref = doc(db, 'onlineParticipants', UID, 'registrations', COMP);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const write = shape.buildRegistrationWrite(
      snap.exists(),
      { competitionId: COMP, events, note },
      { now: serverTimestamp(), remove: deleteField() },
      snap.exists() ? snap.data() : null,
    );
    if (write.kind === 'refused') throw new shape.RegistrationEditRefused(write.reason);
    if (write.kind === 'create') tx.set(ref, write.data);
    else tx.update(ref, write.data);
  });
}
const mine = () => doc(athleteDb(), 'onlineParticipants', UID, 'registrations', COMP);
const stored = async () => (await adb.doc(regPath).get()).data();
const solve = (eventId) =>
  gate.authorizeScrambleRequest(adb, { competitionId: COMP, eventId, uid: UID, requestedAttempt: null }, { waitForFilingMs: 0, pollMs: 1 });
const list = (v) => (v ?? []).join(',');

console.log('\n=== adding an event to an approved registration ===\n');

await step('add', async () => {
  await seed({ status: 'approved', events: ['333'] });
  await assertSucceeds(save(['333', '222']));
  const d = await stored();
  record('the athlete adds 2x2x2: saved as a REQUEST', list(d.requestedEvents) === '222', JSON.stringify(d));
  record('  ...the approved 3x3x3 untouched', list(d.events) === '333');
  record('  ...the registration still approved', d.status === 'approved');

  const approvedEvent = await solve('333');
  record('ADDING AN EVENT LEAVES THE APPROVED ONE SOLVABLE: 3x3x3 is served a scramble',
    approvedEvent.ok === true && approvedEvent.attempt === 1, JSON.stringify(approvedEvent));
  const added = await solve('222');
  record('AN UNAPPROVED ADDED EVENT IS NOT STARTABLE: 2x2x2 is refused',
    added.ok === false && added.error === 'event-not-registered', JSON.stringify(added));

  record('  ...it reads as requested, not approved',
    list(shape.registrationEvents(d).approved) === '333' && list(shape.registrationEvents(d).requested) === '222');
});

await seed({ status: 'approved', events: ['333'] });
await step('sneak', async () => {
  await assertFails(updateDoc(mine(), { events: ['333', '222'], updatedAt: serverTimestamp() }));
  record('writing the added event straight into events is refused', true);
});
await seed({ status: 'approved', events: ['333'] });
await step('overlap', async () => {
  await assertFails(updateDoc(mine(), { requestedEvents: ['333'], updatedAt: serverTimestamp() }));
  record('requesting an event already approved is refused', true);
});
await seed({ status: 'approved', events: ['333'], requestedEvents: ['444'] });
await step('declined-write', async () => {
  await assertFails(updateDoc(mine(), { declinedEvents: [] }));
  record('the athlete cannot write declinedEvents', true);
});

console.log('\n=== the admin decides, one event at a time ===\n');

await step('approve', async () => {
  await seed({ status: 'approved', events: ['333'], requestedEvents: ['222', '444'] });
  await adminReg.decideEventRequest(adb, COMP, UID, '222', 'approve');
  const d = await stored();
  record('approving 2x2x2 moves it into events', list(d.events) === '333,222', JSON.stringify(d));
  record('  ...leaves 4x4x4 still requested', list(d.requestedEvents) === '444');
  record('  ...and 2x2x2 is now solvable', (await solve('222')).ok === true);
  record('  ...while 4x4x4 still is not', (await solve('444')).ok === false);

  await adminReg.decideEventRequest(adb, COMP, UID, '444', 'decline');
  const after = await stored();
  record('declining 4x4x4 records it, and leaves the approved events alone',
    list(after.declinedEvents) === '444' && list(after.events) === '333,222' && list(after.requestedEvents) === '' && after.status === 'approved',
    JSON.stringify(after));
  record('  ...and 4x4x4 is refused', (await solve('444')).ok === false);

  let refused = null;
  try {
    await adminReg.decideEventRequest(adb, COMP, UID, '444', 'approve');
  } catch (e) {
    refused = e;
  }
  record('deciding an event that is no longer requested is refused (409)', refused?.status === 409, String(refused?.message));
});

await step('pending-registration', async () => {
  await seed({ status: 'pending', events: ['333'] });
  let refused = null;
  try {
    await adminReg.decideEventRequest(adb, COMP, UID, '333', 'approve');
  } catch (e) {
    refused = e;
  }
  record('no event decision on a registration that is itself pending (409)', refused?.status === 409);
});

console.log('\n=== removing an approved event ===\n');

await step('withdraw', async () => {
  await seed({ status: 'approved', events: ['333', '222'] });
  await assertSucceeds(save(['333']));
  const d = await stored();
  record('removing 2x2x2 takes effect at once, and is recorded for the admin',
    list(d.events) === '333' && list(d.withdrawnEvents) === '222' && d.status === 'approved', JSON.stringify(d));
  record('  ...2x2x2 is no longer solvable', (await solve('222')).ok === false);
  record('  ...3x3x3 still is', (await solve('333')).ok === true);
});
await seed({ status: 'approved', events: ['333', '222'] });
await step('hide-withdrawal', async () => {
  await assertFails(updateDoc(mine(), { events: ['333'], updatedAt: serverTimestamp() }));
  record('a removal that does not record the withdrawal is refused', true);
});
await step('keep-one', async () => {
  await seed({ status: 'approved', events: ['333'] });
  let refused = null;
  try {
    await save(['222']);
  } catch (e) {
    refused = e;
  }
  record('swapping every approved event for a request is refused before saving', refused?.reason === 'keep-one-approved');
  await assertFails(updateDoc(mine(), { events: [], requestedEvents: ['222'], withdrawnEvents: ['333'], updatedAt: serverTimestamp() }));
  record('  ...and by the rules', true);
  record('  ...leaving 3x3x3 approved', list((await stored()).events) === '333');
});

console.log('\n=== CLOSING REGISTRATION BLOCKS ALL CHANGES ===\n');

const CLOSED = { closed: true };
await step('closed-add', async () => {
  await seed({ status: 'approved', events: ['333'] }, CLOSED);
  await assertFails(save(['333', '222']));
  record('adding an event after the deadline is refused', true);
});
await step('closed-withdraw', async () => {
  await seed({ status: 'approved', events: ['333', '222'] }, CLOSED);
  await assertFails(save(['333']));
  record('removing an event after the deadline is refused', true);
});
await step('closed-request-removal', async () => {
  await seed({ status: 'approved', events: ['333'], requestedEvents: ['222'] }, CLOSED);
  await assertFails(save(['333']));
  record('cancelling a request after the deadline is refused', true);
});
await step('closed-results', async () => {
  await seed({ status: 'approved', events: ['333'] }, CLOSED);
  await assertSucceeds(setDoc(mine(),
    { results: { '333': { ao5: 1234, attempts: [1200, 1234, 1300, 1250, 1180], submittedAt: serverTimestamp() } } },
    { mergeFields: ['results.333'] }));
  record('the solve page\'s result write still works after the deadline', true);
});
await step('closed-admin', async () => {
  await seed({ status: 'approved', events: ['333'], requestedEvents: ['222'] }, CLOSED);
  await adminReg.decideEventRequest(adb, COMP, UID, '222', 'approve');
  record('the admin can still decide a request made before the deadline', list((await stored()).events) === '333,222');
});

console.log('\n=== AN EXISTING REGISTRATION IS UNCHANGED ===\n');

await step('legacy', async () => {
  await seed({ status: 'registered', events: ['333', '222'] });
  const before = await stored();
  const view = shape.registrationEvents(before);
  record('an old registration reads as all its events approved, nothing requested',
    list(view.approved) === '333,222' && view.requested.length === 0 && view.withdrawn.length === 0);
  record('  ...every event solvable, as before', (await solve('333')).ok === true && (await solve('222')).ok === true);
  await assertSucceeds(save(['333', '222'], 'шинэ тайлбар'));
  const after = await stored();
  record('  ...a note-only save leaves its events and status exactly as they were',
    list(after.events) === '333,222' && after.status === 'registered' && list(after.requestedEvents) === '' && list(after.withdrawnEvents) === '',
    JSON.stringify(after));
  record('  ...and nothing appears in the admin\'s change row',
    shape.registrationEvents(after).requested.length === 0 && shape.registrationEvents(after).withdrawn.length === 0);
});
await step('pending-edit', async () => {
  await seed({ status: 'pending', events: ['333'] });
  await assertSucceeds(save(['333', '222']));
  const d = await stored();
  record('a PENDING registration still edits its events directly — the whole thing is under review',
    list(d.events) === '333,222' && d.requestedEvents === undefined, JSON.stringify(d));
  await assertFails(updateDoc(mine(), { requestedEvents: ['444'], updatedAt: serverTimestamp() }));
  record('  ...and may not write a request list', true);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
