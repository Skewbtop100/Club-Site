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
// recorded, so at most ONE video is in memory at a time — and that one
// exists nowhere else. Everything before it is on the server and the run
// picks up from there on the next visit. These pin the guards in front of
// that one unfiled attempt, and in front of an attempt that records
// nothing.
//
// Run: npm run test:solve

const fs = require('node:fs');
const path = require('node:path');

/** Source with its comments removed. A comment explaining a removed
 *  string contains that string, and would fail the assertion that it is
 *  gone. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ROOT = path.join(__dirname, '..', '..');
const SOLVE = 'app/online-competition/[competitionId]/solve/[eventId]';
const page = fs.readFileSync(path.join(ROOT, SOLVE, 'page.tsx'), 'utf8');
const failed = fs.readFileSync(path.join(ROOT, SOLVE, '_components/RecordingFailedStage.tsx'), 'utf8');
const between = fs.readFileSync(path.join(ROOT, SOLVE, '_components/BetweenStage.tsx'), 'utf8');
const lobby = fs.readFileSync(path.join(ROOT, SOLVE, '_components/LobbyStage.tsx'), 'utf8');
const hold = fs.readFileSync(path.join(ROOT, SOLVE, '_components/CameraHoldStage.tsx'), 'utf8');
const rec = fs.readFileSync(path.join(ROOT, SOLVE, '_components/RecStage.tsx'), 'utf8');
const theme = fs.readFileSync(path.join(ROOT, 'app/online-competition/theme.css'), 'utf8');
const bar = fs.readFileSync(path.join(ROOT, SOLVE, '_components/SolveHeader.tsx'), 'utf8');
const summary = fs.readFileSync(path.join(ROOT, SOLVE, '_components/SummaryStage.tsx'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'lib/online-competition/data.ts'), 'utf8');
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
  // Resume changed what is at stake: only the attempt that has not
  // reached the server yet. Leaving with nothing in flight costs nothing,
  // so it no longer asks.
  ok('a run is "at risk" only while an attempt is unfiled',
    page.includes("const runAtRisk = unfiledCount > 0 && stage !== 'sent';"));
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
  ok('  ...says the unfiled recording is lost and must be redone',
    page.includes('тэр бичлэг устаж') && page.includes('дахин хийх шаардлагатай болно'));
  ok('  ...while saying the filed ones survive', page.includes('хэвээр үлдэнэ'));
  // The round CAN be continued now — the old copy said it could not.
  ok('  ...and no longer claims the round is over', !page.includes('үргэлжлүүлэх боломжгүй. Гарах уу?'));
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
  // Started, ran, and produced an empty container anyway. The check moved
  // with the stop (changeset 2) and lives in finishRecording now.
  ok('the finished blob is checked before the attempt is accepted',
    /if \(blob\.size < MIN_RECORDING_BYTES\) \{\s*\n\s*setRecordingFailure\('empty'\);\s*\n\s*return;/.test(page));
  ok('  ...and the blob is only kept when it passes',
    page.indexOf("setRecordingFailure('empty')") < page.indexOf('setPendingBlob(blob);'));
  ok('the threshold is 1KB', /const MIN_RECORDING_BYTES = 1024;/.test(page));
  ok('the stage is rendered', page.includes("{stage === 'recordingFailed' && recordingFailure !== null && ("));
  // The stream that just failed is still an object, so requestCamera
  // would no-op on it.
  ok('reconnecting releases the dead stream first',
    /recorder\.releaseCamera\(\);\s*\n\s*void recorder\.requestCamera\(\);/.test(page));
  ok('restarting replays the SAME attempt from the top',
    /setRecordingFailure\(null\);\s*\n\s*setPendingBlob\(null\);\s*\n\s*setStage\('zeroDisplay'\);/.test(page));
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
  ok('  ...and the run ends at the between stage, never straight at the summary',
    confirm.includes("setStage('between')") && !confirm.includes("setStage('summary')"));

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
  ok('the manual retry lives on the between screen',
    page.includes('void pumpFiling();') && between.includes('onRetry'));
  ok('  ...and that screen offers no way off the page', !/href|next[/]link/i.test(between));

  // The run stops before it can pile up unfiled recordings.
  ok('a filing that gave up blocks the next attempt before it records',
    /if \(filingFailed\) \{\s*\n\s*setStage\('between'\);/.test(page));
  // The effect that used to hold the run on the filing screen is gone --
  // between is left by pressing a button, not by a counter reaching zero.
  // The same guarantee is now that button's own disabled state.
  ok('the summary is unreachable while anything is unfiled',
    between.includes('const waitingToFinish = runComplete && unfiledCount > 0 && !filingFailed;') &&
      between.includes('disabled={waitingToFinish}'));

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

console.log('\n  -- 4. resuming a run --');
{
  const resume = page.slice(page.indexOf('// ── RESUME ─'), page.indexOf('}, [solverUid, runShape !== null]);'));

  // The read has to come first: the attempt number is a parameter of the
  // scramble request, so asking before planning would serve the wrong one.
  ok('the filed attempts are read before any scramble is fetched',
    resume.indexOf('fetchMyFiledAttempts(') < resume.indexOf('fetchScramble(plan.nextAttempt)'));
  ok('  ...with the proven single-filter query shape, filtered in memory',
    /where\('uid', '==', uid\)/.test(data) && data.includes('data.competitionId !== competitionId || data.event !== event'));
  ok('  ...alongside the live round from the same resolver the gate uses',
    resume.includes('/api/online-competition/round-access?competitionId='));
  ok('  ...and a lookup failure stops the run rather than starting it fresh',
    resume.includes('setBlockedMessage(') && resume.includes('Өмнөх оролдлогуудыг уншиж чадсангүй'));

  // The plan decides everything the run starts from.
  ok('the next attempt comes from the plan', resume.includes('setAttemptIndex(plan.nextAttempt - 1)'));
  ok('the round comes from the plan, not from a fresh gate call',
    resume.includes('setCompetitionRound(plan.competitionRound)'));
  ok('the prior attempts are rebuilt as already filed',
    resume.includes("fileState: 'filed' as const"));
  ok('a cut-off run comes back cut off', resume.includes('setCutOff(plan.cutOff)'));
  ok('a completed run goes straight to the summary',
    /plan\.kind === 'complete'[\s\S]{0,200}setStage\('summary'\)/.test(resume));
  ok('a closed round explains itself instead of scrambling',
    /plan\.kind === 'no-live-round'[\s\S]{0,600}setBlockedMessage\(/.test(resume));
  ok('  ...and points at the organiser when a run was left part-finished',
    resume.includes('Зохион байгуулагчтай холбогдоно уу'));

  // The scramble the athlete solves must belong to the round being filed.
  ok('a round that moved under the run refuses the scramble',
    page.includes("data.round !== competitionRound") && page.includes('Раунд өөрчлөгдсөн байна'));

  // One cutoff rule, used by the live run and the resumed one.
  ok('the live run evaluates the cutoff with the same shared function',
    page.includes('const failedCutoff = cutoffFailed('));
  ok('  ...and the page keeps no second copy of the attempt-time rule',
    !page.includes('function attemptTime(') && page.includes('resolveAttemptTime('));

  // Resuming looks identical to starting without this.
  ok('the athlete is told they are continuing', page.includes('{resumeMessage}'));
  ok('  ...and the notice clears once they solve something',
    page.includes('setResumeMessage(null);'));
}

console.log('\n  -- 5. the camera hold is ONE component --');
{
  // Steps 2, 5 and 9 of the new flow are all "preview, an instruction, a
  // tick bar, N seconds". Three copies of that timer would drift, and the
  // timer is what a judge measures the hold against.
  ok('CameraHoldStage is parameterised by seconds, label and instruction',
    /seconds: number;/.test(hold) && /label: string;/.test(hold) &&
      /instruction: \(seconds: number\) => string;/.test(hold));
  ok('  ...and OrientationHoldStage is gone',
    !fs.existsSync(path.join(ROOT, SOLVE, '_components/OrientationHoldStage.tsx')));
  // THE BAR IS THE CLOCK: one segment per second, from the same number
  // that sets the timeout. A duration cannot be changed without the bar
  // following it.
  ok('the tick bar is derived from `seconds`, not a second constant',
    hold.includes('Array.from({ length: seconds })') && hold.includes('setTimeout(onDone, seconds * 1000)'));
  ok('  ...filling one segment a second', hold.includes('Math.min(t + 1, seconds)'));
  // It is a clock and a preview. Nothing else.
  ok('it starts and stops no recording',
    !hold.includes('startRecording') && !hold.includes('stopRecording') && !hold.includes('recorder'));

  ok('the orientation hold keeps its stage name', page.includes("{stage === 'orientationHold' && ("));
  // All three holds — the timer at zero, the cube's orientation, the timer
  // at the finish — are the same component with the same clock.
  ok('all three holds come from the one component',
    (page.match(/<CameraHoldStage/g) ?? []).length === 3);
  // THREE DISTINCT LABELS. The two timer holds are the same component at
  // the same duration with nearly the same sentence; sharing a label too
  // left an athlete glancing at the screen unable to tell whether they
  // were before or after the solve.
  {
    const labels = (page.match(/label="([^"]+)"/g) ?? []).map((m) => m.slice(7, -1));
    ok('  ...each labelled for what it asks for', labels.length === 3 && new Set(labels).size === 3,
      labels.join(' | '));
    ok('  ...the timer holds say which side of the solve they are on',
      labels.includes('ЦАГАА ХАРУУЛ · ЭХЛЭХИЙН ӨМНӨ') && labels.includes('ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА'));
    ok('  ...and the cube hold keeps its own', labels.includes('ШООГОО БАЙРШУУЛ'));
  }
}

console.log('\n  -- 7. durations and markers --');
{
  // ONE NUMBER for every hold: the timer, the tick bar and the sentence
  // all read it.
  ok('the holds share a single duration constant', page.includes('const HOLD_SECONDS = 8;'));
  ok('  ...and every hold uses it',
    (page.match(/seconds=\{HOLD_SECONDS\}/g) ?? []).length === 3 && !/seconds=\{\d/.test(page));
  // THE DRIFT THE REFACTOR DID NOT FIX: the sentence names the duration,
  // so it is built from the same number rather than written beside it.
  ok('the instruction is a function of seconds, not a literal',
    hold.includes('instruction: (seconds: number) => string;') && hold.includes('{instruction(seconds)}'));
  ok('  ...and no call site writes the number into the sentence itself',
    (page.match(/instruction=\{\(sec\) =>/g) ?? []).length === 3 && !/\d+ секунд/.test(page));

  // THE OPENING HOLD is now the athlete's own timer, held to the camera —
  // with a preview to aim at, which the on-screen "0.00" never gave them.
  ok('the opening hold is a camera hold', !fs.existsSync(path.join(ROOT, SOLVE, '_components/ZeroDisplayStage.tsx')));
  // Four transitions since the between screen: the athlete presses to
  // begin each attempt now, so lobby and between both enter it.
  ok('  ...under the SAME stage name, so every transition still lands',
    page.includes("{stage === 'zeroDisplay' && (") && (page.match(/setStage\([^)]*zeroDisplay/g) ?? []).length === 4);
  ok('  ...showing the athlete their own timer at 0.00', /0\.00 дээр байхад нь камерт/.test(page));

  // THE MARKERS: colour, never sound, never anything readable.
  ok('three markers, at 8s, 12s and 15s',
    rec.includes('const MARKER_TIMES_MS = [8000, 12000, 15000];'));
  ok('  ...and the beeps are gone',
    !rec.includes('BEEP') && !rec.includes('onBeep') && !page.includes('playBeep'));
  ok('  ...expressed as the preview frame’s border colour',
    rec.includes('oc-solve-mark-${marker}') &&
      theme.includes('.oc-solve-camera-box-portrait.oc-solve-mark-1'));
  ok('  ...three steps of it', [1, 2, 3].every((n) => theme.includes(`.oc-solve-camera-box-portrait.oc-solve-mark-${n}`)));
  // THE SEQUENCE ESCALATES. Red is intrinsically darker than amber, so
  // "make the last one red" silently made it the weakest of the three.
  // Measured in relative luminance, not eyeballed.
  {
    const colourOf = (n) => {
      const at = theme.indexOf(`.oc-solve-camera-box-portrait.oc-solve-mark-${n} {`);
      const m = /border-color: (#[0-9A-Fa-f]{6})/.exec(theme.slice(at, at + 120));
      return m ? m[1] : null;
    };
    const lum = (hex) => {
      const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const l = [1, 2, 3].map((n) => lum(colourOf(n)));
    ok('  ...each marker at least as strong as the one before',
      l[0] < l[1] && l[1] <= l[2], l.map((x) => x.toFixed(4)).join(' < '));
    ok('  ...and the last one not a jump (within 1.5x of the previous)', l[2] / l[1] < 1.5,
      (l[2] / l[1]).toFixed(2));
  }
  ok('  ...faded, not snapped', theme.includes('transition: border-color 800ms ease;'));
  // Nothing the athlete could read, and nothing that moves: the marker
  // state drives a class name and nothing else.
  ok('the marker renders no text and no number',
    !/marker[^;]{0,80}(БАЙНА|секунд|\{marker\}<)/.test(rec) && (rec.match(/marker/g) ?? []).length <= 6);
  const recCode = rec.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('nothing audio-shaped was added near the recorder',
    !/audio/i.test(recCode) && !/oscillator/i.test(recCode) && !recCode.includes('playBeep'));

  // NOT IN THIS DIFF.
  ok('the recording boundary is untouched: starts at zeroDisplay',
    page.includes("if (stage === 'zeroDisplay') {"));
  ok('  ...and still stops after the closing hold, not at the solve',
    page.includes("onFinish={() => setStage('finishHold')}") &&
      page.includes('async function finishRecording'));
  ok('no instructions stage was added', !page.includes("'instructions'"));
  ok('resume is untouched: a complete run still lands on the summary',
    /plan\.kind === 'complete'[\s\S]{0,200}setStage\('summary'\)/.test(page));
}

console.log('\n  -- 6. the recording stops AFTER the closing hold --');
{
  // The clip used to end the instant the solve did. The reading on the
  // athlete's own timer is the evidence for the number they type next, so
  // it has to be on the same continuous video as the solve.
  ok('the solve’s end button only changes stage — it stops nothing',
    page.includes("onFinish={() => setStage('finishHold')}"));
  // (Changeset 3 folded FINISH_HOLD_SECONDS into the one HOLD_SECONDS
  // every hold shares.)
  ok('the closing hold is 8 seconds of CameraHoldStage',
    page.includes('const HOLD_SECONDS = 8;') && page.includes('seconds={HOLD_SECONDS}'));
  // A stage missing from HEADER_STAGES loses the header and the attempt
  // pips silently, mid-attempt.
  ok('  ...and it is in ATTEMPT_STAGES', /'rec',\s*\n\s*'finishHold',/.test(page));

  // THE INVARIANT THAT MATTERS MOST: the stop, the size check and the
  // handoff are one function, in one order. Splitting them is how an
  // attempt gets filed with no video.
  const finish = page.slice(page.indexOf('async function finishRecording'), page.indexOf('function handleEntryConfirm'));
  ok('stopRecording, the size check and the handoff are ONE function',
    finish.includes('await recorder.stopRecording()') &&
      finish.includes('blob.size < MIN_RECORDING_BYTES') &&
      finish.includes('setPendingBlob(blob)'));
  ok('  ...in that order', finish.indexOf('stopRecording') < finish.indexOf('MIN_RECORDING_BYTES') &&
    finish.indexOf('MIN_RECORDING_BYTES') < finish.indexOf('setPendingBlob(blob)'));
  ok('  ...and the keypad is entered from the same place, after the blob',
    finish.indexOf('setPendingBlob(blob)') < finish.indexOf("setStage('entry')"));
  ok('  ...with an empty recording never reaching it',
    finish.indexOf("setRecordingFailure('empty')") < finish.indexOf('setPendingBlob(blob)'));

  // STRUCTURAL, not sequential: the keypad cannot render without a
  // recording, and confirming takes one as a required argument.
  ok('the keypad cannot render without a recording',
    page.includes("{stage === 'entry' && pendingBlob && ("));
  ok('  ...and hands it to the confirm', page.includes('handleEntryConfirm(result, pendingBlob)'));
  ok('  ...which requires it as an argument', /function handleEntryConfirm\([\s\S]{0,600}?blob: Blob,\s*\n\s*\) \{/.test(page));
  // The fallback that would have filed a 0-byte video is gone, along with
  // the ref that could be read as null.
  const code = page.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the `?? new Blob` fallback is gone', !code.includes('new Blob('));
  ok('  ...and so is the ref it guarded', !page.includes('pendingBlobRef'));
  ok('the blob is cleared with the attempt it belonged to', page.includes('setPendingBlob(null);'));

  // NOT IN THIS DIFF. Each is its own changeset; a short video afterwards
  // must have exactly one suspect.
  ok('the recording still starts at the opening hold', page.includes("if (stage === 'zeroDisplay') {"));
  ok('no instructions stage was added', !page.includes("'instructions'"));
  ok('resume is untouched: a complete run still lands on the summary',
    /plan\.kind === 'complete'[\s\S]{0,200}setStage\('summary'\)/.test(page) && !/plan[\s\S]{0,400}finishHold/.test(page));
}

console.log('\n  -- 8. the competition environment --');
{
  // A fixed takeover, not a page in the site: the run is a room the
  // athlete is inside, and the only way out is the bar's own ГАРАХ.
  ok('the run is a full-screen takeover',
    /\.oc-solve-takeover \{[\s\S]{0,200}?position: fixed;[\s\S]{0,200}?z-index: 200;/.test(theme));
  ok('  ...over the mockup’s ground', /\.oc-solve-takeover \{[\s\S]{0,200}?background: #08080A;/.test(theme));
  ok('  ...and every screen of the run wears it',
    !page.includes('className="oc-solve-page"') &&
      (page.match(/className="oc-solve-takeover"/g) ?? []).length === 6);
  ok('the body scrolls, the bar does not',
    /\.oc-solve-body \{[\s\S]{0,220}?overflow-y: auto;/.test(theme) &&
      /\.oc-solve-bar \{[\s\S]{0,120}?flex: none;[\s\S]{0,120}?height: 56px;/.test(theme));

  // THE BAR IS UNCONDITIONAL. It used to appear on ten stages of thirteen.
  ok('the bar renders once, outside every stage condition',
    (page.match(/<SolveHeader/g) ?? []).length === 1 && !page.includes('ATTEMPT_STAGES.includes(stage) && (\n        <SolveHeader'.replace('\n', String.fromCharCode(10))));
  // ...but the claim about an attempt is not.
  ok('the attempt label and pips only appear inside an attempt',
    page.includes('ATTEMPT_STAGES.includes(stage)') && bar.includes('{attempt && ('));
  ok('  ...so the summary and the sent screen make no claim about one',
    !page.includes("'summary',") && !page.includes("'sent',"));

  // ГАРАХ is the leave guard with a button on it.
  ok('ГАРАХ asks the same question a browser Back does',
    /function exitRun\(\) \{[\s\S]{0,200}?runAtRisk && !window\.confirm\(leaveConfirmMessage\(unfiledCount\)\)/.test(page));
  ok('  ...and only then leaves', /exitRun[\s\S]{0,260}?router\.push\(/.test(page));
  // ЗОГСООХ: rendered, inert, and honest about it. Pausing is only ever
  // safe on a stage with no recording running.
  ok('ЗОГСООХ is disabled, not implemented', /ЗОГСООХ/.test(bar) && /disabled\s*\n\s*title=/.test(bar));
  ok('  ...and says so on hover', bar.includes('удахгүй нэмэгдэнэ'));
  ok('  ...and looks inert', theme.includes('.oc-solve-bar-btn:disabled'));

  // The two banners that used to live in the header. A fixed 56px row has
  // no second line to give them.
  ok('the filing indicator and the resume notice moved into the body',
    page.includes('oc-solve-banner-quiet') && page.includes('className="oc-solve-banner"'));
  ok('  ...above the stage, inside the scrolling column',
    page.indexOf('oc-solve-banner') < page.indexOf("{stage === 'lobby'"));

  // 375px: six elements do not fit one row. What goes, goes in order of
  // what it carries — and never the way out.
  ok('the narrow bar drops the badge and the attempt label',
    /@media \(max-width: 620px\)[\s\S]{0,400}?\.oc-solve-bar-badge,[\s\S]{0,80}?display: none;/.test(theme) &&
      /@media \(max-width: 460px\)[\s\S]{0,400}?\.oc-solve-bar-attempt \{[\s\S]{0,40}?display: none;/.test(theme));
  ok('  ...and the competition name, keeping the event and the round',
    bar.includes('oc-solve-bar-comp') &&
      /@media \(max-width: 460px\)[\s\S]{0,200}?\.oc-solve-bar-comp \{[\s\S]{0,40}?display: none;/.test(theme));
  ok('  ...but never the two buttons', !/@media[\s\S]*?\.oc-solve-bar-btn \{[\s\S]{0,60}?display: none/.test(theme));

  // NOT IN THIS DIFF: layout only.
  ok('no stage was added or removed', (page.match(/^  \| '[a-zA-Z]+'/gm) ?? []).length === 13);
  ok('the recording boundary is untouched',
    page.includes("if (stage === 'zeroDisplay') {") &&
      page.includes("onFinish={() => setStage('finishHold')}") &&
      page.includes('async function finishRecording'));
  ok('the holds are untouched: three of them, 8 seconds',
    page.includes('const HOLD_SECONDS = 8;') && (page.match(/<CameraHoldStage/g) ?? []).length === 3);
  ok('the markers are untouched: 8s, 12s, 15s',
    rec.includes('const MARKER_TIMES_MS = [8000, 12000, 15000];'));
  ok('resume is untouched: a complete run still lands on the summary',
    /plan\.kind === 'complete'[\s\S]{0,200}setStage\('summary'\)/.test(page));
}

console.log('\n  -- 9. the lobby and the between screen --');
{
  // TWO STAGES ABSORBED, not hidden. cameraSetup existed only to ask for
  // the camera; filing existed only to say "wait". Both jobs belong to a
  // screen the athlete was going to be standing on anyway.
  ok('cameraSetup is gone, file and all',
    !fs.existsSync(path.join(ROOT, SOLVE, '_components/CameraSetupStage.tsx')));
  ok('filing is gone, file and all',
    !fs.existsSync(path.join(ROOT, SOLVE, '_components/FilingStage.tsx')));
  ok('  ...and neither stage name survives anywhere in the page',
    !page.includes("'cameraSetup'") && !page.includes("'filing'"));
  ok('  ...nor as a render branch',
    !page.includes("stage === 'cameraSetup'") && !page.includes("stage === 'filing'"));
  ok('the run still has thirteen stages', (page.match(/^  \| '[a-zA-Z]+'/gm) ?? []).length === 13);
  ok('  ...two of them new', page.includes("| 'lobby'") && page.includes("| 'between'"));

  // ── LOBBY ──
  ok('the run opens on the lobby', page.includes("useState<Stage>('lobby')"));
  ok('  ...which asks for the camera itself', lobby.includes('void onRequestCamera();'));
  ok("  ...keeps cameraSetup's gate: no stream, no start",
    lobby.includes('className="oc-solve-lobby-go" disabled={!hasCamera}'));
  ok('  ...and keeps its reconnect path',
    lobby.includes('onRequestCamera()') && lobby.includes('Камерыг дахин холбох'));
  // Neither lobby nor between is inside an attempt, so the bar makes no
  // claim about one on either.
  ok('  ...and the bar claims no attempt on it', (() => {
    const list = page.slice(page.indexOf('const ATTEMPT_STAGES'), page.indexOf('/** Below this, the file is not'));
    return !list.includes("'lobby'") && !list.includes("'between'");
  })());

  // THE COPY. The mockup promises the remaining attempts are void if you
  // leave; this platform files each attempt as it is recorded and resumes
  // at the next. Keeping the mockup's line would keep an athlete solving
  // on a dying battery rather than stopping.
  // Comment-stripped: both files explain in a comment what the mockup's
  // wording was and why it went, which would otherwise fail its own
  // assertion. What must not survive is the CLAIM, not the note about it.
  const lobbyCode = stripComments(lobby);
  const betweenCode = stripComments(between);
  ok('the lobby never claims the remaining attempts are void', !lobbyCode.includes('хүчингүй'));
  ok('  ...it says attempts are saved as they are recorded',
    lobby.includes('бичигдмэгцээ шууд хадгалагдана'));
  ok('  ...and that leaving and returning continues the run',
    lobby.includes('Завсарлах шаардлага гарвал') && lobby.includes('үргэлжлүүлнэ'));

  // RESUME LANDS HERE. Attempt 3 of 5 must not read like attempt 1.
  ok('the lobby knows it is a resume', lobby.includes('const resuming = filedAttempts > 0;'));
  ok('  ...so the heading is not "five in one sitting"',
    lobby.includes("resuming ? 'Үлдсэн оролдлогоо үргэлжлүүл'"));
  ok('  ...and the button names the attempt it starts',
    lobby.includes('`${nextAttempt}-р оролдлогоо эхлэх`'));
  ok('  ...fed from what the server said is already filed',
    page.includes('filedAttempts={attempts.length}') && page.includes('nextAttempt={attempts.length + 1}'));
  // The specifics stay in ONE sentence — the resume banner, rendered above
  // every stage, which is the only place that counts attempts in prose.
  ok('  ...while the numbers stay in the resume banner',
    !lobby.includes('resumeMessage') && page.includes('{resumeMessage && ('));

  // ── BETWEEN ──
  ok('the between screen shows the whole run, not just what was solved',
    page.includes('const slotRows: SlotRow[] = Array.from({ length: slotCount }') &&
      between.includes("state: 'pending' | 'queued' | 'uploading' | 'retrying' | 'filed' | 'failed';"));
  ok('  ...and a cut-off run is as long as it got',
    page.includes('const slotCount = cutOff ? attempts.length : runShape.attempts;'));
  ok('  ...every state has a word',
    ['ХАДГАЛСАН', 'ДАХИН', 'ЭЭЛЖИНД', 'АЛДАА', 'ОДОО', 'ХҮЛЭЭГДЭЖ'].every((w) => between.includes(w)));
  ok('  ...and an uploading slot shows its percentage', between.includes('`${s.uploadPercent}%`'));
  // The mockup's slots read ИЛГЭЭГДЭЭГҮЙ because in its model nothing was
  // filed until the end. Here a recorded attempt IS submitted.
  ok('  ...but no slot says "not submitted"', !betweenCode.includes('ИЛГЭЭГДЭЭГҮЙ'));
  ok('  ...and none of its copy claims the rest are void', !betweenCode.includes('хүчингүй'));

  // MID-RUN THE UPLOAD RUNS BEHIND THE ATHLETE. That is the whole point of
  // filing per attempt, and blocking here would hand it back.
  ok('an in-flight upload does not block the next attempt',
    between.includes('const waitingToFinish = runComplete && unfiledCount > 0 && !filingFailed;'));
  // ...with two exceptions, both of which predate this changeset.
  ok('  ...but a FAILED filing does, before the next attempt records',
    between.includes('onClick={filingFailed ? onRetry : onNext}'));
  ok('  ...and so does the end of the run', between.includes('disabled={waitingToFinish}'));
  ok('  ...so the summary is only reached with everything filed',
    /onNext=\{\(\) => \{\s*\n\s*if \(runComplete\) \{\s*\n\s*setStage\('summary'\);/.test(page));

  // ── the mockup's literal values ──
  ok("the lobby is the mockup's 620px column",
    /\.oc-solve-lobby \{[\s\S]{0,200}?max-width: 620px;[\s\S]{0,120}?gap: 24px;/.test(theme));
  ok('  ...with its 200px camera beside the rules',
    /\.oc-solve-lobby-panel \{[\s\S]{0,200}?grid-template-columns: 200px 1fr;/.test(theme));
  ok("the between screen is the mockup's 520px column",
    /\.oc-solve-between \{[\s\S]{0,200}?max-width: 520px;[\s\S]{0,120}?gap: 22px;/.test(theme));
  ok('  ...five slots across, always',
    /\.oc-solve-slots \{[\s\S]{0,120}?grid-template-columns: repeat\(5, 1fr\);/.test(theme));
  ok("  ...the mockup's card",
    /\.oc-solve-slot \{[\s\S]{0,300}?padding: 16px 8px;[\s\S]{0,200}?min-height: 104px;/.test(theme));
  ok('  ...and its 16x2 marker, olive when done',
    /\.oc-solve-slot-mark \{[\s\S]{0,120}?width: 16px;[\s\S]{0,60}?height: 2px;/.test(theme) &&
      /\.oc-solve-slot-mark-done \{[\s\S]{0,60}?background: #3A4614;/.test(theme));
  ok('both screens end on the same volt button',
    /\.oc-solve-lobby-go,\s*\n\.oc-solve-between-go \{[\s\S]{0,300}?background: #DFFF4F;/.test(theme));

  // 375px: 200px of camera leaves 142px for four rules, and five 17px
  // times do not fit 62px cards.
  ok('the lobby panel stacks on a narrow screen',
    /\.oc-solve-lobby-panel \{\s*\n\s*grid-template-columns: 1fr;/.test(theme));
  ok('  ...and the slot row tightens rather than wrapping',
    /\.oc-solve-slot-time \{\s*\n\s*font-size: 13px;/.test(theme) &&
      !/\.oc-solve-slots \{[\s\S]{0,120}?repeat\(3/.test(theme));

  // NOT IN THIS DIFF.
  ok('the recording boundary did not move',
    page.includes("onFinish={() => setStage('finishHold')}") && page.includes('async function finishRecording'));
  ok('the three holds did not move',
    page.includes('const HOLD_SECONDS = 8;') && (page.match(/<CameraHoldStage/g) ?? []).length === 3);
  ok('the markers did not move', rec.includes('const MARKER_TIMES_MS = [8000, 12000, 15000];'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
