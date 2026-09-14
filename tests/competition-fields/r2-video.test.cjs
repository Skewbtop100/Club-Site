// ── Submission videos on Cloudflare R2 ─────────────────────────────────
// The video no longer rides an unsigned Cloudinary preset. Our route signs
// ONE PUT for ONE object and the browser sends the bytes straight to R2.
// That moves three responsibilities onto code we own, and each has a way
// to fail quietly:
//
//   THE KEY. If the client could choose it, any athlete could overwrite
//   any other athlete's video — or their own, after a judge approved it.
//
//   THE SIGNATURE. The SDK in use adds checksum parameters to presigned
//   URLs by default, computed over an empty body; R2 then rejects the
//   real PUT. Nothing about that is visible until an athlete's upload
//   fails, so it is asserted here against a real generated URL.
//
//   PLAYBACK. Two storage schemes now coexist permanently. If more than
//   one place decided which to play, they would eventually disagree.
//
// No emulator and no network: presigning is pure local signing, and the
// duration probe runs against a scripted fake element.
//
// Run: npm run test:r2

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-r2-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/r2-video.ts',
    'lib/online-competition/video-source.ts',
    'lib/online-competition/video-duration.ts',
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

const r2 = require(path.join(OUT, 'r2-video.js'));
const { resolveVideoSrc } = require(path.join(OUT, 'video-source.js'));
const { probeVideoDurationMs } = require(path.join(OUT, 'video-duration.js'));

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

/** A presign that records every call, so tests can prove it was NOT
 *  reached on a refused request. */
function recordingPresign() {
  const calls = [];
  const fn = async (key, size) => {
    calls.push({ key, size });
    return `https://signed.example/${key}`;
  };
  fn.calls = calls;
  return fn;
}

const VALID = { competitionId: 'comp1', event: '333', competitionRound: 2, attempt: 3, size: 3_380_000 };
const authed = (uid = 'uid123') => async () => uid;
const authError = (status, reason) => Object.assign(new Error(reason), { status, reason });

(async () => {
  console.log('\n=== submission videos on R2 ===\n');

  // ── Authorisation ─────────────────────────────────────────────────────
  {
    const presign = recordingPresign();
    // A body that is invalid in two different ways at once. If validation
    // ran before authorisation, the caller would learn which.
    const res = await r2.handlePresignVideo(
      { key: 'videos/victim/x.webm', attempt: 99 },
      { authorize: async () => { throw authError(401, 'no-token'); }, presign },
    );
    ok('1. an unauthenticated caller is refused', res.status === 401, JSON.stringify(res));
    ok('2. ...before the body is even validated', res.json.error === 'no-token', JSON.stringify(res.json));
    ok('3. ...and no URL is signed', presign.calls.length === 0, JSON.stringify(presign.calls));
  }
  {
    const res = await r2.handlePresignVideo(VALID, {
      authorize: async () => { throw authError(401, 'anonymous'); },
      presign: recordingPresign(),
    });
    ok('4. an anonymous session is refused the same way', res.status === 401 && res.json.error === 'anonymous');
  }
  {
    // A server fault in verification is NOT an auth failure, and must not
    // be disguised as one — it propagates to a 500.
    let threw = false;
    try {
      await r2.handlePresignVideo(VALID, {
        authorize: async () => { throw new Error('admin sdk misconfigured'); },
        presign: recordingPresign(),
      });
    } catch {
      threw = true;
    }
    ok('5. a verification fault is not reported as a 401', threw);
  }

  // ── The key is derived, never accepted ────────────────────────────────
  for (const field of ['key', 'Key', 'videoKey', 'objectKey', 'path']) {
    const presign = recordingPresign();
    const res = await r2.handlePresignVideo(
      { ...VALID, [field]: 'videos/someone-else/comp1/333/r2/a3/x.webm' },
      { authorize: authed(), presign },
    );
    ok(`6. a client-supplied "${field}" is refused, not ignored`,
      res.status === 400 && res.json.error === 'client-key-refused' && presign.calls.length === 0,
      JSON.stringify(res));
  }
  {
    const presign = recordingPresign();
    const res = await r2.handlePresignVideo(VALID, {
      authorize: authed('uid123'),
      presign,
      nonce: () => '1700000000000-a1b2c3',
    });
    const key = res.json.videoKey;
    ok('7. a valid request is granted', res.status === 200, JSON.stringify(res));
    ok('8. the key is exactly the derived format',
      key === 'videos/uid123/comp1/333/r2/a3/1700000000000-a1b2c3.webm', key);
    ok('9. ...containing the VERIFIED uid', key.split('/')[1] === 'uid123', key);
    ok('10. ...and the attempt', key.includes('/a3/'), key);
    ok('11. the URL is signed for that key and that size',
      presign.calls.length === 1 && presign.calls[0].key === key && presign.calls[0].size === 3_380_000,
      JSON.stringify(presign.calls));
    ok('12. the grant names the content type the PUT must send',
      res.json.contentType === 'video/webm' && res.json.expiresInS === r2.VIDEO_UPLOAD_URL_TTL_S);
  }
  {
    // THE OVERWRITE THE NONCE PREVENTS. Two grants for the very same
    // attempt must not name the same object, or an athlete could upload
    // over a video after a judge had approved it.
    const a = await r2.handlePresignVideo(VALID, { authorize: authed(), presign: recordingPresign() });
    const b = await r2.handlePresignVideo(VALID, { authorize: authed(), presign: recordingPresign() });
    ok('13. two grants for the same attempt name different objects',
      a.json.videoKey !== b.json.videoKey, `${a.json.videoKey} / ${b.json.videoKey}`);
  }

  // ── Validation ────────────────────────────────────────────────────────
  {
    const cases = [
      [{ ...VALID, attempt: 6 }, 400, 'bad-attempt'],
      [{ ...VALID, attempt: 0 }, 400, 'bad-attempt'],
      [{ ...VALID, competitionRound: 1.5 }, 400, 'bad-round'],
      [{ ...VALID, competitionId: 'comp/../other' }, 400, 'bad-competition'],
      [{ ...VALID, event: '' }, 400, 'bad-event'],
      [{ ...VALID, size: 0 }, 400, 'bad-size'],
      [{ ...VALID, size: r2.MAX_VIDEO_BYTES + 1 }, 413, 'too-large'],
      [null, 400, 'bad-body'],
    ];
    for (const [body, status, error] of cases) {
      const presign = recordingPresign();
      const res = await r2.handlePresignVideo(body, { authorize: authed(), presign });
      ok(`14. ${error} (${status})`,
        res.status === status && res.json.error === error && presign.calls.length === 0,
        JSON.stringify(res));
    }
    const badUid = await r2.handlePresignVideo(VALID, { authorize: authed('a/b'), presign: recordingPresign() });
    ok('15. a uid that would read as path structure is refused', badUid.status === 400, JSON.stringify(badUid));
  }
  {
    const res = await r2.handlePresignVideo(VALID, {
      authorize: authed(),
      presign: async () => { throw new Error('R2 is not configured'); },
    });
    ok('16. a signing failure is a 500, never a silent success',
      res.status === 500 && res.json.error === 'presign-failed' && !('uploadUrl' in res.json),
      JSON.stringify(res));
  }

  // ── The real signed URL ───────────────────────────────────────────────
  {
    const client = r2.createR2Client({
      accountId: 'acct123',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secretEXAMPLE',
    });
    const key = 'videos/uid123/comp1/333/r2/a3/1700000000000-a1b2c3.webm';
    const url = new URL(await r2.presignVideoPut(client, 'bucket-x', key, 3_380_000));
    const params = [...url.searchParams.keys()];

    // THE ONE THAT FAILS SILENTLY. Verified by hand that a default client
    // on this SDK version DOES add these; the WHEN_REQUIRED setting is the
    // only thing keeping them off.
    ok('17. the URL carries no checksum parameters R2 would reject',
      !params.some((p) => /checksum/i.test(p)), params.join(','));
    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    ok('18. content-type is signed, so the bucket only takes video',
      signed.includes('content-type'), signed.join(';'));
    ok('19. content-length is signed, so the size cap is enforced not requested',
      signed.includes('content-length'), signed.join(';'));
    const expires = Number(url.searchParams.get('X-Amz-Expires'));
    ok('20. the expiry is short', expires === r2.VIDEO_UPLOAD_URL_TTL_S && expires <= 600, String(expires));
    ok('21. path-style, so no bucket name can break the TLS certificate',
      url.host === 'acct123.r2.cloudflarestorage.com' && url.pathname === `/bucket-x/${key}`,
      `${url.host}${url.pathname}`);
  }

  // ── Playback: ONE decision ────────────────────────────────────────────
  {
    const base = 'https://videos.example.com';
    ok('22. playback prefers videoKey over videoUrl',
      resolveVideoSrc({ videoKey: 'videos/u/c/333/r1/a1/n.webm', videoUrl: 'https://res.cloudinary.com/x.webm' }, base) ===
        'https://videos.example.com/videos/u/c/333/r1/a1/n.webm');
    ok('23. playback falls back to videoUrl when videoKey is absent',
      resolveVideoSrc({ videoUrl: 'https://res.cloudinary.com/x.webm' }, base) === 'https://res.cloudinary.com/x.webm');
    ok('24. ...and when the key is present but no public base is configured',
      resolveVideoSrc({ videoKey: 'videos/u/n.webm', videoUrl: 'https://res.cloudinary.com/x.webm' }, '') ===
        'https://res.cloudinary.com/x.webm');
    ok('25. nothing playable is null, not an empty string',
      resolveVideoSrc({}, base) === null && resolveVideoSrc({ videoKey: '', videoUrl: '' }, base) === null);
    ok('26. a trailing slash on the base does not double up',
      resolveVideoSrc({ videoKey: 'videos/a.webm' }, 'https://v.example.com/') === 'https://v.example.com/videos/a.webm');
    ok('27. segments are encoded, slashes survive as structure',
      resolveVideoSrc({ videoKey: 'videos/a b/c.webm' }, base) === 'https://videos.example.com/videos/a%20b/c.webm');
  }

  // ── Duration, read from the file ──────────────────────────────────────
  /** A scripted stand-in for HTMLVideoElement. `onSrc` runs when a source
   *  is assigned, `onSeek` when currentTime is set — which is where the
   *  MediaRecorder Infinity workaround lives. */
  function fakeVideo(script) {
    const handlers = new Map();
    let src = '';
    const el = {
      preload: '',
      muted: false,
      _duration: NaN,
      _currentTime: 0,
      removed: false,
      get duration() { return this._duration; },
      get currentTime() { return this._currentTime; },
      set currentTime(v) { this._currentTime = v; if (script.onSeek) script.onSeek(el); },
      addEventListener(type, fn) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(fn);
      },
      removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
      removeAttribute(name) { if (name === 'src') this.removed = true; },
      load() {},
      emit(type) { for (const fn of [...(handlers.get(type) ?? [])]) fn(); },
      listenerCount() { let n = 0; for (const s of handlers.values()) n += s.size; return n; },
    };
    Object.defineProperty(el, 'src', {
      get: () => src,
      set: (v) => { src = v; if (v) setTimeout(() => script.onSrc(el), 0); },
    });
    return el;
  }

  async function probe(script, timeoutMs = 150) {
    const urls = { created: 0, revoked: 0 };
    let el;
    const ms = await probeVideoDurationMs(new Blob(['webm']), {
      createElement: () => (el = fakeVideo(script)),
      createObjectURL: () => { urls.created++; return 'blob:fake'; },
      revokeObjectURL: () => { urls.revoked++; },
      timeoutMs,
    });
    return { ms, urls, el };
  }
  const tidy = ({ urls, el }) => urls.revoked === 1 && el.removed && el.listenerCount() === 0;

  {
    // A file with a real duration in its header.
    const r = await probe({ onSrc: (el) => { el._duration = 104.033; el.emit('loadedmetadata'); } });
    ok('28. a finite header duration is read directly', r.ms === 104033, String(r.ms));
    ok('  ...and the element and blob URL are released', tidy(r));
  }
  {
    // THE MEDIARECORDER CASE. The header was written before the recording
    // ended, so the element says Infinity until it is made to scan.
    const r = await probe({
      onSrc: (el) => { el._duration = Infinity; el.emit('loadedmetadata'); },
      onSeek: (el) => setTimeout(() => { el._duration = 103.2; el.emit('durationchange'); }, 0),
    });
    ok('29. an Infinity duration is resolved by seeking past the end', r.ms === 103200, String(r.ms));
    ok('  ...having actually sought far past any real recording', r.el._currentTime > 1e100, String(r.el._currentTime));
    ok('  ...and released', tidy(r));
  }
  {
    // Some browsers report the scanned length via timeupdate instead.
    const r = await probe({
      onSrc: (el) => { el._duration = Infinity; el.emit('loadedmetadata'); },
      onSeek: (el) => setTimeout(() => { el._duration = 98.5; el.emit('timeupdate'); }, 0),
    });
    ok('30. ...whichever of durationchange or timeupdate delivers it', r.ms === 98500, String(r.ms));
  }
  {
    // A durationchange that still says Infinity must not end the probe
    // early with a wrong answer.
    const r = await probe({
      onSrc: (el) => { el._duration = Infinity; el.emit('loadedmetadata'); },
      onSeek: (el) => setTimeout(() => {
        el.emit('durationchange');
        el._duration = 61.25;
        el.emit('durationchange');
      }, 0),
    });
    ok('31. a still-Infinite durationchange is waited past, not taken', r.ms === 61250, String(r.ms));
  }
  {
    const r = await probe({ onSrc: (el) => el.emit('error') });
    ok('32. an unreadable file resolves to undefined, never throws', r.ms === undefined && tidy(r), String(r.ms));
  }
  {
    // A decoder that never answers must not hold the upload hostage.
    const started = Date.now();
    const r = await probe({ onSrc: () => {} }, 120);
    ok('33. a probe that never hears back gives up at its timeout',
      r.ms === undefined && Date.now() - started < 1000 && tidy(r), `${r.ms} after ${Date.now() - started}ms`);
  }

  // ── Wiring, read from the source ──────────────────────────────────────
  {
    const route = stripComments(read('app/api/online-competition/r2/presign-video/route.ts'));
    ok('34. the route authorises with the verified athlete token',
      /authorize: \(\) => requireAthlete\(req\)/.test(route) && /handlePresignVideo\(body,/.test(route));
    ok('  ...and hands the raw body to the handler, never picking a key out of it',
      !/body\.(key|videoKey|objectKey|Key|path)\b/.test(route));
  }
  {
    const client = stripComments(read('lib/online-competition/r2-upload-client.ts'));
    ok('35. the browser sends the attempt and size, never a key',
      /JSON\.stringify\(\{ \.\.\.target, size: blob\.size \}\)/.test(client));
    ok('  ...and PUTs with the signed content type',
      /xhr\.setRequestHeader\('Content-Type', contentType\)/.test(client));
  }
  {
    // ONE place builds a playback URL: nothing else may read the env var.
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(rel);
      }
    };
    walk('app');
    walk('lib');
    const readers = files.filter((f) => /NEXT_PUBLIC_R2_PUBLIC_URL/.test(stripComments(read(f))));
    ok('36. the public R2 base is read in exactly one file',
      readers.length === 1 && readers[0] === 'lib/online-competition/video-source.ts', readers.join(', '));
  }
  {
    const panel = stripComments(read('app/online-competition/admin/_components/SubmissionDetailPanel.tsx'));
    ok('37. the review panel plays whatever resolveVideoSrc returns',
      /const videoSrc = resolveVideoSrc\(submission\);/.test(panel) && /src=\{videoSrc \?\? undefined\}/.test(panel));
    ok('  ...and never reads either storage field for playback itself',
      !/submission\.videoUrl/.test(panel) && !/submission\.videoKey/.test(panel));
  }
  {
    const page = stripComments(read('app/online-competition/[competitionId]/solve/[eventId]/page.tsx'));
    ok('38. the solve page sends the video to R2', /await uploadVideoToR2\(/.test(page) && !/uploadVideoToCloudinary/.test(page));
    ok('  ...and files the key rather than a Cloudinary id',
      /^\s*videoKey,\s*$/m.test(page) && !/cloudinaryPublicId: publicId/.test(page));
    ok('  ...while the stills still go to Cloudinary, untouched', /uploadImageToCloudinary/.test(page));
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
