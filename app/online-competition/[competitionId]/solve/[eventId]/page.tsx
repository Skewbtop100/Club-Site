'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import {
  fetchCompetition,
  createSubmission,
  fetchParticipant,
  recordAo5Result,
  SubmissionAlreadyFiledError,
} from '@/lib/online-competition/data';
import { uploadVideoToCloudinary } from '@/lib/online-competition/cloudinary';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useSolveRecorder } from './_lib/useSolveRecorder';
import type { AttemptTime } from '@/lib/online-competition/ao5';
import {
  attemptsForFormat,
  computeResult,
  cutoffPhaseFor,
  resolveResultFormat,
  type ResultFormat,
} from '@/lib/online-competition/ao5';
import { beatsPr } from './_lib/prCheck';
import { fmtTimeLimit } from '@/lib/online-competition/time-utils';
import Header from './_components/Header';
import CameraSetupStage from './_components/CameraSetupStage';
import ZeroDisplayStage from './_components/ZeroDisplayStage';
import RevealStage from './_components/RevealStage';
import OrientationHoldStage from './_components/OrientationHoldStage';
import ReadyPromptStage from './_components/ReadyPromptStage';
import RecStage from './_components/RecStage';
import EntryStage from './_components/EntryStage';
import SummaryStage from './_components/SummaryStage';
import RecordingFailedStage from './_components/RecordingFailedStage';
import ScrambleWaitStage from './_components/ScrambleWaitStage';
import SentStage from './_components/SentStage';
import AuthModal from '@/app/online-competition/_components/hub/v3/AuthModal';

type Stage =
  | 'cameraSetup'
  /** Waiting for THIS attempt's scramble — and where the run parks if
   *  that fetch fails. Nothing may enter zeroDisplay (which starts the
   *  recording) without a scramble in hand. */
  | 'scrambleWait'
  | 'zeroDisplay'
  /** The camera stopped being a camera: MediaRecorder would not start, or
   *  it started and gave back an empty file. The attempt does not
   *  continue without a recording — see RecordingFailedStage. */
  | 'recordingFailed'
  | 'scrambleReveal'
  | 'orientationHold'
  | 'readyPrompt'
  | 'rec'
  | 'entry'
  | 'summary'
  | 'sent';

/** Attempts in a run come from the event's resultFormat via
 *  attemptsForFormat — there is no constant here any more. See `runShape`
 *  below for why it is captured once rather than read per render. */

/** One attempt's value for LOCAL display and the provisional result the
 *  athlete is shown. Mirrors effectiveAttemptTime's limit rule for a time
 *  that has not been judged yet — no status, no penalty, just the
 *  athlete's own number against the limit. */
function attemptTime(a: { timeCs: number | null; isDnf: boolean }, timeLimitCs: number | null): AttemptTime {
  if (a.isDnf || a.timeCs === null) return 'DNF';
  if (timeLimitCs !== null && a.timeCs > timeLimitCs) return 'DNF';
  return a.timeCs;
}

/** Fastest non-DNF attempt, or null if there was none. */
function bestSingle(times: AttemptTime[]): number | null {
  const finished = times.filter((t): t is number => t !== 'DNF');
  return finished.length > 0 ? Math.min(...finished) : null;
}

interface Attempt {
  timeCs: number | null;
  isDnf: boolean;
  videoBlob: Blob | null;
}

const HEADER_STAGES: Stage[] = [
  'scrambleWait',
  'zeroDisplay',
  'recordingFailed',
  'scrambleReveal',
  'orientationHold',
  'readyPrompt',
  'rec',
  'entry',
];

/** Below this, the file is not a recording — it is an empty container.
 *
 *  A real attempt is at least the 5-second frozen "0.00" plus the reveal,
 *  the orientation hold and the solve itself; at the recorder's 250 kbps
 *  that is hundreds of kilobytes. A MediaRecorder that produced nothing
 *  yields ~110 bytes (measured — see the note in useSolveRecorder about
 *  the second audio track that once did exactly this to every attempt).
 *  1 KB sits two orders of magnitude below the smallest real clip and an
 *  order above an empty one, so it cannot reject a genuine recording. */
const MIN_RECORDING_BYTES = 1024;

/** The browser's own dialog wording is not ours to choose, so
 *  beforeunload gets no message. Ours is for in-app navigation. */
function leaveConfirmMessage(recordedAttempts: number): string {
  return (
    `Та ${recordedAttempts} оролдлого бичсэн байна. Хуудаснаас гарвал бичлэгүүд устаж, ` +
    'оролдлогуудаа эхнээс нь дахин хийх шаардлагатай болно. Гарах уу?'
  );
}

export default function SolvePage() {
  const params = useParams<{ competitionId: string; eventId: string }>();
  const { competitionId, eventId } = params;
  const { user, loading: authLoading } = useOnlineAuth();

  const [competition, setCompetition] = useState<OnlineCompetition | null>(null);
  const [loadError, setLoadError] = useState('');

  const [stage, setStage] = useState<Stage>('cameraSetup');
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [scramble, setScramble] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const pendingBlobRef = useRef<Blob | null>(null);
  /** Why the recording for the current attempt is unusable, or null.
   *  Drives the recordingFailed stage. */
  const [recordingFailure, setRecordingFailure] = useState<'start' | 'empty' | null>(null);
  /** Attempt numbers already filed as submissions in THIS session, so a
   *  retry after a partial submit re-uploads only what is missing. Purely
   *  a bandwidth saver: correctness comes from submissionDocId, which
   *  makes a re-file overwrite rather than duplicate even when this set
   *  is gone (a reload) or wrong. */
  const filedAttemptsRef = useRef<Set<number>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const [finalAo5, setFinalAo5] = useState<number | null>(null);

  // ── Live PR indicator ────────────────────────────────────────────────
  // The athlete's stored bests for THIS event, read once when the flow
  // loads and cached for the whole 5-attempt session. Read-only: this
  // page never writes stats — stats.{eventId}.pr is computed exclusively
  // by the admin recompute after a judge approves (see
  // lib/online-competition/athleteStats.ts), which is also why every
  // indicator below is labelled provisional.
  // Set when the API refuses the FIRST attempt on round grounds (no live
  // round, or not qualified into the live one). Distinct from loadError:
  // this is a legitimate "you can't solve right now" answer, not a
  // failure, and gets its own explanatory screen rather than a red error
  // line.
  //
  // FIRST attempt only. This screen replaces the run, and from attempt 2
  // on the run is holding video blobs that exist nowhere else — so a
  // refusal that arrives mid-run goes to scrambleError below, which the
  // athlete can retry from without losing them.
  const [blockedMessage, setBlockedMessage] = useState('');
  /** Why this attempt's scramble did not arrive, or '' while it is in
   *  flight / once it has. Rendered by ScrambleWaitStage, which is the
   *  only screen a mid-run failure is allowed to reach. */
  const [scrambleError, setScrambleError] = useState('');
  /** Which attempt the pending scramble request is for — what the retry
   *  button re-requests. */
  const [pendingAttempt, setPendingAttempt] = useState(1);
  /** Bumped per scramble request; a response whose number is no longer
   *  the current one is DROPPED. Without it a late reply (a retry racing
   *  the request it replaced) could overwrite the scramble of an attempt
   *  the run had already started — the same class of bug as the stale
   *  scramble this changeset removes, arriving from the other direction. */
  const scrambleRequestRef = useRef(0);
  // ── Which competition round this run belongs to ──────────────────────
  // Taken from the scramble route's response, which is the SAME call that
  // gates access (resolveRoundAccess decides both whether the athlete may
  // solve and which round is live — see the round-gating block in
  // app/api/online-competition/scramble/route.ts). Deliberately NOT
  // re-derived here: a second derivation could disagree with the gate.
  //
  // Captured ONCE, on attempt 1, and reused for all five submissions. If
  // an admin advances the event's round mid-run, the run still lands
  // whole in the round it started in rather than being split across two.
  // A redo restarts the run and re-resolves it.
  const [competitionRound, setCompetitionRound] = useState<number | null>(null);
  /** The run's SHAPE, captured once when the competition loads and never
   *  re-read — the same "must not move a run that has already started"
   *  rule competitionRound above follows.
   *
   *  An admin editing this event's resultFormat mid-run would otherwise
   *  change how many attempts the athlete owes them, halfway through.
   *  Step B's lock only bites once something has been JUDGED, and a run in
   *  progress has nothing judged yet, so the lock does NOT cover this
   *  window — capturing here is what does.
   *
   *  In practice `competition` is fetched exactly once and never
   *  refreshed, so today this is belt-and-braces; it is explicit so that
   *  adding a refetch later cannot silently reintroduce the hazard. A redo
   *  deliberately keeps the captured shape: it restarts the run, it does
   *  not renegotiate its format. */
  /** This event's per-round cutoffs, kept until the run's round is known. */
  const [eventCutoffs, setEventCutoffs] = useState<{ round: number; cutoffCs: number }[]>([]);
  const [runShape, setRunShape] = useState<{
    format: ResultFormat;
    attempts: number;
    timeLimitCs: number | null;
    /** This ROUND's cutoff, and how many attempts its phase covers. Both
     *  null when the round has none, or when the format has no established
     *  phase (cutoffPhaseFor). */
    cutoffCs: number | null;
    cutoffPhase: number | null;
  } | null>(null);
  const [bests, setBests] = useState<{ pr: number | null; ao5: number | null; mo3: number | null } | null>(null);
  const [prToast, setPrToast] = useState(false);
  /** Set when the attempt just entered exceeds the event's time limit.
   *  Cleared when the next attempt starts. */
  const [overLimit, setOverLimit] = useState(false);
  /** True once the athlete has failed this round's cutoff. Ends the run and
   *  turns the result into a single. */
  const [cutOff, setCutOff] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const recorder = useSolveRecorder();

  useEffect(() => {
    let cancelled = false;
    fetchCompetition(competitionId)
      .then((c) => {
        if (cancelled) return;
        setCompetition(c);
        // Captured here, at the one moment the competition is read.
        const cfg = c?.events.find((e) => e.eventId === eventId);
        const format = resolveResultFormat(cfg?.resultFormat);
        setRunShape({
          format,
          attempts: attemptsForFormat(format),
          timeLimitCs: typeof cfg?.timeLimitCs === 'number' ? cfg.timeLimitCs : null,
          // Resolved later, once the gate says which round this run is in
          // — a cutoff is per round, and the round is not known yet here.
          cutoffCs: null,
          cutoffPhase: null,
        });
        setEventCutoffs(Array.isArray(cfg?.cutoffs) ? cfg.cutoffs : []);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, eventId]);

  // The real (non-anonymous) uid, or null while auth is still resolving.
  // Everything below the auth gate requires it, and the scramble fetch
  // waits for it too — see the effect below.
  const solverUid = user && !user.isAnonymous ? user.uid : null;

  const fetchScramble = useCallback(
    async (attemptNumber: number) => {
      // Cleared BEFORE the request, every time. The old code only ever
      // SET this, so a failed fetch left the previous attempt's scramble
      // in state — and the run walked straight into revealing it again.
      setScramble('');
      setScrambleError('');
      setPendingAttempt(attemptNumber);
      const requestId = scrambleRequestRef.current + 1;
      scrambleRequestRef.current = requestId;
      const superseded = () => scrambleRequestRef.current !== requestId;
      try {
        // competitionId/uid/round/attempt let the API hand back this
        // athlete's assigned group's official scramble for this attempt
        // when the competition has imported one; without a match it
        // returns a randomly generated scramble exactly as before.
        // No `round` param: which round is live is the server's call now
        // (see the round-gating block in the scramble route), so the client
        // can't ask for one it hasn't qualified into.
        const qs = new URLSearchParams({
          event: eventId,
          competitionId,
          attempt: String(attemptNumber),
        });
        if (solverUid) qs.set('uid', solverUid);
        const res = await fetch(`/api/online-competition/scramble?${qs.toString()}`);
        if (superseded()) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          // A round-gating refusal carries a Mongolian `message`; anything
          // else is a genuine failure. Either way, from attempt 2 on it
          // must NOT reach the blocked screen: that screen replaces the
          // run, and the run is holding every video recorded so far.
          if (attemptNumber > 1) {
            setScrambleError(
              body.message || 'Скрамбл авахад алдаа гарлаа. Холболтоо шалгаад дахин оролдоно уу.',
            );
            return;
          }
          if (body.message) {
            setBlockedMessage(body.message);
            return;
          }
          throw new Error('failed');
        }
        const data = (await res.json()) as { scramble: string; round?: number };
        setBlockedMessage('');
        setScramble(data.scramble);
        // Attempt 1 only — later attempts re-hit the gate but must not
        // move a run that has already started.
        if (attemptNumber === 1 && typeof data.round === 'number') {
          setCompetitionRound(data.round);
          // Captured with the round, and never re-read for the rest of the
          // run — the same rule competitionRound itself follows.
          const forRound = eventCutoffs.find((c) => c.round === data.round);
          setRunShape((prev) =>
            prev === null
              ? prev
              : {
                  ...prev,
                  cutoffCs: forRound?.cutoffCs ?? null,
                  cutoffPhase: forRound ? cutoffPhaseFor(prev.format) : null,
                },
          );
        }
      } catch {
        if (superseded()) return;
        // Never loadError: its screen is guarded by `!competition`, so
        // mid-run it rendered NOTHING while the run marched on. The wait
        // stage shows this and offers a retry.
        setScrambleError('Скрамбл авахад алдаа гарлаа. Холболтоо шалгаад дахин оролдоно уу.');
      }
    },
    [eventId, competitionId, solverUid, eventCutoffs],
  );

  // Fetch the first attempt's scramble once the athlete is known. Later
  // attempts fetch theirs explicitly (in handleEntryConfirm/handleRedo
  // below) rather than via a reactive effect — attemptIndex going back to
  // 0 on a redo wouldn't re-trigger an effect keyed on its value.
  //
  // Keyed on solverUid rather than running on mount: without a uid the
  // request can't resolve a group assignment, and an anonymous/loading
  // visitor is sitting on the sign-in gate anyway, so there is nothing to
  // scramble for yet. solverUid only ever transitions null -> uid, so this
  // still fires exactly once per session.
  useEffect(() => {
    if (!solverUid) return;
    fetchScramble(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solverUid]);

  // THE WAIT. Every attempt now enters scrambleWait first and is promoted
  // to zeroDisplay — which is what starts the recording — only once a
  // scramble has actually arrived. A fetch that fails simply never
  // promotes: the run sits on the wait stage with a retry button instead
  // of recording an attempt it has no scramble for.
  useEffect(() => {
    if (stage === 'scrambleWait' && scramble) setStage('zeroDisplay');
  }, [stage, scramble]);

  useEffect(() => {
    return () => recorder.releaseCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Leaving with a run in progress ───────────────────────────────────
  // Every solved attempt is a video blob in memory, uploaded only when the
  // whole run is submitted. Leaving throws all of them away, and until now
  // nothing said so.
  const runAtRisk = attempts.length > 0 && stage !== 'sent';
  // Read inside the listeners below, which are installed once per
  // at-risk run and must not be re-installed on every attempt (each
  // install pushes a history entry).
  const attemptCountRef = useRef(0);
  useEffect(() => {
    attemptCountRef.current = attempts.length;
  }, [attempts.length]);

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

  // One fetch per session, keyed on the real (non-anonymous) uid.
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    let cancelled = false;
    fetchParticipant(user.uid)
      .then((p) => {
        if (cancelled) return;
        const forEvent = p?.stats?.[eventId];
        setBests({ pr: forEvent?.pr ?? null, ao5: forEvent?.ao5 ?? null, mo3: forEvent?.mo3 ?? null });
      })
      .catch(() => {
        // Missing bests just means no badge is shown — never blocks solving.
        if (!cancelled) setBests({ pr: null, ao5: null, mo3: null });
      });
    return () => {
      cancelled = true;
    };
  }, [user, eventId]);

  useEffect(() => {
    if (!prToast) return;
    const id = setTimeout(() => setPrToast(false), 2200);
    return () => clearTimeout(id);
  }, [prToast]);

  // Recording starts the moment each attempt's zeroDisplay begins (the
  // frozen "0.00" itself must be on video, proving the timer read zero
  // before the scramble was applied) and runs uninterrupted through
  // scrambleReveal -> orientationHold -> readyPrompt -> rec, stopping
  // only when the athlete clicks "Дуусгах" in rec. `stage` only takes the
  // value 'zeroDisplay' at the start of a fresh attempt — never as an
  // intermediate value while already sitting in zeroDisplay — so this
  // fires exactly once per attempt.
  //
  // Every route into it now runs through scrambleWait and its promotion
  // effect above, so the recording can no longer start for an attempt
  // whose scramble never arrived.
  useEffect(() => {
    if (stage === 'zeroDisplay') {
      // The return value used to be discarded. It is false when the
      // stream is gone — phone locked, camera taken by another app,
      // permission revoked — and the attempt then ran to completion and
      // uploaded a 0-byte video that only a judge ever discovered.
      if (!recorder.startRecording()) setRecordingFailure('start');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (recordingFailure !== null) setStage('recordingFailed');
  }, [recordingFailure]);

  function handleEntryConfirm(result: { timeCs: number | null; isDnf: boolean }) {
    // Over the event's per-attempt limit? The attempt still COUNTS as an
    // attempt and the run continues — ending it here would be cutoff
    // behaviour, which this is not.
    //
    // The attempt is stored with the athlete's REAL time and their own
    // isDnf, deliberately NOT rewritten to isDnf:true. createSubmission
    // zeroes reportedTime for a DNF, so flagging it here would destroy the
    // evidence the judge needs to confirm it really was over the limit.
    // It becomes a DNF where that matters instead: in the summary below,
    // and authoritatively in effectiveAttemptTime at scoring.
    const isOver =
      !result.isDnf &&
      result.timeCs !== null &&
      runShape?.timeLimitCs != null &&
      result.timeCs > runShape.timeLimitCs;
    setOverLimit(isOver);

    // Provisional only — a first-ever time for this event counts as a PR
    // too (there is nothing to beat yet). An over-limit attempt is a DNF
    // and can never be one.
    if (!isOver && beatsPr(result.timeCs, result.isDnf, bests)) setPrToast(true);

    const newAttempt: Attempt = { timeCs: result.timeCs, isDnf: result.isDnf, videoBlob: pendingBlobRef.current };
    const next = [...attempts, newAttempt];
    setAttempts(next);
    pendingBlobRef.current = null;

    // ── THE CUTOFF ──
    // At the end of the cutoff phase, if nothing beat the cutoff the run
    // ends here. STRICTLY better is required, and an over-limit attempt
    // (already a DNF above) can never beat it.
    const phase = runShape?.cutoffPhase ?? null;
    const cutoffCs = runShape?.cutoffCs ?? null;
    const failedCutoff =
      phase !== null &&
      cutoffCs !== null &&
      next.length >= phase &&
      next
        .slice(0, phase)
        .every((a) => attemptTime(a, runShape?.timeLimitCs ?? null) === 'DNF' ||
          (a.timeCs as number) >= cutoffCs);

    if (failedCutoff) {
      setCutOff(true);
      setStage('summary');
    } else if (next.length >= (runShape?.attempts ?? 0)) {
      setStage('summary');
    } else {
      setAttemptIndex((i) => i + 1);
      // next.length is the count of completed attempts, so the attempt now
      // starting is next.length + 1 (1-based, matching the group scramble
      // array index the API reads).
      //
      // scrambleWait, NOT zeroDisplay: this fetch is still in flight, and
      // zeroDisplay would start recording an attempt whose scramble may
      // never arrive. The effect above promotes the run when it does.
      setStage('scrambleWait');
      fetchScramble(next.length + 1);
    }
  }

  function handleRedo() {
    setAttempts([]);
    setAttemptIndex(0);
    setOverLimit(false);
    setCutOff(false);
    setSubmitError('');
    // Cleared so a failed re-fetch can't leave the previous run's round
    // attached to the new one; fetchScramble(1) re-resolves it.
    setCompetitionRound(null);
    // A redo is a NEW run for the same round. Its attempts file to the
    // same deterministic ids and overwrite the old ones, so the session
    // set has to be cleared or the new videos would never be uploaded.
    filedAttemptsRef.current = new Set();
    setRecordingFailure(null);
    setStage('scrambleWait');
    fetchScramble(1);
  }

  async function handleSubmit() {
    if (!user || user.isAnonymous) {
      setSubmitError('Та нэвтрээгүй байна. Дахин нэвтэрнэ үү.');
      return;
    }
    // Unreachable in practice — the flow only renders once attempt 1's
    // scramble came back, and that response only exists when the gate
    // resolved a live round. Handled the same way the gate itself answers
    // (ROUND_ACCESS_MESSAGE['no-live-round'] in round-access.ts, a
    // server-only module) rather than defaulting to round 1, so a run can
    // never be filed under a round nobody opened.
    if (competitionRound === null) {
      setSubmitError('Энэ төрлийн раунд одоогоор нээлттэй биш байна.');
      return;
    }
    setSubmitError('');
    setSubmitting(true);
    setSubmitProgress(0);

    // Uploaded one at a time (not in parallel) — simpler aggregate
    // progress and easier on a mobile connection during a live
    // competition than 5 concurrent uploads.
    const perAttemptProgress = new Array(attempts.length).fill(0);
    const reportAggregate = () => {
      const avg = perAttemptProgress.reduce((a, b) => a + b, 0) / attempts.length;
      setSubmitProgress(Math.round(avg));
    };

    try {
      for (let i = 0; i < attempts.length; i++) {
        const attemptNumber = i + 1;
        // Already filed earlier in this session (a submit that failed
        // part-way through). Re-uploading it would cost the athlete the
        // bandwidth again and orphan the video already in Cloudinary;
        // re-filing it would land on the same document id anyway.
        if (filedAttemptsRef.current.has(attemptNumber)) {
          perAttemptProgress[i] = 100;
          reportAggregate();
          continue;
        }
        const attempt = attempts[i];
        const blob = attempt.videoBlob ?? new Blob([], { type: 'video/webm' });
        const { secureUrl, publicId } = await uploadVideoToCloudinary(blob, (pct) => {
          perAttemptProgress[i] = pct;
          reportAggregate();
        });
        await createSubmission({
          competitionId,
          uid: user.uid,
          event: eventId,
          round: attemptNumber,
          competitionRound,
          videoUrl: secureUrl,
          cloudinaryPublicId: publicId,
          reportedTime: attempt.isDnf ? 0 : (attempt.timeCs as number),
          isDnf: attempt.isDnf,
        });
        // Only after the write lands — an upload that succeeded and a
        // file that did not must still be retried.
        filedAttemptsRef.current.add(attemptNumber);
        perAttemptProgress[i] = 100;
        reportAggregate();
      }

      const times: AttemptTime[] = attempts.map((a) => attemptTime(a, runShape?.timeLimitCs ?? null));
      // A cut-off run has no average — its result is the best single, and
      // the partial set never touches computeResult (whose ao5 branch
      // would return a fabricated average from a two-attempt slice).
      // The captured format, not a re-read one — the value stored must be
      // the one the athlete was actually shown on the summary screen.
      const value = cutOff ? bestSingle(times) : computeResult(times, runShape?.format ?? 'ao5').value;
      // NOTE: recordAo5Result writes results.{eventId}.ao5 on the
      // registration doc. For a non-Ao5 event that key now holds an Mo3 or
      // a best single. Renaming it is a stored-field migration and belongs
      // with step E's stats work, not here.
      await recordAo5Result(user.uid, competitionId, eventId, { ao5: value, attempts: times });
      setFinalAo5(value);

      recorder.releaseCamera();
      setStage('sent');
    } catch (err) {
      console.error('Submit failed:', err);
      // A filed attempt is immutable (firestore.rules). Reached today only
      // after a submit that failed part-way through and was then REDONE:
      // the redone attempts carry new times and cannot replace the ones
      // already filed. Retrying will not help, so the message says so
      // rather than inviting it. The redo button itself goes in PR-2.
      setSubmitError(
        err instanceof SubmissionAlreadyFiledError
          ? 'Энэ оролдлого өмнө нь өөр цагтайгаар илгээгдсэн байна. Зохион байгуулагчид хандана уу.'
          : 'Илгээхэд алдаа гарлаа. Дахин оролдоно уу.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Gates: auth, then data load ─────────────────────────────────────────
  if (authLoading) {
    return <div className="oc-solve-page" />;
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="oc-solve-page">
        <div className="oc-solve-shell" style={{ justifyContent: 'center', alignItems: 'center', gap: 16 }}>
          <p style={{ font: '400 13px var(--oc-font-heading), sans-serif', color: '#F4F1EA', textAlign: 'center' }}>
            Тэмцээнд орохын тулд нэвтэрнэ үү.
          </p>
          <button
            type="button"
            className="oc-solve-btn-confirm"
            style={{ width: 'auto', padding: '12px 24px' }}
            onClick={() => setAuthOpen(true)}
          >
            Нэвтрэх
          </button>
        </div>
        {/* AuthModal owns the pending state, the double-click guard and the
            error line that used to live on this page — the button above is
            now only a trigger. Plain sign-in: on success the modal closes
            and this gate re-renders signed-in, straight into the flow. */}
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (loadError && !competition) {
    return (
      <div className="oc-solve-page">
        <div className="oc-solve-shell" style={{ justifyContent: 'center' }}>
          <p style={{ font: '400 13px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>{loadError}</p>
        </div>
      </div>
    );
  }

  // Round gate: a real answer, not a failure, so it gets a readable screen
  // with a way back rather than the blank loading state below.
  if (blockedMessage) {
    return (
      <div className="oc-solve-page">
        <div className="oc-solve-shell" style={{ justifyContent: 'center', alignItems: 'center', gap: 14 }}>
          <p style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#6E6A62' }}>
            {eventId.toUpperCase()}
          </p>
          <p
            style={{
              font: '400 14px var(--oc-font-heading), sans-serif',
              color: '#F4F1EA',
              textAlign: 'center',
              maxWidth: 320,
              lineHeight: 1.6,
            }}
          >
            {blockedMessage}
          </p>
          <Link
            href="/online-competition/dashboard"
            /* Only rendered when the FIRST attempt was refused, so there
               is normally nothing to lose — but a link is a link, and
               beforeunload does not fire for a client-side one. */
            onClick={(e) => {
              if (runAtRisk && !window.confirm(leaveConfirmMessage(attempts.length))) e.preventDefault();
            }}
            style={{
              border: '1px solid #2A2A31',
              color: '#9A958A',
              padding: '11px 18px',
              font: '600 9px var(--oc-font-mono), monospace',
              letterSpacing: '.1em',
              textDecoration: 'none',
            }}
          >
            БУЦАХ
          </Link>
        </div>
      </div>
    );
  }

  // `scramble` is deliberately NOT part of this guard any more. It is
  // empty for the whole of every scrambleWait, and blanking the page
  // there would hide the one screen that explains a failure — and the
  // retry that recovers from it.
  if (!competition || !runShape) {
    return <div className="oc-solve-page" />;
  }

  const eventConfig = competition.events.find((e) => e.eventId === eventId);
  const eventLabel = eventConfig?.label ?? eventId.toUpperCase();

  return (
    <div className="oc-solve-page">
      {prToast && (
        <div className="oc-solve-pr-toast" role="status">
          <span className="oc-solve-pr-toast-title">ШИНЭ PR!</span>
          <span className="oc-solve-pr-note">шүүгч баталгаажуулснаар эцэслэнэ</span>
        </div>
      )}
      {/* Shown INSTEAD of moving on silently: the athlete has to know this
          attempt will not count before they start the next one. The run
          continues — a time limit does not end a round. */}
      {overLimit && runShape.timeLimitCs !== null && (
        <div className="oc-solve-limit-toast" role="alert">
          <span className="oc-solve-limit-toast-title">ЦАГИЙН ХЯЗГААР ХЭТЭРСЭН · DNF</span>
          <span className="oc-solve-pr-note">
            Хязгаар {fmtTimeLimit(runShape.timeLimitCs)} · энэ оролдлого DNF болно
          </span>
        </div>
      )}
      <div className="oc-solve-shell">
        {HEADER_STAGES.includes(stage) && (
          <Header
            competitionName={competition.name}
            eventLabel={eventLabel}
            attemptIndex={attemptIndex}
            totalAttempts={cutOff ? (runShape.cutoffPhase ?? runShape.attempts) : runShape.attempts}
          />
        )}

        {stage === 'cameraSetup' && (
          <CameraSetupStage
            videoRef={recorder.videoRef}
            hasCamera={recorder.hasCamera}
            error={recorder.error}
            onRequestCamera={recorder.requestCamera}
            /* Attempt 1's fetch runs alongside the camera prompt. If it
               has not landed by the time the athlete is ready, the run
               waits on scrambleWait rather than recording without a
               scramble. */
            onDone={() => setStage(scramble ? 'zeroDisplay' : 'scrambleWait')}
          />
        )}

        {stage === 'scrambleWait' && (
          <ScrambleWaitStage
            attemptNumber={pendingAttempt}
            error={scrambleError}
            recordedAttempts={attempts.length}
            onRetry={() => fetchScramble(pendingAttempt)}
          />
        )}

        {stage === 'recordingFailed' && recordingFailure !== null && (
          <RecordingFailedStage
            reason={recordingFailure}
            attemptNumber={attempts.length + 1}
            cameraError={recorder.error}
            hasCamera={recorder.hasCamera}
            recordedAttempts={attempts.length}
            videoRef={recorder.videoRef}
            /* Released first: requestCamera is a no-op while a stream
               object still exists, and the stream here is exactly the one
               that just failed. */
            onReconnectCamera={() => {
              recorder.releaseCamera();
              void recorder.requestCamera();
            }}
            /* Restarts THIS attempt from the top, on the same scramble —
               nothing about it has been kept. */
            onRestartAttempt={() => {
              setRecordingFailure(null);
              setStage('zeroDisplay');
            }}
          />
        )}

        {stage === 'zeroDisplay' && <ZeroDisplayStage onDone={() => setStage('scrambleReveal')} />}

        {stage === 'scrambleReveal' && (
          <RevealStage scramble={scramble} videoRef={recorder.videoRef} onDone={() => setStage('orientationHold')} />
        )}

        {stage === 'orientationHold' && (
          <OrientationHoldStage videoRef={recorder.videoRef} onDone={() => setStage('readyPrompt')} />
        )}

        {stage === 'readyPrompt' && (
          <ReadyPromptStage videoRef={recorder.videoRef} onDone={() => setStage('rec')} />
        )}

        {stage === 'rec' && (
          <RecStage
            videoRef={recorder.videoRef}
            onBeep={recorder.playBeep}
            onFinish={async () => {
              const blob = await recorder.stopRecording();
              // A recorder that started and still produced nothing —
              // the stream died mid-attempt. Accepting this hands the
              // judge an empty file with a time attached to it.
              if (blob.size < MIN_RECORDING_BYTES) {
                setRecordingFailure('empty');
                return;
              }
              pendingBlobRef.current = blob;
              setStage('entry');
            }}
          />
        )}

        {stage === 'entry' && <EntryStage onConfirm={handleEntryConfirm} />}

        {stage === 'summary' && (
          <SummaryStage
            bests={bests}
            attempts={attempts.map((a) => ({ timeCs: a.timeCs, isDnf: a.isDnf }))}
            resultFormat={runShape.format}
            timeLimitCs={runShape.timeLimitCs}
            cutOff={cutOff}
            cutoffCs={runShape.cutoffCs}
            onRedo={handleRedo}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitProgress={submitProgress}
            submitError={submitError}
          />
        )}

        {stage === 'sent' && <SentStage ao5={finalAo5} />}
      </div>
    </div>
  );
}
