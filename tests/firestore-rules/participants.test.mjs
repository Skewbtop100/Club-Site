import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';

// Defaults to the repo's real rules file, so `npm run test:rules` from the
// project root needs no arguments. RULES_PATH overrides it if you want to
// try an edited copy without touching the deployed file.
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const UID = 'athlete1';

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

/** Seed a participant doc bypassing rules, then run `fn` as that athlete. */
async function withDoc(seed, fn) {
  await testEnv.clearFirestore();
  if (seed) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'onlineParticipants', UID), seed);
    });
  }
  const ctx = testEnv.authenticatedContext(UID, { email: 'a@example.com', email_verified: true });
  return fn(doc(ctx.firestore(), 'onlineParticipants', UID));
}

async function check(name, expect, seed, write) {
  let ok;
  try {
    await withDoc(seed, async (ref) => {
      if (expect === 'ALLOW') await assertSucceeds(write(ref));
      else await assertFails(write(ref));
    });
    ok = true;
  } catch (e) {
    ok = false;
    var detail = String(e?.message ?? e).split('\n')[0];
  }
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [expected ${expect}] ${name}`);
  if (!ok) console.log(`          -> ${detail}`);
}

const IDENTITY = {
  lastName: 'Ganzorig',
  firstName: 'Batbayar',
  dateOfBirth: '2003-04-12',
  gender: 'male',
  citizenship: 'Mongolia',
  photoUrl: 'https://res.cloudinary.com/x/new.jpg',
  photoPublicId: 'new',
};

const APPROVED = {
  uid: UID,
  displayName: 'Batbayar',
  email: 'a@example.com',
  lastName: 'Ganzorig',
  firstName: 'Batbayar',
  dateOfBirth: '2003-04-12',
  gender: 'male',
  citizenship: 'Mongolia',
  photoUrl: 'https://res.cloudinary.com/x/old.jpg',
  photoPublicId: 'old',
  profileStatus: 'approved',
  approvedPhotoUrl: 'https://res.cloudinary.com/x/old.jpg',
  approvedLastName: 'Ganzorig',
  approvedFirstName: 'Batbayar',
  approvedDateOfBirth: '2003-04-12',
  approvedGender: 'male',
  approvedCitizenship: 'Mongolia',
  stats: { '333': { pr: 633, ao5: null, solveCount: 1 } },
};

const REJECTED = { ...APPROVED, profileStatus: 'rejected', rejectionReason: 'blurry' };
const INCOMPLETE_SEED = { uid: UID, displayName: 'Batbayar', email: 'a@example.com' };

console.log('\n=== onlineParticipants rules ===\n');

// 1
await check('1. incomplete athlete submits full profile (pending)', 'ALLOW', INCOMPLETE_SEED, (ref) =>
  setDoc(ref, { ...IDENTITY, profileStatus: 'pending', submittedAt: serverTimestamp() }, { merge: true }),
);

// 2
await check('2. rejected athlete resubmits (pending)', 'ALLOW', REJECTED, (ref) =>
  setDoc(ref, { ...IDENTITY, profileStatus: 'pending', submittedAt: serverTimestamp() }, { merge: true }),
);

// 3
await check('3. approved athlete writes identity, OMITS profileStatus', 'DENY', APPROVED, (ref) =>
  setDoc(ref, { ...IDENTITY }, { merge: true }),
);

// 3b — the same, via updateDoc rather than a merge setDoc
await check('3b. approved athlete updateDoc identity, omits profileStatus', 'DENY', APPROVED, (ref) =>
  updateDoc(ref, { lastName: 'Changed' }),
);

// 3c — deleting profileStatus outright while changing identity
await check('3c. approved athlete deletes profileStatus + changes identity', 'DENY', APPROVED, (ref) =>
  updateDoc(ref, { lastName: 'Changed', profileStatus: deleteField() }),
);

// 4
await check('4. approved athlete writes identity WITH profileStatus pending', 'ALLOW', APPROVED, (ref) =>
  setDoc(ref, { ...IDENTITY, profileStatus: 'pending' }, { merge: true }),
);

// 5 — split: the escalation vs the indistinguishable no-op
await check('5a. PENDING athlete writes profileStatus approved (escalation)', 'DENY', { ...APPROVED, profileStatus: 'pending' }, (ref) =>
  setDoc(ref, { profileStatus: 'approved' }, { merge: true }),
);
await check('5b. REJECTED athlete writes profileStatus approved', 'DENY', REJECTED, (ref) =>
  setDoc(ref, { profileStatus: 'approved' }, { merge: true }),
);
await check('5c. INCOMPLETE athlete writes profileStatus approved', 'DENY', INCOMPLETE_SEED, (ref) =>
  setDoc(ref, { profileStatus: 'approved' }, { merge: true }),
);
await check('5d. approved athlete writes approved + CHANGES identity', 'DENY', APPROVED, (ref) =>
  setDoc(ref, { profileStatus: 'approved', lastName: 'Changed' }, { merge: true }),
);
await check('5e. approved athlete re-writes approved, no identity change (= the sign-in upsert; indistinguishable)', 'ALLOW', APPROVED, (ref) =>
  setDoc(ref, { profileStatus: 'approved' }, { merge: true }),
);

// 6
await check('6a. client writes approvedPhotoUrl', 'DENY', APPROVED, (ref) =>
  setDoc(ref, { approvedPhotoUrl: 'https://evil/x.jpg' }, { merge: true }),
);
await check('6b. client writes approvedLastName', 'DENY', APPROVED, (ref) =>
  setDoc(ref, { approvedLastName: 'Forged' }, { merge: true }),
);
await check('6c. client writes approvedDateOfBirth', 'DENY', APPROVED, (ref) =>
  setDoc(ref, { approvedDateOfBirth: '1990-01-01' }, { merge: true }),
);
await check('6d. client erases approvedCitizenship', 'DENY', APPROVED, (ref) =>
  updateDoc(ref, { approvedCitizenship: deleteField() }),
);
await check('6e. client writes stats', 'DENY', APPROVED, (ref) =>
  setDoc(ref, { stats: { '333': { pr: 1, ao5: 1, solveCount: 1 } } }, { merge: true }),
);

// ── wcaId: a plain, unreviewed string ──
// Not in reviewedIdentityKeys(), no approved* snapshot, no entry in
// judgeFieldsUntouched(). The rules type-check it and nothing more: format
// is enforced by the profile form, which is a UI concern, not a security
// one. A malformed id is a self-defeating lie (WCA ids are public and
// checkable), so there is nothing to protect against here.
await check('W1. athlete may write a wcaId with their profile', 'ALLOW', INCOMPLETE_SEED, (ref) =>
  setDoc(ref, { ...IDENTITY, wcaId: '2016BAYA01', profileStatus: 'pending' }, { merge: true }),
);
await check('W2. a MALFORMED wcaId is still accepted by the rules (format is a UI concern)', 'ALLOW', INCOMPLETE_SEED, (ref) =>
  setDoc(ref, { ...IDENTITY, wcaId: 'not-a-wca-id', profileStatus: 'pending' }, { merge: true }),
);
await check('W3. an APPROVED athlete may change wcaId without re-review', 'ALLOW', APPROVED, (ref) =>
  updateDoc(ref, { wcaId: '2020NEWW02' }),
);

// ── A merged-away account must be reusable ──
// The merge tombstones the old document with mergedInto/mergedAt and strips
// the rest. That account stays usable: submitting a fresh profile clears the
// markers in the SAME write (submitParticipantProfile). These prove the
// rules allow a client to do that, rather than the app assuming they do.
const TOMBSTONED = {
  uid: UID,
  displayName: 'Batbayar',
  email: 'a@example.com',
  photoURL: 'https://google/a.jpg',
  mergedInto: 'someOtherUid0000000000000001',
  mergedAt: new Date(1_700_000_000_000),
};
await check('M1. merged-away athlete submits a fresh profile AND clears mergedInto', 'ALLOW', TOMBSTONED, (ref) =>
  setDoc(
    ref,
    { ...IDENTITY, profileStatus: 'pending', submittedAt: serverTimestamp(), mergedInto: deleteField(), mergedAt: deleteField() },
    { merge: true },
  ),
);
await check('M2. merged-away athlete clears mergedInto alone', 'ALLOW', TOMBSTONED, (ref) =>
  updateDoc(ref, { mergedInto: deleteField(), mergedAt: deleteField() }),
);
await check('M3. sign-in upsert still works on a tombstoned doc', 'ALLOW', TOMBSTONED, (ref) =>
  setDoc(
    ref,
    { uid: UID, displayName: 'Batbayar B', photoURL: 'https://google/a.jpg', email: 'a@example.com', createdAt: serverTimestamp() },
    { merge: true },
  ),
);

// ── The non-identity writer that must keep working ──
await check('N1. sign-in upsert on an APPROVED doc (no identity fields)', 'ALLOW', APPROVED, (ref) =>
  setDoc(
    ref,
    { uid: UID, displayName: 'Batbayar B', photoURL: 'https://google/a.jpg', email: 'a@example.com', createdAt: serverTimestamp() },
    { merge: true },
  ),
);
await check('N2. sign-in upsert on a PENDING doc', 'ALLOW', { ...APPROVED, profileStatus: 'pending' }, (ref) =>
  setDoc(
    ref,
    { uid: UID, displayName: 'Batbayar B', photoURL: 'https://google/a.jpg', email: 'a@example.com', createdAt: serverTimestamp() },
    { merge: true },
  ),
);
await check('N3. sign-in upsert creating a brand-new doc', 'ALLOW', null, (ref) =>
  setDoc(
    ref,
    { uid: UID, displayName: 'New', photoURL: null, email: 'a@example.com', createdAt: serverTimestamp() },
    { merge: true },
  ),
);
await check('N4. approved athlete changes only photoURL (Google avatar, not photoUrl)', 'ALLOW', APPROVED, (ref) =>
  setDoc(ref, { photoURL: 'https://google/new.jpg' }, { merge: true }),
);

// ── Extra: the reviewed-identity guard, field by field ──
for (const [field, value] of [['lastName','X'],['firstName','X'],['dateOfBirth','1999-01-01'],['gender','female'],['citizenship','X'],['photoUrl','https://res.cloudinary.com/x/z.jpg']]) {
  await check(`E. approved athlete changes ${field} alone, omits profileStatus`, 'DENY', APPROVED, (ref) =>
    updateDoc(ref, { [field]: value }),
  );
}
await check('E7. approved athlete changes photoPublicId alone (not a reviewed field)', 'ALLOW', APPROVED, (ref) =>
  updateDoc(ref, { photoPublicId: 'other' }),
);

// ── Registrations: onlineParticipants/{uid}/registrations/{competitionId} ──
// This collection had NO rules coverage until the `note` field. The client
// writes it directly — there is no API route in between — so these rules
// are the only server-side validation a registration ever gets.
const reg = (ref, competitionId = 'comp1') => doc(ref, 'registrations', competitionId);
const REG = { competitionId: 'comp1', events: ['333'], status: 'registered' };
const NOTE_300 = 'а'.repeat(300); // Cyrillic: size() counts characters

await check('R1. owner registers with events', 'ALLOW', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, registeredAt: serverTimestamp() }),
);
await check('R2. registration with NO note (every doc before the field)', 'ALLOW', APPROVED, (ref) =>
  setDoc(reg(ref), REG),
);
await check('R3. note of exactly 300 characters', 'ALLOW', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, note: NOTE_300 }),
);
await check('R4. note of 301 characters is REFUSED', 'DENY', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, note: NOTE_300 + 'а' }),
);
await check('R5. a non-string note is REFUSED', 'DENY', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, note: 42 }),
);
await check('R6. a map smuggled in as the note is REFUSED', 'DENY', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, note: { text: 'x' } }),
);
await check('R7. editing: overwrite that DROPS the note (clearing it)', 'ALLOW', APPROVED, async (ref) => {
  await setDoc(reg(ref), { ...REG, note: 'хамт ирнэ' });
  return setDoc(reg(ref), REG);
});
await check('R8. empty events list is refused (pre-existing rule)', 'DENY', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, events: [] }),
);
await check('R9. competitionId must match the doc id (pre-existing rule)', 'DENY', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, competitionId: 'other' }),
);
await check('R10. writing ANOTHER athlete\'s registration is refused', 'DENY', APPROVED, (ref) =>
  setDoc(doc(ref.firestore, 'onlineParticipants', 'someoneElse', 'registrations', 'comp1'), REG),
);
await check('R11. deleting a registration is refused', 'DENY', APPROVED, async (ref) => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'onlineParticipants', UID, 'registrations', 'comp1'), REG);
  });
  const { deleteDoc } = await import('firebase/firestore');
  return deleteDoc(reg(ref));
});

// ── KNOWN GAPS — these document what the rules do NOT enforce today ──
// Each is a gate the registration panel applies CLIENT-SIDE only. They are
// asserted as ALLOW so that hardening the rules makes these fail loudly
// and forces whoever hardened them to update this list, rather than the
// gap being invisible.
await check('GAP-1. an UNAPPROVED athlete can write a registration directly', 'ALLOW', null, (ref) =>
  setDoc(reg(ref), REG),
);
await check('GAP-2. a registration for a competition id that does not exist is accepted', 'ALLOW', APPROVED, (ref) =>
  setDoc(reg(ref, 'no-such-comp'), { ...REG, competitionId: 'no-such-comp' }),
);
await check('GAP-3. event ids are not checked against the competition', 'ALLOW', APPROVED, (ref) =>
  setDoc(reg(ref), { ...REG, events: ['not-an-event'] }),
);
// The deadline, status and participant limit are not checked either — the
// rule never reads the competition document at all, so GAP-2 covers them.

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
