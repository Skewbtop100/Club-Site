'use client';

import { useEffect, useRef, useState } from 'react';
import type { useSolveRecorder } from './useSolveRecorder';

// ── The run's stage machine ─────────────────────────────────────────────
// The Stage union, the transitions between stages, the RECORDING BOUNDARY,
// and the guards in front of a run in progress. Extracted verbatim from
// the competition solve page, which now composes this hook; the comments
// below came with the code they explain.
//
// WHAT IS HERE is everything a recorded run needs whatever it is a run OF.
// WHAT IS NOT is everything that makes a run a COMPETITION attempt, and
// that all stays on the page: the scramble fetch through the gate, the
// round and its cutoffs, attempt numbering and resume, the PR check, and
// filing to onlineSubmissions. This hook never learns a competitionId.
//
// ── HOW IT TALKS TO THE PAGE ──
// Three values in, because the machine's transitions genuinely depend on
// them and it must not own them:
//   `scramble`      — nothing may enter zeroDisplay without one, and the
//                     fetch that produces it is competition-bound;
//   `filingFailed`  — a filing that has given up stops the run before the
//                     next attempt records;
//   `unfiledCount`  — what the leave guards are protecting, and the
//                     number the dialog names.
// The recorder is passed in rather than created here: the page's render
// hands `recorder.videoRef` to every stage and calls `recorder.mark()` from
// each transition, so it is the page's for the whole of the run's life.
// Nothing in this file changes the recorder.


export type Stage =
  /** The first screen of a round, and the only one that asks for the
   *  camera. Absorbed cameraSetup, which existed to do nothing else. */
  | 'lobby'
  /** Waiting for THIS attempt's scramble — and where the run parks if
   *  that fetch fails. Nothing may enter zeroDisplay (which starts the
   *  recording) without a scramble in hand. */
  | 'scrambleWait'
  /** The beat before the timer check: "attempt N is about to start, get
   *  your timer ready". Five seconds, no camera, NOT on the recording —
   *  the clip still begins at zeroDisplay, where the evidence begins.
   *  It exists because the hold's eight seconds start the instant it
   *  renders, and an athlete still reaching for their timer spent the
   *  first half of a measured hold doing it. */
  | 'attemptIntro'
  | 'zeroDisplay'
  /** The camera stopped being a camera: MediaRecorder would not start, or
   *  it started and gave back an empty file. The attempt does not
   *  continue without a recording — see RecordingFailedStage. */
  | 'recordingFailed'
  | 'scrambleReveal'
  /** The cube goes under its cover, white up and green to camera. Took
   *  over orientationHold's eight seconds AND its job; what it adds is
   *  that the cube ends up hidden, so the moment the cover comes off is a
   *  visible mark on the video and the inspection can be measured. */
  | 'cover'
  | 'readyPrompt'
  /** THE INSPECTION AND THE SOLVE, on one screen. It absorbed `count`
   *  (a 130px countdown) and `go` (a full-bleed flash): three screens for
   *  one continuous moment, the middle of which told the athlete when to
   *  begin — which WCA does not. Inspection is up to fifteen seconds and
   *  going at six is a legitimate solve. The window is a quiet counter on
   *  this screen now, and nothing advances when it is reached. */
  | 'rec'
  /** The hold AFTER the solve: the athlete shows their timer to the
   *  camera. The reading on that timer is the evidence for the time typed
   *  two screens later, so it has to be on the same continuous video as
   *  the solve it belongs to. */
  | 'finishHold'
  /** And then the CUBE, turned slowly so every face is seen. THE CLIP
   *  STOPS HERE now — one stage later than it used to.
   *
   *  Why it moved: the cube's final state is what a judge reads to decide
   *  +2 (one face off by a turn) or DNF (more than that), and until now
   *  nothing on the video showed it. The time was evidenced and the solve
   *  was not. Evidence that arrives after the recording has stopped is not
   *  evidence, so the boundary had to follow it. */
  | 'cubeCheck'
  | 'entry'
  /** The pause between attempts, and the run's only waiting screen: it
   *  absorbed `filing`. The athlete reads their times, watches the last
   *  one land, and starts the next one when they choose to — the old
   *  filing stage moved on by itself, which took that choice away. */
  | 'between'
  | 'summary'
  | 'sent';

/** Below this, the file is not a recording — it is an empty container.
 *
 *  A real attempt is at least the 5-second frozen "0.00" plus the reveal,
 *  the orientation hold and the solve itself; at the recorder's capped bitrate
 *  that is hundreds of kilobytes. A MediaRecorder that produced nothing
 *  yields ~110 bytes (measured — see the note in useSolveRecorder about
 *  the second audio track that once did exactly this to every attempt).
 *  1 KB sits two orders of magnitude below the smallest real clip and an
 *  order above an empty one, so it cannot reject a genuine recording. */
const MIN_RECORDING_BYTES = 1024;

/** The browser's own dialog wording is not ours to choose, so
 *  beforeunload gets no message. Ours is for in-app navigation.
 *
 *  One loss to describe now: the attempt that has not been filed yet. The
 *  ones before it are on the server, and returning to this page picks the
 *  run up at the next attempt — so the dialog says what actually happens,
 *  which is that this one solve has to be done again. */
export function leaveConfirmMessage(unfiledAttempts: number): string {
  return (
    `Хадгалагдаагүй ${unfiledAttempts} оролдлого байна. Хуудаснаас гарвал тэр бичлэг устаж, ` +
    'уг оролдлогыг дахин хийх шаардлагатай болно. Өмнөх оролдлогууд сервэрт хэвээр үлдэнэ. Гарах уу?'
  );
}

export interface SolveRun {
  stage: Stage;
  setStage: (stage: Stage) => void;
  recordingFailure: 'start' | 'empty' | null;
  setRecordingFailure: (failure: 'start' | 'empty' | null) => void;
  pendingBlob: Blob | null;
  setPendingBlob: (blob: Blob | null) => void;
  /** An attempt is recorded and not yet on the server, and the run has not
   *  been sent. What the leave guards protect. */
  runAtRisk: boolean;
  finishRecording: () => Promise<void>;
}

export function useSolveRun({
  recorder,
  scramble,
  unfiledCount,
  filingFailed,
}: {
  recorder: ReturnType<typeof useSolveRecorder>;
  /** THIS attempt's scramble, or '' while it has not arrived. */
  scramble: string;
  /** Attempts recorded but not yet on the server. */
  unfiledCount: number;
  /** A filing that has stopped trying on its own and needs the athlete. */
  filingFailed: boolean;
}): SolveRun {
  const [stage, setStage] = useState<Stage>('lobby');
  /** The recording of the attempt being entered, between the moment it is
   *  accepted and the moment the athlete confirms their time.
   *
   *  STATE, NOT A REF, and that is the whole safety argument of this
   *  changeset. The keypad cannot render without it (see the render gate),
   *  and handleEntryConfirm takes it as a REQUIRED PARAMETER rather than
   *  reading it — so "confirm a time with no video" is not an ordering
   *  mistake waiting to happen, it is a thing that does not typecheck and
   *  does not render. A ref could be read as null by a keypad that mounted
   *  first, and the old `?? new Blob([])` fallback would then have filed a
   *  0-byte video with a time attached to it. */
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  /** Why the recording for the current attempt is unusable, or null.
   *  Drives the recordingFailed stage. */
  const [recordingFailure, setRecordingFailure] = useState<'start' | 'empty' | null>(null);

  // THE WAIT, and it is now only ever reached from the END of the intro.
  // An attempt is promoted off it only once a scramble has actually
  // arrived. A fetch that fails simply never promotes: the run sits on
  // the wait stage with a retry button instead of recording an attempt it
  // has no scramble for.
  //
  // It promotes straight to zeroDisplay. The athlete has already had
  // their five seconds of intro before landing here — that is what this
  // screen means now, "the scramble did not arrive during the intro" —
  // and making them sit through a second one would be a beat they have
  // already had. The gate is unchanged: this is still the only promotion
  // and it is still conditional on `scramble`.
  useEffect(() => {
    if (stage !== 'scrambleWait') return;
    // A filing that has given up stops the run here, before the next
    // attempt starts recording. The queue already guarantees ORDER; this
    // guarantees the athlete finds out, and that unfiled recordings cannot
    // pile up in memory behind a broken connection.
    if (filingFailed) {
      setStage('between');
      return;
    }
    if (scramble) setStage('zeroDisplay');
  }, [stage, scramble, filingFailed]);

  useEffect(() => {
    return () => recorder.releaseCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Leaving with a run in progress ───────────────────────────────────
  // Every solved attempt is a video blob in memory, uploaded only when the
  // whole run is submitted. Leaving throws all of them away, and until now
  // nothing said so.
  //
  // It now protects exactly one thing: the attempt that has been recorded
  // but not yet filed. Everything before it is on the server, and coming
  // back resumes at the next attempt — so leaving with nothing in flight
  // costs nothing and is not worth a dialog.
  const runAtRisk = unfiledCount > 0 && stage !== 'sent';
  // Read inside the listeners below, which are installed once per
  // at-risk run and must not be re-installed on every attempt (each
  // install pushes a history entry).
  const attemptCountRef = useRef(0);
  useEffect(() => {
    // `unfiledCount` IS this count — the page derives it from `attempts`
    // and hands it in. Reading it here instead of re-filtering the array
    // writes the same number to the ref; the dependency narrows from the
    // array to the count it produces, so a change to `attempts` that
    // leaves the count alone no longer rewrites the same value.
    attemptCountRef.current = unfiledCount;
  }, [unfiledCount]);

  useEffect(() => {
    if (!runAtRisk) return;

    // Reload, tab close, and any navigation that really unloads the
    // document. The browser shows ITS OWN wording here; a message set on
    // the event has been ignored by every current browser for years.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Back, in an app this size, is usually NOT an unload: Next handles
    // it client-side, beforeunload never fires, and the run would vanish
    // silently. So we keep one spare history entry to absorb the first
    // Back, and ask in our own words.
    //
    // The pushed state is a COPY of Next's current one: popping an entry
    // whose state the router does not recognise can make it fall back to
    // a full page load — which would destroy the very run this is
    // protecting.
    window.history.pushState(window.history.state, '', window.location.href);
    let leaving = false;
    const onPopState = () => {
      if (leaving) return;
      if (window.confirm(leaveConfirmMessage(attemptCountRef.current))) {
        leaving = true;
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.history.back();
        return;
      }
      window.history.pushState(window.history.state, '', window.location.href);
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
    };
  }, [runAtRisk]);

  // ── WHERE THE CLIP BEGINS, and why it did not move ──────────────────
  // Recording starts the moment each attempt's zeroDisplay begins (the
  // frozen "0.00" itself must be on video, proving the timer read zero
  // before the scramble was applied) and runs uninterrupted through
  // scrambleReveal -> cover -> readyPrompt -> count -> go -> rec, stopping
  // only when the athlete clicks "Дуусгах" in rec. `stage` only takes the
  // value 'zeroDisplay' at the start of a fresh attempt — never as an
  // intermediate value while already sitting in zeroDisplay — so this
  // fires exactly once per attempt.
  //
  // attemptIntro now runs BEFORE this, and the clip deliberately does NOT
  // begin there. The recording exists to be evidence, and it should start
  // where the evidence starts: the first thing a judge needs to see is a
  // timer reading 0.00 before the scramble was applied. Nothing on the
  // intro is evidence of anything — it is five seconds of an athlete
  // reaching for a timer. Starting there would add those five seconds to
  // every clip of every attempt of every athlete, for upload, storage and
  // review, and prove nothing that zeroDisplay does not already prove.
  // The boundary is therefore exactly where it was: this effect is still
  // keyed on 'zeroDisplay' alone.
  //
  // TWO transitions reach it, and both hold a scramble. The intro's exit
  // takes it when the fetch has landed; when it has not, the intro sends
  // the run to scrambleWait, whose promotion effect above is the other —
  // and that one is conditional on `scramble` too. So the recording still
  // cannot start for an attempt whose scramble never arrived, and the
  // press that begins an attempt no longer has to know anything about
  // it.
  useEffect(() => {
    if (stage !== 'zeroDisplay') return;
    // AWAITED, AND THAT IS LOAD-BEARING. startRecording became async so it
    // can put a frame on the canvas before starting the recorder — a
    // canvas stream emits nothing until it is drawn, and a recorder
    // started before that produces a clip whose t=0 is later than
    // recordingT0, which silently shifts every mark and every jump.
    //
    // `if (!recorder.startRecording())` still COMPILES against a promise
    // — a promise is truthy, so the negation is always false — which
    // would have turned the failure branch below into dead code without
    // a single type error. The await is what keeps it reachable.
    let cancelled = false;
    void (async () => {
      // False when the stream is gone — phone locked, camera taken by
      // another app, permission revoked — and the attempt would otherwise
      // run to completion and upload a 0-byte video that only a judge
      // ever discovered.
      const started = await recorder.startRecording();
      // The run may have left zeroDisplay while we waited (the athlete
      // navigated away, or the camera was released). Reporting a failure
      // into a stage that no longer exists would strand them on the
      // recording-failed screen for an attempt they had abandoned.
      if (!cancelled && !started) setRecordingFailure('start');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (recordingFailure !== null) setStage('recordingFailed');
  }, [recordingFailure]);

  /** Ends the recording and hands it to the keypad. The ONLY route from
   *  the last hold to the time entry.
   *
   *  WHERE THE CLIP STOPS. This function is the boundary, and it did not
   *  change when the boundary moved: stopRecording, the size check and the
   *  blob handoff are all still here, in this order, in one place. What
   *  moved is WHO CALLS IT — cubeCheck's onDone rather than finishHold's —
   *  so the clip now runs eight seconds longer and covers the cube as well
   *  as the timer. Moving a call site is the whole change; nothing about
   *  how the recording is ended, checked or handed on is different.
   *
   *  The blob and the stage are set together, so React commits them in one
   *  render: the keypad never exists in a frame where the recording does
   *  not. A recording that came back empty goes to the failure stage
   *  instead — the athlete re-solves the attempt rather than filing a time
   *  with no evidence. */
  async function finishRecording() {
    const blob = await recorder.stopRecording();
    // A recorder that started and still produced nothing — the stream died
    // mid-attempt. Accepting this hands the judge an empty file with a
    // time attached to it.
    if (blob.size < MIN_RECORDING_BYTES) {
      setRecordingFailure('empty');
      return;
    }
    setPendingBlob(blob);
    setStage('entry');
  }

  return {
    stage,
    setStage,
    recordingFailure,
    setRecordingFailure,
    pendingBlob,
    setPendingBlob,
    runAtRisk,
    finishRecording,
  };
}
