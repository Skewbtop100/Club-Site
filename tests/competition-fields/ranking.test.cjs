// ── Ranking on JUDGED attempts, not approved ones ───────────────────────
// Regression suite for the bug where a judge-assigned DNF erased an
// athlete from a round entirely.
//
// A judge DNF writes status:'rejected' (app/api/online-competition/review/
// route.ts). Every scorer used to query status=='approved' only, so that
// attempt vanished, the athlete had 4 of 5 slots, the completeness check
// dropped them, and they disappeared from the standings, the season
// points and their own stats — when WCA says one DNF is simply the worst
// attempt, dropped, leaving a valid Ao5.
//
// The rule now: an attempt counts toward COMPLETENESS once it is decided
// either way; a rejected one enters the set as a DNF; a PENDING one still
// makes the round incomplete.
//
// Exercises the real compiled modules against the Firestore emulator.
// Run: npm run test:ranking

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-ranking-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/round-results.ts',
      'lib/online-competition/seasonPoints.ts',
      'lib/online-competition/athleteStats.ts',
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
// seasonPoints/athleteStats call getOnlineCompAdminDb() internally, which
// builds its own credentialed app via cert(). cert() PARSES the private
// key eagerly, even though FIRESTORE_EMULATOR_HOST means it is never used
// to authenticate anything — so a placeholder string fails outright. Generate
// a real throwaway RSA key instead: structurally valid, belongs to nobody,
// never leaves this process, and every request still goes to the emulator.
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'rt-ranking';
process.env.ONLINE_COMP_FIREBASE_CLIENT_EMAIL = 'test@example.com';
process.env.ONLINE_COMP_FIREBASE_PRIVATE_KEY = require('node:crypto')
  .generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  .privateKey;
compile();

const { collectRoundResults, rankRoundResults } = require(path.join(OUT, 'round-results.js'));
const { recomputeSeasonPointsForCompetition } = require(path.join(OUT, 'seasonPoints.js'));
const { recomputeAthleteStatsForCompetition } = require(path.join(OUT, 'athleteStats.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-ranking' }, 'rank'));

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

const COMP = 'comp-rank';
const EVENT = '333';
const ROUND = 1;

// Four athletes, one per scenario in the brief.
//   full     5 approved                  -> ranked, unchanged from before
//   oneDnf   4 approved + 1 REJECTED     -> ranked, DNF dropped, valid Ao5
//   twoDnf   3 approved + 2 REJECTED     -> DNF average, last among finishers
//   pending  4 approved + 1 PENDING      -> NOT ranked (incomplete)
const ATHLETES = {
  full:    { times: [1000, 1100, 1200, 1300, 1400], statuses: ['approved','approved','approved','approved','approved'] },
  oneDnf:  { times: [1000, 1100, 1200, 1300,    0], statuses: ['approved','approved','approved','approved','rejected'] },
  twoDnf:  { times: [1000, 1100, 1200,    0,    0], statuses: ['approved','approved','approved','rejected','rejected'] },
  pending: { times: [1000, 1100, 1200, 1300, 1400], statuses: ['approved','approved','approved','approved','pending' ] },
};

async function seed() {
  // Wipe the collections this suite touches so a re-run is deterministic.
  for (const col of ['onlineSubmissions', 'onlineParticipants', 'onlineCompetitions']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const seasonSnap = await db.collection('onlineSeasonPoints').doc('s1').collection('athletes').get();
  await Promise.all(seasonSnap.docs.map((d) => d.ref.delete()));

  await db.collection('onlineCompetitions').doc(COMP).set({
    name: 'Ranking test',
    status: 'finished',
    season: 's1',
    events: [{ eventId: EVENT, label: '3x3x3', rounds: 1 }],
  });

  let t = 1_700_000_000_000;
  for (const [uid, spec] of Object.entries(ATHLETES)) {
    await db.collection('onlineParticipants').doc(uid).set({ uid, displayName: uid });
    for (let i = 0; i < 5; i++) {
      const status = spec.statuses[i];
      await db.collection('onlineSubmissions').add({
        competitionId: COMP,
        uid,
        event: EVENT,
        round: i + 1,
        competitionRound: ROUND,
        videoUrl: 'x',
        cloudinaryPublicId: 'x',
        // A rejected attempt carries a real-looking reportedTime on
        // purpose: if any scorer ever trusts it, these tests fail loudly.
        reportedTime: status === 'rejected' ? 999 : spec.times[i],
        isDnf: false,
        penalty: status === 'rejected' ? 'DNF' : null,
        status,
        createdAt: Timestamp.fromMillis((t += 1000)),
      });
    }
  }
}

// Ao5 of [1000,1100,1200,1300,1400] = drop 1000 & 1400, mean(1100,1200,1300)
const FULL_AO5 = 1200;
// oneDnf: [1000,1100,1200,1300,DNF] -> DNF is worst and dropped, 1000 best
// dropped, mean(1100,1200,1300) = 1200. Same average as `full` by design,
// so ties resolve by uid and both are demonstrably ranked.
const ONE_DNF_AO5 = 1200;

(async () => {
  console.log('\n=== ranking on judged attempts, not approved ===\n');
  await seed();

  // ── collectRoundResults: who finished the round at all ──────────────
  const results = await collectRoundResults(db, COMP, EVENT, ROUND);
  const byUid = new Map(results.map((r) => [r.uid, r]));

  ok('5 approved -> present in results', byUid.has('full'));
  ok('  ...with the expected Ao5', byUid.get('full')?.ao5 === FULL_AO5, String(byUid.get('full')?.ao5));

  ok('4 approved + 1 REJECTED -> present (the bug: used to vanish)', byUid.has('oneDnf'));
  ok(
    '  ...DNF dropped as the worst, valid average',
    byUid.get('oneDnf')?.ao5 === ONE_DNF_AO5,
    String(byUid.get('oneDnf')?.ao5),
  );
  ok('  ...counted as a complete 5-attempt set', byUid.get('oneDnf')?.attempts === 5, String(byUid.get('oneDnf')?.attempts));

  ok('3 approved + 2 REJECTED -> present as a finisher', byUid.has('twoDnf'));
  ok('  ...with a DNF average (ao5 null)', byUid.get('twoDnf')?.ao5 === null, String(byUid.get('twoDnf')?.ao5));

  ok('4 approved + 1 PENDING -> absent (incomplete, unchanged)', !byUid.has('pending'));

  // DNF averages sort last among finishers.
  const order = results.map((r) => r.uid);
  ok('DNF average sorts last among finishers', order[order.length - 1] === 'twoDnf', order.join(','));

  // ── rankRoundResults: who is actually ranked/qualifiable ────────────
  const ranked = await rankRoundResults(db, COMP, EVENT, ROUND);
  const rankedUids = ranked.map((r) => r.uid);
  ok('ranked: the 5-approved athlete', rankedUids.includes('full'), rankedUids.join(','));
  ok('ranked: the one-DNF athlete (the fix)', rankedUids.includes('oneDnf'), rankedUids.join(','));
  ok('NOT ranked: DNF average', !rankedUids.includes('twoDnf'), rankedUids.join(','));
  ok('NOT ranked: incomplete (pending)', !rankedUids.includes('pending'), rankedUids.join(','));
  ok('exactly two athletes ranked', ranked.length === 2, String(ranked.length));
  // The qualify route ranks through this same function, so a cut of 2 now
  // includes the one-DNF athlete where it previously could not have.
  ok('a rejected attempt never contributes its reportedTime',
    ranked.every((r) => r.ao5 !== 999 && r.ao5 < 1500), JSON.stringify(ranked.map((r) => r.ao5)));

  // ── season points ───────────────────────────────────────────────────
  await recomputeSeasonPointsForCompetition(COMP);
  const seasonDocs = await db.collection('onlineSeasonPoints').doc('s1').collection('athletes').get();
  const points = new Map(seasonDocs.docs.map((d) => [d.id, d.data()]));

  ok('season: 5-approved athlete scores', (points.get('full')?.totalPoints ?? 0) > 0, JSON.stringify(points.get('full')?.breakdown));
  ok(
    'season: one-DNF athlete scores (the bug: used to score nothing)',
    (points.get('oneDnf')?.totalPoints ?? 0) > 0,
    JSON.stringify(points.get('oneDnf')?.breakdown),
  );
  ok(
    'season: DNF-average athlete gets no placement',
    (points.get('twoDnf')?.breakdown ?? []).length === 0,
    JSON.stringify(points.get('twoDnf')?.breakdown),
  );
  ok(
    'season: incomplete athlete gets no placement',
    (points.get('pending')?.breakdown ?? []).length === 0,
    JSON.stringify(points.get('pending')?.breakdown),
  );
  // Both finishers averaged 1200, so they tie; the placement set must be
  // exactly the two of them, not one.
  const placed = [...points.entries()].filter(([, v]) => (v.breakdown ?? []).length > 0).map(([k]) => k).sort();
  ok('season: exactly the two ranked athletes are placed', placed.join(',') === 'full,oneDnf', placed.join(','));

  // ── athlete stats ───────────────────────────────────────────────────
  await recomputeAthleteStatsForCompetition(COMP);
  const statDocs = await Promise.all(
    Object.keys(ATHLETES).map(async (uid) => [uid, (await db.collection('onlineParticipants').doc(uid).get()).data()]),
  );
  const stats = new Map(statDocs.map(([uid, d]) => [uid, d?.stats?.[EVENT]]));

  ok('stats: 5-approved athlete has an Ao5', stats.get('full')?.ao5 === FULL_AO5, JSON.stringify(stats.get('full')));
  ok(
    'stats: one-DNF athlete has an Ao5 (the bug: used to have none)',
    stats.get('oneDnf')?.ao5 === ONE_DNF_AO5,
    JSON.stringify(stats.get('oneDnf')),
  );
  ok('stats: DNF-average athlete has no Ao5', stats.get('twoDnf')?.ao5 === null, JSON.stringify(stats.get('twoDnf')));
  ok('stats: incomplete athlete has no Ao5', stats.get('pending')?.ao5 === null, JSON.stringify(stats.get('pending')));

  // PR and solveCount must keep their APPROVED-only meaning.
  ok('stats: PR ignores the rejected attempt entirely', stats.get('oneDnf')?.pr === 1000, JSON.stringify(stats.get('oneDnf')));
  ok(
    'stats: a rejected 999 never becomes anyone PR',
    [...stats.values()].every((v) => v?.pr !== 999),
    JSON.stringify([...stats.values()].map((v) => v?.pr)),
  );
  ok('stats: solveCount counts APPROVED only (4, not 5)', stats.get('oneDnf')?.solveCount === 4, String(stats.get('oneDnf')?.solveCount));
  ok('stats: solveCount for the all-approved athlete is 5', stats.get('full')?.solveCount === 5, String(stats.get('full')?.solveCount));
  ok('stats: pending athlete solveCount is 4 (pending is not judged)', stats.get('pending')?.solveCount === 4, String(stats.get('pending')?.solveCount));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
});
