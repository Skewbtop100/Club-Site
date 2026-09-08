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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
