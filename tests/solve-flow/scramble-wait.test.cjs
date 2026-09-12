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
  // The request goes through authedFetch now (it carries the athlete's
  // verified token), so this looks for that call rather than a bare fetch.
  ok('fetchScramble clears the scramble BEFORE requesting the next one',
    fn.indexOf("setScramble('')") !== -1 &&
      fn.indexOf("setScramble('')") < fn.indexOf('await authedFetchWithRetry('));
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
  // zeroDisplay is what starts the MediaRecorder. The gate is no longer
  // at the press that begins an attempt — that press cannot fail, and
  // asking it about the scramble is what made the wait screen flash for
  // a frame. It is at the intro's EXIT, one step before the recording.
  //
  // So the invariant is: four ways in, none of which consults the
  // scramble; and every transition onto the recording guarded by it.
  // THREE, not four: the wait's promotion used to route back through the
  // intro and now lands on the recording directly, because reaching the
  // wait at all means the intro has already been spent.
  const intoIntro = page.match(/setStage\([^)]*attemptIntro/g) ?? [];
  ok('exactly three transitions into attemptIntro', intoIntro.length === 3, intoIntro.join(' | '));
  ok('  ...none of which asks whether the scramble has arrived',
    !/setStage\(scramble \? 'attemptIntro'/.test(page));
  // THE RECORDING BOUNDARY. Two transitions reach it now — the intro's
  // exit and the wait's promotion — and BOTH are conditional on the
  // scramble. The start effect is still keyed on that stage alone, so
  // the intro itself is not recorded.
  const intoZero = page.match(/setStage\([^)]*zeroDisplay/g) ?? [];
  // Both of them, named exactly: the intro's guarded exit, and the wait's
  // promotion — which is itself inside `if (scramble)`, checked below.
  ok('  ...and exactly two transitions into zeroDisplay, both guarded',
    intoZero.length === 2 &&
      intoZero.includes("setStage(scramble ? 'zeroDisplay") &&
      intoZero.includes("setStage('zeroDisplay") &&
      /if \(scramble\) setStage\('zeroDisplay'\);/.test(page),
    intoZero.join(' | '));
  ok('  ...one being the intro finishing WITH a scramble in hand',
    /<AttemptIntroStage[\s\S]{0,200}?onDone=\{\(\) => setStage\(scramble \? 'zeroDisplay' : 'scrambleWait'\)\}/.test(page));
  ok('  ...and the clip still begins on zeroDisplay, not on the intro',
    /useEffect\(\(\) => \{\s*\n\s*if \(stage === 'zeroDisplay'\) \{[\s\S]{0,400}?startRecording\(\)/.test(page) &&
      !/stage === 'attemptIntro'[\s\S]{0,200}?startRecording/.test(page));
  // The other. It lands straight on the recording rather than replaying
  // the intro: reaching this screen MEANS the intro's five seconds have
  // already been spent, so a second beat would be one the athlete has
  // had.
  ok('  ...the promotion effect, which requires a scramble',
    /if \(stage !== 'scrambleWait'\) return;[\s\S]{0,800}?if \(scramble\) setStage\('zeroDisplay'\);/.test(page));
  // A FETCH THAT RESOLVES QUICKLY NEVER PAINTS. The wait screen is only
  // reachable from the end of the intro, so it cannot appear until the
  // fetch has had the intro's full five seconds to land — except when
  // it has ALREADY failed, which is not a wait and is shown at once.
  ok('  ...so the press only reaches the wait on an error already in hand',
    (page.match(/setStage\(scrambleError \? 'scrambleWait' : 'attemptIntro'\)/g) ?? []).length === 2);
  ok('  ...the lobby, which goes to the intro regardless',
    page.includes("onStart={() => setStage(scrambleError ? 'scrambleWait' : 'attemptIntro')}"));
  // The between screen's button, which starts every attempt after the
  // first. Same fallback, same reason: handleEntryConfirm fetched this
  // attempt's scramble when the previous one ended, so it is normally
  // already in hand -- but if it is not, the run waits rather than
  // recording without one.
  ok('  ...and the between screen, which does the same', (() => {
    const next = page.slice(page.indexOf('onNext={() => {'), page.indexOf('/* Manual retry.'));
    return next.includes("setStage(scrambleError ? 'scrambleWait' : 'attemptIntro');") &&
      next.includes("setStage('summary');");
  })());
  // Restarting an attempt whose recording failed. It re-enters the attempt
  // it was already in, on the scramble that attempt was given — no fetch,
  // so nothing can have cleared it.
  // (It also clears the recording of the attempt being restarted —
  // changeset 2 put the blob in state, and a restarted attempt starts with
  // none in hand.)
  ok('  ...and the recording-failure restart, which replays the same attempt',
    /setRecordingFailure\(null\);\s*\n\s*setPendingBlob\(null\);[\s\S]{0,400}?setStage\('attemptIntro'\);/.test(page));
  // The two places an attempt begins mid-run.
  const confirm = page.slice(page.indexOf('function handleEntryConfirm'), page.indexOf('// NO REDO.'));
  // It no longer starts the next attempt at all: it ends on the between
  // screen, which is where the athlete chooses to go again. What has not
  // changed is the thing this was guarding -- handleEntryConfirm never
  // enters the recording stage directly.
  ok('handleEntryConfirm ends the attempt on the BETWEEN stage',
    confirm.includes("setStage('between')") && !confirm.includes("setStage('zeroDisplay')"));
  // The third route in is the recording-failure restart; the run has no
  // other way to re-enter an attempt now that redo is gone.
  ok('there is no redo to re-enter the run through',
    !page.includes('handleRedo') && !page.includes('onRedo'));
  ok('the wait stage is rendered', page.includes("{stage === 'scrambleWait' && ("));
  // An empty scramble is the whole of every wait stage; blanking the page
  // on it would hide the failure and the retry both.
  ok('the render guard no longer blanks the page on an empty scramble',
    page.includes('if (!competition || !runShape) {') && !page.includes('!competition || !scramble'));
}

console.log('\n  -- a mid-run failure must not unmount the run --');
{
  // The blocked screen REPLACES the run and offers only a link away. Even
  // with attempts filed as they are recorded, the run in progress is not
  // resumable after leaving — so it is for attempt 1, which has nothing to
  // lose, and nothing else.
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
