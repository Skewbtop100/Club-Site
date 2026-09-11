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
// What a run holds: each attempt is uploaded and filed the moment it is
// recorded, so at most ONE video is in memory at a time — but that one
// exists nowhere else, an attempt that records nothing wastes the
// athlete's solve, and a run cannot yet be resumed after leaving. These
// pin the guards that stand in front of all three.
//
// Run: npm run test:solve

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SOLVE = 'app/online-competition/[competitionId]/solve/[eventId]';
const page = fs.readFileSync(path.join(ROOT, SOLVE, 'page.tsx'), 'utf8');
const failed = fs.readFileSync(path.join(ROOT, SOLVE, '_components/RecordingFailedStage.tsx'), 'utf8');
const filing = fs.readFileSync(path.join(ROOT, SOLVE, '_components/FilingStage.tsx'), 'utf8');
const summary = fs.readFileSync(path.join(ROOT, SOLVE, '_components/SummaryStage.tsx'), 'utf8');
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
  // Our own wording, in Mongolian, for the one dialog we control. It has
  // two truths to tell apart now: the unfiled attempt is lost, and the
  // round cannot be continued either way (resume is PR-3).
  ok('the confirm counts the UNFILED attempts, not every attempt',
    /function leaveConfirmMessage\(unfiledAttempts: number\)/.test(page) &&
      page.includes('${unfiledAttempts} оролдлого'));
  ok('  ...says the unfiled recording is lost', page.includes('тэр бичлэг устах'));
  ok('  ...and that the round cannot be continued', page.includes('үргэлжлүүлэх боломжгүй'));
  ok('  ...while saying the filed ones survive', page.includes('хэвээр үлдэнэ'));
  ok('the in-app link on this page is guarded by the same confirm',
    page.includes('if (runAtRisk && !window.confirm(leaveConfirmMessage(unfiledCount))) e.preventDefault();'));
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

console.log('\n  -- 3. each attempt is filed as it is recorded --');
{
  const confirm = page.slice(page.indexOf('function handleEntryConfirm'), page.indexOf('// NO REDO.'));
  const worker = page.slice(page.indexOf('const pumpFiling'), page.indexOf('const enqueueFiling'));
  const finish = page.slice(page.indexOf('async function handleFinish'), page.indexOf('// ── Gates: auth'));

  // The whole point: the recording goes as soon as it exists, and the run
  // does not wait for it.
  ok('a solved attempt goes straight into the filing queue', confirm.includes('enqueueFiling(index, {'));
  ok('  ...unawaited — the athlete moves on to the next attempt',
    !/await enqueueFiling|await pumpFiling/.test(page));
  ok('  ...and the run ends at the filing stage, never straight at the summary',
    confirm.includes("setStage('filing')") && !confirm.includes("setStage('summary')"));

  // One connection, one attempt, in order.
  ok('the queue is single-flight', worker.includes('if (filingBusyRef.current) return;'));
  ok('  ...worked from the head', worker.includes('const index = filingQueueRef.current[0];'));
  ok('  ...which only moves on once the write has landed',
    worker.indexOf('await createSubmission(') < worker.lastIndexOf('filingQueueRef.current.shift();'));

  // THE POINT OF THE CHANGESET: the video is dropped once the server has it.
  ok('the blob is released the moment the attempt is filed',
    worker.includes('pendingUploadsRef.current.delete(index);'));
  ok('  ...only after the submission write resolved',
    worker.indexOf('await createSubmission(') < worker.indexOf('pendingUploadsRef.current.delete(index);'));
  ok('  ...and what is kept is the time, the DNF flag and the id',
    /fileState: 'filed', uploadPercent: 100, submissionId, fileError: null/.test(worker));
  ok('the recording is never held in React state', !/videoBlob/.test(page));

  // Retry: once on its own, then it asks.
  ok('one automatic retry, then the athlete decides', page.includes('const FILING_AUTO_RETRIES = 1;'));
  ok('  ...scheduled on a timer that is cleared on unmount',
    worker.includes('filingRetryTimerRef.current = setTimeout(') &&
      page.includes('if (filingRetryTimerRef.current) clearTimeout(filingRetryTimerRef.current);'));
  ok('  ...and a conflict never auto-retries (it can never come good)',
    worker.includes('if (!conflict && spent < FILING_AUTO_RETRIES)'));
  ok('the manual retry is the filing screen’s only action',
    page.includes('void pumpFiling();') && filing.includes('onRetry'));
  ok('  ...and that screen offers no way off the page', !/href|next[/]link/i.test(filing));

  // The run stops before it can pile up unfiled recordings.
  ok('a filing that gave up blocks the next attempt before it records',
    /if \(filingFailed\) \{\s*\n\s*setStage\('filing'\);/.test(page));
  ok('the summary is unreachable while anything is unfiled',
    /if \(stage !== 'filing'\) return;\s*\n\s*if \(unfiledCount > 0\) return;/.test(page));

  // Finish uploads nothing.
  ok('handleFinish sends no video', !finish.includes('uploadVideoToCloudinary'));
  ok('  ...and files no submission', !finish.includes('createSubmission'));
  ok('  ...it writes the run result and moves to the sent screen',
    finish.includes('await recordAo5Result(') && finish.includes("setStage('sent')"));
  ok('  ...refusing to finish a run with an unfiled attempt',
    finish.includes("attempts.some((a) => a.fileState !== 'filed')"));

  // Redo is gone, everywhere.
  ok('no redo in the page', !page.includes('handleRedo') && !page.includes('onRedo'));
  // Code, not prose: the comment that replaced the button explains what
  // it was, and would otherwise fail its own assertion.
  ok('  ...none in the summary screen either',
    !summary.includes('onRedo') && !summary.includes('oc-solve-btn-redo') && !/>\s*Дахин үзэх/.test(summary));
  ok('  ...and the confirm that used to offer it is gone',
    !summary.includes('Бүх бичлэгийг устгаад дахин эхлэх үү?'));
  ok('the aggregate upload progress went with the end-of-run loop',
    !page.includes('submitProgress') && !summary.includes('submitProgress'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
