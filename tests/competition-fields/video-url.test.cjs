// ── Video URL parsing ───────────────────────────────────────────────────
// Pure unit tests for parseVideoUrl — the single rule shared by the
// section editor (which shows the parsed id back to the admin) and by
// validateCompetitionInput (which refuses a url it cannot parse). One
// function, two callers: if they ever disagreed, the editor would accept
// a link the save then rejects with no explanation.
//
// The load-bearing group is REFUSED: a YouTube playlist or channel url is
// a real, working YouTube link that is NOT a video, and accepting one
// would store a block that can never render.
//
// Run: npm run test:video

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-video-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/video-url.ts',
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

const { parseVideoUrl, describeVideo } = require(path.join(OUT, 'video-url.js'));

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

const ID = 'dQw4w9WgXcQ';
const accept = (url, provider, id) => {
  const got = parseVideoUrl(url);
  ok(
    `${url}  ->  ${provider} ${id}`,
    got !== null && got.provider === provider && got.id === id,
    JSON.stringify(got),
  );
};
const refuse = (url, why) => ok(`REFUSED (${why}): ${JSON.stringify(url)}`, parseVideoUrl(url) === null, JSON.stringify(parseVideoUrl(url)));

console.log('\n  -- YouTube: every shape a browser hands you --');
accept(`https://www.youtube.com/watch?v=${ID}`, 'youtube', ID);
accept(`https://youtube.com/watch?v=${ID}`, 'youtube', ID);
accept(`http://youtube.com/watch?v=${ID}`, 'youtube', ID);
accept(`https://m.youtube.com/watch?v=${ID}`, 'youtube', ID);
accept(`https://youtu.be/${ID}`, 'youtube', ID);
accept(`https://www.youtube.com/embed/${ID}`, 'youtube', ID);
accept(`https://www.youtube-nocookie.com/embed/${ID}`, 'youtube', ID);
accept(`https://www.youtube.com/shorts/${ID}`, 'youtube', ID);
accept(`https://www.youtube.com/live/${ID}`, 'youtube', ID);
accept(`https://www.youtube.com/v/${ID}`, 'youtube', ID);

console.log('\n  -- forgiving about the wrapper --');
// What an admin actually pastes: a share link with tracking params, a
// timestamp, a copied url with no scheme, stray whitespace, odd casing.
accept(`https://youtu.be/${ID}?si=abcdef123`, 'youtube', ID);
accept(`https://www.youtube.com/watch?v=${ID}&t=42s`, 'youtube', ID);
accept(`https://www.youtube.com/watch?list=PL123&v=${ID}`, 'youtube', ID);
accept(`youtube.com/watch?v=${ID}`, 'youtube', ID);
accept(`www.youtube.com/watch?v=${ID}`, 'youtube', ID);
accept(`youtu.be/${ID}`, 'youtube', ID);
accept(`   https://youtu.be/${ID}   `, 'youtube', ID);
accept(`https://WWW.YOUTUBE.COM/watch?v=${ID}`, 'youtube', ID);

console.log('\n  -- Vimeo --');
accept('https://vimeo.com/123456789', 'vimeo', '123456789');
accept('https://www.vimeo.com/123456789', 'vimeo', '123456789');
accept('https://player.vimeo.com/video/123456789', 'vimeo', '123456789');
// An unlisted link is vimeo.com/<id>/<private hash>: the hash is not
// numeric, so the id is still found.
accept('https://vimeo.com/123456789/a1b2c3d4e5', 'vimeo', '123456789');
// A group link puts the id LAST — the opposite of the unlisted case,
// which is why the scan runs backwards.
accept('https://vimeo.com/groups/cubing/videos/123456789', 'vimeo', '123456789');
accept('https://vimeo.com/channels/staffpicks/123456789', 'vimeo', '123456789');
accept('vimeo.com/123456789', 'vimeo', '123456789');

console.log('\n  -- REFUSED: not a video --');
// The important ones: real links to the right sites that are not videos.
refuse('https://www.youtube.com/@somechannel', 'a channel');
refuse('https://youtube.com/playlist?list=PL1234567890', 'a playlist');
refuse('https://www.youtube.com/watch', 'watch with no v');
refuse('https://www.youtube.com/results?search_query=cubing', 'a search');
refuse('https://vimeo.com/cubingmongolia', 'a user page, no numeric id');
refuse('https://vimeo.com/', 'the bare host');

console.log('\n  -- REFUSED: strict about the id --');
// A truncated or over-long id must be a NON-match, never a silently
// trimmed one — an id cut to 11 chars would play a different video.
refuse(`https://youtu.be/${ID}extra`, 'id too long');
refuse('https://youtu.be/short', 'id too short');
refuse(`https://www.youtube.com/watch?v=${ID}X`, '12-char v param');
refuse('https://youtu.be/abcdefghij!', 'illegal character');
refuse('https://vimeo.com/12345', 'vimeo id too short');
refuse('https://vimeo.com/1234567890123', 'vimeo id too long');

console.log('\n  -- REFUSED: not one of the two providers --');
refuse('https://example.com/video.mp4', 'another host');
refuse('https://dailymotion.com/video/x8abcd', 'another provider');
refuse('https://res.cloudinary.com/x/video/upload/v1/a.mp4', 'a Cloudinary video');
refuse(`https://notyoutube.com/watch?v=${ID}`, 'a lookalike host');
refuse(`https://youtube.com.evil.test/watch?v=${ID}`, 'a suffixed host');
refuse(`ftp://youtube.com/watch?v=${ID}`, 'a non-http scheme');
refuse(`javascript:alert(1)//youtube.com/watch?v=${ID}`, 'a javascript: url');

console.log('\n  -- REFUSED: junk --');
refuse('', 'empty');
refuse('   ', 'whitespace');
refuse('not a url at all', 'free text');
refuse('http://', 'no host');
ok('a non-string is refused rather than thrown on', parseVideoUrl(null) === null && parseVideoUrl(undefined) === null);

console.log('\n  -- the readback the admin sees --');
ok('describeVideo names YouTube and the id',
  describeVideo({ provider: 'youtube', id: ID }) === `YouTube · ${ID}`,
  describeVideo({ provider: 'youtube', id: ID }));
ok('describeVideo names Vimeo and the id',
  describeVideo({ provider: 'vimeo', id: '123456789' }) === 'Vimeo · 123456789');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
