// ── A judging video is never cropped ───────────────────────────────────
// Recordings come off a phone held upright. Put one in a landscape-ish
// box and the browser does not complain, does not letterbox, and does not
// warn: it silently cuts the top and bottom off every clip. The frame
// just looks tight, so a judge has no way to know they are looking at
// less than the athlete filmed — and what gets cut is the top and bottom
// of frame, which is where the timer and the athlete's hands are.
//
// THIS HAS SHIPPED TWICE. First as aspect-video (16:9) on the old review
// dashboard — which sent someone rewriting useSolveRecorder around an
// off-screen canvas chasing a rotation bug that was really this, see the
// note still in that file. Then again as aspect-[3/4] on the panel that
// replaced it. Both times the file was fine and the container was wrong.
//
// So this suite pins THE RULE rather than today's markup: the admin
// review panel declares NO fixed aspect ratio at all — in any spelling —
// and the video element carries object-fit: contain, which is the thing
// that actually makes a clip of any shape letterbox instead of crop.
//
// The named landscape ratios are still barred individually below. That is
// redundant with "no ratio at all" and kept anyway: those two are the
// exact values that shipped, so a failure names the specific mistake
// being repeated rather than a general rule being broken.
//
// Run: npm run test:videoshape

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PANEL = path.join(
  ROOT,
  'app/online-competition/admin/_components/SubmissionDetailPanel.tsx',
);
const RECORDER = path.join(
  ROOT,
  'app/online-competition/[competitionId]/solve/[eventId]/_lib/useSolveRecorder.ts',
);

const panel = fs.readFileSync(PANEL, 'utf8');
const recorder = fs.readFileSync(RECORDER, 'utf8');

/** Code only. The recorder's comments discuss aspect ratios and the
 *  constraints that used to be there at length — precisely because of
 *  this bug — so any "X appears nowhere" assertion has to read past the
 *  prose explaining why X appears nowhere. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ 	]*\/\/.*$/gm, '');
const recorderCode = stripComments(recorder);

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

console.log('\n=== the review video is never cropped ===\n');

// ── Every spelling of a forbidden ratio ───────────────────────────────
// Tailwind's utility, a Tailwind arbitrary value, the CSS property and
// the React style object all say the same thing differently, and the two
// regressions used two different spellings. All of them are barred.
const FORBIDDEN = [
  { label: '16:9 via Tailwind aspect-video', re: /aspect-video/ },
  { label: '16:9 via an arbitrary Tailwind value', re: /aspect-\[\s*16\s*\/\s*9\s*\]/ },
  { label: '4:3 via an arbitrary Tailwind value', re: /aspect-\[\s*4\s*\/\s*3\s*\]/ },
  { label: '3:4 via an arbitrary Tailwind value', re: /aspect-\[\s*3\s*\/\s*4\s*\]/ },
  { label: "16:9 via aspectRatio / aspect-ratio", re: /aspect-?[rR]atio['"\s:]+['"]?\s*16\s*\/\s*9/ },
  { label: "4:3 via aspectRatio / aspect-ratio", re: /aspect-?[rR]atio['"\s:]+['"]?\s*4\s*\/\s*3/ },
  { label: "3:4 via aspectRatio / aspect-ratio", re: /aspect-?[rR]atio['"\s:]+['"]?\s*3\s*\/\s*4/ },
];

for (const f of FORBIDDEN) {
  ok(`the panel declares no ${f.label}`, !f.re.test(panel),
    (panel.match(f.re) || [''])[0]);
}

// ── NO FIXED RATIO AT ALL ─────────────────────────────────────────────
// Not merely "not a landscape one". The wrapper fills its column and
// `contain` fits the clip inside it, so any declared ratio is a guess
// about a shape nothing actually knows in advance — and a wrong guess is
// how both regressions happened. A 9:16 box was the third version of the
// same mistake in the other direction: it never cropped, but it spent
// most of the column on black bars for every landscape webcam clip.
ok('the video wrapper declares no fixed aspect ratio at all',
  !/aspect-?[rR]atio/.test(panel) && !/aspect-(video|square|\[)/.test(panel),
  (panel.match(/aspect-?[rR]atio.{0,40}/) || [''])[0]);

// CONTAIN IS THE WHOLE MECHANISM, and now the only one. It is what makes
// a clip of ANY shape letterbox rather than crop — a future device that
// films 4:3 is handled by this and by nothing else.
ok('the video element uses object-fit: contain, never cover',
  /objectFit:\s*'contain'/.test(panel));
ok('  ...and never cover, which would crop instead of letterbox',
  !/objectFit:\s*'cover'/.test(panel) && !/object-cover/.test(panel));

// ── Exactly one video, so there is one place to get this wrong ────────
const videoTags = (panel.match(/<video\b/g) || []).length;
ok('the admin renders the submission video exactly once', videoTags === 1,
  `${videoTags} <video> tags`);

// ── The premise the rule rests on ─────────────────────────────────────
// If the recorder ever DID pin a ratio, a reader might reasonably decide
// the container could stop worrying. It does not, and it no longer even
// caps two dimensions: capping both states a ratio, and a browser reached
// that ratio by CROPPING — 1080x1440 recorded from a 1080x1920 source,
// with the stills proving the source was whole. So the recorder now caps
// the long edge alone, which leaves nothing to crop toward.
//
// Track constraints are gone entirely — the device ignored them, so the
// sizing moved to a canvas the recorder draws into. Which means the
// anti-crop rule moved with it: ONE scale factor, applied to both
// dimensions. Two independently chosen numbers is the only way a canvas
// can distort or crop, exactly as two independent constraints was.
//
// Scoped to the pipeline, not the whole file: the hook's comments discuss
// ratios at length precisely because of this bug, and a file-wide scan
// would be tripped by the explanation of the rule it is enforcing.
const pipeline = recorder.slice(
  recorder.indexOf('const startCanvasPipeline'),
  recorder.indexOf('const requestCamera'),
);
ok('the recorder sizes one canvas by a single scale factor',
  /RECORDING_MAX_EDGE \/ Math\.max\(size\.w, size\.h\)/.test(pipeline) &&
    /canvas\.width = Math\.round\(size\.w \* scale\)/.test(pipeline) &&
    /canvas\.height = Math\.round\(size\.h \* scale\)/.test(pipeline) &&
    !/aspectRatio/.test(pipeline));
ok('  ...and uses ideal, never exact, on the source constraints',
  /width:\s*\{\s*ideal:\s*1920\s*\}/.test(recorder) && !/exact:/.test(recorder));
// Nothing constrains the track any more, so there is no second place a
// shape could be stated.
ok('  ...with no track constraint left anywhere',
  !/applyConstraints/.test(recorderCode));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
