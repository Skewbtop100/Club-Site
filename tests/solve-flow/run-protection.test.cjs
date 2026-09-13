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
const intro = fs.readFileSync(path.join(ROOT, SOLVE, '_components/AttemptIntroStage.tsx'), 'utf8');
const holdClock = fs.readFileSync(path.join(ROOT, SOLVE, '_lib/useHoldClock.ts'), 'utf8');
const screenFill = fs.readFileSync(path.join(ROOT, SOLVE, '_components/ScreenFill.tsx'), 'utf8');

const chunks = fs.readFileSync(path.join(ROOT, SOLVE, '_lib/scrambleChunks.ts'), 'utf8');
const cover = fs.readFileSync(path.join(ROOT, SOLVE, '_components/CoverStage.tsx'), 'utf8');
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
    /setRecordingFailure\(null\);\s*\n\s*setPendingBlob\(null\);[\s\S]{0,400}?setStage\('attemptIntro'\);/.test(page));
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

  // Resuming looks identical to starting without this. It is still
  // built and still said — but by the LOBBY, as its own overlay band,
  // rather than by a page banner that followed the athlete onto every
  // screen until they recorded something.
  ok('the athlete is told they are continuing',
    page.includes('setResumeMessage(resumeNotice(plan))') &&
      page.includes('const lobbyNote = resumeMessage ??'));
  ok('  ...once, by the lobby, and never repeated downstream',
    page.includes('note={lobbyNote}') && !page.includes('{resumeMessage}'));
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
  // THE NUMBER IS THE CLOCK: it starts at the same value that sets the
  // timeout. A duration cannot be changed without the display following
  // it. (It was an 8-segment tick bar until the mockup restyle; the
  // guarantee is the same one, on the mockup's countdown.)
  // THE SAME GUARANTEE, carried by useHoldClock: a duration cannot be
  // changed without the display of it following, because one argument
  // drives the tick, the timeout and the sentence.
  ok('the countdown starts from `seconds`, not a second constant',
    holdClock.includes('useState(seconds)') &&
      holdClock.includes('}, seconds * 1000);'));
  ok('  ...counting down one a second', holdClock.includes('Math.max(r - 1, 0)'));
  // ONE CLOCK FOR THE WHOLE RUN. The cover used to keep a private copy
  // of this, which is how two holds come to disagree about how long a
  // hold is — and it must not come back.
  // The two preview-less screens reach it through useScreenFill, which
  // is itself one line of useHoldClock — so there is still exactly one
  // clock in the run, whatever each screen draws with it.
  ok('  ...and every timed screen reads it from the one place',
    hold.includes("from '../_lib/useHoldClock'") &&
      cover.includes("from '../_lib/useHoldClock'") &&
      screenFill.includes("from '../_lib/useHoldClock'") &&
      intro.includes("from './ScreenFill'"));
  ok('  ...with no screen keeping a timer of its own',
    [hold, cover, intro, screenFill].every((f) =>
      !f.includes('setInterval') && !f.includes('setTimeout')));
  // DISPLAY vs DECISION. The number is what an athlete reads; `done` is
  // what opens the gate, and it flips on a real-time timeout rather than
  // on the tick count, so a drifting or throttled interval can never
  // open it early.
  ok('  ...and the gate reads the timeout, not the ticking number',
    /const t = setTimeout\(\(\) => \{\s*\n\s*setDone\(true\);/.test(holdClock));
  ok('  ...and no tick bar survives beside it', !hold.includes('oc-solve-chunk-bar'));
  // It is a clock and a preview. Nothing else.
  ok('it starts and stops no recording',
    !hold.includes('startRecording') && !hold.includes('stopRecording') && !hold.includes('recorder'));

  // It no longer has that name: `cover` took over its eight seconds AND
  // its job, and added the hiding that makes the inspection measurable.
  ok('the orientation hold became the cover stage',
    !page.includes("'orientationHold'") && page.includes("{stage === 'cover' && ("));
  ok('  ...at its own, longer duration', page.includes('<CoverStage seconds={COVER_SECONDS}'));
  // All three holds — the timer at zero, the cube's orientation, the timer
  // at the finish — are the same component with the same clock.
  // Two, not three, since cover: the two TIMER holds share the component;
  // cover holds a cube, not a timer, and shows two colour diagrams
  // instead of a preview.
  ok('all three camera holds come from the one component',
    (page.match(/<CameraHoldStage/g) ?? []).length === 3);
  // THREE DISTINCT LABELS. The two timer holds are the same component at
  // the same duration with nearly the same sentence; sharing a label too
  // left an athlete glancing at the screen unable to tell whether they
  // were before or after the solve.
  {
    const labels = (page.match(/label="([^"]+)"/g) ?? []).map((m) => m.slice(7, -1));
    ok('  ...each labelled for what it asks for', labels.length === 3 && new Set(labels).size === 3,
      labels.join(' | '));
    ok('  ...the timer holds name the timer',
      labels.includes('ЦАГАА ХАРУУЛАХ ХЭСЭГ') && labels.includes('ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА'));
    // The third is the only hold whose subject is the cube rather than
    // a clock, and says so.
    ok('  ...and the cube check names the cube, not a timer',
      labels.includes('ШООГОО ХАРУУЛ · ЭЦСИЙН БАЙДАЛ'));
    }
  // The cube hold's own words moved into CoverStage with the rest of it.
  {
    const cover = fs.readFileSync(path.join(ROOT, SOLVE, '_components/CoverStage.tsx'), 'utf8');
    ok('the cube hold still says what orientation it wants',
      cover.includes('цагаан') && cover.includes('ногоон') && cover.includes('КАМЕР РУУ'));
  }
}

console.log('\n  -- 7. durations and markers --');
{
  // ONE NUMBER for every hold: the timer, the tick bar and the sentence
  // all read it.
  // THE TWO TIMER HOLDS share one constant; the cover has its own.
  // They answer different questions — HOLD_SECONDS is how long a judge
  // must see something for, COVER_SECONDS is how long the athlete needs
  // to read an instruction and act on it — so a change to either must
  // not silently move the other.
  ok('the three 8-second holds share a single duration constant',
    page.includes('const HOLD_SECONDS = 8;') &&
      (page.match(/seconds=\{HOLD_SECONDS\}/g) ?? []).length === 3);
  ok('  ...and the cover has a longer one of its own',
    page.includes('const COVER_SECONDS = 20;') &&
      page.includes('<CoverStage seconds={COVER_SECONDS}'));
  ok('  ...with no bare number at any call site',
    !/seconds=\{\d/.test(page));
  // THE DRIFT THE REFACTOR DID NOT FIX: the sentence names the duration,
  // so it is built from the same number rather than written beside it.
  ok('the instruction is a function of seconds, not a literal',
    hold.includes('instruction: (seconds: number) => string;') && hold.includes('{instruction(seconds)}'));
  // One call site takes `sec` now, not two: the timer check's sentence
  // stopped naming a duration at all ("цаг дуустал" — until the count
  // runs out), so it has no number to get wrong. The guard that matters
  // is unchanged and still absolute: NO call site may write a literal
  // number of seconds into its sentence.
  ok('  ...and no call site writes the number into the sentence itself',
    (page.match(/instruction=\{\(sec\) =>/g) ?? []).length === 2 && !/\d+ секунд/.test(page));

  // THE OPENING HOLD is now the athlete's own timer, held to the camera —
  // with a preview to aim at, which the on-screen "0.00" never gave them.
  ok('the opening hold is a camera hold', !fs.existsSync(path.join(ROOT, SOLVE, '_components/ZeroDisplayStage.tsx')));
  // ONE transition in now, from the intro. Every way of beginning an
  // attempt enters attemptIntro, whose only exit is here — so the
  // recording still starts in exactly one place, one screen later than
  // the athlete presses to begin.
  // TWO transitions in now, and both hold a scramble: the intro's exit
  // when the fetch has landed, and the wait's promotion when it had not.
  // Beginning an attempt no longer consults the scramble at all — see
  // scramble-wait.test.cjs, which owns that invariant.
  ok('  ...under the SAME stage name, so every transition still lands',
    page.includes("{stage === 'zeroDisplay' && (") && (page.match(/setStage\([^)]*zeroDisplay/g) ?? []).length === 2);
  ok('  ...showing the athlete their own timer at 0.00',
    /Цагийг 0\.00 болгож, хугацаа дуустал камерт харуулна уу\./.test(page));

  // THE 8/12/15 CUES ARE BACK, AND SOMEWHERE ELSE. They were removed
  // when a dedicated inspection countdown made them misleading — they
  // walked the PREVIEW'S BORDER from the start of the solve, which was
  // never inspection. That countdown is gone now (its stage merged into
  // this screen), so the cues are meaningful again and have come back as
  // the counter's own colour.
  ok('the old border markers stay gone, timers and rules alike',
    !rec.includes('MARKER_TIMES_MS') && !rec.includes('setMarker') && !rec.includes('oc-solve-mark-') &&
      [1, 2, 3].every((n) => !theme.includes(`.oc-solve-mark-${n}`)) &&
      !theme.includes('transition: border-color 800ms ease;'));
  ok('  ...and nothing else referenced them',
    !fs.readFileSync(path.join(ROOT, SOLVE, '_lib/useSolveRecorder.ts'), 'utf8').includes('marker') &&
      !page.includes('marker') && !theme.includes('oc-solve-mark'));
  // ON THE DIGITS, not the frame. The border is the edge of what is
  // being recorded — the one thing on this screen that already means
  // something specific — and a border is a large peripheral change that
  // pulls the eye across the whole frame while the athlete should be
  // looking at a cube.
  ok('  ...the cue colour living on the counter, not the camera frame',
    rec.includes('const CUE_AMBER_AT = 8;') && rec.includes('const CUE_RED_AT = 12;') &&
      /\.oc-solve-insp-amber \{\s*\n\s*color: #E0A020;/.test(theme) &&
      /\.oc-solve-insp-red \{\s*\n\s*color: #D8402C;/.test(theme) &&
      !/\.oc-solve-rec-feed \{[^}]*border/.test(theme));
  // The beeps they replaced are still gone, and nothing audio-shaped came
  // back with the removal.
  ok('  ...and the beeps are still gone',
    !rec.includes('BEEP') && !rec.includes('onBeep') && !page.includes('playBeep'));
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

console.log('\n  -- 6. the recording stops AFTER the cube check --');
{
  // The clip used to end the instant the solve did, then after the
  // closing hold. It ends after the CUBE CHECK now — one stage later
  // again — because the cube's final state is what a judge reads to
  // decide +2 or DNF, and evidence that arrives after the recording has
  // stopped is not evidence.
  //
  // THE BOUNDARY MOVED BY ONE CALL SITE AND NOTHING ELSE: finishRecording
  // is unchanged, and the assertions below on its contents are the same
  // ones that guarded the previous boundary.
  ok('the solve’s end button only changes stage — it stops nothing',
    page.includes("onFinish={() => setStage('finishHold')}"));
  // (Changeset 3 folded FINISH_HOLD_SECONDS into the one HOLD_SECONDS
  // every hold shares.)
  ok('the closing hold is 8 seconds of CameraHoldStage',
    page.includes('const HOLD_SECONDS = 8;') && page.includes('seconds={HOLD_SECONDS}'));
  // A stage missing from HEADER_STAGES loses the header and the attempt
  // pips silently, mid-attempt.
  ok('  ...and it is in ATTEMPT_STAGES', /'rec',\s*\n\s*'finishHold',/.test(page));

  // ── THE CUBE CHECK, AND WHY THE CLIP NOW REACHES IT ──
  // A judge reads the cube's final state for +2 (one face off by a turn)
  // or DNF (more than that). Until now nothing on the video showed it:
  // the time was evidenced and the solve was not.
  ok('a cube check follows the closing hold',
    page.includes("| 'cubeCheck'") &&
      /label="ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА"[\s\S]{0,500}?onDone=\{\(\) => setStage\('cubeCheck'\)\}/.test(page));
  ok('  ...in ATTEMPT_STAGES, between the closing hold and the keypad',
    /'finishHold',\s*\n\s*'cubeCheck',\s*\n\s*'entry',/.test(page));
  ok('  ...at the same 8 seconds, from the same constant',
    /label="ШООГОО ХАРУУЛ · ЭЦСИЙН БАЙДАЛ"/.test(page) &&
      /<CameraHoldStage\s*\n\s*seconds=\{HOLD_SECONDS\}\s*\n\s*label="ШООГОО ХАРУУЛ · ЭЦСИЙН БАЙДАЛ"/.test(page));
  // THE TWO THINGS THE INSTRUCTION MUST SAY. Turning a single layer
  // here would erase the difference between a finished solve, a +2 and a
  // DNF — the athlete destroying the evidence they are providing.
  ok('  ...telling the athlete to turn the cube so every face is seen',
    page.includes('Шоогоо аажмаар эргүүлж бүх талыг нь'));
  ok('  ...and NOT to turn a layer, with the reason',
    page.includes('Аль ч давхаргыг эргүүлж болохгүй') &&
      page.includes('эвлүүлэлтийн эцсийн байдлыг шүүгч шалгана'));
  // THE CLIP NOW STOPS HERE, and in exactly one place.
  ok('  ...and it is the one stage that ends the recording',
    (page.match(/onDone=\{finishRecording\}/g) ?? []).length === 1 &&
      /label="ШООГОО ХАРУУЛ · ЭЦСИЙН БАЙДАЛ"[\s\S]{0,1200}?onDone=\{finishRecording\}/.test(page));
  ok('  ...so the closing hold no longer ends it',
    !/label="ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА"[\s\S]{0,500}?onDone=\{finishRecording\}/.test(page));

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
    /\.oc-solve-takeover \{[^}]*position: fixed;[^}]*z-index: 200;/.test(theme));
  ok('  ...over the mockup’s ground', /\.oc-solve-takeover \{[^}]*background: #08080A;/.test(theme));
  // THE VISIBLE VIEWPORT, not the layout one. `inset: 0` on a fixed box
  // resolves against the LARGE viewport — the height the page would have
  // with the browser chrome retracted — so with a URL bar showing, its
  // bottom edge sits below what the phone displays, and anything
  // anchored there goes with it. 100dvh tracks the chrome.
  ok('  ...sized to what the phone actually shows',
    /\.oc-solve-takeover \{[^}]*height: 100dvh;/.test(theme));
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
  // Only the filing indicator is left here — the resume notice is the
  // lobby's band now. What remains is above the stage, in the scrolling
  // column, where the fixed 56px bar has no second line for it.
  ok('the filing indicator moved into the body',
    page.includes('oc-solve-banner-quiet'));
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
  ok('the run has fifteen stages', (page.match(/^  \| '[a-zA-Z]+'/gm) ?? []).length === 15);
  ok('the recording boundary is untouched',
    page.includes("if (stage === 'zeroDisplay') {") &&
      page.includes("onFinish={() => setStage('finishHold')}") &&
      page.includes('async function finishRecording'));
  ok('the 8-second holds are untouched: three of them, all 8',
    page.includes('const HOLD_SECONDS = 8;') &&
      (page.match(/seconds=\{HOLD_SECONDS\}/g) ?? []).length === 3);
  ok('the markers are gone and stayed gone', !rec.includes('MARKER_TIMES_MS'));
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
  ok('the run still has every stage it had, plus the cube check', (page.match(/^  \| '[a-zA-Z]+'/gm) ?? []).length === 15);
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

  // THE PROSE IS GONE — heading, lead and all four rules. They were not
  // reworded, they were removed: the screen's job is aiming a camera, and
  // four paragraphs beside a 200px thumbnail is not how that is done. The
  // 'хүчингүй' guard above still stands, because the claim that leaving
  // voids the round must never come back whatever the copy becomes.
  ok('  ...and the rules list is gone entirely',
    !lobby.includes('oc-solve-lobby-rule') && !lobby.includes('oc-solve-lobby-panel'));
  ok('  ...as are the heading and the lead',
    !lobby.includes('oc-solve-lobby-title') && !lobby.includes('oc-solve-lobby-lead'));
  ok('  ...leaving one line, BELOW the preview',
    lobby.includes('Камерт шоо болон хугацаа хэмжигч хоёрыг бүтэн харагдахаар 50см орчим зайтай байрлуулна уу.') &&
      lobby.includes('oc-solve-lobby-aim'));

  // ── A STANDING INSTRUCTION IS NOT A PASSING NOTICE ──
  // These two were briefly one fading stack inside the frame. Wrong:
  // "put the cube and the timer in frame, ~50cm away" is needed for as
  // long as the athlete is aiming, which is the whole time they are on
  // this screen, while "2 saved, you resume at 3" is true once and read
  // once. Fading them together timed out the one line the screen exists
  // to deliver, while they were still doing the thing it describes.
  ok('  ...which NEVER fades — no timer, no conditional class',
    lobby.includes('<p className="oc-solve-lobby-aim">') &&
      !/oc-solve-lobby-aim[^"]*\$\{/.test(lobby));
  ok('  ...and never covers the video it is telling them to check',
    !/\.oc-solve-lobby-aim \{[^}]*position:/.test(theme) &&
      // Out of the preview area entirely: after the area closes, before
      // the button. That is the dead space the column already had.
      lobby.indexOf('oc-solve-lobby-aim') > lobby.indexOf('oc-solve-lobby-band') &&
      lobby.indexOf('oc-solve-lobby-aim') < lobby.indexOf('oc-solve-lobby-go'));
  ok('  ...and nothing but the video is left inside the frame',
    !/oc-solve-lobby-frame[\s\S]{0,900}?oc-solve-lobby-aim/.test(lobby) &&
      !/oc-solve-lobby-frame[\s\S]{0,900}?oc-solve-lobby-band/.test(lobby));

  // THE BAND: the passing notice, on its OWN timer, and the only thing
  // left that covers any video. Fades but is never REMOVED — opacity
  // only, so a screen reader keeps the sentence either way.
  ok('the status band fades on a timer of its own',
    lobby.includes('const NOTE_VISIBLE_MS = 5000;') &&
      /oc-solve-lobby-band-out/.test(lobby) &&
      /\.oc-solve-lobby-band-out \{\s*\n\s*opacity: 0;/.test(theme));
  ok('  ...which is the ONLY timer on the screen',
    (lobbyCode.match(/NOTE_VISIBLE_MS/g) ?? []).length === 2 &&
      !lobbyCode.includes('OVERLAY_VISIBLE_MS') && !lobbyCode.includes('HINT_VISIBLE_MS'));
  ok('  ...and comes back when the athlete taps the preview',
    lobby.includes('onClick={showNote}') && lobby.includes('setNoteOn(true);'));
  // A BAND, not a card. The card was pinned inside the frame and floated
  // over whatever the camera was pointing at — usually the athlete's own
  // face. Full-bleed across the area reads as the system talking.
  ok('  ...spanning the whole stage rather than floating as a card',
    /\.oc-solve-lobby-band \{[\s\S]{0,400}?left: 0;[\s\S]{0,60}?right: 0;[\s\S]{0,60}?top: 0;/.test(theme));
  // THE TOP EDGE. The cube and the timer sit low in a solve's frame, so
  // the bottom is the edge that clips what a judge must see — and the one
  // the athlete is checking when they aim. The top is usually wall.
  ok('  ...at the top, where a solve has least worth covering',
    !/\.oc-solve-lobby-band \{[^}]*bottom: 0;/.test(theme));

  // RESUME LANDS HERE. Attempt 3 of 5 must not read like attempt 1 — but
  // with the prose gone, the button is the only place left that can say
  // so, and the resume banner above the stage carries the arithmetic.
  ok('the lobby knows it is a resume', lobby.includes('const resuming = filedAttempts > 0;'));
  ok('  ...and the button names the attempt it starts',
    lobby.includes('`${nextAttempt}-р оролдлогоо эхлэх`'));
  ok('  ...which is the ONLY thing resuming now changes',
    (lobbyCode.match(/resuming/g) ?? []).length === 2);
  ok('  ...fed from what the server said is already filed',
    page.includes('filedAttempts={attempts.length}') && page.includes('nextAttempt={attempts.length + 1}'));
  // The specifics stay in ONE sentence, computed in ONE place. On the
  // lobby that sentence is now an overlay on the preview rather than a
  // row above it, but the lobby still only RENDERS it — it neither counts
  // attempts nor words the sentence, so there is still exactly one place
  // that does.
  ok('  ...while the numbers stay in one sentence the lobby only renders',
    !lobby.includes('resumeMessage') && !lobbyCode.includes('filedAttempts}') &&
      page.includes('setResumeMessage(resumeNotice(plan))') &&
      page.includes('note={lobbyNote}'));
  ok('  ...and has no page-level banner of its own left at all',
    !page.includes('{resumeMessage &&'));

  // ── A FAILURE THAT FADES IS A FAILURE NOBODY SEES ──
  // The saving line is not a lobby ornament: during the run it reports
  // upload progress and upload failure. Only its REASSURING variant —
  // "n are safely stored" — may ever be allowed to fade, and the gate is
  // on what the line SAYS, not on which stage it is on. A stage-only
  // gate would hide a failed upload the moment one could occur on the
  // lobby, and hide "ХАДГАЛЖ БАЙНА 60%" from an athlete who would then
  // believe the upload had finished.
  // AN ALLOWLIST BY WHAT THE LINE SAYS, not a list of screens to
  // suppress it on. That list was growing by one every time a screen was
  // added — lobby, intro, timer check, reveal — and a rule that has to
  // name each new screen is always one screen out of date. The quiet
  // lines are the LOBBY's, delivered once through lobbyNote; the
  // page-level banner carries the saving line only when it is not
  // reassurance.
  ok('only a saving line that is NOT reassurance reaches the page banner',
    page.includes('const savingIsReassurance = !filingFailed && !uploading;') &&
      page.includes("{savingLabel && !savingIsReassurance && stage !== 'between' && (") &&
      !page.includes('instructingStage'));
  ok('  ...so a failure and an upload in progress stay a permanent row everywhere',
    // The only stage-based suppression left is `between`, which predates
    // this and has its own per-attempt slot cards instead.
    (page.match(/stage !== 'between'/g) ?? []).length === 1 &&
      !/savingLabel && stage === 'lobby'/.test(page));
  ok('  ...and the lobby overlay is only ever fed the reassuring one',
    page.includes('const lobbyNote = resumeMessage ?? (savingIsReassurance ? savingLabel : null);'));
  // ONE note, not a stack of two: the resume notice already contains the
  // saving line's count AND says which attempt is next, so showing both
  // would be the same fact twice, over the video, in two type sizes.
  ok('  ...as ONE note, since the resume notice already carries the count',
    /note: string \| null;/.test(lobby) &&
      (lobbyCode.match(/oc-solve-lobby-band/g) ?? []).length === 2);

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
  // THE LOBBY IS NO LONGER THE MOCKUP'S COLUMN. Its 620px/200px-thumbnail
  // panel could not do the screen's one job — see "the preview is the
  // recording" below — so the column now fills the stage and the camera
  // fills the column.
  ok('the lobby fills the stage rather than sitting in a 620px column',
    /\.oc-solve-lobby \{[\s\S]{0,600}?max-width: 1080px;[\s\S]{0,400}?flex: 1;[\s\S]{0,120}?min-height: 0;/.test(theme));
  ok('  ...and the panel that held the thumbnail is gone',
    !theme.includes('.oc-solve-lobby-panel') && !theme.includes('.oc-solve-lobby-rules'));
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

  // ── THE PREVIEW IS THE RECORDING ──
  // MediaRecorder reads the raw camera track (useSolveRecorder's comment
  // is emphatic about it), so the recording is the full frame at the
  // stream's own ratio. A preview that crops, or that fixes a ratio the
  // camera does not produce, has the athlete framing the cube and the
  // timer against edges the recording does not have — and they find out
  // when a judge rejects the clip. This is not hypothetical: the same
  // mistake downstream, a portrait clip in a landscape box on the review
  // dashboard, is what got the recordings blamed.
  const feedRule = theme.slice(theme.indexOf('.oc-solve-lobby-feed {'));
  const frameRule = theme.slice(theme.indexOf('.oc-solve-lobby-frame {'));
  ok('the preview contains the frame, never crops it',
    /^\.oc-solve-lobby-feed \{[\s\S]{0,300}?object-fit: contain;/.test(feedRule));
  ok('  ...and never cover, which is what cropped it',
    !/^\.oc-solve-lobby-feed \{[\s\S]{0,300}?object-fit: cover;/.test(feedRule));
  // THE SIZING RULE: the largest box of the STREAM'S ratio that fits the
  // area — min(the area's width, the area's height x the ratio) — so
  // whichever axis runs out first decides and the preview is as large as
  // the viewport allows. It scales up as well as down; intrinsic sizing
  // with max-* caps left a 640x480 webcam at 640x480 on a 1440px screen.
  ok('  ...and is sized to the largest box of the stream’s ratio that fits',
    /^\.oc-solve-lobby-frame \{[\s\S]{0,400}?width: min\(100cqw, 100cqh \* \(var\(--oc-cam-w\) \/ var\(--oc-cam-h\)\)\);/.test(frameRule) &&
      /\.oc-solve-lobby-view \{[\s\S]{0,400}?container-type: size;/.test(theme));
  // EVERY ratio in the lobby is built from the measured stream size (or
  // explicitly `auto` while it is unknown). A literal like `3 / 4` or
  // `16 / 10` here is the bug this screen was rebuilt to remove.
  ok('  ...from the stream’s own numbers, never a hardcoded ratio', (() => {
    const ratios = theme.match(/\.oc-solve-lobby[a-z-]* \{[^}]*\}/g) ?? [];
    const declared = ratios.flatMap((r) => r.match(/aspect-ratio: [^;]+;/g) ?? []);
    return declared.length > 0 &&
      declared.every((d) => d.includes('var(--oc-cam-w)') || d === 'aspect-ratio: auto;');
  })());
  // Read off the ELEMENT, which is what a <video> lays out from — and a
  // <video> is also what replays the recording in review.
  ok('the real frame size comes from the element, on metadata AND resize',
    lobby.includes('el.videoWidth') && lobby.includes('el.videoHeight') &&
      lobby.includes("el.addEventListener('loadedmetadata', read)") &&
      lobby.includes("el.addEventListener('resize', read)"));
  // Rotation is exactly the `resize` case, and the phone is the device
  // that records portrait — so the 16/10 landscape override the old
  // narrow-screen rule forced was the crop bug at its worst.
  ok('  ...and 375px no longer forces a landscape preview',
    !/@media[^{]*\{[\s\S]*?\.oc-solve-lobby-cam \{[\s\S]{0,80}?aspect-ratio: 16 \/ 10;/.test(theme));
  // Before metadata there is no true frame to draw, so none is drawn:
  // the frame claims no ratio and no edge until the stream reports one.
  ok('  ...and nothing draws a frame before the size is known',
    lobby.includes('const live = hasCamera && dims !== null;') &&
      /\.oc-solve-lobby-frame-idle \{[\s\S]{0,200}?aspect-ratio: auto;[\s\S]{0,120}?box-shadow: none;/.test(theme) &&
      /\.oc-solve-lobby-placeholder \{[\s\S]{0,300}?border: 1px dashed/.test(theme));
  // The one line is a child of the FRAME, not the area: positioned
  // against the area it drifted onto the black beside a portrait frame
  // on a desktop, and below a landscape frame on a phone.
  ok('  ...and the status band spans the area, not the frame',
    /oc-solve-lobby-view[\s\S]{0,3000}?oc-solve-lobby-band/.test(lobby) &&
      /\.oc-solve-lobby-band \{[\s\S]{0,200}?position: absolute;/.test(theme));

  // 375px: five 17px times do not fit 62px cards.
  ok('the slot row tightens rather than wrapping',
    /\.oc-solve-slot-time \{\s*\n\s*font-size: 13px;/.test(theme) &&
      !/\.oc-solve-slots \{[\s\S]{0,120}?repeat\(3/.test(theme));

  // NOT IN THIS DIFF.
  ok('the recording boundary did not move',
    page.includes("onFinish={() => setStage('finishHold')}") && page.includes('async function finishRecording'));
  ok('the 8-second holds did not move',
    page.includes('const HOLD_SECONDS = 8;') && (page.match(/seconds=\{HOLD_SECONDS\}/g) ?? []).length === 3);
  ok('  ...and the cover now runs longer, on its own constant',
    page.includes('<CoverStage seconds={COVER_SECONDS}'));
  ok('the markers are gone and stayed gone', !rec.includes('MARKER_TIMES_MS'));
}

console.log('\n  -- 10. the mockup restyle --');
{
  const entry = fs.readFileSync(path.join(ROOT, SOLVE, '_components/EntryStage.tsx'), 'utf8');
  const reveal = fs.readFileSync(path.join(ROOT, SOLVE, '_components/RevealStage.tsx'), 'utf8');
  const ready = fs.readFileSync(path.join(ROOT, SOLVE, '_components/ReadyPromptStage.tsx'), 'utf8');
  const sent = fs.readFileSync(path.join(ROOT, SOLVE, '_components/SentStage.tsx'), 'utf8');
  // Comment-stripped, for the assertions that something is ABSENT: each
  // of these files explains in a comment what it dropped and why, and the
  // explanation contains the thing.
  const readyCode = stripComments(ready);
  const revealCode = stripComments(reveal);
  const summaryCode = stripComments(summary);

  // THE CAP THAT MADE EVERY MAX-WIDTH A LIE. The shell kept the old
  // shell's 480px on the stage column, so lobby's declared 620 (and every
  // other stage's) was clamped to 480 and nothing said so.
  ok('the stage column no longer caps every screen at 480px',
    /\.oc-solve-stage \{[\s\S]{0,160}?\}/.test(theme) &&
      !/\.oc-solve-stage \{[\s\S]{0,160}?max-width/.test(theme));
  ok('  ...so each screen carries the mockup’s own width', [
    ['.oc-solve-entry', '380px'], ['.oc-solve-sent', '460px'], ['.oc-solve-between', '520px'],
    ['.oc-solve-summary', '560px'], ['.oc-solve-lobby', '1080px'], ['.oc-solve-hold', '680px'],
    ['.oc-solve-reveal', '760px'],
  ].every(([sel, w]) => new RegExp(`\\${sel} \\{[\\s\\S]{0,220}?max-width: ${w};`).test(theme)));
  ok('  ...and centres itself, since the column no longer does',
    (theme.match(/\n  margin: auto;/g) ?? []).length >= 8);

  // ── THE HOLD: one component, ONE presentation ──
  ok('all three camera holds are still one component', (page.match(/<CameraHoldStage/g) ?? []).length === 3);
  // ── THE NUMBER, ON ALL THREE CAMERA HOLDS ──
  // A colour fill briefly replaced it on all three. It is back: these
  // screens carry a live preview, and colour moving behind the picture
  // an athlete is trying to frame competes with the one thing they are
  // meant to be looking at. The fill belongs to the intro, which has no
  // preview — see below.
  ok('  ...showing the mockup’s countdown, not a tick bar',
    hold.includes('className="oc-solve-hold-n"') && !hold.includes('oc-solve-chunk-bar'));
  ok('  ...at the mockup’s 50px volt over a 4/3 frame',
    /\.oc-solve-hold-n \{[\s\S]{0,140}?font: 700 50px\/1 var\(--oc-font-mono\)/.test(theme) &&
      /\.oc-solve-hold-cam \{[\s\S]{0,400}?aspect-ratio: 4 \/ 3;/.test(theme));
  ok('  ...and the cover counting the same way, off the shared clock',
    cover.includes('useHoldClock(seconds, onDone)') &&
      cover.includes('className="oc-solve-cover-n"') &&
      /\.oc-solve-cover-n \{[\s\S]{0,140}?font: 700 50px\/1 var\(--oc-font-mono\)/.test(theme));
  // NO FILL ON A SCREEN WITH A PREVIEW. The number and the fill must not
  // both live in the shared hold component when only one screen fills.
  ok('  ...with no colour fill left on any hold',
    !hold.includes('fill') && !cover.includes('fill') &&
      !/\.oc-solve-hold[a-z-]* \{[^}]*animation: oc-solve-fill-rise/.test(theme));
  ok('  ...with four corner brackets at 22px', ['tl', 'tr', 'bl', 'br']
    .every((c) => theme.includes(`.oc-solve-hold-corner-${c} {`)) &&
    /\.oc-solve-hold-corner \{[\s\S]{0,90}?width: 22px;/.test(theme));
  // The label is what tells the three holds apart, so it survives the
  // restyle -- in the mockup's in-frame caption slot.
  ok('  ...and each hold still names itself inside the frame',
    hold.includes('className="oc-solve-hold-caption">{label}'));
  // WHAT HAPPENS AT ZERO, once per hold — but no longer always as a
  // footnote. A hold that ends on a button has the button say it, and
  // repeating it underneath was the same sentence twice. The rule is
  // that a hold says it exactly once, either way, and never neither.
  ok('every timer hold says what the count leads to', (() => {
    const footnotes = page.match(/footnote="([^"]+)"/g) ?? [];
    const silenced = page.match(/footnote=\{null\}/g) ?? [];
    const buttons = page.match(/end=\{\{ label: '[^']+' \}\}/g) ?? [];
    // Three CameraHoldStage call sites: two footnotes (the closing hold
    // and the cube check), one button (the timer check), and all of them
    // saying something different.
    return footnotes.length === 2 && silenced.length === 1 && buttons.length === 1 &&
      new Set(footnotes).size === 2;
  })());

  // ── THE BEAT BEFORE THE TIMER CHECK ──
  // The hold's eight seconds start the instant it renders, so an athlete
  // who had not already picked up their timer spent the first half of a
  // measured hold reaching for it. This screen is where that happens now.
  ok('an intro screen precedes the timer check',
    fs.existsSync(path.join(ROOT, SOLVE, '_components/AttemptIntroStage.tsx')) &&
      page.includes("{stage === 'attemptIntro' && ("));
  ok('  ...for five seconds, then on by itself',
    intro.includes('const INTRO_SECONDS = 5;') &&
      intro.includes('useScreenFill(INTRO_SECONDS, onDone)'));
  // ONE LINE. It also carried "{N}-р эвлүүлэлт эхлэх гэж байна"; the bar
  // above already names the attempt, and a screen with one instruction
  // on it should have one sentence on it.
  ok('  ...saying one thing, with the attempt number dropped',
    intro.includes('<p className="oc-solve-intro-say">Цагаа 0.00 болгож шалгуулахдаа бэлдээрэй.</p>') &&
      !stripComments(intro).includes('эвлүүлэлт эхлэх гэж байна') &&
      !intro.includes('attemptNumber') &&
      page.includes('<AttemptIntroStage'));
  // Its five seconds are the same fill the holds use, from the same
  // clock — a screen that fills is a screen that is waiting, wherever
  // the athlete meets one.
  // THE FILL IS THE INTRO'S AND NOWHERE ELSE'S. This is the only waiting
  // screen with nothing on it but a sentence, so it is the only one where
  // the screen itself is free to become the clock.
  ok('  ...shown as the screen filling, not as a number',
    intro.includes('{fill}') && !intro.includes('oc-solve-intro-count'));
  // ONE ARGUMENT arms the clock and sizes the sweep, so a screen cannot
  // be given a fill longer than the wait it is a picture of.
  ok('  ...from the same `seconds` that ends the screen',
    screenFill.includes('useHoldClock(seconds, onElapsed)') &&
      screenFill.includes("'--oc-fill-duration': `${seconds}s`") &&
      screenFill.includes("'--oc-fill-steps': seconds"));
  // BEHIND THE SENTENCE, which stays the brightest thing on the screen.
  ok('  ...behind the sentence, never over it',
    /\.oc-solve-fill \{[\s\S]{0,400}?z-index: -1;/.test(theme) &&
      /\.oc-solve-body \{[^}]*isolation: isolate;/.test(theme));
  // THE ACCENT, not a tint of it. At 4-16% it read as a grey-green
  // smudge; the volt is unmistakable at 10-38%.
  ok('  ...in the volt accent at a strength that reads as a colour',
    /\.oc-solve-fill \{[\s\S]{0,500}?linear-gradient\(to top, rgba\(223, 255, 79, 0\.1\), rgba\(223, 255, 79, 0\.38\)\)/.test(theme));
  // THE SENTENCE IS THE SCREEN'S CONTENT, not a caption. At 18px it read
  // as a footnote to an empty page.
  ok('  ...under a sentence sized as the screen’s content',
    /\.oc-solve-intro-say \{[\s\S]{0,220}?font: 600 clamp\(26px, 6\.4vw, 42px\)/.test(theme));
  // REDUCED MOTION: stepped, not deleted. The fill is the only thing on
  // these screens saying how long they last.
  ok('  ...stepping instead of sweeping under reduced motion',
    /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.oc-solve-fill \{\s*\n\s*animation-timing-function: steps\(var\(--oc-fill-steps\), end\);/.test(theme));
  ok('  ...and saying its duration to a screen reader',
    screenFill.includes('oc-sr-only') && /\{seconds\} секунд хүлээнэ үү\./.test(screenFill) &&
      /\.oc-sr-only \{/.test(theme));
  // NOT ON THE RECORDING, and no preview on it either: five seconds of
  // an athlete reaching for a timer is not evidence of anything, and
  // would otherwise be added to every clip of every attempt.
  ok('  ...with no camera on it, because none of it is evidence',
    !intro.includes('videoRef') && !intro.includes('<video'));

  // ── THE HOLD ENDS ON A BUTTON, AND ONLY THIS HOLD DOES ──
  // At zero the athlete has a timer in one hand and needs the cube in
  // the other. Advancing on its own started the scramble appearing while
  // their hands were still full.
  ok('the timer check waits for a press instead of advancing itself',
    page.includes("end={{ label: 'ХОЛИЛТ ХАРАХ' }}"));
  // THE SECONDS ARE EVIDENCE. The button cannot be pressed early, and it
  // is gated on the DISPLAYED count rather than a second timer of its
  // own — a throttled background tab then enables it late, never early.
  // STRONGER THAN IT WAS. The button used to render throughout and lean
  // on `disabled={!done}`; it does not exist at all until `done` now, so
  // there is nothing to press early rather than something inert to
  // press. Comment-stripped, because the component explains the
  // attribute it replaced and that explanation contains it.
  ok('  ...and cannot be pressed before the time runs out',
    /\{done \? \(\s*\n\s*<button type="button" className="oc-solve-hold-go" onClick=\{onDone\}>/.test(hold) &&
      !stripComments(hold).includes('disabled='));
  // Either way the decision is the real-time timeout, never the ticking
  // number — an interval that drifts or is throttled could open a gate
  // early; a timeout can only fire late.
  ok('  ...off the timeout, not the displayed number',
    hold.includes('const { remaining, done } = useHoldClock(') &&
      !stripComments(hold).includes('remaining === 0') &&
      !stripComments(hold).includes('remaining > 0'));
  // A hold that waits for a press hands useHoldClock no onElapsed at
  // all, so there is no second timer able to advance it behind the
  // button.
  ok('  ...with nothing left able to advance it but the press',
    hold.includes('useHoldClock(seconds, waitsForPress ? undefined : onDone)'));
  ok('  ...as the button arrives lit, not merely enabled',
    /\.oc-solve-hold-go:not\(:disabled\) \{\s*\n\s*box-shadow: 0 0 26px 0 rgba\(223, 255, 79, 0\.34\);/.test(theme));
  // THE OTHER TWO HOLDS DID NOT CHANGE. finishHold and cover are both
  // after the scramble, where nothing may move; and neither asks the
  // athlete to swap what is in their hands before the next screen, which
  // is the only reason this one needed a button.
  ok('  ...while the closing hold still advances on its own',
    (page.match(/end=\{\{ label:/g) ?? []).length === 1 &&
      /label="ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА"[\s\S]{0,500}?onDone=\{\(\) => setStage\('cubeCheck'\)\}/.test(page) &&
      !/label="ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА"[\s\S]{0,500}?end=/.test(page));
  ok('  ...and the cube check too, which is what ends the clip',
    /label="ШООГОО ХАРУУЛ · ЭЦСИЙН БАЙДАЛ"[\s\S]{0,1200}?onDone=\{finishRecording\}/.test(page) &&
      !/label="ШООГОО ХАРУУЛ · ЭЦСИЙН БАЙДАЛ"[\s\S]{0,1200}?end=/.test(page));
  ok('  ...and the cover hold too, still auto-advancing',
    page.includes("<CoverStage seconds={COVER_SECONDS} onDone={() => setStage('readyPrompt')} />"));
  ok('  ...so "auto" is still what a hold does unless told otherwise',
    hold.includes("end = 'auto',") && hold.includes("end?: 'auto' | { label: string };"));

  // ── THE TIMER CHECK'S LAYOUT ──
  // ITS CLOCK IS AT THE BOTTOM, in the slot the button will take. One
  // element becomes the other in one place, so "the wait is over" is a
  // single change where the athlete is already looking — not a number
  // going quiet at the top while something lights up at the bottom.
  ok('the timer check puts its count in the slot the button will take',
    hold.includes('{!waitsForPress && count}') &&
      /<div className="oc-solve-hold-slot">[\s\S]{0,300}?done \?[\s\S]{0,300}?oc-solve-hold-go[\s\S]{0,300}?\) : \(\s*\n\s*count\s*\n\s*\)/.test(hold));
  // The swap must not reflow the column: a button that arrives 20px
  // from where the count was is a button that moves out from under a
  // thumb at the moment it becomes pressable.
  ok('  ...in a slot whose height does not change when they swap',
    /\.oc-solve-hold-slot \{[\s\S]{0,300}?min-height: 56px;/.test(theme));
  // WHICH LEAVES ONLY THE INSTRUCTION ABOVE THE PREVIEW, so `layout`
  // had nothing left to choose and went with it.
  ok('  ...leaving no layout prop to pick between them',
    !stripComments(hold).includes('layout') && !page.includes('layout="'));
  // THE TWO AUTO HOLDS ARE UNTOUCHED. Nothing on their screen is going
  // to change when the count ends except the screen itself, so there is
  // no slot for the clock to share and it stays at the top.
  ok('  ...while an auto hold still leads with its count',
    hold.includes('{!waitsForPress && count}'));
  // THE PREVIEW MAY CROP HERE — different job from the lobby's. The
  // athlete is centring one object, so the centre of the frame is the
  // whole question. Centred ON PURPOSE rather than by `cover`'s default,
  // and display-only: MediaRecorder reads the raw track, never a
  // stylesheet, so what is recorded is the full frame either way.
  // THE PREVIEW TOOK THE COUNT'S HEIGHT. At 375px the 4/3 box is
  // limited by WIDTH — it is already the full column — so freeing
  // vertical space buys it nothing unless the shape changes too. Square
  // is taller at the same width, and crops a phone's portrait stream
  // LESS rather than more, which is the stream this hold usually sees.
  ok('the timer check\u2019s preview is taller than the other holds\u2019',
    hold.includes("waitsForPress ? ' oc-solve-hold-cam-tall' : ''") &&
      /\.oc-solve-hold-cam-tall \{[\s\S]{0,200}?aspect-ratio: 1 \/ 1;/.test(theme));
  ok('  ...and the two auto holds keep the 4/3 box',
    /\.oc-solve-hold-cam \{[\s\S]{0,400}?aspect-ratio: 4 \/ 3;/.test(theme) &&
      (page.match(/oc-solve-hold-cam-tall/g) ?? []).length === 0);
  ok('the hold preview crops from the centre, deliberately',
    /\.oc-solve-hold-cam \.oc-solve-camera-video \{\s*\n\s*object-position: center center;/.test(theme) &&
      /\.oc-solve-camera-video \{[\s\S]{0,160}?object-fit: cover;/.test(theme));
  ok('  ...and the crop cannot reach the recording',
    (() => {
      // Comment-stripped: the hook's own comment explains at length the
      // off-screen canvas it USED to redraw through and why that was
      // removed, which would fail the assertion that it is gone.
      const rec = stripComments(
        fs.readFileSync(path.join(ROOT, SOLVE, '_lib/useSolveRecorder.ts'), 'utf8'),
      );
      return !rec.includes('canvas') && rec.includes('new MediaRecorder(stream');
    })());

  // ── READY: a stage after the hold, never a way to cut it short ──
  ok('ready is reached only when the hold has run out',
    page.includes("onDone={() => setStage('readyPrompt')}") && !page.includes('skipZero'));
  ok('  ...and cannot end a hold itself', !readyCode.includes('seconds') && !readyCode.includes('setTimeout'));
  ok('  ...it is the mockup’s full-bleed confirmation',
    ready.includes('className="oc-solve-ready"') &&
      /\.oc-solve-ready \{[\s\S]{0,400}?position: absolute;[\s\S]{0,120}?background: #08080A;/.test(theme));
  // THE SAME GROUND AS EVERY OTHER SCREEN. It was #16180F, a green-washed
  // near-black that made one moment of the run look like a different
  // product. The green stays on the badge, which is the thing being
  // confirmed.
  ok('  ...on the same black as the rest of the run',
    // The DECLARATION, not the string: the rule above carries a comment
    // naming the colour it stopped using, which is the point of it.
    !theme.includes('background: #16180F') &&
      /\.oc-solve-ready-badge-text \{[\s\S]{0,140}?color: #4FD07A;/.test(theme));
  // WHAT IT CONFIRMS is the scramble, not the timer. The timer check is
  // four screens and about a minute back; what has just finished is the
  // scramble, every chunk shown and applied.
  ok('  ...confirming the scramble, not the long-past timer check',
    // Comment-stripped: the component explains what the badge used to
    // say and why it was wrong, which contains the old wording.
    ready.includes('ХОЛИЛТ ХИЙГДЛЭЭ') && !stripComments(ready).includes('ЦАГ ШАЛГАГДЛАА'));
  ok('  ...over a body that can host it', /\.oc-solve-body \{[\s\S]{0,220}?position: relative;/.test(theme));
  ok('  ...and shows no preview of its own', !ready.includes('videoRef') && !ready.includes('<video'));

  // ── REVEAL ──
  ok('the reveal wears the mockup’s header',
    reveal.includes('oc-solve-reveal-eyebrow') && reveal.includes('oc-solve-reveal-n'));
  ok('  ...whose countdown is a readout of the chunk clock, not a second one',
    reveal.includes('setSecondsLeft(GROUP_DISPLAY_MS / 1000)') &&
      (reveal.match(/GROUP_DISPLAY_MS/g) ?? []).length === 6);
  ok('  ...the chunk ticks are 9px squares', /\.oc-solve-chunk-bar \{[\s\S]{0,90}?width: 9px;[\s\S]{0,40}?height: 9px;/.test(theme));
  // 68px WHERE THERE IS ROOM. The row is a grid of one column per move
  // capped at the 68px ideal, so a short chunk on a wide screen is
  // exactly as it was and a long one divides the width instead.
  ok('  ...and the moves are 68px tiles where there is room',
    /\.oc-solve-move-row \{[\s\S]{0,500}?max-width: calc\(var\(--oc-chunk-n, 5\) \* 68px/.test(theme) &&
      /\.oc-solve-move-tile \{[\s\S]{0,200}?aspect-ratio: 1;/.test(theme));
  // A PREVIEW IS BACK, AND IT IS NOT THE ONE THAT WAS REMOVED. The old
  // one was a 74px box in a column BESIDE the scramble, in the same
  // horizontal sweep as the tiles. This one is above the header,
  // centred, smaller, and dimmed — see .oc-solve-reveal-rec.
  //
  // It exists because the reveal and the cover after it are forty
  // seconds — the longest stretch of the clip — during which the athlete
  // is looking at moves and has no way to tell the camera is alive.
  ok('the reveal shows a small preview again',
    revealCode.includes('oc-solve-reveal-cam') && revealCode.includes('<video ref={videoRef}') &&
      page.includes('videoRef={recorder.videoRef}'));
  ok('  ...above the scramble, not beside it',
    revealCode.indexOf('oc-solve-reveal-rec') < revealCode.indexOf('oc-solve-reveal-head') &&
      !theme.includes('oc-solve-camera-box-mini'));
  // SMALLER THAN A MOVE TILE AT EVERY WIDTH. Tiles shrink on a narrow
  // screen and a fixed box does not: at 64px this was 1.27x a tile in a
  // six-move chunk at 375px — wider than the thing it must not compete
  // with.
  ok('  ...smaller than a move tile, and dimmed',
    /\.oc-solve-reveal-cam \{[\s\S]{0,300}?width: 48px;/.test(theme) &&
      /\.oc-solve-reveal-cam \{[\s\S]{0,400}?opacity: 0\.72;/.test(theme));
  // THE SAME SIGNAL AS THE SOLVE SCREEN'S, from the same two classes: a
  // reassurance only reassures if it is recognised, and a bare dot
  // elsewhere would be a second thing to learn for one fact.
  ok('  ...under the same recording flag the solve screen uses',
    revealCode.includes('oc-solve-rec-dot') && revealCode.includes('oc-solve-rec-flag-text') &&
      revealCode.includes('БИЧИЖ БАЙНА'));
  // WHAT IT DOES NOT REUSE is the positioning: .oc-solve-rec-flag pins
  // itself to the corner of a full-bleed video, which is the solve
  // screen's job and would cover a 48px box.
  ok('  ...without borrowing that screen\u2019s positioning',
    !revealCode.includes('oc-solve-rec-flag"') &&
      /\.oc-solve-rec-flag \{[\s\S]{0,200}?position: absolute;/.test(theme));
  // IT TOUCHES NO RECORDING. MediaRecorder reads the camera track and
  // has never read a <video> element, so adding one here neither starts,
  // stops nor alters the clip.
  ok('  ...and starts or stops nothing',
    !revealCode.includes('startRecording') && !revealCode.includes('stopRecording') &&
      !revealCode.includes('recorder.'));

  // ── REC: THE CAMERA IS THE SCREEN ──
  // It was a 4/3 box in a 720px column, reached after a countdown screen
  // and a flash. Those two are gone; this one is full-bleed.
  ok('rec is full-bleed, the camera filling the screen',
    rec.includes('className="oc-solve-rec-feed"') &&
      /\.oc-solve-rec \{[\s\S]{0,500}?position: absolute;[\s\S]{0,60}?inset: 0;/.test(theme) &&
      /\.oc-solve-rec-feed \{[\s\S]{0,300}?object-fit: cover;/.test(theme));
  ok('  ...with the mockup’s finish button', rec.includes('Эвлүүлэлт дууссан'));

  // ── THE ONLY WAY OUT OF AN ATTEMPT ──
  // IT WAS INVISIBLE ON A PHONE, and geometry said it was fine: the
  // button had a box in the right place, but .oc-solve-rec-feed is
  // absolutely positioned and the button was a STATIC sibling of it, so
  // the opaque video painted over it. A positioned element paints above
  // static in-flow content whatever the DOM order.
  //
  // The fix is structural, not a z-index: the button is not a sibling of
  // the video any more. The camera and its overlays live in one row, and
  // everything that must not be covered lives in another.
  ok('the finish button is not a sibling of the video',
    /oc-solve-rec-view[\s\S]*?oc-solve-rec-feed[\s\S]*?<\/div>[\s\S]*?oc-solve-rec-actions[\s\S]*?oc-solve-btn-finish/.test(rec));
  ok('  ...so nothing positioned can paint over it',
    /\.oc-solve-rec-view \{[^}]*position: relative;/.test(theme) &&
      /\.oc-solve-rec-actions \{[^}]*flex: none;/.test(theme) &&
      !/\.oc-solve-rec-actions \{[^}]*position: absolute;/.test(theme));
  // BELOW THE VIDEO, NOT OVER IT. The cube and the hands sit low in a
  // solve's frame, so a button floating over the bottom of the picture
  // would cover exactly the strip the athlete is watching.
  ok('  ...and covers none of the frame',
    /\.oc-solve-rec-view \{[^}]*flex: 1;/.test(theme) &&
      /\.oc-solve-rec-feed \{[^}]*inset: 0;/.test(theme));
  // The home indicator overlays the bottom of the screen on phones that
  // have one; the band clears it.
  ok('  ...clear of the home indicator',
    /\.oc-solve-rec-actions \{[^}]*padding-bottom: max\(14px, env\(safe-area-inset-bottom\)\);/.test(theme));
  ok('  ...and the old boxed preview gone with the column',
    !theme.includes('oc-solve-rec-box') && !rec.includes('oc-solve-rec-box'));
  ok('the scrolling tick strip is gone', !theme.includes('.oc-solve-tick-strip') && !rec.includes('tick-strip'));

  // ── ENTRY: the mockup's `entry` block, NOT verify's ──
  ok('entry is one 380px column', /\.oc-solve-entry \{[\s\S]{0,200}?max-width: 380px;/.test(theme));
  ok('  ...with no camera beside the keypad', !entry.includes('videoRef') && !entry.includes('<video'));
  ok('  ...the mockup’s 56px well', /\.oc-solve-entry-digits \{[\s\S]{0,120}?font: 700 56px\/0\.9/.test(theme));
  ok('  ...and its 3-column keypad at gap 8',
    /\.oc-solve-keypad \{[\s\S]{0,140}?grid-template-columns: repeat\(3, 1fr\);[\s\S]{0,40}?gap: 8px;/.test(theme));

  // ── SUMMARY, minus the attestation ──
  ok('the summary list is the mockup’s hairline stack',
    /\.oc-solve-attempt-row \{[\s\S]{0,200}?padding: 13px 16px;/.test(theme) &&
      /\.oc-solve-attempt-time \{[\s\S]{0,140}?font: 700 24px\/1/.test(theme));
  ok('  ...and the average box its volt frame',
    /\.oc-solve-ao5-box \{[\s\S]{0,200}?border: 1px solid #DFFF4F;[\s\S]{0,120}?padding: 16px 18px;/.test(theme) &&
      /\.oc-solve-ao5-value \{[\s\S]{0,120}?font: 700 44px\/0\.9/.test(theme));
  // Changeset 5, both of them: the checkbox and the label whose colours
  // the mockup binds to it.
  // The checkbox and the label it gates arrived in changeset 5; what this
  // section still owns is that the box sits ABOVE the button, which is
  // the mockup's order and the only order in which it is a gate.
  ok('  ...with the attestation above the submit button',
    summaryCode.indexOf('oc-solve-attest') < summaryCode.indexOf('oc-solve-btn-submit'));

  // ── SENT ──
  ok('the sent grid is 18px cells at gap 4',
    /\.oc-solve-sent-grid \{[\s\S]{0,200}?repeat\(3, 18px\);[\s\S]{0,120}?gap: 4px;/.test(theme));
  ok('  ...on the mockup’s ink', sent.includes("ink: '#1C1C21'"));

  // ── WHAT MUST NOT MOVE ──
  ok('the recording boundary did not move',
    page.includes("if (stage === 'zeroDisplay') {") &&
      page.includes("onFinish={() => setStage('finishHold')}") &&
      page.includes('async function finishRecording'));
  ok('the hold durations did not move',
    page.includes('const HOLD_SECONDS = 8;') && (page.match(/seconds=\{HOLD_SECONDS\}/g) ?? []).length === 3);
  ok('the markers are gone and stayed gone', !rec.includes('MARKER_TIMES_MS'));
  ok('resume did not move',
    /plan\.kind === 'complete'[\s\S]{0,200}setStage\('summary'\)/.test(page) &&
      page.includes('setResumeMessage(resumeNotice(plan))'));
  // The lobby WAS restyled, deliberately and later than this changeset —
  // the camera became the screen (see "the preview is the recording").
  // What that rework had to leave alone is asserted where it was made;
  // here, only that it did not drag the between screen along with it.
  ok('between was not restyled',
    between.includes('className="oc-solve-between"') &&
      /\.oc-solve-between \{[\s\S]{0,200}?max-width: 520px;[\s\S]{0,120}?gap: 22px;/.test(theme));
  ok('  ...and the lobby is still the lobby', lobby.includes('className="oc-solve-lobby"'));
  ok('the stage list is fifteen long', (page.match(/^  \| '[a-zA-Z]+'/gm) ?? []).length === 15);
  // count and go were merged into rec; verify was never built, because
  // it merges the closing hold with the keypad and that moves the
  // recording boundary.
  ok('  ...cover stayed, count and go merged away, verify never arrived',
    page.includes("| 'cover'") && !page.includes("| 'count'") &&
      !page.includes("| 'go'") && !page.includes("'verify'"));

  // ── ONE ROW PER CHUNK, AT EVERY WIDTH ──
  // A grid with one column per move cannot wrap: there is no second row
  // to wrap onto. It was a flex row with flex-wrap and fixed tiles,
  // which put a lone move on a line of its own the moment a chunk was
  // one tile too wide.
  ok('a chunk cannot wrap, because the row has one line',
    /\.oc-solve-move-row \{[\s\S]{0,400}?grid-template-columns: repeat\(var\(--oc-chunk-n, 5\), minmax\(0, 1fr\)\);/.test(theme) &&
      !/\.oc-solve-move-row \{[^}]*flex-wrap/.test(theme));
  ok('  ...with the column count coming from the chunk on screen',
    reveal.includes("'--oc-chunk-n': moves.length"));
  // Type follows the tile, not the viewport — a fixed 30px overflowed a
  // 37px tile, which is what an eight-move chunk gives at 375px.
  ok('  ...and the type scaling with the tile it sits in',
    /\.oc-solve-move-row \{[\s\S]{0,500}?container-type: inline-size;/.test(theme) &&
      /font-size: clamp\(11px, calc\(100cqw \/ var\(--oc-chunk-n, 5\) \* 0\.41\), 30px\);/.test(theme));
  ok('  ...and the 56px keypad well shrinks with them',
    /\.oc-solve-entry-digits \{\s*\n\s*font-size: 44px;/.test(theme));
}

console.log('\n  -- 11. the inspection --');
{
  const cover = fs.readFileSync(path.join(ROOT, SOLVE, '_components/CoverStage.tsx'), 'utf8');
  const ready = fs.readFileSync(path.join(ROOT, SOLVE, '_components/ReadyPromptStage.tsx'), 'utf8');
  const recCode2 = stripComments(rec);
  const pageCode = stripComments(page);

  // ── THE SEQUENCE ──
  // STRAIGHT TO THE COVER. A five-second coverPrep screen sat here for
  // one changeset and is gone, file and all — the cover's own twenty
  // seconds are now long enough to read the instruction and act on it,
  // which is what the extra screen was compensating for.
  ok('reveal hands to cover',
    /<RevealStage[\s\S]{0,400}?onDone=\{\(\) => setStage\('cover'\)\}/.test(page));
  ok('  ...and the prep screen is gone, file and all',
    !fs.existsSync(path.join(ROOT, SOLVE, '_components/CoverPrepStage.tsx')) &&
      !page.includes('coverPrep') && !page.includes('CoverPrepStage') &&
      !theme.includes('oc-solve-prep'));
  ok('  ...cover to ready', page.includes("<CoverStage seconds={COVER_SECONDS} onDone={() => setStage('readyPrompt')} />"));
  // STRAIGHT TO THE SOLVE SCREEN. `count` and `go` sat between these
  // two — three screens for one continuous moment, and the middle one
  // told the athlete when to begin, which WCA does not.
  ok('  ...and ready straight to rec', page.includes("<ReadyPromptStage onDone={() => setStage('rec')} />"));
  ok('  ...with both merged stages gone, files and all',
    !fs.existsSync(path.join(ROOT, SOLVE, '_components/CountStage.tsx')) &&
      !fs.existsSync(path.join(ROOT, SOLVE, '_components/GoStage.tsx')) &&
      !page.includes('CountStage') && !page.includes('GoStage') &&
      !page.includes("'count'") && !page.includes("'go'"));
  ok('  ...and their constants with them',
    !page.includes('const INSPECTION_SECONDS') && !page.includes('GO_FLASH_MS'));
  ok('  ...and their CSS',
    !theme.includes('oc-solve-count') && !theme.includes('oc-solve-goflash'));

  // ── ALL THREE ARE INSIDE THE RECORDING ──
  ok('the recording still starts at the opening hold', page.includes("if (stage === 'zeroDisplay') {"));
  ok('  ...and still stops after the closing hold, nowhere else',
    page.includes("onFinish={() => setStage('finishHold')}") &&
      /async function finishRecording[\s\S]{0,200}?await recorder\.stopRecording\(\)/.test(page));
  // THE MERGE MOVED NEITHER END OF THE CLIP. It already ran across all
  // three of the screens folded together here, so folding them changes
  // nothing about where it starts or stops — and the merged screen
  // touches the recorder no more than its parts did.
  ok('  ...so neither the cover nor the merged solve screen touches it',
    [cover, stripComments(rec)]
      .every((f) => !f.includes('startRecording') && !f.includes('stopRecording')));
  // EVERY stage of an attempt must be in ATTEMPT_STAGES, or the bar drops
  // its attempt label part-way through one.
  {
    const list = page.slice(page.indexOf('const ATTEMPT_STAGES'), page.indexOf('/** Below this, the file is not'));
    const inList = (list.match(/'[a-zA-Z]+'/g) ?? []).map((x) => x.slice(1, -1));
    const union = (page.match(/^  \| '([a-zA-Z]+)'/gm) ?? []).map((m) => m.slice(5, -1));
    const notAnAttempt = ['lobby', 'between', 'summary', 'sent'];
    ok('every stage of an attempt is in ATTEMPT_STAGES',
      union.filter((u) => !notAnAttempt.includes(u)).every((u) => inList.includes(u)),
      union.filter((u) => !notAnAttempt.includes(u) && !inList.includes(u)).join(',') || 'all present');
    // TWO FEWER: count and go merged into rec.
    ok('  ...eleven of them', inList.length === 11, String(inList.length));
    // attemptIntro names the attempt it introduces ("3-р эвлүүлэлт эхлэх
    // гэж байна"), so the bar must claim that attempt too — the two
    // would otherwise disagree on the same screen.
    ok('  ...including the intro, which names its attempt', inList.includes('attemptIntro'));
    ok('  ...including the cover, and no longer count or go',
      inList.includes('cover') && !inList.includes('count') && !inList.includes('go'));
    ok('  ...and the four that are not an attempt stay out',
      notAnAttempt.every((x) => !inList.includes(x)));
  }

  // ── COVER ──
  ok('cover is the mockup’s 620px column with two 78px faces',
    /\.oc-solve-cover \{[\s\S]{0,200}?max-width: 620px;[\s\S]{0,120}?gap: 24px;/.test(theme) &&
      /\.oc-solve-cover-grid \{[\s\S]{0,140}?width: 78px;[\s\S]{0,40}?height: 78px;/.test(theme));
  ok('  ...in the mockup’s own cube colours', cover.includes("'#00FF55'") && cover.includes("'#F4F1EA'"));
  // ONE go-ahead, and it is ready's. The mockup gives cover a БЭЛЭН of its
  // own; two on two consecutive screens is one too many, and the one that
  // must not be pressable early is the one that stayed.
  ok('cover carries no button of its own', !cover.includes('<button'));
  ok('  ...so the single go-ahead is still ready’s',
    (stripComments(ready).match(/<button/g) ?? []).length === 1);
  ok('  ...which still cannot end a hold early',
    !stripComments(ready).includes('seconds') && !stripComments(ready).includes('setTimeout'));
  // ...and it now starts the inspection rather than the solve, so it says so.
  ok('  ...and says what it now starts', ready.includes('ажиглалтаа эхлүүлээрэй') || ready.includes('Ажиглалтаа эхлүүлэх'));

  // ── THE INSPECTION, ON THE SOLVE SCREEN ──
  // Fifteen seconds, counted UP. Up, not down, because a countdown is a
  // deadline — it says something happens at zero, and here nothing does.
  ok('the inspection window is fifteen seconds',
    rec.includes('const INSPECTION_WINDOW_SECONDS = 15;'));
  ok('  ...counted up, 1 to 15, from one value',
    rec.includes('useState(1)') &&
      rec.includes('Math.min(e + 1, INSPECTION_WINDOW_SECONDS)'));
  ok('  ...and NOT a stage duration: nothing advances when it is reached',
    !rec.includes('setTimeout') && !stripComments(rec).includes('onDone'));
  // SMALL AND PERIPHERAL. An athlete inspecting a cube should be looking
  // at the cube, so the counter is sized and placed to be glanced at.
  ok('  ...shown small, in the corner, not as a 210px number',
    /\.oc-solve-insp \{[\s\S]{0,400}?position: absolute;[\s\S]{0,400}?font: 600 15px\/1/.test(theme) &&
      !theme.includes('.oc-solve-count-n'));
  // AT FIFTEEN IT GOES. A number parked at the end of a closed window
  // still looks like it means something, and the only thing it could be
  // taken to mean is the penalty this platform does not apply. Faded,
  // not removed, because the athlete may be mid-solve.
  ok('  ...then fading out rather than sitting on 15',
    rec.includes('oc-solve-insp-done') &&
      /\.oc-solve-insp-done \{\s*\n\s*opacity: 0;/.test(theme) &&
      /\.oc-solve-insp \{[^}]*transition:[^;]*opacity/.test(theme));
  // NOTHING TELLS THE ATHLETE TO BEGIN. That was `go`'s whole job and
  // it is the part of it that had to not come back: WCA inspection is UP
  // TO fifteen seconds, and going at six is a legitimate solve.
  ok('  ...and nothing on it says when to start',
    !recCode2.includes('ЭВЛҮҮЛЖ ЭХЛЭЭРЭЙ') && !recCode2.includes('эхлээрэй') &&
      !theme.includes('oc-solve-goflash'));
  // THE BUTTON IS THERE THROUGHOUT, at nine seconds or ninety.
  ok('  ...while the finish button is present from the first frame',
    /<button type="button" className="oc-solve-btn-finish"/.test(rec) &&
      !/disabled/.test(rec));

  // THE PART THAT MATTERS: no client-side penalty, anywhere. Fifteen
  // seconds passing does nothing at all.
  ok('the solve screen writes no penalty',
    !recCode2.includes('penalty') && !recCode2.includes('+2'));
  ok('  ...and neither does the page', !pageCode.includes('penalty'));
  ok('  ...and it names no rule it cannot apply',
    !recCode2.includes('17') && !recCode2.includes('DNF'));
  // The judge's +2 is real and reaches scoring — that is what answers an
  // overrun, and it is a field athletes cannot write.
  ok('the judge’s +2 still reaches every scorer',
    fs.readFileSync(path.join(ROOT, 'lib/online-competition/ao5.ts'), 'utf8')
      .includes("a.penalty === '+2' ? 200 : 0"));
  ok('  ...and athletes still cannot set one',
    fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
      .includes('request.resource.data.penalty == null'));

  // EXACTLY ONE THING OWNS THE INSPECTION, and now it is the solve
  // screen's counter. The old panel's label is gone with its stage: a
  // bare number needs no heading, and a heading would make it something
  // to read rather than glance at.
  ok('the inspection is a bare counter, with no panel or label',
    !recCode2.includes('АЖИГЛАХ') && !theme.includes('oc-solve-count-label'));
  // THE EARLY EXIT IS GONE WITH THE STAGE, and nothing replaced it,
  // because there is nothing left to exit. `count` needed a "done"
  // button so an athlete who had planned their solve at six was not held
  // for the remaining nine seconds; here the window does not hold them
  // at all — they simply start turning, and the counter goes on counting
  // beside them without meaning anything.
  ok('nothing on the screen ends the inspection early, or at all',
    !rec.includes('oc-solve-count-go') && !theme.includes('oc-solve-count-go'));

  // Neither full-bleed screen may cover the bar: ГАРАХ is the only way
  // out. The flash is gone; the solve screen took its place as the
  // second full-bleed one.
  ok('neither full-bleed screen covers the bar',
    /\.oc-solve-ready \{[\s\S]{0,200}?position: absolute;/.test(theme) &&
      /\.oc-solve-rec \{[\s\S]{0,500}?position: absolute;/.test(theme) &&
      /\.oc-solve-body \{[\s\S]{0,220}?position: relative;/.test(theme));

  // ── WHAT MUST NOT MOVE ──
  ok('resume did not move',
    /plan\.kind === 'complete'[\s\S]{0,200}setStage\('summary'\)/.test(page) &&
      page.includes('setResumeMessage(resumeNotice(plan))'));
  ok('lobby, between, entry, summary and sent were not touched', [
    ['.oc-solve-lobby', '1080px'], ['.oc-solve-between', '520px'], ['.oc-solve-entry', '380px'],
    ['.oc-solve-summary', '560px'], ['.oc-solve-sent', '460px'],
  ].every(([sel, w]) => new RegExp(`\\${sel} \\{[\\s\\S]{0,220}?max-width: ${w};`).test(theme)));
  ok('the markers are gone and stayed gone', !rec.includes('MARKER_TIMES_MS'));

  // 375px: the two numbers that did not fit as specified are gone with
  // their stages — a 210px countdown and a 46px flash title. What is
  // left on the solve screen is a 15px counter, which fits anywhere.
  ok('the two oversized numbers went with their stages',
    !theme.includes('.oc-solve-count-n') && !theme.includes('.oc-solve-goflash-title'));
}

console.log('\n  -- 12. the attestation --');
{
  const summaryCode2 = stripComments(summary);

  // THE MOCKUP'S OWN WORDING is «Миний эвлүүлэлт үнэн зөв байна» — my
  // solve is correct. It names no act, so ticking it costs a cheat
  // nothing. These name acts the athlete alone knows and the video can be
  // checked against.
  ok('the attestation is not the mockup’s unfalsifiable line',
    !summaryCode2.includes('Миний эвлүүлэлт үнэн зөв байна'));
  ok('  ...it attests to the times matching the athlete’s own timer',
    summary.includes('өөрийн таймерын заасантай тохирч байна'));
  ok('  ...to nobody having helped', summary.includes('тусламж, зөвлөгөөгүйгээр'));
  ok('  ...and to the recording being unedited', summary.includes('засвар, хасалт, тасалдал ороогүй'));
  ok('  ...three of them, in one list', /const ATTESTATIONS = \[[\s\S]{0,400}?\];/.test(summary) &&
    (summary.match(/^  '[^']+',$/gm) ?? []).length === 3);

  // The mockup's geometry, and its two box states.
  ok('the checkbox is the mockup’s 20px box in a bordered row',
    /\.oc-solve-attest \{[\s\S]{0,260}?border: 1px solid #2A2A31;[\s\S]{0,120}?padding: 15px 16px;/.test(theme) &&
      /\.oc-solve-attest-box \{[\s\S]{0,140}?width: 20px;[\s\S]{0,40}?height: 20px;/.test(theme));
  ok('  ...volt when ticked', /\.oc-solve-attest-box-on \{[\s\S]{0,120}?background: #DFFF4F;/.test(theme));
  ok('  ...and it is a real toggle', summary.includes('setAttested((v) => !v)') &&
    summary.includes('aria-pressed={attested}'));

  // THE BUTTON'S COLOURS FOLLOW IT, as the mockup binds them — an outline
  // that says "not yet", not a greyed one that says broken.
  ok('the submit button is gated on the checkbox',
    summary.includes('disabled={submitting || !attested}'));
  ok('  ...and looks ungated rather than broken',
    /\.oc-solve-btn-submit:disabled \{[\s\S]{0,200}?background: transparent;[\s\S]{0,120}?color: #4A4740;/.test(theme));

  // NOT STORED, and the code says so rather than implying otherwise: it
  // gates a button in one tab. Making it evidence needs a field.
  ok('the attestation is local to the screen and not persisted',
    summary.includes('const [attested, setAttested] = useState(false);') &&
      !page.includes('attested') &&
      !fs.readFileSync(path.join(ROOT, 'lib/online-competition/data.ts'), 'utf8').includes('attested'));

  // THE LABEL is neither the mockup's nor the old one. Every attempt is
  // already on the server; the only thing this sends is the result line.
  ok('the submit label does not promise to send what is already sent',
    !summaryCode2.includes('Бүгдийг илгээх'));
  ok('  ...it names the one thing it does send', summary.includes("'Дүнгээ илгээх'"));
  // ...and the run's result really is all that is left to write.
  ok('  ...which is all handleFinish writes',
    /async function handleFinish\(\)[\s\S]{0,2600}?await recordAo5Result\(/.test(page) &&
      !/async function handleFinish\(\)[\s\S]{0,2600}?uploadVideoToCloudinary/.test(page));

  // ── WHAT MUST NOT MOVE ──
  ok('the recording boundary did not move',
    page.includes("if (stage === 'zeroDisplay') {") &&
      page.includes("onFinish={() => setStage('finishHold')}") &&
      /async function finishRecording[\s\S]{0,200}?await recorder\.stopRecording\(\)/.test(page));
  ok('the hold durations did not move',
    page.includes('const HOLD_SECONDS = 8;') && (page.match(/seconds=\{HOLD_SECONDS\}/g) ?? []).length === 3);
  // THE INSPECTION IS STILL FIFTEEN SECONDS, but it is no longer a stage
  // duration: `count` and `go` merged into the solve screen, so nothing
  // advances when the window is reached and the page holds no constant
  // for it. The number lives with the counter that shows it.
  ok('the inspection window is still fifteen seconds',
    rec.includes('const INSPECTION_WINDOW_SECONDS = 15;') &&
      !page.includes('INSPECTION_SECONDS') && !page.includes('GO_FLASH_MS'));
  ok('  ...and one thing still owns it — the solve screen’s counter',
    !stripComments(rec).includes('АЖИГЛАХ') &&
      theme.includes('.oc-solve-insp {') && !theme.includes('.oc-solve-count-label'));
  ok('resume did not move',
    /plan\.kind === 'complete'[\s\S]{0,200}setStage\('summary'\)/.test(page) &&
      page.includes('setResumeMessage(resumeNotice(plan))'));
  ok('the stage list did not move', (page.match(/^  \| '[a-zA-Z]+'/gm) ?? []).length === 15);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
