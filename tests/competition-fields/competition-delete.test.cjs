// ── Deleting a competition ───────────────────────────────────────────────
// The real compiled competition-delete.ts against the Firestore emulator,
// with R2 and Cloudinary replaced by in-process fakes.
//
// What must hold:
//   * the preview counts what is there, and writes nothing;
//   * a wrong or partial name refuses, and writes nothing;
//   * a completed deletion leaves nothing of the competition anywhere it
//     can be found — and touches no other competition's data;
//   * a file that cannot be deleted does not keep its document alive, and
//     is reported.
//
// Run: npm run test:compdelete

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-compdelete-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/competition-delete.ts',
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

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
// No Cloudinary credentials: the legacy video delete reports a failure
// without any network call, which is one of the failures this checks.
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;

const del = require(path.join(OUT, 'competition-delete.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-compdelete' }, 'compdelete'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}
async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const DEL = 'del-comp';
const KEEP = 'keep-comp';
const NAME = 'Тест Тэмцээн 2026';
const key = (uid, comp, attempt, nonce) => `videos/${uid}/${comp}/333/r1/a${attempt}/${nonce}.webm`;
const OWN_A1 = key('a', DEL, 1, '1-aaa');
const OWN_A2 = key('a', DEL, 2, '2-fail'); // its delete fails
const ORPHAN = key('z', DEL, 1, '9-orphan'); // uploaded, never filed
const KEEP_KEY = key('a', KEEP, 1, '1-keep');

/** An in-process R2: a set of keys, a list of keys whose delete fails. */
class FakeR2 {
  constructor(keys, failing) {
    this.objects = new Set(keys);
    this.failing = new Set(failing);
    this.deleted = [];
  }
  async send(cmd) {
    const name = cmd.constructor.name;
    const input = cmd.input;
    if (name === 'DeleteObjectCommand') {
      if (this.failing.has(input.Key)) {
        const e = new Error('InternalError');
        e.name = 'InternalError';
        e.$metadata = { httpStatusCode: 500 };
        throw e;
      }
      this.objects.delete(input.Key);
      this.deleted.push(input.Key);
      return {};
    }
    if (name === 'ListObjectsV2Command') {
      const keys = [...this.objects].filter((k) => k.startsWith(input.Prefix)).sort();
      return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
    }
    throw new Error(`unexpected command ${name}`);
  }
}

async function seed() {
  for (const c of ['onlineCompetitions', 'onlineSubmissions', 'onlineNotifications', 'onlineParticipants', 'onlineCompetitionDeletions']) {
    await db.recursiveDelete(db.collection(c));
  }
  const comp = db.collection('onlineCompetitions').doc(DEL);
  await comp.set({
    name: NAME,
    status: 'live',
    featured: true,
    events: [{ eventId: '333', label: '3x3x3', rounds: 2 }],
    posterPublicId: 'oc/poster-del',
    bannerPublicId: 'oc/banner-del',
    sections: [{ id: 's1', title: 'Дүрэм', blocks: [{ id: 'b1', type: 'image', imageUrl: 'u', imagePublicId: 'oc/shared' }] }],
  });
  await db.collection('onlineCompetitions').doc(KEEP).set({
    name: 'Бусад тэмцээн',
    status: 'live',
    bannerPublicId: 'oc/shared', // the same image as del-comp's section
    posterPublicId: 'oc/poster-keep',
  });

  await comp.collection('roundState').doc('333_1').set({ status: 'done' });
  await comp.collection('roundState').doc('333_2').set({ status: 'live' });
  await comp.collection('runTickets').doc('a__333__r2').set({ uid: 'a', servedThrough: 1 });
  await comp.collection('qualifiers').doc('333_1').set({ uids: ['a'] });
  await comp.collection('scrambleData').doc('333_1').set({ groups: [] });
  await comp.collection('groupAssignments').doc('333_1').set({ assignments: {} });
  await comp.collection('scrambles').doc('333_r1').set({ scramble: 'R U' });
  await db.collection('onlineCompetitions').doc(KEEP).collection('roundState').doc('333_1').set({ status: 'live' });

  const reg = (uid, compId, status) =>
    db.collection('onlineParticipants').doc(uid).collection('registrations').doc(compId)
      .set({ competitionId: compId, events: ['333'], status });
  await reg('a', DEL, 'approved');
  await reg('b', DEL, 'approved');
  await reg('c', DEL, 'pending');
  await reg('a', KEEP, 'approved');

  const sub = (id, data) => db.collection('onlineSubmissions').doc(id).set(data);
  const base = (uid, compId, attempt, status) => ({
    uid, competitionId: compId, event: '333', competitionRound: 1, round: attempt, status,
    reportedTime: 1000, isDnf: false, penalty: null,
  });
  await sub(`a__${DEL}__333__r1__a1`, { ...base('a', DEL, 1, 'approved'), videoKey: OWN_A1 });
  await sub(`a__${DEL}__333__r1__a2`, { ...base('a', DEL, 2, 'pending'), videoKey: OWN_A2 });
  await sub(`b__${DEL}__333__r1__a1`, { ...base('b', DEL, 1, 'rejected'), cloudinaryPublicId: 'oc/legacy-b', videoUrl: 'https://x/v.webm' });
  await sub(`a__${KEEP}__333__r1__a1`, { ...base('a', KEEP, 1, 'approved'), videoKey: KEEP_KEY });

  const note = (id, data) => db.collection('onlineNotifications').doc(id).set({ uid: 'a', type: 'round_result', title: 't', href: '', read: false, ...data });
  await note('n1', { competitionId: DEL, contextLabel: NAME.toUpperCase() });
  await note('n2', { competitionId: DEL, contextLabel: NAME.toUpperCase() });
  await note('n3', { competitionId: KEEP, contextLabel: 'БУСАД' });
  await note('n-legacy', { contextLabel: NAME.toUpperCase() }); // written before competitionId existed
}

const count = async (q) => (await q.count().get()).data().count;
const regsFor = async (compId) =>
  (await db.collectionGroup('registrations').get()).docs.filter((d) => d.get('competitionId') === compId).length;

(async () => {
  await seed();

  console.log('\n=== preview ===\n');
  const preview = await del.previewCompetitionDeletion(db, DEL);
  ok('registered athletes: 3 (2 approved, 1 pending)',
    preview.registrations.total === 3 && preview.registrations.approved === 2 && preview.registrations.pending === 1, JSON.stringify(preview.registrations));
  ok('submissions: 3 (2 judged, 1 pending)',
    preview.submissions.total === 3 && preview.submissions.judged === 2 && preview.submissions.pending === 1, JSON.stringify(preview.submissions));
  ok('videos: 2 in R2, 1 legacy Cloudinary', preview.videos.r2 === 2 && preview.videos.legacyCloudinary === 1, JSON.stringify(preview.videos));
  ok('notifications: the 2 that carry the competition id', preview.notifications === 2, String(preview.notifications));
  ok('round and scramble documents counted per subcollection',
    preview.roundDocs.roundState === 2 && preview.roundDocs.runTickets === 1 && preview.roundDocs.qualifiers === 1 &&
      preview.roundDocs.scrambleData === 1 && preview.roundDocs.groupAssignments === 1 && preview.roundDocs.scrambles === 1,
    JSON.stringify(preview.roundDocs));
  ok('images: poster, banner and a section image', preview.images === 3, String(preview.images));
  ok('the text to type is the exact name', preview.confirmText === NAME);
  const afterPreview = (await db.collection('onlineCompetitions').doc(DEL).get()).data();
  ok('THE PREVIEW WRITES NOTHING: still live, no marker, no record',
    afterPreview.status === 'live' && !afterPreview.deletion &&
      !(await db.collection('onlineCompetitionDeletions').doc(DEL).get()).exists);

  console.log('\n=== confirmation ===\n');
  const who = { sessionId: 'sess-1', ip: '1.2.3.4', userAgent: 'test' };
  for (const [label, typed] of [['a wrong name', 'Өөр тэмцээн'], ['a partial name', 'Тест Тэмцээн'], ['different case', NAME.toLowerCase()], ['trailing space', `${NAME} `], ['nothing', '']]) {
    const err = await caught(() => del.startCompetitionDeletion(db, DEL, { confirmName: typed, requestedBy: who }));
    ok(`${label} refuses`, err instanceof del.CompetitionDeleteError && err.status === 400, String(err));
  }
  const untouched = (await db.collection('onlineCompetitions').doc(DEL).get()).data();
  ok('  ...and writes nothing',
    untouched.status === 'live' && !untouched.deletion && !(await db.collection('onlineCompetitionDeletions').doc(DEL).get()).exists);

  const job = await del.startCompetitionDeletion(db, DEL, { confirmName: NAME, requestedBy: who, nowMs: 1_800_000_000_000 });
  const hidden = (await db.collection('onlineCompetitions').doc(DEL).get()).data();
  ok('the exact name starts it: the competition is HIDDEN at once (draft, unfeatured, marked)',
    hidden.status === 'draft' && hidden.featured === false && hidden.deletion?.statusBefore === 'live', JSON.stringify(hidden));
  ok('  ...and nothing has been removed yet', (await count(db.collection('onlineSubmissions').where('competitionId', '==', DEL))) === 3);
  ok('  ...the record names the session, when, and the counts',
    job.requestedBy.sessionId === 'sess-1' && job.startedAtMs === 1_800_000_000_000 && job.preview.submissions.total === 3);

  console.log('\n=== deletion ===\n');
  const r2 = new FakeR2([OWN_A1, OWN_A2, ORPHAN, KEEP_KEY], [OWN_A2]);
  const destroyed = [];
  const deps = {
    r2: { client: r2, bucket: 'test-bucket' },
    destroyImages: async (ids) => {
      destroyed.push(...ids);
      return { deleted: ids.length, failed: 0, failures: [] };
    },
    batchSize: 1,
    budgetMs: 0, // one unit per call: proves it resumes across calls
  };
  let steps = 0;
  let state = job;
  while (state.phase !== 'done' && steps < 100) {
    state = await del.runCompetitionDeletionStep(db, DEL, deps);
    steps++;
  }
  ok('finishes, across several calls', state.phase === 'done' && steps > 3, `${steps} steps, phase ${state.phase}`);

  ok('the competition document is gone', !(await db.collection('onlineCompetitions').doc(DEL).get()).exists);
  for (const sub of ['roundState', 'runTickets', 'qualifiers', 'scrambleData', 'groupAssignments', 'scrambles']) {
    ok(`  ...and its ${sub}`, (await count(db.collection('onlineCompetitions').doc(DEL).collection(sub))) === 0);
  }
  ok('every registration for it is gone', (await regsFor(DEL)) === 0);
  ok('every submission for it is gone', (await count(db.collection('onlineSubmissions').where('competitionId', '==', DEL))) === 0);
  ok('its notifications are gone', (await count(db.collection('onlineNotifications').where('competitionId', '==', DEL))) === 0);
  ok('its R2 video and the never-filed upload are gone', !r2.objects.has(OWN_A1) && !r2.objects.has(ORPHAN));
  ok('its own images are deleted, the one another competition uses is not',
    destroyed.includes('oc/poster-del') && destroyed.includes('oc/banner-del') && !destroyed.includes('oc/shared'), JSON.stringify(destroyed));

  console.log('\n=== nothing else ===\n');
  ok('the other competition is untouched',
    (await db.collection('onlineCompetitions').doc(KEEP).get()).exists &&
      (await count(db.collection('onlineCompetitions').doc(KEEP).collection('roundState'))) === 1);
  ok('  ...its registration, submission and notification remain',
    (await regsFor(KEEP)) === 1 &&
      (await count(db.collection('onlineSubmissions').where('competitionId', '==', KEEP))) === 1 &&
      (await db.collection('onlineNotifications').doc('n3').get()).exists);
  ok('  ...and its video', r2.objects.has(KEEP_KEY));
  ok('a notification with no competition id cannot be matched, and is left', (await db.collection('onlineNotifications').doc('n-legacy').get()).exists);

  console.log('\n=== a file that cannot be deleted ===\n');
  ok('THE DOCUMENT STILL GOES: the submission whose video failed is deleted',
    !(await db.collection('onlineSubmissions').doc(`a__${DEL}__333__r1__a2`).get()).exists);
  ok('  ...the video is still there', r2.objects.has(OWN_A2));
  ok('  ...and it is reported, by key', state.failures.some((f) => f.kind === 'r2-video' && f.id === OWN_A2), JSON.stringify(state.failures));
  ok('the legacy video Cloudinary could not delete is reported too',
    state.failures.some((f) => f.kind === 'legacy-video' && f.id === 'oc/legacy-b'), JSON.stringify(state.failures));
  ok('the shared image is reported as refused, not failed', state.refused.some((r) => r.kind === 'image' && r.id === 'oc/shared'));

  console.log('\n=== the record ===\n');
  const record = (await db.collection('onlineCompetitionDeletions').doc(DEL).get()).data();
  ok('it outlives the competition: name, session, start and end',
    record && record.name === NAME && record.requestedBy.sessionId === 'sess-1' && record.startedAtMs === 1_800_000_000_000 &&
      typeof record.completedAtMs === 'number' && record.phase === 'done', JSON.stringify(record && { ...record, preview: undefined }));
  ok('  ...with what was removed',
    record.removed.submissions === 3 && record.removed.registrations === 3 && record.removed.notifications === 2 &&
      record.removed.r2Videos === 1 && record.removed.r2Orphans === 1 && record.removed.images === 2 && record.removed.roundDocs === 7,
    JSON.stringify(record.removed));
  ok('  ...and what could not be', record.failureCount === state.failureCount && record.failureCount >= 2);
  ok('  ...holding no lease', record.leaseUntilMs === null);

  const again = await del.runCompetitionDeletionStep(db, DEL, deps);
  ok('running it again after it finished does nothing', again.phase === 'done');

  console.log('\n=== wiring ===\n');
  const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const route = src('app/api/online-competition/admin-competitions/[id]/delete/route.ts');
  ok('both handlers are admin-only', (route.match(/if \(!\(await isOnlineCompAdmin\(\)\)\)/g) || []).length === 2);
  const dialog = src('app/online-competition/admin/_components/DeleteCompetitionDialog.tsx');
  ok('the confirm button is enabled only by the exact name',
    dialog.includes('const canConfirm = !!preview && typed === preview.confirmText && !running;') && dialog.includes('disabled={!canConfirm}'));
  ok('submissions are deleted through deleteSubmissionAndVideo',
    src('lib/online-competition/competition-delete.ts').includes("deleteSubmissionAndVideo(doc.ref, data, 'competition delete'"));
  ok('new notifications carry the competition id',
    (src('lib/online-competition/notifications-server.ts').match(/^\s+competitionId,$/gm) || []).length === 2);
  ok('editing a competition mid-deletion is refused',
    src('lib/online-competition/admin-competitions.ts').includes("snap.get('deletion')"));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
