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
    'lib/online-competition/rounds.ts',
    'lib/online-competition/admin-competitions.ts',
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
  ok('  ...with the expected Ao5', byUid.get('full')?.value === FULL_AO5, String(byUid.get('full')?.value));

  ok('4 approved + 1 REJECTED -> present (the bug: used to vanish)', byUid.has('oneDnf'));
  ok(
    '  ...DNF dropped as the worst, valid average',
    byUid.get('oneDnf')?.value === ONE_DNF_AO5,
    String(byUid.get('oneDnf')?.value),
  );
  ok('  ...counted as a complete 5-attempt set', byUid.get('oneDnf')?.attempts === 5, String(byUid.get('oneDnf')?.attempts));

  ok('3 approved + 2 REJECTED -> present as a finisher', byUid.has('twoDnf'));
  ok('  ...with a DNF average (ao5 null)', byUid.get('twoDnf')?.value === null, String(byUid.get('twoDnf')?.value));

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
    ranked.every((r) => r.value !== 999 && r.value < 1500), JSON.stringify(ranked.map((r) => r.value)));

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


  // NOTE: every fixture athlete below has a GLOBALLY UNIQUE uid. That is
// not cosmetic: recomputeAthleteStatsForCompetition recomputes an
// athlete across EVERY competition they appear in, so a uid reused
// between two fixtures silently merges their solveCount and PR.
// ══ NON-Ao5 FORMATS ══════════════════════════════════════════════════
  // Same judged-not-approved rule, but the attempt count, the result and
  // the sort all come from the event's resultFormat now.
  const { selectQualifiers } = require(path.join(OUT, 'rounds.js'));
  const { validateCompetitionInput, writeCompetitionDoc } = require(path.join(OUT, 'admin-competitions.js'));
  const body = (over) => ({ name: 'x', status: 'draft', events: [], ...over });

  /** Seeds one competition whose single event runs `format`, with one
   *  athlete per spec. `times` may hold numbers or 'DNF'; a 'DNF' entry is
   *  seeded as a judge-REJECTED attempt, which is how a DNF actually
   *  reaches the ranker. `pending` marks trailing attempts as unjudged. */
  async function seedFormat(compId, format, attemptCount, specs) {
    await db.collection('onlineCompetitions').doc(compId).set({
      name: compId, status: 'finished', season: 's1',
      events: [{ eventId: EVENT, label: '3x3x3', rounds: 1, resultFormat: format }],
    });
    let t = 1_800_000_000_000;
    for (const [uid, spec] of Object.entries(specs)) {
      await db.collection('onlineParticipants').doc(uid).set({ uid, displayName: uid });
      for (let i = 0; i < attemptCount; i++) {
        const v = spec.times[i];
        const isPending = spec.pending?.includes(i);
        if (v === undefined) continue;
        await db.collection('onlineSubmissions').add({
          competitionId: compId, uid, event: EVENT, round: i + 1, competitionRound: ROUND,
          videoUrl: 'x', cloudinaryPublicId: 'x',
          reportedTime: v === 'DNF' ? 999 : v,
          isDnf: false,
          penalty: v === 'DNF' ? 'DNF' : null,
          status: isPending ? 'pending' : v === 'DNF' ? 'rejected' : 'approved',
          createdAt: Timestamp.fromMillis((t += 1000)),
        });
      }
    }
  }

  // ── Mo3 ───────────────────────────────────────────────────────────────
  const MO3 = 'comp-mo3';
  await seedFormat(MO3, 'mo3', 3, {
    // mean(1000,1100,1200) = 1100
    mClean:   { times: [1000, 1100, 1200] },
    // mean(1200,1300,1400) = 1300
    mSlower:  { times: [1200, 1300, 1400] },
    // ANY DNF kills an Mo3 — no cushion
    mOneDnf:  { times: [1000, 1100, 'DNF'] },
    // only 2 of 3 judged
    mPartial: { times: [1000, 1100, 1200], pending: [2] },
  });

  const mo3All = await collectRoundResults(db, MO3, EVENT, ROUND);
  const mo3By = new Map(mo3All.map((r) => [r.uid, r]));
  ok('mo3: reads 3 attempts, not 5 — clean set is ranked', mo3By.has('mClean'));
  ok('mo3: clean mean is right (no trimming)', mo3By.get('mClean')?.value === 1100, String(mo3By.get('mClean')?.value));
  ok('mo3: slower athlete ranked too', mo3By.get('mSlower')?.value === 1300, String(mo3By.get('mSlower')?.value));
  ok('mo3: ONE DNF is a DNF result (no cushion)', mo3By.get('mOneDnf')?.value === null, String(mo3By.get('mOneDnf')?.value));
  ok('mo3: DNF-result athlete still FINISHED the round', mo3By.has('mOneDnf'));
  ok('mo3: an unjudged attempt means incomplete, not ranked', !mo3By.has('mPartial'));
  ok('mo3: DNF result sorts last among finishers', mo3All[mo3All.length - 1].uid === 'mOneDnf', mo3All.map((r) => r.uid).join(','));

  const mo3Ranked = await rankRoundResults(db, MO3, EVENT, ROUND);
  ok('mo3: exactly the two finishers with a real mean are ranked',
    mo3Ranked.map((r) => r.uid).join(',') === 'mClean,mSlower', mo3Ranked.map((r) => r.uid).join(','));
  ok('mo3: a rejected attempt never contributes its reportedTime',
    mo3Ranked.every((r) => r.value !== 999), JSON.stringify(mo3Ranked.map((r) => r.value)));

  // ── Bo3 ───────────────────────────────────────────────────────────────
  const BO3 = 'comp-bo3';
  await seedFormat(BO3, 'bo3', 3, {
    // best of the three = 900
    b3Fast:    { times: [1200, 900, 1500] },
    // one DNF, still ranked on the best of what remains = 1000
    b3OneDnf:  { times: ['DNF', 1000, 1400] },
    // every attempt DNF -> no result
    b3AllDnf:  { times: ['DNF', 'DNF', 'DNF'] },
    b3Partial: { times: [800, 900, 1000], pending: [2] },
  });

  const bo3All = await collectRoundResults(db, BO3, EVENT, ROUND);
  const bo3By = new Map(bo3All.map((r) => [r.uid, r]));
  ok('bo3: value is the BEST SINGLE, not an average', bo3By.get('b3Fast')?.value === 900, String(bo3By.get('b3Fast')?.value));
  ok('bo3: one DNF still ranks on the best of the rest', bo3By.get('b3OneDnf')?.value === 1000, String(bo3By.get('b3OneDnf')?.value));
  ok('bo3: all-DNF has no result', bo3By.get('b3AllDnf')?.value === null, String(bo3By.get('b3AllDnf')?.value));
  ok('bo3: an unjudged attempt means incomplete, not ranked', !bo3By.has('b3Partial'));
  ok('bo3: value equals best for a best-of format', bo3By.get('b3Fast')?.best === bo3By.get('b3Fast')?.value);

  const bo3Ranked = await rankRoundResults(db, BO3, EVENT, ROUND);
  ok('bo3: ranked fastest-single first',
    bo3Ranked.map((r) => r.uid).join(',') === 'b3Fast,b3OneDnf', bo3Ranked.map((r) => r.uid).join(','));

  // ── Bo1 ───────────────────────────────────────────────────────────────
  const BO1 = 'comp-bo1';
  await seedFormat(BO1, 'bo1', 1, {
    b1Solo: { times: [1234] },
    b1Dnf:  { times: ['DNF'] },
  });
  const bo1All = await collectRoundResults(db, BO1, EVENT, ROUND);
  const bo1By = new Map(bo1All.map((r) => [r.uid, r]));
  ok('bo1: a single attempt is a complete round', bo1By.get('b1Solo')?.value === 1234, String(bo1By.get('b1Solo')?.value));
  ok('bo1: a DNF single has no result', bo1By.get('b1Dnf')?.value === null, String(bo1By.get('b1Dnf')?.value));

  // ── the WCA tie-break ────────────────────────────────────────────────
  // Equal Mo3 means, different singles. Before this changeset a tie fell
  // straight to uid (alphabetical), which silently decided who advanced.
  // 'tZzz' is deliberately alphabetically LAST so a uid tie-break would put
  // it second — it must come first on the better single.
  const TIE = 'comp-tie';
  await seedFormat(TIE, 'mo3', 3, {
    // mean(1000,1100,1200) = 1100, best single 1000
    tAaa: { times: [1000, 1100, 1200] },
    // mean(900,1100,1300)  = 1100, best single 900  <- better single
    tZzz: { times: [900, 1100, 1300] },
  });
  const tieRanked = await rankRoundResults(db, TIE, EVENT, ROUND);
  ok('tie-break: both athletes have the SAME mean',
    tieRanked[0]?.value === 1100 && tieRanked[1]?.value === 1100,
    JSON.stringify(tieRanked.map((r) => r.value)));
  ok('tie-break: the better SINGLE ranks first (not alphabetical uid)',
    tieRanked[0]?.uid === 'tZzz', tieRanked.map((r) => `${r.uid}:${r.best}`).join(','));
  ok('tie-break: best single is carried on the ranking',
    tieRanked[0]?.best === 900 && tieRanked[1]?.best === 1000,
    JSON.stringify(tieRanked.map((r) => r.best)));

  // ── qualification on a non-Ao5 round ─────────────────────────────────
  // The qualify route ranks through rankRoundResults, so it inherits all
  // of the above; selectQualifiers is the pure selection it then applies.
  const bo3Cut = selectQualifiers(bo3Ranked, 'count', 1);
  ok('qualify: top-1 of a Bo3 round selects the fastest single',
    bo3Cut.length === 1 && bo3Cut[0].uid === 'b3Fast', JSON.stringify(bo3Cut.map((r) => r.uid)));
  const mo3Cut = selectQualifiers(mo3Ranked, 'count', 1);
  ok('qualify: top-1 of an Mo3 round selects the best mean',
    mo3Cut.length === 1 && mo3Cut[0].uid === 'mClean', JSON.stringify(mo3Cut.map((r) => r.uid)));
  const tieCut = selectQualifiers(tieRanked, 'count', 1);
  ok('qualify: a tie is broken by single, so the cut is not arbitrary',
    tieCut.length === 1 && tieCut[0].uid === 'tZzz', JSON.stringify(tieCut.map((r) => r.uid)));
  ok('qualify: a DNF-result athlete is never selected',
    selectQualifiers(mo3Ranked, 'count', 99).every((r) => r.uid !== 'oneDnf'));


  // ══ CROSS-FORMAT STATS AND SEASON POINTS ═════════════════════════════
  // athleteStats recomputes GLOBALLY — across every competition an athlete
  // has ever solved in — so an Ao5 result in one and an Mo3 in another for
  // the SAME event must land in separate fields and never overwrite one
  // another. `pr` spans everything, because a single is a single.

  /** Seeds one competition + one athlete's judged attempts for an event. */
  async function seedComp(compId, format, attemptCount, perUid, season = 's2') {
    await db.collection('onlineCompetitions').doc(compId).set({
      name: compId, status: 'finished', season,
      events: [{ eventId: EVENT, label: '3x3x3', rounds: 1, resultFormat: format }],
    });
    let t = 1_900_000_000_000;
    for (const [uid, times] of Object.entries(perUid)) {
      await db.collection('onlineParticipants').doc(uid).set({ uid, displayName: uid }, { merge: true });
      for (let i = 0; i < attemptCount; i++) {
        const v = times[i];
        await db.collection('onlineSubmissions').add({
          competitionId: compId, uid, event: EVENT, round: i + 1, competitionRound: 1,
          videoUrl: 'x', cloudinaryPublicId: 'x',
          reportedTime: v === 'DNF' ? 999 : v,
          isDnf: false,
          penalty: v === 'DNF' ? 'DNF' : null,
          status: v === 'DNF' ? 'rejected' : 'approved',
          createdAt: Timestamp.fromMillis((t += 1000)),
        });
      }
    }
  }

  const statsFor = async (uid) =>
    (await db.collection('onlineParticipants').doc(uid).get()).data()?.stats?.[EVENT];

  // Same athlete, same event, two competitions with different formats.
  // Ao5 of [1000,1100,1200,1300,1400] = 1200; best single 1000.
  // Mo3 of [1500,1600,1700]           = 1600; best single 1500.
  await seedComp('x-ao5', 'ao5', 5, { xDual: [1000, 1100, 1200, 1300, 1400] });
  await seedComp('x-mo3', 'mo3', 3, { xDual: [1500, 1600, 1700] });
  await recomputeAthleteStatsForCompetition('x-ao5');
  let dual = await statsFor('xDual');
  ok('cross-format: Ao5 stored in stats.ao5', dual?.ao5 === 1200, JSON.stringify(dual));
  ok('cross-format: Mo3 stored in stats.mo3', dual?.mo3 === 1600, JSON.stringify(dual));
  ok('cross-format: the SLOWER Mo3 did not overwrite the Ao5', dual?.ao5 === 1200);
  ok('cross-format: the FASTER Ao5 did not overwrite the Mo3', dual?.mo3 === 1600);
  ok('cross-format: pr is the best single across BOTH competitions', dual?.pr === 1000, String(dual?.pr));
  ok('cross-format: solveCount spans both competitions', dual?.solveCount === 8, String(dual?.solveCount));

  // Recomputing from the OTHER competition must reach the same answer —
  // the recompute is global, not per-competition.
  await recomputeAthleteStatsForCompetition('x-mo3');
  dual = await statsFor('xDual');
  ok('cross-format: recomputing from the Mo3 competition gives the same stats',
    dual?.ao5 === 1200 && dual?.mo3 === 1600 && dual?.pr === 1000, JSON.stringify(dual));

  // An Mo3 that is FASTER than the athlete's Ao5 still must not touch it.
  await seedComp('x-mo3-fast', 'mo3', 3, { xDual: [500, 600, 700] });
  await recomputeAthleteStatsForCompetition('x-mo3-fast');
  dual = await statsFor('xDual');
  ok('cross-format: a faster Mo3 (600) replaces only stats.mo3', dual?.mo3 === 600, JSON.stringify(dual));
  ok('cross-format: ...and leaves stats.ao5 alone', dual?.ao5 === 1200, JSON.stringify(dual));
  ok('cross-format: ...and does move pr', dual?.pr === 500, String(dual?.pr));

  // ── Bo-N contributes to pr and solveCount but NO average ─────────────
  await seedComp('x-bo3', 'bo3', 3, { xBonly: [800, 700, 900] });
  await recomputeAthleteStatsForCompetition('x-bo3');
  const bonly = await statsFor('xBonly');
  ok('bo3: contributes to pr', bonly?.pr === 700, String(bonly?.pr));
  ok('bo3: contributes to solveCount', bonly?.solveCount === 3, String(bonly?.solveCount));
  ok('bo3: produces NO ao5', bonly?.ao5 === null, JSON.stringify(bonly));
  ok('bo3: produces NO mo3', bonly?.mo3 === null, JSON.stringify(bonly));

  // ── season points for a non-Ao5 round ────────────────────────────────
  await seedComp('x-season', 'mo3', 3, {
    sWinner: [1000, 1000, 1000], // mean 1000
    sSecond: [1100, 1100, 1100], // mean 1100
    sDnfd:   [1000, 1100, 'DNF'], // any DNF kills an Mo3
  }, 's3');
  await recomputeSeasonPointsForCompetition('x-season');
  const seasonRows = await db.collection('onlineSeasonPoints').doc('s3').collection('athletes').get();
  const pts = new Map(seasonRows.docs.map((d) => [d.id, d.data()]));
  const placementOf = (uid) => (pts.get(uid)?.breakdown ?? []).find((b) => b.competitionId === 'x-season')?.placement;
  ok('season/mo3: the better mean places first', placementOf('sWinner') === 1, String(placementOf('sWinner')));
  ok('season/mo3: the slower mean places second', placementOf('sSecond') === 2, String(placementOf('sSecond')));
  ok('season/mo3: a DNF mean gets no placement', placementOf('sDnfd') === undefined, String(placementOf('sDnfd')));
  ok('season/mo3: the winner scores more than second',
    (pts.get('sWinner')?.totalPoints ?? 0) > (pts.get('sSecond')?.totalPoints ?? 0),
    `${pts.get('sWinner')?.totalPoints} vs ${pts.get('sSecond')?.totalPoints}`);

  // The season tie-break: equal means, better single wins the placement —
  // and placement is what decides +15 vs +10.
  await seedComp('x-tie', 'mo3', 3, {
    sAaa: [1000, 1100, 1200], // mean 1100, best 1000
    sZzz: [900, 1100, 1300],  // mean 1100, best 900   <- better single
  }, 's4');
  await recomputeSeasonPointsForCompetition('x-tie');
  const tieRows = await db.collection('onlineSeasonPoints').doc('s4').collection('athletes').get();
  const tiePts = new Map(tieRows.docs.map((d) => [d.id, d.data()]));
  const tiePlace = (uid) => (tiePts.get(uid)?.breakdown ?? []).find((b) => b.competitionId === 'x-tie')?.placement;
  ok('season tie-break: the better single takes 1st (not read order)', tiePlace('sZzz') === 1, String(tiePlace('sZzz')));
  ok('season tie-break: the other takes 2nd', tiePlace('sAaa') === 2, String(tiePlace('sAaa')));

  // ── THE REGRESSION THAT MATTERS MOST ─────────────────────────────────
  // Every Ao5-only case above (the original suite) must be byte-identical.
  // Re-run the original competition's recomputes and re-assert them.
  await recomputeSeasonPointsForCompetition(COMP);
  await recomputeAthleteStatsForCompetition(COMP);
  const regStats = await Promise.all(
    Object.keys(ATHLETES).map(async (uid) => [uid, (await db.collection('onlineParticipants').doc(uid).get()).data()?.stats?.[EVENT]]),
  );
  const reg = new Map(regStats);
  ok('REGRESSION ao5: 5-approved athlete Ao5 unchanged', reg.get('full')?.ao5 === FULL_AO5, JSON.stringify(reg.get('full')));
  ok('REGRESSION ao5: one-DNF athlete Ao5 unchanged', reg.get('oneDnf')?.ao5 === ONE_DNF_AO5, JSON.stringify(reg.get('oneDnf')));
  ok('REGRESSION ao5: DNF-average athlete still has no Ao5', reg.get('twoDnf')?.ao5 === null);
  ok('REGRESSION ao5: incomplete athlete still has no Ao5', reg.get('pending')?.ao5 === null);
  ok('REGRESSION ao5: PR unchanged', reg.get('oneDnf')?.pr === 1000, String(reg.get('oneDnf')?.pr));
  ok('REGRESSION ao5: solveCount unchanged', reg.get('oneDnf')?.solveCount === 4, String(reg.get('oneDnf')?.solveCount));
  // An Ao5-only athlete has no Mo3 — the new field is null, not absent-
  // and-undefined, so readers get a consistent shape.
  ok('REGRESSION ao5: an Ao5-only athlete has mo3 === null', reg.get('full')?.mo3 === null, JSON.stringify(reg.get('full')));

  const regSeason = await db.collection('onlineSeasonPoints').doc('s1').collection('athletes').get();
  const regPts = new Map(regSeason.docs.map((d) => [d.id, d.data()]));
  ok('REGRESSION ao5: season points still awarded to the two finishers',
    (regPts.get('full')?.totalPoints ?? 0) > 0 && (regPts.get('oneDnf')?.totalPoints ?? 0) > 0);
  ok('REGRESSION ao5: DNF-average athlete still unplaced',
    (regPts.get('twoDnf')?.breakdown ?? []).length === 0);


  // ══ TIME LIMIT ═══════════════════════════════════════════════════════
  // Enforced authoritatively in effectiveAttemptTime, which every scorer
  // converges on. These drive it through the real ranker end to end.

  /** Seeds an Ao5 competition with a per-attempt limit. `specs` values may
   *  be a plain number, or [time, '+2'] to attach a judge penalty. */
  async function seedLimit(compId, timeLimitCs, specs) {
    await db.collection('onlineCompetitions').doc(compId).set({
      name: compId, status: 'finished', season: 's5',
      events: [{ eventId: EVENT, label: '3x3x3', rounds: 1, resultFormat: 'ao5', timeLimitCs }],
    });
    let t = 2_000_000_000_000;
    for (const [uid, times] of Object.entries(specs)) {
      await db.collection('onlineParticipants').doc(uid).set({ uid, displayName: uid }, { merge: true });
      for (let i = 0; i < 5; i++) {
        const raw = times[i];
        const [ms, pen] = Array.isArray(raw) ? raw : [raw, null];
        await db.collection('onlineSubmissions').add({
          competitionId: compId, uid, event: EVENT, round: i + 1, competitionRound: ROUND,
          videoUrl: 'x', cloudinaryPublicId: 'x',
          reportedTime: ms, isDnf: false, penalty: pen, status: 'approved',
          createdAt: Timestamp.fromMillis((t += 1000)),
        });
      }
    }
  }

  // Limit 1:00 (6000cs).
  await seedLimit('comp-limit', 6000, {
    // all under -> ordinary Ao5: drop 1000 & 1400, mean(1100,1200,1300)
    lUnder:  [1000, 1100, 1200, 1300, 1400],
    // one attempt over -> that attempt is a DNF, dropped as the worst
    lOneOver: [1000, 1100, 1200, 1300, 9000],
    // two over -> two DNFs -> DNF average
    lTwoOver: [1000, 1100, 1200, 9000, 9500],
    // exactly the limit is allowed, not over
    lExact:   [6000, 6000, 6000, 6000, 6000],
    // legal until the judge's +2 crosses the limit: 59.90 + 2s = 61.90
    lPlusTwo: [1000, 1100, 1200, 1300, [5990, '+2']],
  });

  const lim = new Map((await collectRoundResults(db, 'comp-limit', EVENT, ROUND)).map((r) => [r.uid, r]));
  ok('limit: a time under the limit is unaffected', lim.get('lUnder')?.value === 1200, String(lim.get('lUnder')?.value));
  ok('limit: one over-limit attempt becomes a DNF and is dropped as worst',
    lim.get('lOneOver')?.value === 1200, String(lim.get('lOneOver')?.value));
  ok('limit: two over-limit attempts give a DNF average',
    lim.get('lTwoOver')?.value === null, String(lim.get('lTwoOver')?.value));
  ok('limit: EXACTLY the limit is allowed (not over)', lim.get('lExact')?.value === 6000, String(lim.get('lExact')?.value));
  ok('limit: a +2 that crosses the limit makes it a DNF',
    lim.get('lPlusTwo')?.value === 1200, String(lim.get('lPlusTwo')?.value));
  ok('limit: an over-limit time never contributes its value',
    [...lim.values()].every((r) => r.value === null || r.value < 6100),
    JSON.stringify([...lim.values()].map((r) => r.value)));

  // The PR must not be set from an over-limit solve either.
  await recomputeAthleteStatsForCompetition('comp-limit');
  const overStats = (await db.collection('onlineParticipants').doc('lOneOver').get()).data()?.stats?.[EVENT];
  ok('limit: PR ignores the over-limit attempt', overStats?.pr === 1000, JSON.stringify(overStats));
  const twoOverStats = (await db.collection('onlineParticipants').doc('lTwoOver').get()).data()?.stats?.[EVENT];
  ok('limit: a DNF-average athlete still has a PR from their legal solves',
    twoOverStats?.pr === 1000, JSON.stringify(twoOverStats));
  ok('limit: ...but no Ao5', twoOverStats?.ao5 === null, JSON.stringify(twoOverStats));

  // ── null limit changes NOTHING ───────────────────────────────────────
  // The assertion that matters most for existing data: the same attempts,
  // with no limit stored, must score exactly as they always did.
  await seedLimit('comp-nolimit', null, {
    nUnder:  [1000, 1100, 1200, 1300, 1400],
    nSlow:   [1000, 1100, 1200, 1300, 9000],   // would be DNF under a limit
    nVerySlow: [90000, 91000, 92000, 93000, 94000], // all over any sane limit
  });
  const nolim = new Map((await collectRoundResults(db, 'comp-nolimit', EVENT, ROUND)).map((r) => [r.uid, r]));
  ok('null limit: an ordinary set is unchanged', nolim.get('nUnder')?.value === 1200, String(nolim.get('nUnder')?.value));
  ok('null limit: a slow attempt is NOT a DNF — it is just the worst, dropped',
    nolim.get('nSlow')?.value === 1200, String(nolim.get('nSlow')?.value));
  ok('null limit: very slow times still produce a real average',
    nolim.get('nVerySlow')?.value === 92000, String(nolim.get('nVerySlow')?.value));

  // An event with NO timeLimitCs field at all (every competition that
  // predates this changeset) behaves identically to an explicit null.
  await db.collection('onlineCompetitions').doc('comp-legacy-lim').set({
    name: 'legacy', status: 'finished', season: 's5',
    events: [{ eventId: EVENT, label: '3x3x3', rounds: 1 }], // no resultFormat, no timeLimitCs
  });
  let tl = 2_100_000_000_000;
  for (let i = 0; i < 5; i++) {
    await db.collection('onlineSubmissions').add({
      competitionId: 'comp-legacy-lim', uid: 'legacyAth', event: EVENT, round: i + 1, competitionRound: ROUND,
      videoUrl: 'x', cloudinaryPublicId: 'x',
      reportedTime: [1000, 1100, 1200, 1300, 90000][i], isDnf: false, penalty: null, status: 'approved',
      createdAt: Timestamp.fromMillis((tl += 1000)),
    });
  }
  await db.collection('onlineParticipants').doc('legacyAth').set({ uid: 'legacyAth', displayName: 'legacyAth' }, { merge: true });
  const legacyLim = await collectRoundResults(db, 'comp-legacy-lim', EVENT, ROUND);
  ok('ABSENT timeLimitCs behaves exactly like null — no DNF, ordinary Ao5',
    legacyLim[0]?.value === 1200, JSON.stringify(legacyLim.map((r) => r.value)));

  // ── the lock covers the limit too ────────────────────────────────────
  const LIMLOCK = 'comp-limlock';
  const saveLimit = async (cs) => {
    const r = validateCompetitionInput(body({
      events: [{ eventId: EVENT, label: '3x3x3', rounds: 1, resultFormat: 'ao5', timeLimitCs: cs }],
      status: 'upcoming',
    }));
    if (!r.ok) throw new Error(r.error);
    return writeCompetitionDoc(db, LIMLOCK, r.data);
  };
  await db.collection('onlineCompetitions').doc(LIMLOCK).set({ name: 'l', status: 'draft', events: [] });
  await saveLimit(6000);
  ok('limit lock: changeable while nothing is judged',
    await saveLimit(12000).then(() => true).catch((e) => e.message));
  await db.collection('onlineSubmissions').add({
    competitionId: LIMLOCK, uid: 'u1', event: EVENT, round: 1, competitionRound: 1,
    reportedTime: 1000, penalty: null, status: 'approved',
  });
  let limRefused = null;
  try { await saveLimit(6000); } catch (e) { limRefused = e; }
  ok('limit lock: REFUSED once a judged submission exists', limRefused !== null, 'change was allowed');
  ok('  ...with a message naming the time limit', /цагийн хязгаар/.test(limRefused?.message ?? ''), limRefused?.message);
  ok('limit lock: re-saving the SAME limit is still allowed',
    await saveLimit(12000).then(() => true).catch((e) => e.message));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
});
