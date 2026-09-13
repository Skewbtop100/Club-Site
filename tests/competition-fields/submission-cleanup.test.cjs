// ── Deleting a submission deletes ALL of its assets ─────────────────────
// A submission owns a video AND, since the stills changeset, up to six
// full-resolution JPEGs of the athlete — different Cloudinary resource
// type, different endpoint, their own public ids. The original cleanup
// deleted the video only, so the frames would have outlived the clip they
// came from and the retention window that is supposed to cover both. The
// club's athletes include minors; that is the hole this suite pins shut.
//
// WHAT IT ACTUALLY EXERCISES: the real compiled module, with `fetch`
// replaced by a recorder. No emulator and no firebase-admin — the module
// imports DocumentReference as a TYPE only, so a stub object with a
// delete() method is a faithful stand-in, and the Firestore half of the
// contract here is just "the doc is deleted, always".
//
// Run: npm run test:cleanup

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-cleanup-build');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      'lib/online-competition/submission-cleanup.ts',
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

compile();
const { deleteSubmissionAndVideo } = require(path.join(OUT, 'submission-cleanup.js'));

// Credentials must EXIST here, unlike the reset suite which deliberately
// clears them to keep that module's network half inert. This suite is
// about what gets requested, so it needs the module to get as far as
// building a request — which the fetch stub below then intercepts. These
// are not real and never leave the process.
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = 'test-cloud';

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

/** Stands in for a DocumentReference. Records whether the doc was
 *  deleted, which is the one thing that must happen on every path. */
function fakeRef(id = 'sub1') {
  return { id, deleted: false, delete() { this.deleted = true; return Promise.resolve(); } };
}

/** Replaces global fetch with a recorder. `handler` decides each response;
 *  returns the list of calls made, each parsed into resource type and the
 *  public ids the URL asked for. */
function withFetch(handler, run) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    const m = u.pathname.match(/\/resources\/(video|image)\/upload$/);
    const call = {
      resourceType: m ? m[1] : null,
      publicIds: u.searchParams.getAll('public_ids[]'),
      method: init?.method,
    };
    calls.push(call);
    return handler(call);
  };
  return run(calls).finally(() => { globalThis.fetch = real; });
}

/** The success shape Cloudinary's delete-resources endpoint returns. */
const allDeleted = (call) => ({
  ok: true,
  status: 200,
  json: async () => ({
    deleted: Object.fromEntries(call.publicIds.map((id) => [id, 'deleted'])),
  }),
  text: async () => '',
});

const SHOTS_T = ['oc/t1', 'oc/t2', 'oc/t3'];
const SHOTS_C = ['oc/c1', 'oc/c2', 'oc/c3'];

// Console noise from the deliberate-failure cases below is expected — the
// module logs every orphaned asset on purpose. Silenced so the report
// stays readable, and restored after.
const realError = console.error;
const errors = [];
console.error = (...args) => errors.push(args.join(' '));

(async () => {
  console.log('\n=== submission cleanup — every asset a submission owns ===\n');

  // ── A full submission: one video, six stills ──────────────────────────
  await withFetch(allDeleted, async (calls) => {
    const ref = fakeRef();
    const result = await deleteSubmissionAndVideo(
      ref,
      { cloudinaryPublicId: 'oc/a', timerShotIds: SHOTS_T, cubeShotIds: SHOTS_C },
      'test',
    );

    const videoCalls = calls.filter((c) => c.resourceType === 'video');
    const imageCalls = calls.filter((c) => c.resourceType === 'image');
    const imageIds = imageCalls.flatMap((c) => c.publicIds);

    ok('1. the video is destroyed, as a video resource',
      videoCalls.length === 1 && videoCalls[0].publicIds.join() === 'oc/a',
      JSON.stringify(videoCalls));
    // THE BUG, DIRECTLY: six images existed and none were ever requested.
    ok('2. all six stills are destroyed, as IMAGE resources',
      imageIds.length === 6 && [...SHOTS_T, ...SHOTS_C].every((id) => imageIds.includes(id)),
      JSON.stringify(imageIds));
    ok('3. ...batched into one request, not one call each',
      imageCalls.length === 1, `${imageCalls.length} image calls`);
    ok('4. ...and never sent to the video endpoint, which would 404 them',
      videoCalls.every((c) => !c.publicIds.some((id) => imageIds.includes(id))));
    ok('5. every delete is a DELETE', calls.every((c) => c.method === 'DELETE'));
    ok('6. the counts come back', result.stillsDeleted === 6 && result.stillsFailed === 0,
      JSON.stringify(result));
    ok('7. the video result is unchanged in shape',
      result.cloudinaryDeleted === true && result.cloudinaryDetail === 'deleted');
    ok('8. and the document is gone', ref.deleted);
  });

  // ── An old submission: video only, no stills fields at all ────────────
  await withFetch(allDeleted, async (calls) => {
    const ref = fakeRef();
    const result = await deleteSubmissionAndVideo(ref, { cloudinaryPublicId: 'oc/old' }, 'test');
    ok('9. a submission with no stills destroys only the video',
      calls.length === 1 && calls[0].resourceType === 'video',
      JSON.stringify(calls));
    ok('10. ...with no image request attempted at all',
      !calls.some((c) => c.resourceType === 'image'));
    ok('11. ...reported as zero, not as failures',
      result.stillsDeleted === 0 && result.stillsFailed === 0);
    ok('12. ...and the document is gone', ref.deleted);
  });

  // ── Empty lists, the shape createSubmission actually writes ───────────
  await withFetch(allDeleted, async (calls) => {
    const ref = fakeRef();
    await deleteSubmissionAndVideo(
      ref,
      { cloudinaryPublicId: 'oc/e', timerShotIds: [], cubeShotIds: [] },
      'test',
    );
    ok('13. empty lists are a no-op, not an empty request',
      !calls.some((c) => c.resourceType === 'image') && ref.deleted);
  });

  // ── Malformed stored data must not reach the URL builder ──────────────
  await withFetch(allDeleted, async (calls) => {
    const ref = fakeRef();
    await deleteSubmissionAndVideo(
      ref,
      { cloudinaryPublicId: 'oc/m', timerShotIds: ['oc/good', 42, null, ''], cubeShotIds: 'nope' },
      'test',
    );
    const imageIds = calls.filter((c) => c.resourceType === 'image').flatMap((c) => c.publicIds);
    ok('14. non-string and empty ids are dropped, the good one still goes',
      imageIds.join() === 'oc/good', JSON.stringify(imageIds));
    ok('15. ...and a non-list field is simply nothing to delete', ref.deleted);
  });

  // ── A failing image destroy must not take anything with it ────────────
  await withFetch(
    (call) => {
      if (call.resourceType === 'image') {
        return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      }
      return allDeleted(call);
    },
    async (calls) => {
      const ref = fakeRef();
      const result = await deleteSubmissionAndVideo(
        ref,
        { cloudinaryPublicId: 'oc/a', timerShotIds: SHOTS_T, cubeShotIds: SHOTS_C },
        'test',
      );
      ok('16. a failing image destroy still deletes the VIDEO',
        result.cloudinaryDeleted === true &&
          calls.some((c) => c.resourceType === 'video'));
      ok('17. ...and still deletes the DOCUMENT', ref.deleted);
      ok('18. ...and reports the images as failed, not as deleted',
        result.stillsFailed === 6 && result.stillsDeleted === 0, JSON.stringify(result));
      ok('19. ...naming every orphaned id in the log, for manual removal',
        [...SHOTS_T, ...SHOTS_C].every((id) => errors.join(' ').includes(id)));
    },
  );

  // ── A throwing image destroy — the network dropping mid-flight ────────
  await withFetch(
    (call) => {
      if (call.resourceType === 'image') return Promise.reject(new Error('socket hang up'));
      return allDeleted(call);
    },
    async () => {
      const ref = fakeRef();
      const result = await deleteSubmissionAndVideo(
        ref,
        { cloudinaryPublicId: 'oc/a', timerShotIds: SHOTS_T, cubeShotIds: [] },
        'test',
      );
      ok('20. a THROWN image destroy still deletes the video and the doc',
        result.cloudinaryDeleted === true && ref.deleted);
      ok('21. ...and is counted, not swallowed', result.stillsFailed === 3);
    },
  );

  // ── A failing VIDEO destroy must not stop the stills ──────────────────
  // The reverse of the case above, and the one that decides whether a
  // lingering video can strand six images alongside it.
  await withFetch(
    (call) => {
      if (call.resourceType === 'video') {
        return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      }
      return allDeleted(call);
    },
    async () => {
      const ref = fakeRef();
      const result = await deleteSubmissionAndVideo(
        ref,
        { cloudinaryPublicId: 'oc/a', timerShotIds: SHOTS_T, cubeShotIds: SHOTS_C },
        'test',
      );
      ok('22. a failing video destroy still destroys the stills',
        result.stillsDeleted === 6 && result.cloudinaryDeleted === false,
        JSON.stringify(result));
      ok('23. ...and still deletes the document', ref.deleted);
    },
  );

  // ── Already gone is success, which is what makes the sweep re-runnable ─
  await withFetch(
    (call) => ({
      ok: true,
      status: 200,
      json: async () => ({
        deleted: Object.fromEntries(call.publicIds.map((id) => [id, 'not_found'])),
      }),
      text: async () => '',
    }),
    async () => {
      const ref = fakeRef();
      const result = await deleteSubmissionAndVideo(
        ref,
        { cloudinaryPublicId: 'oc/a', timerShotIds: SHOTS_T, cubeShotIds: [] },
        'test',
      );
      ok('24. an already-deleted still is success, not a failure',
        result.stillsDeleted === 3 && result.stillsFailed === 0);
      ok('25. ...the same way an already-deleted video is',
        result.cloudinaryDeleted === true);
    },
  );

  // ── No document data at all ───────────────────────────────────────────
  await withFetch(allDeleted, async (calls) => {
    const ref = fakeRef();
    const result = await deleteSubmissionAndVideo(ref, undefined, 'test');
    ok('26. an undefined document deletes nothing and still removes the doc',
      calls.length === 0 && ref.deleted && result.cloudinaryDetail === 'no-public-id');
  });

  console.error = realError;
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
