import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp, runTransaction } from 'firebase/firestore';

// ── The two verification parts, against the REAL rules ──────────────────
// verification.ts is compiled and used exactly as the app uses it: the
// athlete's save runs resubmissionStatuses inside a real client transaction
// (the shape of data.ts submitParticipantProfile), and the admin decision is
// planDecision's update written with rules bypassed (the Admin SDK route).
//
// Run: npm run test:verifyrules   (or as part of npm run test:rules)

const require = createRequire(import.meta.url);
const OUT = path.resolve('.tmp-verification-rules');
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/verification.ts',
    '--outDir', OUT,
    '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node',
    '--strict', '--skipLibCheck', '--esModuleInterop',
  ],
  { stdio: 'inherit' },
);
const V = require(path.join(OUT, 'verification.js'));

const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const UID = 'athlete1';
const EMAIL = 'a@example.com';

let pass = 0;
let fail = 0;
function record(name, good, detail) {
  if (good) pass++;
  else fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${name}`);
  if (!good && detail) console.log(`          -> ${detail}`);
}

const testEnv = await initializeTestEnvironment({
  projectId: 'verification-check',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

const athleteDb = () => testEnv.authenticatedContext(UID, { email: EMAIL, email_verified: true }).firestore();

async function seed(data) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'onlineParticipants', UID), data));
}

async function stored() {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), 'onlineParticipants', UID));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

/** submitParticipantProfile, as data.ts writes it. */
async function athleteSubmit(identity) {
  const db = athleteDb();
  const ref = doc(db, 'onlineParticipants', UID);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const next = V.resubmissionStatuses(snap.exists() ? snap.data() : null, identity);
    tx.set(
      ref,
      {
        ...identity,
        wcaId: '',
        photoPublicId: 'p',
        detailsStatus: next.detailsStatus,
        photoStatus: next.photoStatus,
        profileStatus: next.profileStatus,
        ...(next.anyPending ? { submittedAt: serverTimestamp() } : {}),
        mergedInto: deleteField(),
        mergedAt: deleteField(),
      },
      { merge: true },
    );
    return next;
  });
}

/** The admin route: planDecision against the stored record, Admin SDK write. */
async function adminDecide(parts) {
  const data = await stored();
  const submittedAt = data?.submittedAt?.toMillis?.() ?? null;
  const plan = V.planDecision(data, submittedAt, { submittedAt, ...parts });
  if (!plan.ok) throw new Error(`decision refused: ${plan.error}`);
  await testEnv.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'onlineParticipants', UID), { ...plan.update, reviewedAt: serverTimestamp() }, { merge: true }),
  );
  return plan;
}

async function expectWrite(name, expect, write) {
  try {
    const ref = doc(athleteDb(), 'onlineParticipants', UID);
    if (expect === 'ALLOW') await assertSucceeds(write(ref));
    else await assertFails(write(ref));
    record(`[${expect}] ${name}`, true);
  } catch (e) {
    record(`[${expect}] ${name}`, false, String(e?.message ?? e).split('\n')[0]);
  }
}

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, String(e?.message ?? e).split('\n')[0]);
  }
}

const SUBMITTED = {
  lastName: 'Ganzorig',
  firstName: 'Batbayar',
  dateOfBirth: '2003-04-12',
  gender: 'male',
  citizenship: 'mn',
  photoUrl: 'https://res.cloudinary.com/x/1.jpg',
};
const SNAPSHOT = {
  approvedLastName: 'Ganzorig',
  approvedFirstName: 'Batbayar',
  approvedDateOfBirth: '2003-04-12',
  approvedGender: 'male',
  approvedCitizenship: 'mn',
  approvedPhotoUrl: 'https://res.cloudinary.com/x/1.jpg',
};
const BASE = { uid: UID, displayName: 'Batbayar', email: EMAIL };
const UPSERT = { uid: UID, displayName: 'Batbayar B', photoURL: 'https://google/a.jpg', email: EMAIL, createdAt: serverTimestamp() };

console.log('\n=== verification: the required flow ===\n');

await step('flow', async () => {
  await seed(BASE);
  await assertSucceeds(athleteSubmit(SUBMITTED));
  let d = await stored();
  record('the athlete submits: both parts pending', d.detailsStatus === 'pending' && d.photoStatus === 'pending' && d.profileStatus === 'pending');

  await adminDecide({ details: { decision: 'approve' }, photo: { decision: 'reject', reason: 'Царай харагдахгүй' } });
  d = await stored();
  record('the admin approves details, rejects photo: stored separately',
    d.detailsStatus === 'approved' && d.photoStatus === 'rejected' && d.photoRejectionReason === 'Царай харагдахгүй' && d.profileStatus === 'rejected',
    JSON.stringify(d));
  record('  ...not verified', V.resolveVerification(d).verified === false);

  await expectWrite('the athlete marks the photo approved themselves', 'DENY', (ref) =>
    setDoc(ref, { photoStatus: 'approved', profileStatus: 'approved' }, { merge: true }),
  );

  await assertSucceeds(athleteSubmit({ ...SUBMITTED, photoUrl: 'https://res.cloudinary.com/x/2.jpg' }));
  d = await stored();
  record('the athlete resubmits the photo: details still approved, photo pending',
    d.detailsStatus === 'approved' && d.photoStatus === 'pending' && d.profileStatus === 'pending', JSON.stringify(d));

  const plan = await adminDecide({ photo: { decision: 'approve' } });
  d = await stored();
  record('the admin approves the photo: VERIFIED', V.resolveVerification(d).verified === true && d.profileStatus === 'approved');
  record('  ...without re-approving the details', plan.decided.details === undefined && d.approvedLastName === 'Ganzorig');
  record('  ...the new photo is the approved photo', d.approvedPhotoUrl === 'https://res.cloudinary.com/x/2.jpg');

  await assertSucceeds(setDoc(doc(athleteDb(), 'onlineParticipants', UID), UPSERT, { merge: true }));
  record('  ...and the sign-in upsert still works on it', V.resolveVerification(await stored()).verified === true);
});

console.log('\n=== verification: an old single-approval athlete ===\n');

const LEGACY = { ...BASE, ...SUBMITTED, ...SNAPSHOT, photoPublicId: 'p', profileStatus: 'approved' };

await step('legacy', async () => {
  await seed(LEGACY);
  record('stays verified with nothing written', V.resolveVerification(await stored()).verified === true);

  await expectWrite('sign-in upsert on the old record', 'ALLOW', (ref) => setDoc(ref, UPSERT, { merge: true }));
  const afterUpsert = await stored();
  record('  ...still verified, still an old record', V.resolveVerification(afterUpsert).verified && !('detailsStatus' in afterUpsert));

  await assertSucceeds(athleteSubmit(SUBMITTED));
  let d = await stored();
  record('saving the same profile with the new app: approved, not back to pending',
    d.detailsStatus === 'approved' && d.photoStatus === 'approved' && d.profileStatus === 'approved', JSON.stringify(d));

  await seed(LEGACY);
  await assertSucceeds(athleteSubmit({ ...SUBMITTED, photoUrl: 'https://res.cloudinary.com/x/new.jpg' }));
  d = await stored();
  record('a new photo on the old record: details approved, photo pending',
    d.detailsStatus === 'approved' && d.photoStatus === 'pending' && d.profileStatus === 'pending');

  await seed(LEGACY);
  await expectWrite('the old app\'s resubmission (profileStatus pending, no parts) still works', 'ALLOW', (ref) =>
    setDoc(ref, { ...SUBMITTED, lastName: 'Changed', profileStatus: 'pending' }, { merge: true }),
  );
  await expectWrite('keeping "approved" on an old record while changing a detail', 'DENY', (ref) =>
    setDoc(ref, { lastName: 'Changed', detailsStatus: 'approved', photoStatus: 'approved', profileStatus: 'approved' }, { merge: true }),
  );

  await seed({ ...LEGACY, profileStatus: 'pending' });
  await expectWrite('an old PENDING record: the athlete writes both parts approved', 'DENY', (ref) =>
    setDoc(ref, { detailsStatus: 'approved', photoStatus: 'approved', profileStatus: 'approved' }, { merge: true }),
  );
});

console.log('\n=== verification: what the athlete may not write ===\n');

const HALF = {
  ...BASE, ...SUBMITTED, ...SNAPSHOT, approvedPhotoUrl: null, photoPublicId: 'p',
  detailsStatus: 'approved', photoStatus: 'rejected', profileStatus: 'rejected', photoRejectionReason: 'blurry',
};
const cases = [
  ['photo rejected -> approved', 'DENY', { photoStatus: 'approved', profileStatus: 'approved' }],
  ['photo rejected -> approved, overall left rejected', 'DENY', { photoStatus: 'approved' }],
  ['a changed detail keeping details approved', 'DENY', { lastName: 'Changed', photoStatus: 'pending', profileStatus: 'pending' }],
  ['a changed detail with details pending', 'ALLOW', { lastName: 'Changed', detailsStatus: 'pending', photoStatus: 'pending', profileStatus: 'pending' }],
  ['a new photo while the photo stays rejected', 'DENY', { photoUrl: 'https://res.cloudinary.com/x/9.jpg' }],
  ['a new photo, photo pending', 'ALLOW', { photoUrl: 'https://res.cloudinary.com/x/9.jpg', photoStatus: 'pending', profileStatus: 'pending' }],
  ['overall approved while the photo is pending', 'DENY', { photoStatus: 'pending', profileStatus: 'approved' }],
  ['a part set to rejected by the athlete', 'DENY', { detailsStatus: 'rejected', photoStatus: 'rejected' }],
  ['a part set to an unknown value', 'DENY', { detailsStatus: 'incomplete', photoStatus: 'pending', profileStatus: 'pending' }],
  ['the photo reason erased', 'DENY', { photoRejectionReason: null }],
  ['a details reason written', 'DENY', { detailsRejectionReason: 'fine' }],
];
for (const [name, expect, patch] of cases) {
  await seed(HALF);
  await expectWrite(name, expect, (ref) => setDoc(ref, patch, { merge: true }));
}
await seed(HALF);
await expectWrite('removing the part fields to fall back to the old model', 'DENY', (ref) =>
  updateDoc(ref, { detailsStatus: deleteField(), photoStatus: deleteField(), profileStatus: 'pending' }),
);
await seed({ ...HALF, lastName: 'Typo' });
await expectWrite('a detail set back to exactly the approved value keeps details approved', 'ALLOW', (ref) =>
  setDoc(ref, { lastName: 'Ganzorig', photoStatus: 'pending', profileStatus: 'pending' }, { merge: true }),
);
await seed(HALF);
await expectWrite('sign-in upsert on a two-part record', 'ALLOW', (ref) => setDoc(ref, UPSERT, { merge: true }));
await seed(HALF);
await expectWrite('WCA ID alone on a two-part record', 'ALLOW', (ref) => updateDoc(ref, { wcaId: '2020NEWW02' }));
await testEnv.clearFirestore();
await expectWrite('a brand-new record may not start approved', 'DENY', (ref) =>
  setDoc(ref, { ...BASE, ...SUBMITTED, detailsStatus: 'approved', photoStatus: 'approved', profileStatus: 'approved' }),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
