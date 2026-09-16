// ── The six seek targets ─────────────────────────────────────────────────
// Pure unit tests for lib/online-competition/solve-jumps.ts.
//
// THIS MODULE HAD NO TESTS WHEN IT WAS A CONST INSIDE SubmissionDetailPanel
// — it could not have any, because nothing could import it. It has them now
// because it is shared: the competition review panel and the practice review
// panel both seek from this one table, so a change to an offset moves a
// judge's jump on two screens at once, and "did anything change" has to be
// answerable without opening a video.
//
// The numbers below are the offsets as extracted, not as re-derived. If one
// of them fails after a deliberate change, the fix is to change the number
// here too — and the failure is the point: it says which of the six moved.
//
// Run: npm run test:jumps

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-jumps-build');

fs.rmSync(OUT, { recursive: true, force: true });
// THROUGH A TEMP tsconfig, not bare flags: solve-jumps pulls in
// solve-stage-timing, which imports the solve flow's scrambleChunks through
// the `@/` alias — and `paths` has no command-line equivalent. Extending
// the project's own config is also the honest thing: this compiles the
// module the way the app compiles it.
const TSCONFIG = path.join(ROOT, '.tmp-jumps-tsconfig.json');
fs.writeFileSync(
  TSCONFIG,
  JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: {
      outDir: path.basename(OUT),
      module: 'commonjs',
      moduleResolution: 'node',
      target: 'es2022',
      noEmit: false,
      jsx: 'react-jsx',
      declaration: false,
    },
    // practice.ts comes along so the marks a practice run FILES can be
    // checked against the marks these jumps READ - see the last section.
    files: ['lib/online-competition/solve-jumps.ts', 'lib/online-competition/practice.ts'],
  }),
);
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', TSCONFIG], {
  cwd: ROOT,
  stdio: 'inherit',
});
fs.rmSync(TSCONFIG, { force: true });

// TypeScript does NOT rewrite module specifiers, so the emitted JS still
// says `require('@/app/.../scrambleChunks')`. The emitted tree mirrors the
// source layout under outDir, so one resolver hook maps the alias onto it.
// Scoped to this process and to the `@/` prefix only.
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(OUT, request.slice(2)) : request, ...rest);
};

const J = require(path.join(OUT, 'lib/online-competition/solve-jumps.js'));
const P = require(path.join(OUT, 'lib/online-competition/practice.js'));

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

const jump = (key) => J.JUMPS.find((j) => j.key === key);
const target = (key, marks, scramble = null) => jump(key).resolve(marks, scramble);

/** A 3x3 scramble: 20 moves, so four reveal chunks at 5s = 20s of reveal. */
const SCRAMBLE_333 = "R U R' U' F2 L D L' B2 R2 F' U2 D B L2 F R' B' U D2";

console.log('\n  -- the table itself --');
{
  eq('six targets', J.JUMPS.length, 6);
  eq('in order', J.JUMPS.map((j) => j.key).join(','), 'start,cover,inspect,finish,timer,cube');
  eq('labels', J.JUMPS.map((j) => j.label).join(','), 'ЭХЛЭХ,КОВЕР,ЭВЛҮҮЛЭХ,ТӨГСГӨЛ,ЦАГ,ШОО');
  // Only ЭХЛЭХ is correct whatever was recorded, which is what lets the
  // panel tell "no marks at all" from "this one button has nothing to aim
  // at".
  eq('only ЭХЛЭХ needs no marks',
    J.JUMPS.filter((j) => !j.needsMarks).map((j) => j.key).join(','), 'start');
}

console.log('\n  -- ЭХЛЭХ --');
{
  eq('always zero', target('start', undefined), 0);
  eq('  ...even with marks', target('start', { solveStart: 9999 }), 0);
}

console.log('\n  -- КОВЕР: the recorded route wins --');
{
  // coverStart names the transition, so the midpoint is that plus half the
  // stage. COVER_SECONDS is 20, so +10s.
  eq('coverStart + half the cover stage', target('cover', { coverStart: 30_000 }), 40_000);
  // It must PREFER the recorded mark: an attempt carrying both must not be
  // seeked by the inferred route, which is only as right as the assumption
  // that today's stage timing produced that old clip.
  eq('  ...and wins over scrambleShown when both exist',
    target('cover', { coverStart: 30_000, scrambleShown: 1_000 }, SCRAMBLE_333), 40_000);
}

console.log('\n  -- КОВЕР: the inferred route, for clips filed before coverStart --');
{
  // scrambleShown + the reveal's own length + half the cover. The reveal is
  // NOT a constant: it plays the scramble one chunk at a time, so its
  // length follows the scramble.
  const from = 5_000;
  const got = target('cover', { scrambleShown: from }, SCRAMBLE_333);
  // 20 moves -> 4 chunks -> 20s of reveal, then +10s into the cover.
  eq('scrambleShown + reveal + half the cover', got, from + 20_000 + 10_000);
  // A SHORTER scramble gives a SHORTER reveal, which is the whole reason
  // this needs the athlete's actual scramble.
  const short = target('cover', { scrambleShown: from }, "R U R' U'");
  ok('a shorter scramble lands earlier', short < got, `${short} vs ${got}`);
  // Without the scramble it cannot be computed, and a null disables the
  // button rather than guessing.
  eq('no scramble: null', target('cover', { scrambleShown: from }, null), null);
  eq('no marks at all: null', target('cover', undefined, SCRAMBLE_333), null);
}

console.log('\n  -- ЭВЛҮҮЛЭХ: the mark itself, no offset --');
{
  eq('solveStart exactly', target('inspect', { solveStart: 42_000 }), 42_000);
  eq('missing: null', target('inspect', {}), null);
}

console.log('\n  -- ТӨГСГӨЛ: backwards from solveEnd, clamped --');
{
  // 5s before the end, so the last moves land on screen rather than a cube
  // already finished and still.
  eq('solveEnd - 5s', target('finish', { solveEnd: 60_000, solveStart: 40_000 }), 55_000);
  // THE CLAMP. A solve faster than 5s would seek back past its own start,
  // into the cover stage, and show a SCRAMBLED cube at the moment labelled
  // "the finish".
  eq('a 3s solve clamps to solveStart',
    target('finish', { solveStart: 50_000, solveEnd: 53_000 }), 50_000);
  eq('  ...exactly 5s does not clamp',
    target('finish', { solveStart: 50_000, solveEnd: 55_000 }), 50_000);
  // With no solveStart there is nothing to clamp against, so the raw offset
  // stands rather than the button going dead.
  eq('no solveStart: the raw offset', target('finish', { solveEnd: 60_000 }), 55_000);
  eq('no solveEnd: null', target('finish', { solveStart: 1 }), null);
}

console.log('\n  -- ЦАГ and ШОО: into the hold, not at its edge --');
{
  // A mark names the instant a stage BEGAN, and at +0 the athlete is still
  // moving their hands.
  eq('ЦАГ is solveEnd + 3s', target('timer', { solveEnd: 60_000 }), 63_000);
  eq('ШОО is cubeShown + 3s', target('cube', { cubeShown: 80_000 }), 83_000);
  eq('ЦАГ missing: null', target('timer', {}), null);
  eq('ШОО missing: null', target('cube', {}), null);
}

console.log('\n  -- at(): a mark, or null --');
{
  eq('a number reads back', J.at({ solveStart: 5 }, 'solveStart'), 5);
  eq('zero is a real mark, not a missing one', J.at({ solveStart: 0 }, 'solveStart'), 0);
  eq('missing is null', J.at({}, 'solveStart'), null);
  eq('undefined marks is null', J.at(undefined, 'solveStart'), null);
  // The guard that keeps a missing mark from becoming a NaN seek.
  eq('a string is null', J.at({ solveStart: '5' }, 'solveStart'), null);
  eq('NaN is null', J.at({ solveStart: NaN }, 'solveStart'), null);
  eq('Infinity is null', J.at({ solveStart: Infinity }, 'solveStart'), null);
}

console.log('\n  -- every needsMarks target is null with no marks --');
{
  // What the panel's `noMarks` relies on: with nothing recorded, every
  // button that needs a mark is disabled and only ЭХЛЭХ remains.
  const withNothing = J.JUMPS.filter((j) => j.needsMarks).map((j) => j.resolve(undefined, SCRAMBLE_333));
  ok('all five are null', withNothing.every((t) => t === null), JSON.stringify(withNothing));
  eq('  ...and ЭХЛЭХ still aims at 0', target('start', undefined), 0);
}

console.log('\n  -- it is the SAME table the panel uses --');
{
  const panel = fs.readFileSync(
    path.join(ROOT, 'app/online-competition/admin/_components/SubmissionDetailPanel.tsx'), 'utf8');
  ok('the panel imports it rather than declaring its own',
    /import \{[^}]*JUMPS[^}]*\} from '@\/lib\/online-competition\/solve-jumps'/.test(panel));
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('  ...and declares no JUMPS of its own', !/const JUMPS\s*[:=]/.test(code));
  ok('  ...nor its own at()', !/function at\s*\(/.test(code));
}

console.log('\n  -- it is the SAME table the practice panel uses --');
{
  const prv = fs.readFileSync(
    path.join(ROOT, 'app/online-competition/admin/_components/PracticeRunPanel.tsx'), 'utf8');
  ok('the practice panel imports it rather than declaring its own',
    /import \{[^}]*JUMPS[^}]*\} from '@\/lib\/online-competition\/solve-jumps'/.test(prv));
  const code = prv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('  ...and declares no JUMPS of its own', !/const JUMPS\s*[:=]/.test(code));
  ok('  ...nor its own at()', !/function at\s*\(/.test(code));
  // ONE BUTTON PER ENTRY, so a seventh moment added to the table appears on
  // both screens rather than on whichever one was remembered.
  ok('  ...and draws a button per entry', /JUMPS\.map\(/.test(code));
  // The seek target is JUMPS' own. Recomputing it here would be a second
  // opinion about where a phase starts.
  ok('  ...seeking through resolve, not its own arithmetic', /jump\.resolve\(/.test(code));
  // THE GUARD: a null target disables the button, it never seeks.
  ok('  ...and a null target disables the button', /disabled=\{dead/.test(code));
  // MILLISECONDS IN, SECONDS OUT — the conversion the panel's own comment
  // calls out, because handing currentTime a millisecond figure seeks
  // silently to the end of the clip.
  ok('  ...and converts ms to seconds before seeking', /ms \/ 1000/.test(code));
}

console.log('\n  -- a practice run files every mark these jumps read --');
{
  // THE CROSS-CHECK BETWEEN THE TWO HALVES OF THIS FEATURE. The practice
  // filing route stores only the keys in PRACTICE_MARK_KEYS and drops the
  // rest, so a key this table reads but that list omits would be a button
  // permanently dead on the practice screen and alive on the competition
  // one, with nothing failing to say so.
  const filed = {};
  for (const key of P.PRACTICE_MARK_KEYS) filed[key] = 1000;
  const kept = P.readPracticeMarks(filed);
  const dead = J.JUMPS.filter((j) => j.resolve(kept, SCRAMBLE_333) === null).map((j) => j.key);
  ok('every one of the six resolves from a full practice marks map', dead.length === 0,
    `dead: ${JSON.stringify(dead)}`);
  eq('  ...and that list is exactly six keys long', P.PRACTICE_MARK_KEYS.length, 6);
  // A run filed BEFORE marks existed: readPracticeMarks turns the missing
  // field into {}, so every button that needs one is inert and only ЭХЛЭХ
  // remains. That is what the panel's "no marks" line reports.
  const none = P.readPracticeMarks(undefined);
  const alive = J.JUMPS.filter((j) => j.resolve(none, SCRAMBLE_333) !== null).map((j) => j.key);
  ok('a run with no marks leaves only ЭХЛЭХ', JSON.stringify(alive) === JSON.stringify(['start']),
    JSON.stringify(alive));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
