// ── Protecting a run in progress ────────────────────────────────────────
// SOURCE ASSERTIONS, NOT BEHAVIOUR — the same limitation as
// scramble-wait.test.cjs, and for the same reason: this project has no
// React test tooling of any kind (no jest, vitest, testing-library or
// jsdom), so the solve flow cannot be rendered, and neither
// `beforeunload`, a history pop, nor a dead MediaRecorder can be
// simulated. Everything below is a grep.
//
// They cover two of the three changes in this pass. The third — the
// deterministic submission id — is a pure function and IS really tested,
// in tests/competition-fields/submission-id.test.cjs.
//
// What a run holds: every solved attempt is a video blob in memory,
// uploaded only when the whole run is submitted. Leaving the page throws
// them away, and an attempt that records nothing wastes the athlete's
// solve. These pin the guards that now stand in front of both.
//
// Run: npm run test:solve

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SOLVE = 'app/online-competition/[competitionId]/solve/[eventId]';
const page = fs.readFileSync(path.join(ROOT, SOLVE, 'page.tsx'), 'utf8');
const failed = fs.readFileSync(path.join(ROOT, SOLVE, '_components/RecordingFailedStage.tsx'), 'utf8');
const components = fs
  .readdirSync(path.join(ROOT, SOLVE, '_components'))
  .filter((f) => f.endsWith('.tsx'));

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

console.log('\n  -- 1. leaving a run in progress --');
{
  ok('a run is "at risk" from the first solved attempt until it is sent',
    page.includes("const runAtRisk = attempts.length > 0 && stage !== 'sent';"));
  ok('the guard is installed only while it is at risk',
    /if \(!runAtRisk\) return;/.test(page) && /\}, \[runAtRisk\]\);/.test(page));
  // Reload, tab close, hard navigation.
  ok('beforeunload is registered', page.includes("window.addEventListener('beforeunload', onBeforeUnload)"));
  ok('  ...and preventDefault + returnValue are both set (browsers differ)',
    /e\.preventDefault\(\);\s*\n\s*e\.returnValue = '';/.test(page));
  ok('  ...and removed again when the run is no longer at risk',
    page.includes("window.removeEventListener('beforeunload', onBeforeUnload)"));
  // Back, which in a Next app is a client-side navigation: beforeunload
  // never fires for it, so it needs its own guard.
  ok('popstate is guarded too', page.includes("window.addEventListener('popstate', onPopState)"));
  ok('  ...with a spare history entry to absorb the first Back',
    page.includes("window.history.pushState(window.history.state, '', window.location.href)"));
  // Popping an entry whose state the Next router does not recognise can
  // make it fall back to a full page load — which would destroy the run
  // this is protecting.
  ok('  ...carrying the router’s own state, never null',
    !/pushState\(\s*(null|\{)/.test(page));
  ok('  ...and declining re-arms it', (page.match(/pushState\(window\.history\.state/g) ?? []).length === 2);
  ok('confirming leaves without asking twice',
    page.includes('leaving = true') && page.includes('window.history.back()'));
  // Our own wording, in Mongolian, for the one dialog we control.
  ok('the confirm names the number of attempts at stake',
    /function leaveConfirmMessage\(recordedAttempts: number\)/.test(page) &&
      page.includes('${recordedAttempts} оролдлого'));
  ok('  ...and says they will have to be redone', page.includes('дахин хийх шаардлагатай болно'));
  ok('the in-app link on this page is guarded by the same confirm',
    /onClick=\{\(e\) => \{\s*\n\s*if \(runAtRisk && !window\.confirm\(leaveConfirmMessage\(attempts\.length\)\)\) e\.preventDefault\(\);/.test(page));
  // beforeunload does not fire for a client-side <Link>, so a new one
  // anywhere in the flow would be an unguarded exit.
  {
    const withLinks = components.filter((f) =>
      /from 'next\/link'/.test(fs.readFileSync(path.join(ROOT, SOLVE, '_components', f), 'utf8')));
    ok('no stage component can navigate away except SentStage (after the run is filed)',
      withLinks.join(',') === 'SentStage.tsx', withLinks.join(',') || 'none');
  }
}

console.log('\n  -- 2. an empty recording is not accepted --');
{
  ok('startRecording’s return value decides whether the attempt proceeds',
    page.includes("if (!recorder.startRecording()) setRecordingFailure('start');"));
  ok('a failure moves the run to its own stage, not onward',
    page.includes("if (recordingFailure !== null) setStage('recordingFailed');"));
  // Started, ran, and produced an empty container anyway.
  ok('the finished blob is checked before the attempt is accepted',
    /if \(blob\.size < MIN_RECORDING_BYTES\) \{\s*\n\s*setRecordingFailure\('empty'\);\s*\n\s*return;/.test(page));
  ok('  ...and the blob is only kept when it passes',
    page.indexOf('setRecordingFailure(\'empty\')') < page.indexOf('pendingBlobRef.current = blob;'));
  ok('the threshold is 1KB', /const MIN_RECORDING_BYTES = 1024;/.test(page));
  ok('the stage is rendered', page.includes("{stage === 'recordingFailed' && recordingFailure !== null && ("));
  // The stream that just failed is still an object, so requestCamera
  // would no-op on it.
  ok('reconnecting releases the dead stream first',
    /recorder\.releaseCamera\(\);\s*\n\s*void recorder\.requestCamera\(\);/.test(page));
  ok('restarting replays the SAME attempt from the top',
    /setRecordingFailure\(null\);\s*\n\s*setStage\('zeroDisplay'\);/.test(page));
  ok('the athlete can see the camera before restarting', failed.includes('<video ref={videoRef}'));
  ok('  ...and cannot restart until there is one', failed.includes('disabled={!hasCamera}'));
  ok('the screen offers no way off the page', !/href|next\/link/i.test(failed));
  ok('  ...and says the recorded attempts are still here', failed.includes('recordedAttempts > 0'));
}

console.log('\n  -- 3. a retry resumes instead of restarting --');
{
  const submit = page.slice(page.indexOf('async function handleSubmit'), page.indexOf('// ── Gates: auth'));
  ok('attempts already filed this session are skipped',
    submit.includes('if (filedAttemptsRef.current.has(attemptNumber)) {'));
  ok('  ...before the upload, not after it',
    submit.indexOf('filedAttemptsRef.current.has') < submit.indexOf('uploadVideoToCloudinary'));
  ok('  ...and their progress still reads as done',
    /filedAttemptsRef\.current\.has\(attemptNumber\)\) \{\s*\n\s*perAttemptProgress\[i\] = 100;/.test(submit));
  // An upload that succeeded and a file that did not must still retry.
  ok('an attempt is marked filed only after the write lands',
    submit.indexOf('await createSubmission(') < submit.indexOf('filedAttemptsRef.current.add(attemptNumber)'));
  ok('a redo clears the set — a new run must upload its own videos',
    page.includes('filedAttemptsRef.current = new Set();'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
