// ── The solve flow's scramble-failure handling ──────────────────────────
// SOURCE ASSERTIONS, NOT BEHAVIOUR. This project has no React test
// tooling at all — no jest, no vitest, no testing-library, no jsdom — so
// the solve flow cannot be rendered, stepped through a run, or made to
// fail a fetch. Everything here is a grep over the file, in the same
// style as the D7 call-site audit in registration-shape.test.cjs.
//
// What they are for: the bug these pin regressed SILENTLY and was only
// ever discovered by a judge rejecting a video. A run advanced into
// zeroDisplay (which starts the recording) without waiting for the
// scramble it had just requested, and `scramble` was never cleared — so a
// failed fetch revealed the PREVIOUS attempt's scramble and the athlete
// solved it on camera. Each assertion below is one of the invariants that
// would have to hold for that to be impossible; a future edit that
// re-introduces a shortcut into zeroDisplay fails here.
//
// They cannot tell you the screen renders correctly, that the retry
// works, or that a real network failure behaves as intended. That was
// verified by reading.
//
// Run: npm run test:solve

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SOLVE = 'app/online-competition/[competitionId]/solve/[eventId]';
const page = fs.readFileSync(path.join(ROOT, SOLVE, 'page.tsx'), 'utf8');
const wait = fs.readFileSync(path.join(ROOT, SOLVE, '_components/ScrambleWaitStage.tsx'), 'utf8');

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
const count = (s, needle) => s.split(needle).length - 1;

console.log('\n  -- a stale scramble can never be displayed --');
{
  const fn = page.slice(page.indexOf('const fetchScramble'), page.indexOf('// THE WAIT'));
  ok('fetchScramble clears the scramble BEFORE requesting the next one',
    fn.indexOf("setScramble('')") !== -1 && fn.indexOf("setScramble('')") < fn.indexOf('await fetch('));
  ok('  ...and sets it only from the response', count(fn, 'setScramble(') === 2);
  // The old failure path. Its screen is guarded by `!competition`, so
  // mid-run it rendered nothing at all while the run marched on.
  ok('a scramble failure never routes to loadError', !fn.includes('setLoadError('));
  ok('  ...it sets scrambleError, which the wait stage shows', fn.includes('setScrambleError('));
  // A late reply from a superseded request must not overwrite the
  // scramble of an attempt already under way.
  ok('a superseded response is dropped', count(fn, 'if (superseded()) return;') === 2);
}

console.log('\n  -- the run cannot start recording without a scramble --');
{
  // zeroDisplay is what starts the MediaRecorder. Exactly two places may
  // enter it, and both require a scramble in hand.
  const intoZero = page.match(/setStage\([^)]*zeroDisplay/g) ?? [];
  ok('exactly two transitions into zeroDisplay', intoZero.length === 2, intoZero.join(' | '));
  ok('  ...the promotion effect, which requires a scramble',
    page.includes("if (stage === 'scrambleWait' && scramble) setStage('zeroDisplay');"));
  ok('  ...and cameraSetup, which falls back to the wait when there is none',
    page.includes("onDone={() => setStage(scramble ? 'zeroDisplay' : 'scrambleWait')}"));
  // The two places an attempt begins mid-run.
  const confirm = page.slice(page.indexOf('function handleEntryConfirm'), page.indexOf('function handleRedo'));
  const redo = page.slice(page.indexOf('function handleRedo'), page.indexOf('async function handleSubmit'));
  ok('handleEntryConfirm starts the next attempt on the WAIT stage',
    confirm.includes("setStage('scrambleWait')") && !confirm.includes("setStage('zeroDisplay')"));
  ok('handleRedo does the same', redo.includes("setStage('scrambleWait')") && !redo.includes("setStage('zeroDisplay')"));
  ok('the wait stage is rendered', page.includes("{stage === 'scrambleWait' && ("));
  // An empty scramble is the whole of every wait stage; blanking the page
  // on it would hide the failure and the retry both.
  ok('the render guard no longer blanks the page on an empty scramble',
    page.includes('if (!competition || !runShape) {') && !page.includes('!competition || !scramble'));
}

console.log('\n  -- a mid-run failure must not unmount the run --');
{
  // Everything solved so far is a video blob in memory, uploaded only at
  // the end of the run. The blocked screen REPLACES the run and offers
  // only a link away, so it is for attempt 1 — which has nothing to lose
  // — and nothing else.
  const fn = page.slice(page.indexOf('const fetchScramble'), page.indexOf('// THE WAIT'));
  ok('the blocked screen is gated on attempt 1',
    fn.indexOf('if (attemptNumber > 1) {') < fn.indexOf('setBlockedMessage(body.message)'));
  ok('  ...and a mid-run refusal keeps the server’s own wording',
    fn.includes('body.message ||'));
  ok('the wait stage offers NO way off the page', !/href|next\/link/i.test(wait));
  ok('  ...and says what is at stake', wait.includes('recordedAttempts > 0'));
  ok('  ...and offers a retry', wait.includes('onRetry'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
