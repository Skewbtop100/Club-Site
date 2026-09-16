// ── Practice is for verified athletes, enforced on the SERVER ─────────────
// Runs the real filePracticeRun (lib/online-competition/practice-server.ts,
// compiled) against the Firestore EMULATOR through the Admin SDK — the same
// SDK, and so the same bypass of firestore.rules, the filing route uses in
// production. That is the point: practiceRuns is closed to client writes, so
// the rules never see a practice run being filed, and a rules test could not
// show this gate working. Only a test of the server path can.
//
// What carries weight here:
//   REFUSED: never submitted, no participant document at all, awaiting
//     review, rejected, and HALF-verified (one part approved). Each refusal
//     is a 403 carrying the state the page explains — and writes NOTHING.
//   ACCEPTED: verified by the two part statuses, and verified the legacy
//     way (a single approved profileStatus), because resolveVerification
//     reads both and registration accepts both.
//   FAILS CLOSED: a profile read that throws files nothing.
//
// Run: npm run test:practiceverify   (starts the Firestore emulator)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.tmp-practice-verify-build');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — run through `npm run test:practiceverify`.');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/practice-server.ts',
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

// CommonJS throughout, deliberately: the compiled module requires
// firebase-admin/firestore, and a FieldValue sentinel from a second copy of
// that module (an ESM import) would not be recognised by this Firestore.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const S = require(path.join(OUT, 'practice-server.js'));

initializeApp({ projectId: 'practice-verify-check' });
const db = getFirestore();

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
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const run = (uid) => ({
  uid,
  event: '333',
  scramble: "R U R' U'",
  timeCs: 1234,
  isDnf: false,
  videoKey: `practice-videos/${uid}/333/abc.webm`,
  marks: { solveStart: 1000, solveEnd: 9000 },
});

const runsOf = async (uid) => (await db.collection('practiceRuns').where('uid', '==', uid).get()).size;

/** Files one run for `uid` and reports what happened, never throwing. */
async function attempt(uid) {
  try {
    const res = await S.filePracticeRun(db, run(uid));
    return { filed: true, res, written: await runsOf(uid) };
  } catch (err) {
    return { filed: false, err, written: await runsOf(uid) };
  }
}

async function refused(name, uid, profile, wantStatus, wantReason = null) {
  console.log(`\n  -- ${name} --`);
  if (profile !== undefined) await db.collection('onlineParticipants').doc(uid).set(profile);
  const r = await attempt(uid);
  ok('refused', !r.filed, r.filed ? 'it filed' : undefined);
  ok('  ...as a PracticeError', r.err instanceof S.PracticeError, String(r.err));
  eq('  ...with 403', r.err?.status, 403);
  eq('  ...naming the state the page explains', r.err?.gate?.status, wantStatus);
  eq('  ...with the reason it carries', r.err?.gate?.reason ?? null, wantReason);
  eq('  ...and NOTHING was written', r.written, 0);
}

async function accepted(name, uid, profile) {
  console.log(`\n  -- ${name} --`);
  await db.collection('onlineParticipants').doc(uid).set(profile);
  const r = await attempt(uid);
  ok('accepted', r.filed, r.filed ? undefined : String(r.err));
  eq('  ...one run written', r.written, 1);
  eq('  ...and nine of ten left', r.res?.remaining, 9);
}

const APPROVED = { detailsStatus: 'approved', photoStatus: 'approved', profileStatus: 'approved' };

// ── the four the brief names ─────────────────────────────────────────
// "Unverified": signed in, profile never submitted — what
// upsertGoogleParticipant leaves behind on first sign-in.
await refused('unverified: profile never submitted', 'never', { displayName: 'A' }, 'incomplete');
await refused('pending: submitted, awaiting review', 'pending',
  { detailsStatus: 'pending', photoStatus: 'pending', profileStatus: 'pending' }, 'pending');
await refused('rejected: with the reason', 'rejected',
  {
    detailsStatus: 'rejected', photoStatus: 'approved', profileStatus: 'rejected',
    detailsRejectionReason: 'Нэр буруу',
  },
  'rejected', 'Мэдээлэл: Нэр буруу');
await accepted('verified: details and photo both approved', 'verified', APPROVED);

// ── the edges around them ────────────────────────────────────────────
// FAIL CLOSED on absence: no document is "never submitted", not "unknown".
await refused('no participant document at all', 'ghost', undefined, 'incomplete');
// ONE PART is not verified — the same rule registration applies.
await refused('half-verified: details approved, photo awaiting review', 'half',
  { detailsStatus: 'approved', photoStatus: 'pending', profileStatus: 'pending' }, 'pending');
await refused('legacy record, still pending', 'legacy-pending', { profileStatus: 'pending' }, 'pending');
// An athlete approved under the single status is verified for registering,
// so they are verified here too.
await accepted('legacy record, approved', 'legacy-approved', { profileStatus: 'approved' });

// ── re-verification is read at filing time, not remembered ──────────
console.log('\n  -- verified, then rejected: the next run is refused --');
{
  await db.collection('onlineParticipants').doc('verified').set(
    { detailsStatus: 'approved', photoStatus: 'rejected', profileStatus: 'rejected', photoRejectionReason: 'Бүдэг' },
  );
  const r = await attempt('verified');
  ok('refused', !r.filed);
  eq('  ...as rejected', r.err?.gate?.status, 'rejected');
  eq('  ...and the earlier run is untouched, no second one', r.written, 1);
}

// ── readPracticeGate: what the list and presign routes ask ────────────
console.log('\n  -- readPracticeGate agrees with the filing check --');
eq('verified is allowed', (await S.readPracticeGate(db, 'legacy-approved')).allowed, true);
eq('pending is not', (await S.readPracticeGate(db, 'pending')).allowed, false);
eq('no document is not', (await S.readPracticeGate(db, 'nobody-at-all')).allowed, false);

// ── FAILS CLOSED on an unreadable profile ────────────────────────────
console.log('\n  -- an unreadable profile files nothing --');
{
  // A Firestore whose transaction cannot read. Everything the function
  // needs is present; only the read fails — as it would with the database
  // unreachable or a permissions fault.
  let setCalled = false;
  const broken = {
    collection: (name) => db.collection(name),
    runTransaction: async (fn) =>
      fn({
        get: async () => { throw new Error('UNAVAILABLE'); },
        set: () => { setCalled = true; },
      }),
  };
  let threw = null;
  try {
    await S.filePracticeRun(broken, run('unreadable'));
  } catch (err) {
    threw = err;
  }
  ok('filing rejects', threw !== null);
  ok('  ...with the read error, not a pass', /UNAVAILABLE/.test(String(threw)), String(threw));
  eq('  ...and never reached the write', setCalled, false);

  let gateThrew = false;
  try {
    await S.readPracticeGate({ collection: () => ({ doc: () => ({ get: async () => { throw new Error('x'); } }) }) }, 'u');
  } catch {
    gateThrew = true;
  }
  ok('readPracticeGate THROWS on an unreadable profile rather than answering', gateThrew);
}

// ── The admin's ХЯНАГДААГҮЙ load: whole histories ───────────────────
console.log('\n  -- ХЯНАГДААГҮЙ loads every run of an athlete with one pending --');
{
  // A fresh, verified athlete with five runs: four refused, one waiting.
  // And a second whose runs are all decided.
  await db.collection('onlineParticipants').doc('five').set(APPROVED);
  await db.collection('onlineParticipants').doc('settled').set(APPROVED);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await S.filePracticeRun(db, run('five'))).id);
  for (const id of ids.slice(0, 4)) await S.reviewPracticeRun(db, id, 'incorrect', 'Холилт буруу');
  const settled = (await S.filePracticeRun(db, run('settled'))).id;
  await S.reviewPracticeRun(db, settled, 'correct', null);

  const pending = await S.listPracticeScope(db, 'pending');
  const fiveRuns = pending.runs.filter((r) => r.uid === 'five');
  eq('all five of her runs come back, not only the pending one', fiveRuns.length, 5);
  eq('  ...four of them decided', fiveRuns.filter((r) => r.status === 'incorrect').length, 4);
  eq('  ...each carrying its reason', fiveRuns.filter((r) => r.reason === 'Холилт буруу').length, 4);
  eq('an athlete with nothing pending is not loaded', pending.runs.some((r) => r.uid === 'settled'), false);
  ok('`matched` is only what is waiting', pending.matched.every((r) => r.status === 'pending'));

  // Her last pending run decided: she has left the scope the NEXT load sees.
  // (The screen holds her row until the panel moves on — see
  // practice-review-rows; this is the server half.)
  await S.reviewPracticeRun(db, ids[4], 'incorrect', 'Холилт буруу');
  const after = await S.listPracticeScope(db, 'pending');
  eq('once all are decided, the next ХЯНАГДААГҮЙ load leaves her out',
    after.runs.some((r) => r.uid === 'five'), false);

  const all = await S.listPracticeScope(db, 'all');
  eq('БҮГД still has all five', all.runs.filter((r) => r.uid === 'five').length, 5);
  eq('  ...and the settled athlete', all.runs.some((r) => r.uid === 'settled'), true);

  // A DECISION CAN BE CHANGED, and the reason goes with a refusal.
  console.log('\n  -- a decision can be changed --');
  const changed = await S.reviewPracticeRun(db, ids[0], 'correct', null);
  eq('refused, then marked correct', changed.status, 'correct');
  eq('  ...and the old refusal reason is cleared', changed.reason, null);
  const again = await S.reviewPracticeRun(db, ids[0], 'redo', null);
  eq('correct, then redo requested', again.status, 'redo');
  const stored = (await db.collection('practiceRuns').doc(ids[0]).get()).data();
  eq('  ...as stored', stored.status, 'redo');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
