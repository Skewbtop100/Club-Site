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
      'lib/online-competition/submission-retention.ts',
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
const { isSweepable, SUBMISSION_RETENTION_MS } = require(path.join(OUT, 'submission-retention.js'));

const DAY = 86_400_000;
/** When every fixture submission below was filed. Its legacy assets are, by
 *  default, uploaded a minute before — which is what a genuine one looks
 *  like. */
const CREATED_MS = Date.UTC(2026, 8, 10, 3, 0);
/** The identity every fixture document carries, so an R2 key built for it
 *  is its OWN key. A case that wants a foreign key names one. */
const OWN = {
  uid: 'uid123',
  competitionId: 'comp1',
  event: '333',
  competitionRound: 1,
  round: 2,
  createdAt: { toMillis: () => CREATED_MS },
};
/** deleteSubmissionAndVideo over a document that carries OWN's identity. */
const del = (ref, data, context, deps) =>
  deleteSubmissionAndVideo(ref, data === undefined ? undefined : { ...OWN, ...data }, context, deps);

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

/** Replaces global fetch with a recorder. `handler` decides each DELETE's
 *  response; `calls` lists the DELETEs, each parsed into resource type and
 *  the public ids the URL asked for.
 *
 *  The ownership LOOKUPS (GET, same path) are answered separately and listed
 *  on `calls.lookups`. `uploadedAt(id)` gives each asset's upload time: a
 *  number (ms), null for an asset that no longer exists, or 'FAIL' to make
 *  the lookup itself fail. By default every asset was uploaded a minute
 *  before the submission was filed — a genuine legacy asset. */
function withFetch(handler, run, uploadedAt = () => CREATED_MS - 60_000) {
  const calls = [];
  calls.lookups = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    const m = u.pathname.match(/\/resources\/(video|image)\/upload$/);
    const call = {
      resourceType: m ? m[1] : null,
      publicIds: u.searchParams.getAll('public_ids[]'),
      method: init?.method,
    };
    if (call.method === 'GET') {
      calls.lookups.push(call);
      const times = call.publicIds.map((id) => [id, uploadedAt(id, call.resourceType)]);
      if (times.some(([, t]) => t === 'FAIL')) {
        return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          resources: times
            .filter(([, t]) => typeof t === 'number')
            .map(([id, t]) => ({ public_id: id, created_at: new Date(t).toISOString() })),
        }),
        text: async () => '',
      };
    }
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
    const result = await del(
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
    const result = await del(ref, { cloudinaryPublicId: 'oc/old' }, 'test');
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
    await del(
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
    await del(
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
      const result = await del(
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
      const result = await del(
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
      const result = await del(
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
      const result = await del(
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
    const result = await del(ref, undefined, 'test');
    ok('26. an undefined document deletes nothing and still removes the doc',
      calls.length === 0 && ref.deleted && result.cloudinaryDetail === 'no-public-id');
  });

  // ── R2 videos ───────────────────────────────────────────────────────────
  // Everything filed since videos moved to R2 carries a videoKey instead of
  // a Cloudinary id, and cleanup used to know only the Cloudinary id — so
  // an R2 submission's document was deleted and its object left in the
  // bucket forever. These run the REAL S3 client (the same factory the
  // presign route uses) with one middleware that captures each request and
  // answers it in-process: the SDK builds and signs the actual DELETE, and
  // nothing leaves the machine.
  const stripCode = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  for (const v of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    delete process.env[v];
  }
  const { createR2Client } = require(path.join(OUT, 'r2-video.js'));
  const R2_KEY = 'videos/uid123/comp1/333/r1/a2/1700000000000-a1b2c3.webm';

  /** A real client whose requests are answered by `respond` instead of R2.
   *  `respond` returns an HTTP status, or throws the error R2 would. */
  function fakeR2(respond, log) {
    const client = createR2Client({
      accountId: 'acct123',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secretEXAMPLE',
    });
    const requests = [];
    client.middlewareStack.add(
      () => async (args) => {
        const req = args.request;
        requests.push({ method: req.method, path: req.path, host: req.hostname, headers: req.headers });
        if (log) log.push('r2');
        const status = respond(req);
        return { output: { $metadata: { httpStatusCode: status } }, response: { statusCode: status, headers: {} } };
      },
      { step: 'finalizeRequest', priority: 'low', name: 'captureR2' },
    );
    return { client, requests, deps: { r2: { client, bucket: 'bucket-x' } } };
  }
  const r2Error = (name, status) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status }, $fault: 'client' });

  // STEP 7 · an R2 submission deletes its object.
  await withFetch(allDeleted, async (calls) => {
    const r2 = fakeR2(() => 204);
    const ref = fakeRef();
    const result = await del(ref, { videoKey: R2_KEY }, 'test', r2.deps);
    const req = r2.requests[0];
    ok('27. an R2 submission deletes its object', r2.requests.length === 1 && req.method === 'DELETE',
      JSON.stringify(r2.requests.map((r) => r.method)));
    ok('  ...the exact key, in the configured bucket, path-style',
      req && req.host === 'acct123.r2.cloudflarestorage.com' && req.path === `/bucket-x/${R2_KEY}`,
      req && `${req.host}${req.path}`);
    ok('  ...signed with the shared client factory’s credentials',
      req && String(req.headers.authorization ?? '').includes('AKIDEXAMPLE'));
    ok('  ...reported as deleted', result.r2Deleted === true && result.r2Detail === 'deleted', JSON.stringify(result));
    ok('  ...touching no Cloudinary video', !calls.some((c) => c.resourceType === 'video'));
    ok('  ...and removing the document', ref.deleted);
  });

  // STEP 7 · a legacy submission still deletes its Cloudinary video.
  await withFetch(allDeleted, async (calls) => {
    const r2 = fakeR2(() => 204);
    const ref = fakeRef();
    const result = await del(ref, { cloudinaryPublicId: 'oc/legacy' }, 'test', r2.deps);
    ok('28. a legacy submission deletes its Cloudinary video',
      calls.some((c) => c.resourceType === 'video' && c.publicIds.join() === 'oc/legacy') &&
        result.cloudinaryDeleted === true,
      JSON.stringify(calls));
    ok('  ...making no R2 request at all', r2.requests.length === 0);
    ok('  ...and says so', result.r2Deleted === false && result.r2Detail === 'no-video-key', JSON.stringify(result));
    ok('  ...and removes the document', ref.deleted);
  });

  // STEP 7 · a failed R2 delete still removes the document.
  await withFetch(allDeleted, async (calls) => {
    const r2 = fakeR2(() => { throw r2Error('AccessDenied', 403); });
    const ref = fakeRef('sub-r2-fail');
    const before = errors.length;
    // CAUGHT, not awaited bare. If an R2 failure ever escaped as a thrown
    // error it would crash this suite before any assertion named the
    // problem; caught here, it fails test 29 by name instead.
    let result = {};
    let rejection = null;
    try {
      result = await del(
        ref,
        { videoKey: R2_KEY, timerShotIds: SHOTS_T, cubeShotIds: SHOTS_C },
        'test',
        r2.deps,
      );
    } catch (e) {
      rejection = e;
    }
    ok('29. a failed R2 delete still removes the document', ref.deleted && rejection === null,
      rejection ? `the delete REJECTED: ${rejection.name ?? rejection.message}` : 'document not deleted');
    ok('  ...and still deletes the stills',
      result.stillsDeleted === 6 && calls.some((c) => c.resourceType === 'image'), JSON.stringify(result));
    ok('  ...reporting the failure rather than a success',
      result.r2Deleted === false && /AccessDenied/.test(result.r2Detail), JSON.stringify(result));
    ok('  ...with the key named in the log, for manual removal',
      errors.slice(before).some((e) => e.includes(R2_KEY) && e.includes('sub-r2-fail')));
  });

  // STEP 7 · neither field is a no-op.
  await withFetch(allDeleted, async (calls) => {
    const r2 = fakeR2(() => 204);
    const ref = fakeRef();
    const result = await del(ref, {}, 'test', r2.deps);
    ok('30. a submission with neither video field deletes no video',
      r2.requests.length === 0 && calls.length === 0, `${r2.requests.length} r2, ${calls.length} fetch`);
    ok('  ...and still removes the document',
      ref.deleted && result.cloudinaryDetail === 'no-public-id' && result.r2Detail === 'no-video-key');
  });

  // A missing object is not an error.
  await withFetch(allDeleted, async () => {
    const r2 = fakeR2(() => { throw r2Error('NoSuchKey', 404); });
    const result = await del(fakeRef(), { videoKey: R2_KEY }, 'test', r2.deps);
    ok('31. an object that is already gone counts as deleted',
      result.r2Deleted === true && result.r2Detail === 'not-found (already gone)', JSON.stringify(result));
  });

  // A document the Admin SDK wrote with both shapes loses both.
  await withFetch(allDeleted, async (calls) => {
    const r2 = fakeR2(() => 204);
    const result = await del(
      fakeRef(), { videoKey: R2_KEY, cloudinaryPublicId: 'oc/both' }, 'test', r2.deps,
    );
    ok('32. a document carrying BOTH shapes has both videos deleted',
      result.r2Deleted && result.cloudinaryDeleted && r2.requests.length === 1 &&
        calls.some((c) => c.resourceType === 'video'),
      JSON.stringify(result));
  });

  // The R2 delete happens BEFORE the document goes — the document is the
  // only record of which key belonged to this submission.
  await withFetch(allDeleted, async () => {
    const log = [];
    const r2 = fakeR2(() => 204, log);
    const ref = { id: 'ordered', deleted: false, delete() { log.push('doc'); this.deleted = true; return Promise.resolve(); } };
    await del(ref, { videoKey: R2_KEY }, 'test', r2.deps);
    ok('33. the object is deleted before the document that names it', log.join() === 'r2,doc', log.join());
  });

  // No R2 configuration: no request, no throw, document still removed.
  // This is what keeps the emulator suites inert against the real bucket.
  await withFetch(allDeleted, async () => {
    const ref = fakeRef();
    const result = await del(ref, { videoKey: R2_KEY }, 'test');
    ok('34. unconfigured R2 makes no request and still removes the document',
      ref.deleted && result.r2Deleted === false && result.r2Detail === 'missing-credentials',
      JSON.stringify(result));
  });

  // ══ WHOSE ASSET IS IT — the second check, at deletion time ═══════════
  // firestore.rules now refuses a new submission that names foreign assets.
  // These cover what the rules cannot: documents already stored.
  const FOREIGN_KEY = 'videos/victim999/comp1/333/r1/a2/1700000000000-a1b2c3.webm';
  await withFetch(allDeleted, async () => {
    const r2 = fakeR2(() => 204);
    const ref = fakeRef('forged-r2');
    const before = errors.length;
    const result = await del(ref, { videoKey: FOREIGN_KEY }, 'test', r2.deps);
    ok("39. an R2 key under ANOTHER athlete's uid is not deleted",
      r2.requests.length === 0 && result.r2Deleted === false && /^refused/.test(result.r2Detail), JSON.stringify(result));
    ok('  ...listed as refused', result.refused.some((x) => x.kind === 'r2' && x.id === FOREIGN_KEY));
    ok('  ...logged as NOT deleted, with the submission named',
      errors.slice(before).some((e) => e.includes('forged-r2') && e.includes('NOT deleted')));
    ok('  ...and the forged document itself is still removed', ref.deleted);
  });
  await withFetch(allDeleted, async () => {
    const r2 = fakeR2(() => 204);
    const result = await del(fakeRef(), { videoKey: 'videos/uid123/comp1/333/r1/a5/1700000000000-a1b2c3.webm' }, 'test', r2.deps);
    ok("40. the athlete's own key for a DIFFERENT attempt is not deleted either",
      r2.requests.length === 0 && /^refused/.test(result.r2Detail), JSON.stringify(result));
  });
  await withFetch(allDeleted, async () => {
    const r2 = fakeR2(() => 204);
    const result = await del(fakeRef(), { videoKey: 'videos/uid123/comp1/333/r1/a2/../../../victim999/x.webm' }, 'test', r2.deps);
    ok('41. a key that climbs out of its folder is not deleted', r2.requests.length === 0 && /^refused/.test(result.r2Detail));
  });

  const POSTER = 'competition-poster';
  await withFetch(
    allDeleted,
    async (calls) => {
      const ref = fakeRef();
      const result = await del(ref, { cloudinaryPublicId: 'oc/v', timerShotIds: ['oc/t1', POSTER] }, 'test');
      const imageIds = calls.filter((c) => c.resourceType === 'image').flatMap((c) => c.publicIds);
      ok('42. THE HOLE: a still id naming a months-old asset (a poster) is NOT deleted',
        !imageIds.includes(POSTER), JSON.stringify(imageIds));
      ok('  ...while the genuine still in the same document is', imageIds.includes('oc/t1'));
      ok('  ...counted as refused, not as failed',
        result.stillsRefused === 1 && result.stillsDeleted === 1 && result.stillsFailed === 0, JSON.stringify(result));
      ok('  ...the genuine video still goes', result.cloudinaryDeleted === true);
      ok('  ...and the document is removed', ref.deleted);
    },
    (id) => (id === POSTER ? CREATED_MS - 120 * DAY : CREATED_MS - 60_000),
  );
  await withFetch(
    allDeleted,
    async (calls) => {
      const result = await del(fakeRef(), { cloudinaryPublicId: 'someone-elses-video' }, 'test');
      ok('43. a Cloudinary video uploaded days before the submission is NOT deleted',
        !calls.some((c) => c.resourceType === 'video') && result.cloudinaryDeleted === false &&
          /^refused/.test(result.cloudinaryDetail), JSON.stringify(result));
    },
    () => CREATED_MS - 3 * DAY,
  );
  await withFetch(
    allDeleted,
    async (calls) => {
      const ref = fakeRef();
      const result = await del(ref, { cloudinaryPublicId: 'oc/v', timerShotIds: ['oc/t1'] }, 'test');
      ok('44. FAIL CLOSED: when upload times cannot be read, nothing in Cloudinary is deleted',
        calls.length === 0 && result.stillsRefused === 1 && /^refused/.test(result.cloudinaryDetail), JSON.stringify(result));
      ok('  ...and the document is still removed', ref.deleted);
    },
    () => 'FAIL',
  );
  await withFetch(
    allDeleted,
    async (calls) => {
      const result = await del(fakeRef(), { cloudinaryPublicId: 'oc/gone', timerShotIds: ['oc/t-gone'] }, 'test');
      ok('45. an asset that no longer exists is not a refusal, so a re-run sweep stays clean',
        result.stillsRefused === 0 && result.refused.length === 0 && calls.length === 2, JSON.stringify(result));
    },
    () => null,
  );
  await withFetch(allDeleted, async (calls) => {
    const direct = deleteSubmissionAndVideo;
    const result = await direct(fakeRef(), { cloudinaryPublicId: 'oc/v' }, 'test');
    ok('46. a legacy document with no createdAt cannot be verified, so its asset is kept',
      calls.length === 0 && /^refused/.test(result.cloudinaryDetail), JSON.stringify(result));
  });
  await withFetch(allDeleted, async (calls) => {
    const ref = fakeRef();
    const result = await del(ref, { cloudinaryPublicId: 'oc/legacy-v', timerShotIds: SHOTS_T, cubeShotIds: SHOTS_C }, 'test');
    ok('47. LEGACY SUBMISSIONS STILL CLEAN UP: video and all six stills uploaded with it are deleted',
      result.cloudinaryDeleted && result.stillsDeleted === 6 && result.stillsRefused === 0 && ref.deleted,
      JSON.stringify(result));
    ok('  ...after their upload times were checked (one lookup per resource type)', calls.lookups.length === 2);
  });

  // ══ WHEN THE SWEEP MAY DELETE ════════════════════════════════════════
  {
    const NOW = Date.UTC(2026, 8, 30);
    const c = (o) => ({ status: 'approved', createdAtMs: NOW - 15 * DAY, retentionExpiresAtMs: NOW - DAY, ...o });
    ok('48. a judged submission past its retention period and its stored date is swept', isSweepable(c({}), NOW));
    ok('49. THE HOLE: a stored date of yesterday on a submission filed today is NOT swept',
      !isSweepable(c({ createdAtMs: NOW - 60_000, retentionExpiresAtMs: NOW - DAY }), NOW));
    ok('50. exactly the retention period after creation is due',
      isSweepable(c({ createdAtMs: NOW - SUBMISSION_RETENTION_MS }), NOW));
    ok('51. a later stored date only DELAYS a sweep', !isSweepable(c({ retentionExpiresAtMs: NOW + DAY }), NOW));
    ok('52. no stored date: never swept, as before', !isSweepable(c({ retentionExpiresAtMs: null }), NOW));
    ok('53. no createdAt: never swept', !isSweepable(c({ createdAtMs: null }), NOW));
    ok('54. pending: never swept, however old', !isSweepable(c({ status: 'pending', createdAtMs: NOW - 90 * DAY }), NOW));
    ok('  ...and a rejected submission is swept like an approved one', isSweepable(c({ status: 'rejected' }), NOW));
  }

  // ── Wiring, read from the source ──
  {
    const src = (rel) => stripCode(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const cleanup = src('lib/online-competition/submission-cleanup.ts');
    ok('35. cleanup uses the shared R2 client rather than building its own',
      /deps\.client \?\? r2Client\(\)/.test(cleanup) && !/new S3Client\(|createR2Client\(/.test(cleanup));
    const constructors = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name) && /new S3Client\(/.test(src(rel))) constructors.push(rel);
      }
    };
    walk('app');
    walk('lib');
    ok('  ...and an S3 client is constructed in exactly one file',
      constructors.length === 1 && constructors[0] === 'lib/online-competition/r2-video.ts', constructors.join(', '));

    const sweep = src('app/api/online-competition/cron/sweep-videos/route.ts');
    ok('36. the sweep counts R2 deletes and names failing keys',
      /r2Deleted,\s*\n\s*r2Failed,/.test(sweep) && /videoKey: videoKey \?\? null/.test(sweep) &&
        /const r2Ok = !videoKey \|\| result\.r2Deleted;/.test(sweep));
    const admin = src('app/api/online-competition/submissions/[id]/route.ts');
    ok('37. the admin delete response carries the R2 outcome',
      /NextResponse\.json\(\{[\s\S]*r2Deleted,[\s\S]*r2Detail,[\s\S]*\}\)/.test(admin));
    const reset = src('lib/online-competition/reset-attempts.ts');
    ok('38. an attempt reset counts R2 videos too', /if \(data\.videoKey\)/.test(reset));
    ok('55. the sweep decides with isSweepable, over the server-pinned createdAt',
      /isSweepable\(/.test(sweep) && /\.where\('createdAt', '<=', /.test(sweep) && !/\.where\('retentionExpiresAt'/.test(sweep));
    ok('56. the client writes the same retention period the sweep checks',
      src('lib/online-competition/data.ts').includes('Date.now() + SUBMISSION_RETENTION_MS'));
    ok('57. cleanup checks R2 ownership before any R2 delete',
      cleanup.indexOf('videoKeyBelongsTo(videoKey, data)') > -1 &&
        cleanup.indexOf('videoKeyBelongsTo(videoKey, data)') < cleanup.indexOf('destroyR2Video(videoKey'));
  }

  console.error = realError;
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
