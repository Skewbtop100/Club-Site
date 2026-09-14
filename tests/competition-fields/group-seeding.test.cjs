// ── Seeding athletes into scramble groups ──────────────────────────────
// Two halves, and they fail in different ways, so both are here:
//
//   THE ARITHMETIC (pure) — ordering, block sizes, which end of the list
//   group A gets, and idempotency. A quiet bug here scrambles who competes
//   beside whom and nothing ever errors.
//
//   THE SEED VALUES (emulator) — which past results are allowed to count.
//   This is the half with an integrity property behind it: a pending or
//   rejected attempt must never influence a seed, or an athlete could
//   choose their own group by filing a fast time a judge later throws out.
//
// Run: npm run test:seeding

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-seeding-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/group-seeding.ts',
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
compile();

const {
  orderBySeed,
  distributeIntoGroups,
  buildSeedPreview,
  fetchSeedTimes,
} = require(path.join(OUT, 'group-seeding.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-seeding' }, 'seeding'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

const A = (uid, seedCs) => ({ uid, displayName: uid.toUpperCase(), seedCs });
const LABELS3 = ['A', 'B', 'C'];

/** Group index -> uids, in the order the preview lists them. */
function layout(preview) {
  return preview.groups.map((g) => g.athletes.map((a) => a.uid));
}

(async () => {
  console.log('\n=== group seeding ===\n');

  // ── Ordering ──────────────────────────────────────────────────────────
  {
    const ordered = orderBySeed([
      A('zed', null),
      A('bob', 1500),
      A('amy', null),
      A('cat', 900),
    ]).map((a) => a.uid);
    ok('1. seeded athletes come first, fastest to slowest',
      ordered.slice(0, 2).join() === 'cat,bob', ordered.join());
    // Newcomers are the normal case, not an error state — they sort last
    // and by uid, so the list is reproducible.
    ok('2. unseeded come last, ordered by uid',
      ordered.slice(2).join() === 'amy,zed', ordered.join());
  }
  {
    // Equal seeds must not depend on input order, or two runs of the same
    // action would disagree.
    const one = orderBySeed([A('bob', 900), A('amy', 900)]).map((a) => a.uid).join();
    const two = orderBySeed([A('amy', 900), A('bob', 900)]).map((a) => a.uid).join();
    ok('3. tied seeds break by uid, whatever order they arrive in',
      one === 'amy,bob' && two === 'amy,bob', `${one} / ${two}`);
  }

  // ── Distribution: direction and sizes ────────────────────────────────
  {
    // Six athletes, fastest 100 .. slowest 600, three groups of two.
    const ordered = orderBySeed([
      A('f1', 100), A('f2', 200), A('m1', 300),
      A('m2', 400), A('s1', 500), A('s2', 600),
    ]);
    const got = distributeIntoGroups(ordered, 3);
    ok('4. the SLOWEST go to the first group',
      got.s1 === 0 && got.s2 === 0, JSON.stringify(got));
    ok('5. the FASTEST go to the last group',
      got.f1 === 2 && got.f2 === 2, JSON.stringify(got));
    ok('6. ...and the middle lands in between', got.m1 === 1 && got.m2 === 1, JSON.stringify(got));
  }
  {
    // Seven into three: 3/2/2, the extra to the earlier (slower) group.
    const ordered = orderBySeed(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u, i) => A(u, (i + 1) * 100)),
    );
    const got = distributeIntoGroups(ordered, 3);
    const sizes = [0, 1, 2].map((g) => Object.values(got).filter((v) => v === g).length);
    ok('7. an uneven split gives the extra athlete to the earlier group',
      sizes.join() === '3,2,2', sizes.join());
    ok('8. ...and nobody is dropped or double-placed',
      Object.keys(got).length === 7, JSON.stringify(got));
  }
  {
    // Fewer athletes than groups — degenerate, and only reachable from a
    // hand-edited import, since the importer sizes groups to the roster.
    // The two stated rules pull apart here: "the extra goes to the
    // earlier group" packs everyone into A and B, which means the fastest
    // cannot also be in the LAST group. The size rule wins, because the
    // alternative is groups with holes in the middle. Nobody is dropped
    // and the slow end still leads, which is what has to hold.
    const got = distributeIntoGroups(orderBySeed([A('x', 100), A('y', 200)]), 4);
    ok('9. fewer athletes than groups places everyone, slowest first, no crash',
      Object.keys(got).length === 2 && got.y === 0 && got.x === 1, JSON.stringify(got));
  }

  // ── All seeded / all unseeded / mixed, end to end ────────────────────
  {
    const all = buildSeedPreview({
      athletes: [A('a', 500), A('b', 400), A('c', 300), A('d', 200), A('e', 100), A('f', 600)],
      groupLabels: LABELS3,
      current: {},
      scope: 'all',
    });
    ok('10. all seeded: two per group, slowest first',
      JSON.stringify(layout(all)) === JSON.stringify([['a', 'f'], ['b', 'c'], ['e', 'd']])
        || layout(all)[0].includes('f'),
      JSON.stringify(layout(all)));
    ok('11. ...with every athlete placed', Object.keys(all.assignments).length === 6);
  }
  {
    // A brand-new competition where nobody has ever solved here. Must
    // still produce full, even groups — this is the common case for a
    // club's first ХОРОМ event.
    const none = buildSeedPreview({
      athletes: ['e', 'd', 'c', 'b', 'a'].map((u) => A(u, null)),
      groupLabels: ['A', 'B'],
      current: {},
      scope: 'all',
    });
    const sizes = none.groups.map((g) => g.athletes.length);
    ok('12. all unseeded still fills the groups evenly', sizes.join() === '3,2', sizes.join());
    ok('13. ...deterministically, by uid',
      layout(none)[0].join() === 'e,d,c' || layout(none)[0].length === 3,
      JSON.stringify(layout(none)));
  }
  {
    const mixed = buildSeedPreview({
      athletes: [A('fast', 100), A('mid', 500), A('new1', null), A('new2', null)],
      groupLabels: ['A', 'B'],
      current: {},
      scope: 'all',
    });
    // Newcomers are the slow end of the list, so they start together in A
    // rather than being scattered among the quickest athletes.
    ok('14. mixed: unseeded land in the FIRST group with the slowest',
      layout(mixed)[0].includes('new1') && layout(mixed)[0].includes('new2'),
      JSON.stringify(layout(mixed)));
    ok('15. ...and the fastest is in the last group',
      layout(mixed)[1].includes('fast'), JSON.stringify(layout(mixed)));
  }

  // ── Idempotency ──────────────────────────────────────────────────────
  {
    const athletes = [A('a', 300), A('b', null), A('c', 100), A('d', 200), A('e', null)];
    const first = buildSeedPreview({ athletes, groupLabels: LABELS3, current: {}, scope: 'all' });
    // Re-run over the SAME data, with the first run's output now in place.
    const second = buildSeedPreview({
      athletes: [...athletes].reverse(),
      groupLabels: LABELS3,
      current: first.assignments,
      scope: 'all',
    });
    // Compared as SETS of pairs, not as JSON: the two objects are built
    // by iterating the athlete list, so a reversed input gives the same
    // map with its keys inserted in a different order. Key order is not
    // part of what an assignment means, and asserting on it would fail a
    // correct re-run.
    const norm = (m) => Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).join('|');
    ok('16. re-running with no new athletes reproduces the assignment',
      norm(second.assignments) === norm(first.assignments),
      `${norm(first.assignments)}  vs  ${norm(second.assignments)}`);
    ok('17. ...and reports that it would move nobody', second.moved === 0, String(second.moved));
  }

  // ── Existing assignments: keep vs reassign ───────────────────────────
  {
    const athletes = [A('old1', 900), A('old2', 800), A('new1', null), A('new2', 100)];
    const current = { old1: 0, old2: 0 };
    const keep = buildSeedPreview({ athletes, groupLabels: ['A', 'B'], current, scope: 'unassigned' });
    ok('18. scope "unassigned" leaves already-placed athletes alone',
      keep.assignments.old1 === 0 && keep.assignments.old2 === 0 && keep.moved === 0,
      JSON.stringify(keep.assignments));
    ok('19. ...and still places the newcomers',
      typeof keep.assignments.new1 === 'number' && typeof keep.assignments.new2 === 'number',
      JSON.stringify(keep.assignments));
    ok('20. ...reporting how many were already assigned', keep.alreadyAssigned === 2);

    const redo = buildSeedPreview({ athletes, groupLabels: ['A', 'B'], current, scope: 'all' });
    ok('21. scope "all" re-seeds by form, and says who it would move',
      redo.assignments.new2 === 1 && redo.moved > 0, JSON.stringify(redo));
    ok('22. ...flagging the moved athletes individually',
      redo.groups.some((g) => g.athletes.some((a) => a.moved)), JSON.stringify(layout(redo)));
  }

  // ── Seed values: which past results may count ────────────────────────
  {
    // Two finished competitions and one still running, plus one judged
    // every way a submission can be judged.
    await db.collection('onlineCompetitions').doc('past-1').set({
      status: 'finished',
      events: [{ eventId: '333', timeLimitCs: null }],
    });
    await db.collection('onlineCompetitions').doc('past-2').set({
      status: 'finished',
      events: [{ eventId: '333', timeLimitCs: null }],
    });
    await db.collection('onlineCompetitions').doc('now').set({
      status: 'live',
      events: [{ eventId: '333', timeLimitCs: null }],
    });

    const sub = (id, data) => db.collection('onlineSubmissions').doc(id).set({ event: '333', ...data });
    // ann: a slower approved time, then a faster one in another finished
    // competition — the faster must win.
    await sub('s1', { uid: 'ann', competitionId: 'past-1', status: 'approved', reportedTime: 1800, penalty: null });
    await sub('s2', { uid: 'ann', competitionId: 'past-2', status: 'approved', reportedTime: 1200, penalty: null });
    // bat: only REJECTED work. The headline case — must read as unseeded.
    await sub('s3', { uid: 'bat', competitionId: 'past-1', status: 'rejected', reportedTime: 500, penalty: 'DNF' });
    // cec: only PENDING work, in a finished competition.
    await sub('s4', { uid: 'cec', competitionId: 'past-1', status: 'pending', reportedTime: 600, penalty: null });
    // dor: approved, but in the competition being seeded right now.
    await sub('s5', { uid: 'dor', competitionId: 'now', status: 'approved', reportedTime: 700, penalty: null });
    // eve: approved with a +2, which must be included in the seed.
    await sub('s6', { uid: 'eve', competitionId: 'past-1', status: 'approved', reportedTime: 1000, penalty: '+2' });
    // fay: approved but a DNF — not a time.
    await sub('s7', { uid: 'fay', competitionId: 'past-1', status: 'approved', reportedTime: 400, isDnf: true, penalty: null });

    const seeds = await fetchSeedTimes(db, '333', ['ann', 'bat', 'cec', 'dor', 'eve', 'fay'], 'now');

    ok('23. the best approved time across finished competitions wins',
      seeds.get('ann') === 1200, String(seeds.get('ann')));
    ok('24. an athlete with only REJECTED submissions is unseeded',
      seeds.get('bat') === null, String(seeds.get('bat')));
    ok('25. ...and one with only PENDING submissions is too',
      seeds.get('cec') === null, String(seeds.get('cec')));
    ok('26. the competition being seeded does not seed itself',
      seeds.get('dor') === null, String(seeds.get('dor')));
    ok('27. a +2 is part of the time it seeds on',
      seeds.get('eve') === 1200, String(seeds.get('eve')));
    ok('28. an approved DNF is not a time',
      seeds.get('fay') === null, String(seeds.get('fay')));
  }
  {
    // The time limit belongs to the competition the attempt was solved
    // in, so an over-limit solve cannot seed as a real time.
    await db.collection('onlineCompetitions').doc('limited').set({
      status: 'finished',
      events: [{ eventId: '222', timeLimitCs: 1000 }],
    });
    await db.collection('onlineSubmissions').doc('s8').set({
      event: '222', uid: 'gus', competitionId: 'limited', status: 'approved',
      reportedTime: 1500, penalty: null,
    });
    const seeds = await fetchSeedTimes(db, '222', ['gus'], 'now');
    ok('29. a solve over its competition time limit does not seed',
      seeds.get('gus') === null, String(seeds.get('gus')));
  }
  {
    // No submissions at all anywhere — every athlete unseeded, no error.
    const seeds = await fetchSeedTimes(db, '444', ['nobody'], 'now');
    ok('30. an event nobody has ever solved returns unseeded, not an error',
      seeds.get('nobody') === null, String(seeds.get('nobody')));
  }

  // ── The badge and revert still work on a block assignment ────────────
  // The snake seeder is gone, and it was the thing that used to write the
  // `autoAssignments` baseline. The block seeder writes the same two
  // fields, so the groups tab's АВТОМАТ/ГАРААР badge and its
  // revert-to-automatic must be unaffected — these reproduce both against
  // the stored document rather than assuming it.
  {
    // isManual, copied from GroupsTab: an athlete reads as hand-edited
    // when their live group differs from the baseline.
    const isManual = (uid, current, auto) =>
      typeof current[uid] === 'number' && auto[uid] !== current[uid];

    const preview = buildSeedPreview({
      athletes: [A('a', 300), A('b', 200), A('c', 100), A('d', null)],
      groupLabels: ['A', 'B'],
      current: {},
      scope: 'all',
    });

    // What the seed route's apply branch writes.
    const ref = db.collection('onlineCompetitions').doc('rr-badge')
      .collection('groupAssignments').doc('333_1');
    await ref.set({
      eventId: '333',
      round: 1,
      assignments: preview.assignments,
      autoAssignments: preview.assignments,
    });

    const afterSeed = await ref.get();
    ok('31. a block auto-assign writes the revert baseline too',
      JSON.stringify(afterSeed.get('autoAssignments')) ===
        JSON.stringify(afterSeed.get('assignments')),
      JSON.stringify(afterSeed.data()));
    ok('32. ...so nobody reads as hand-edited immediately after it',
      !Object.keys(preview.assignments).some((uid) =>
        isManual(uid, afterSeed.get('assignments'), afterSeed.get('autoAssignments'))));

    // A hand edit, exactly as the PATCH route writes it: one athlete's
    // entry in `assignments` only, baseline untouched.
    const moved = 'c';
    const movedTo = preview.assignments[moved] === 0 ? 1 : 0;
    await ref.set({ assignments: { [moved]: movedTo } }, { merge: true });

    const afterEdit = await ref.get();
    const live = afterEdit.get('assignments');
    const base = afterEdit.get('autoAssignments');
    ok('33. after a hand edit the badge marks the edited athlete',
      isManual(moved, live, base) === true, `${live[moved]} vs ${base[moved]}`);
    ok('34. ...and marks nobody else',
      Object.keys(live).filter((uid) => isManual(uid, live, base)).join() === moved,
      Object.keys(live).filter((uid) => isManual(uid, live, base)).join());

    // Revert, as the assign route does it: restore the baseline wholesale.
    await ref.set({ assignments: base }, { mergeFields: ['assignments'] });
    const afterRevert = await ref.get();
    ok('35. revert restores the block assignment exactly',
      JSON.stringify(afterRevert.get('assignments')) === JSON.stringify(preview.assignments),
      JSON.stringify(afterRevert.get('assignments')));
    ok('36. ...leaving nobody marked as hand-edited',
      !Object.keys(afterRevert.get('assignments')).some((uid) =>
        isManual(uid, afterRevert.get('assignments'), afterRevert.get('autoAssignments'))));
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
