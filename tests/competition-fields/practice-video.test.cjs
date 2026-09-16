// ── Where a practice run's video goes ───────────────────────────────────
// Pure unit tests for lib/online-competition/practice-video.ts.
//
// These cannot be reached through the route: it authorises FIRST, so every
// malformed body comes back 401 in production and the refusals below are
// only observable here. That ordering is correct — nothing about a request
// is read as authoritative before there is a verified identity to attribute
// it to — and it is exactly why this suite exists.
//
// What carries weight:
//   THE KEY IS DERIVED, NEVER ACCEPTED. A client that names the object is
//     refused outright, not silently ignored.
//   uid FIRST, from the verified token, so an athlete can only ever write
//     under their own prefix.
//   ITS OWN PREFIX. A practice clip must not land under `videos/`, where the
//     competition retention sweep walks.
//
// Run: npm run test:practicevideo

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-practicevideo-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/practice-video.ts',
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

const V = require(path.join(OUT, 'practice-video.js'));

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

console.log('\n  -- the key --');
{
  eq('uid first, then event, then a nonce',
    V.buildPracticeVideoKey({ uid: 'u1', event: '333' }, 'n1'),
    'practice-videos/u1/333/n1.webm');
  // The competition sweep walks `videos/`. A practice clip under that prefix
  // would be inside a retention pass written for a different policy.
  ok('NOT under the competition prefix',
    !V.buildPracticeVideoKey({ uid: 'u1', event: '333' }, 'n1').startsWith('videos/'));
  eq('the prefix is its own', V.PRACTICE_VIDEO_KEY_PREFIX, 'practice-videos');
  // No round and no attempt: a practice run is one solve, so the nonce is
  // the only thing distinguishing two runs of the same event.
  const a = V.buildPracticeVideoKey({ uid: 'u1', event: '333' }, 'n1');
  const b = V.buildPracticeVideoKey({ uid: 'u1', event: '333' }, 'n2');
  ok('two runs of one event are different objects', a !== b);
}

console.log('\n  -- the body: the key is never accepted --');
{
  for (const field of ['key', 'Key', 'videoKey', 'objectKey', 'path']) {
    const r = V.parsePracticePresignBody({ event: '333', size: 10, [field]: 'anything' });
    ok(`"${field}" is REFUSED, not ignored`, r.ok === false && r.error === 'client-key-refused',
      JSON.stringify(r));
  }
}
{
  // A caller passing a competition target is using the wrong route, and this
  // path would otherwise write their clip under the practice prefix anyway.
  for (const field of ['competitionId', 'competitionRound', 'attempt']) {
    const r = V.parsePracticePresignBody({ event: '333', size: 10, [field]: 'x' });
    ok(`"${field}" is refused — wrong route`, r.ok === false && r.error === 'not-a-competition-upload',
      JSON.stringify(r));
  }
}

console.log('\n  -- the body: event and size --');
{
  const good = V.parsePracticePresignBody({ event: '333', size: 1024 });
  ok('a well-formed body passes', good.ok === true, JSON.stringify(good));
  eq('  ...carrying the event', good.event, '333');
  eq('  ...and the size', good.size, 1024);

  const bad = (body) => V.parsePracticePresignBody(body);
  eq('no body', bad(null).error, 'bad-body');
  eq('an array', bad([]).error, 'bad-body');
  eq('no event', bad({ size: 10 }).error, 'bad-event');
  // A path separator in a segment would let a client climb out of its own
  // prefix, which is the whole reason the alphabet is restricted.
  eq('a slash in the event', bad({ event: 'a/b', size: 10 }).error, 'bad-event');
  eq('a dotted event', bad({ event: '../x', size: 10 }).error, 'bad-event');
  eq('no size', bad({ event: '333' }).error, 'bad-size');
  eq('a zero size', bad({ event: '333', size: 0 }).error, 'bad-size');
  eq('a fractional size', bad({ event: '333', size: 1.5 }).error, 'bad-size');
  eq('a negative size', bad({ event: '333', size: -1 }).error, 'bad-size');
  const big = bad({ event: '333', size: 64 * 1024 * 1024 + 1 });
  eq('over the ceiling is 413', big.status, 413);
  eq('  ...and says so', big.error, 'too-large');
}

console.log('\n  -- the handler: authorise, derive, sign --');
{
  const run = async (body, opts = {}) =>
    V.handlePracticePresign(body, {
      authorize: opts.authorize ?? (async () => 'uid-1'),
      presign: opts.presign ?? (async (key) => `https://r2.example/${key}?sig=1`),
      nonce: () => 'NONCE',
    });

  (async () => {
    const okRes = await run({ event: '333', size: 10 });
    eq('a granted request is 200', okRes.status, 200);
    eq('  ...with the DERIVED key', okRes.json.videoKey, 'practice-videos/uid-1/333/NONCE.webm');
    ok('  ...and an upload url built from it', okRes.json.uploadUrl.includes('practice-videos/uid-1/333/NONCE.webm'));
    // R2 refuses a PUT whose Content-Type differs from the signed one, so
    // the client must be told rather than assume.
    eq('  ...and the signed content type', okRes.json.contentType, 'video/webm');

    // AUTHORISE FIRST: a malformed body from an unauthorised caller must
    // come back 401, never a 400 that confirms the body was read.
    const unauth = await run({ event: '333', size: 10 }, {
      authorize: async () => { throw new Error('no'); },
    });
    eq('an unauthorised caller is 401', unauth.status, 401);
    const unauthBad = await run({ videoKey: 'x' }, {
      authorize: async () => { throw new Error('no'); },
    });
    eq('  ...even with a body that would also be refused', unauthBad.status, 401);
    eq('  ...and it says only "unauthorized"', unauthBad.json.error, 'unauthorized');

    // An athlete cannot reach another athlete's prefix: the uid comes from
    // authorize(), and nothing in the body can influence it.
    const other = await run({ event: '333', size: 10, uid: 'somebody-else' }, {
      authorize: async () => 'uid-1',
    });
    eq('a uid in the body is ignored', other.json.videoKey, 'practice-videos/uid-1/333/NONCE.webm');

    const broken = await run({ event: '333', size: 10 }, {
      presign: async () => { throw new Error('r2 down'); },
    });
    eq('a signing failure is 502', broken.status, 502);
    eq('  ...and does not leak the cause', broken.json.error, 'presign-failed');

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    fs.rmSync(OUT, { recursive: true, force: true });
    process.exit(fail === 0 ? 0 : 1);
  })();
}
