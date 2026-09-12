// ── Resetting one athlete's attempts for one round ──────────────────────
// The action deletes real work, so what this suite actually pins down is
// the BLAST RADIUS: the right submissions go, and everything one field
// away from them stays — another round, another event, another athlete,
// and the registration doc with its approval and its stored result.
//
// Also checks the point of the feature: after a reset the athlete's solve
// page plans a FRESH run at attempt 1, which is what lets a competition be
// tested repeatedly without re-registering anyone.
//
// Exercises the real compiled modules against the Firestore emulator.
// Run: npm run test:reset

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-reset-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/reset-attempts.ts',
      'lib/online-competition/run-resume.ts',
      'lib/online-competition/submission-id.ts',
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
}

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
// NO Cloudinary credentials, asserted rather than assumed. deleteSubmissionAndVideo
// runs for real in here, and a developer machine with these exported would
// have this suite issuing live DELETEs against the production media
// library. Cleared, destroyCloudinaryVideo returns 'missing-credentials'
// without making any network call at all — so the Firestore half is
// exercised exactly as in production while the asset half is inert.
// (It logs one console.error per video-bearing doc. Expected, not a
// failure: that is the "asset may linger" path the module documents.)
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;

// resetAthleteRoundAttempts calls getOnlineCompAdminDb() internally, which
// builds its own credentialed app via cert(). cert() PARSES the private key
// eagerly even though FIRESTORE_EMULATOR_HOST means it never authenticates
// anything — so a placeholder string fails outright. Generate a real
// throwaway RSA key: structurally valid, belongs to nobody, never leaves
// this process, and every request still goes to the emulator.
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'rt-reset';
process.env.ONLINE_COMP_FIREBASE_CLIENT_EMAIL = 'test@example.com';
process.env.ONLINE_COMP_FIREBASE_PRIVATE_KEY = require('node:crypto')
  .generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  .privateKey;
compile();

const { resetAthleteRoundAttempts, inResetScope } = require(path.join(OUT, 'reset-attempts.js'));
const { planResume } = require(path.join(OUT, 'run-resume.js'));
const { submissionDocId } = require(path.join(OUT, 'submission-id.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-reset' }, 'reset'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const COMP = 'comp-reset';
const OTHER_COMP = 'comp-other';
const ALICE = 'uid-alice';
const BOB = 'uid-bob';

/** One submission, filed the way the solve flow files it: at the
 *  deterministic id for (uid, competition, event, round, attempt). */
async function seedSubmission(o) {
  const id = submissionDocId({
    uid: o.uid,
    competitionId: o.competitionId,
    event: o.event,
    competitionRound: o.competitionRound,
    attempt: o.attempt,
  });
  await db
    .collection('onlineSubmissions')
    .doc(id)
    .set({
      competitionId: o.competitionId,
      uid: o.uid,
      event: o.event,
      round: o.attempt, // the ATTEMPT index, under its stored name
      competitionRound: o.competitionRound,
      videoUrl: `https://res.cloudinary.com/demo/video/upload/${id}.mp4`,
      ...(o.cloudinaryPublicId ? { cloudinaryPublicId: o.cloudinaryPublicId } : {}),
      reportedTime: o.reportedTime ?? 1200 + o.attempt,
      isDnf: false,
      penalty: o.penalty ?? null,
      status: o.status ?? 'pending',
      createdAt: Timestamp.fromMillis(1700000000000 + o.attempt * 1000),
    });
  return id;
}

async function wipe() {
  for (const coll of ['onlineSubmissions']) {
    const snap = await db.collection(coll).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const regs = await db.collection('onlineParticipants').doc(ALICE).collection('registrations').get();
  await Promise.all(regs.docs.map((d) => d.ref.delete()));
}

/** Mirrors fetchMyFiledAttempts (data.ts) — the client-SDK read the solve
 *  page does on open — using the Admin SDK, including its rule that a
 *  document with no numeric competitionRound cannot be resumed into one. */
async function filedAttemptsFor(uid, competitionId, event) {
  const snap = await db.collection('onlineSubmissions').where('uid', '==', uid).get();
  const mine = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.competitionId !== competitionId || data.event !== event) continue;
    if (typeof data.round !== 'number' || typeof data.competitionRound !== 'number') continue;
    mine.push({
      submissionId: d.id,
      attempt: data.round,
      competitionRound: data.competitionRound,
      reportedTime: typeof data.reportedTime === 'number' ? data.reportedTime : 0,
      isDnf: data.isDnf === true,
    });
  }
  return mine;
}

async function idsIn(uid) {
  const snap = await db.collection('onlineSubmissions').where('uid', '==', uid).get();
  return new Set(snap.docs.map((d) => d.id));
}

async function main() {
  await wipe();

  // ── Seed ─────────────────────────────────────────────────────────
  // The target: Alice, 3x3, round 1 — a complete Ao5 run, three of whose
  // attempts a judge has already ruled on (one of them a DNF).
  const target = [];
  for (let a = 1; a <= 5; a++) {
    target.push(
      await seedSubmission({
        uid: ALICE,
        competitionId: COMP,
        event: '333',
        competitionRound: 1,
        attempt: a,
        status: a <= 2 ? 'approved' : a === 3 ? 'rejected' : 'pending',
        penalty: a === 3 ? 'DNF' : null,
        // Only attempt 1 carries a video, so the Cloudinary counters are
        // checkable: exactly one asset is attempted, and fails for want of
        // credentials.
        cloudinaryPublicId: a === 1 ? 'online-comp/alice-333-r1-a1' : undefined,
      }),
    );
  }

  // A legacy document with NO competitionRound field at all. The admin
  // grid shows it under round 1, so a round-1 reset has to take it.
  const legacyId = `${ALICE}__${COMP}__333__legacy__a1`;
  await db.collection('onlineSubmissions').doc(legacyId).set({
    competitionId: COMP,
    uid: ALICE,
    event: '333',
    round: 1,
    videoUrl: 'https://res.cloudinary.com/demo/video/upload/legacy.mp4',
    reportedTime: 1500,
    isDnf: false,
    penalty: null,
    status: 'pending',
    createdAt: Timestamp.fromMillis(1600000000000),
  });
  target.push(legacyId);

  // Everything exactly one field away, which must all survive.
  const survivors = [];
  survivors.push(
    // Same athlete, same event, DIFFERENT round.
    await seedSubmission({ uid: ALICE, competitionId: COMP, event: '333', competitionRound: 2, attempt: 1 }),
    await seedSubmission({ uid: ALICE, competitionId: COMP, event: '333', competitionRound: 2, attempt: 2 }),
    // Same athlete, same round, DIFFERENT event.
    await seedSubmission({ uid: ALICE, competitionId: COMP, event: '222', competitionRound: 1, attempt: 1 }),
    await seedSubmission({ uid: ALICE, competitionId: COMP, event: '222', competitionRound: 1, attempt: 2 }),
    // Same athlete, same event and round, DIFFERENT competition.
    await seedSubmission({ uid: ALICE, competitionId: OTHER_COMP, event: '333', competitionRound: 1, attempt: 1 }),
    // DIFFERENT athlete, same competition, event and round.
    await seedSubmission({ uid: BOB, competitionId: COMP, event: '333', competitionRound: 1, attempt: 1 }),
    await seedSubmission({ uid: BOB, competitionId: COMP, event: '333', competitionRound: 1, attempt: 2 }),
  );

  // Alice's registration: approved, two events, and a stored Ao5 result.
  const regRef = db.collection('onlineParticipants').doc(ALICE).collection('registrations').doc(COMP);
  const registrationBefore = {
    competitionId: COMP,
    events: ['333', '222'],
    status: 'approved',
    registeredAt: Timestamp.fromMillis(1690000000000),
    results: { '333': { ao5: 1234, attempts: [1201, 1202, 1203, 1204, 1205] } },
  };
  await regRef.set(registrationBefore);

  const beforeTotal = (await db.collection('onlineSubmissions').get()).size;
  ok('seeded the expected number of submissions', beforeTotal === 13, `got ${beforeTotal}`);

  // ── Pure scope predicate ─────────────────────────────────────────
  const scope = { competitionId: COMP, uid: ALICE, event: '333', competitionRound: 1 };
  ok(
    'inResetScope: an exact match is in scope',
    inResetScope({ competitionId: COMP, uid: ALICE, event: '333', competitionRound: 1 }, scope),
  );
  ok(
    'inResetScope: another round is out',
    !inResetScope({ competitionId: COMP, uid: ALICE, event: '333', competitionRound: 2 }, scope),
  );
  ok(
    'inResetScope: another event is out',
    !inResetScope({ competitionId: COMP, uid: ALICE, event: '222', competitionRound: 1 }, scope),
  );
  ok(
    'inResetScope: another athlete is out',
    !inResetScope({ competitionId: COMP, uid: BOB, event: '333', competitionRound: 1 }, scope),
  );
  ok(
    'inResetScope: another competition is out',
    !inResetScope({ competitionId: OTHER_COMP, uid: ALICE, event: '333', competitionRound: 1 }, scope),
  );
  ok(
    'inResetScope: a round-less legacy doc counts as round 1, as the grid shows it',
    inResetScope({ competitionId: COMP, uid: ALICE, event: '333' }, scope) &&
      !inResetScope({ competitionId: COMP, uid: ALICE, event: '333' }, { ...scope, competitionRound: 2 }),
  );

  // ── The reset ────────────────────────────────────────────────────
  const result = await resetAthleteRoundAttempts(scope);

  ok('deleted exactly the 6 in-scope submissions', result.deleted === 6, `got ${result.deleted}`);
  ok('reported the 3 judged attempts that went with them', result.judged === 3, `got ${result.judged}`);
  ok(
    'deleted set is exactly the target set',
    target.length === 6 &&
      result.submissionIds.length === 6 &&
      target.every((id) => result.submissionIds.includes(id)),
    `got ${JSON.stringify(result.submissionIds)}`,
  );
  ok(
    'the one video-bearing doc was reported as an asset that may linger',
    result.videosDeleted === 0 && result.videosFailed === 1,
    `deleted=${result.videosDeleted} failed=${result.videosFailed}`,
  );

  // ── Nothing else moved ───────────────────────────────────────────
  const afterTotal = (await db.collection('onlineSubmissions').get()).size;
  ok('the 7 out-of-scope submissions remain', afterTotal === 7, `got ${afterTotal}`);

  const aliceLeft = await idsIn(ALICE);
  const bobLeft = await idsIn(BOB);
  ok('no target submission survived', target.every((id) => !aliceLeft.has(id)));
  ok(
    'every out-of-scope submission survived',
    survivors.every((id) => aliceLeft.has(id) || bobLeft.has(id)),
  );

  const aliceR2 = (await filedAttemptsFor(ALICE, COMP, '333')).filter((f) => f.competitionRound === 2);
  ok('Alice’s round 2 still has both attempts', aliceR2.length === 2, `got ${aliceR2.length}`);
  const alice222 = await filedAttemptsFor(ALICE, COMP, '222');
  ok('Alice’s 2x2 round 1 still has both attempts', alice222.length === 2, `got ${alice222.length}`);
  const aliceOther = await filedAttemptsFor(ALICE, OTHER_COMP, '333');
  ok('Alice’s other competition is untouched', aliceOther.length === 1, `got ${aliceOther.length}`);
  ok('Bob kept both of his round 1 attempts', bobLeft.size === 2, `got ${bobLeft.size}`);

  // ── The registration is untouched, results map included ──────────
  const regAfter = (await regRef.get()).data();
  ok('registration still exists', !!regAfter);
  ok('registration status unchanged', regAfter.status === 'approved', `got ${regAfter && regAfter.status}`);
  ok(
    'registration events unchanged',
    JSON.stringify(regAfter.events) === JSON.stringify(['333', '222']),
    JSON.stringify(regAfter && regAfter.events),
  );
  ok(
    'registeredAt unchanged — the participant limit sees the same registration',
    regAfter.registeredAt.toMillis() === 1690000000000,
  );
  // Documented, not incidental: the stored Ao5 is per EVENT, so a
  // per-ROUND reset leaves it alone and it goes stale until the athlete
  // finishes the run again (recordAo5Result overwrites it) or the admin
  // recomputes.
  ok('stored Ao5 result survives and is therefore stale', regAfter.results['333'].ao5 === 1234);

  // ── The athlete resumes at attempt 1 ─────────────────────────────
  const filed = await filedAttemptsFor(ALICE, COMP, '333');
  const shape = { format: 'ao5', attempts: 5, timeLimitCs: null, cutoffCs: null, cutoffPhase: null };
  const plan = planResume(filed, 1, shape);
  ok('resume plan for the reset round is a FRESH run', plan.kind === 'fresh', `got ${plan.kind}`);
  ok('next attempt is 1', plan.nextAttempt === 1, `got ${plan.nextAttempt}`);
  ok('no prior attempts are carried in', plan.priorAttempts.length === 0, `got ${plan.priorAttempts.length}`);
  ok('the run is not cut off', plan.cutOff === false);

  // Round 2 was never reset, so planning for it still resumes — proof the
  // reset did not quietly empty the athlete's whole event.
  const planR2 = planResume(filed, 2, shape);
  ok('round 2 still resumes at attempt 3', planR2.kind === 'resume' && planR2.nextAttempt === 3,
    `got ${planR2.kind}/${planR2.nextAttempt}`);

  // ── Re-running is harmless ───────────────────────────────────────
  const again = await resetAthleteRoundAttempts(scope);
  ok('a second reset deletes nothing', again.deleted === 0, `got ${again.deleted}`);
  const afterSecond = (await db.collection('onlineSubmissions').get()).size;
  ok('and leaves the other 7 alone', afterSecond === 7, `got ${afterSecond}`);

  await wipe();
  fs.rmSync(OUT, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
