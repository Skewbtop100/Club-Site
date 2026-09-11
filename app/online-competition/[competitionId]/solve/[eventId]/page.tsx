'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import {
  fetchCompetition,
  createSubmission,
  fetchMyFiledAttempts,
  fetchParticipant,
  recordAo5Result,
  SubmissionAlreadyFiledError,
} from '@/lib/online-competition/data';
import { NotSignedInError, authedFetchWithRetry } from '@/lib/online-competition/authed-fetch';
import {
  cutoffFailed,
  planResume,
  resolveAttemptTime,
  resumeNotice,
  type FiledAttempt,
} from '@/lib/online-competition/run-resume';
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
import RevealStage from './_components/RevealStage';
import CameraHoldStage from './_components/CameraHoldStage';
import ReadyPromptStage from './_components/ReadyPromptStage';
import RecStage from './_components/RecStage';
import EntryStage from './_components/EntryStage';
import SummaryStage from './_components/SummaryStage';
import FilingStage, { type FilingRow } from './_components/FilingStage';
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
  /** The hold AFTER the solve: the athlete shows their timer to the
   *  camera, and the recording runs through it. THE CLIP STOPS HERE, not
   *  at the button that ends the solve — the reading on that timer is the
   *  evidence for the time typed on the next screen, so it has to be on
   *  the same continuous video as the solve it belongs to. */
  | 'finishHold'
  | 'entry'
  /** Waiting for recordings to reach the server. Normally seen once, after
   *  the last attempt; also mid-run when a filing failed, because the next
   *  attempt must not start on top of a hole in the attempt order. */
  | 'filing'
  | 'summary'
  | 'sent';

/** Attempts in a run come from the event's resultFormat via
 *  attemptsForFormat — there is no constant here any more. See `runShape`
 *  below for why it is captured once rather than read per render. */

/** Fastest non-DNF attempt, or null if there was none. */
function bestSingle(times: AttemptTime[]): number | null {
  const finished = times.filter((t): t is number => t !== 'DNF');
  return finished.length > 0 ? Math.min(...finished) : null;
}

/** One attempt of the run, as the page tracks it AFTER it has been solved.
 *
 *  The recording is NOT here. It lives in pendingUploadsRef until the
 *  attempt is filed and is dropped the moment it is — holding five videos
 *  in memory for the length of a run is what made a tab discard
 *  catastrophic. What stays is what the summary and the result need: the
 *  time, the DNF flag, and where the attempt got to. */
interface Attempt {
  timeCs: number | null;
  isDnf: boolean;
  /** queued    — recorded, waiting its turn in the single-file queue
   *  uploading — its video is going up now
   *  retrying  — it failed once and is going again on its own
   *  filed     — the submission landed; the blob has been released
   *  failed    — it has given up asking; the athlete decides */
  fileState: 'queued' | 'uploading' | 'retrying' | 'filed' | 'failed';
  uploadPercent: number;
  /** The onlineSubmissions document id, once filed. */
  submissionId: string | null;
  fileError: string | null;
}

/** One automatic retry before the run stops and asks. A dropped packet on
 *  a phone is the common case and does not deserve a dialog; a second
 *  failure is a real problem and does. */
const FILING_AUTO_RETRIES = 1;
const FILING_RETRY_DELAY_MS = 3000;

const HEADER_STAGES: Stage[] = [
  'scrambleWait',
  'filing',
  'zeroDisplay',
  'recordingFailed',
  'scrambleReveal',
  'orientationHold',
  'readyPrompt',
  'rec',
  'finishHold',
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

/** Every hold in the flow runs the same length: long enough for a judge
 *  to read a timer or an orientation off the video, short enough not to
 *  pad five attempts. Each stage passes this to CameraHoldStage, which
 *  builds its sentence and its tick bar from the same number. */
const HOLD_SECONDS = 8;

/** The browser's own dialog wording is not ours to choose, so
 *  beforeunload gets no message. Ours is for in-app navigation.
 *
 *  One loss to describe now: the attempt that has not been filed yet. The
 *  ones before it are on the server, and returning to this page picks the
 *  run up at the next attempt — so the dialog says what actually happens,
 *  which is that this one solve has to be done again. */
function leaveConfirmMessage(unfiledAttempts: number): string {
  return (
    `Хадгалагдаагүй ${unfiledAttempts} оролдлого байна. Хуудаснаас гарвал тэр бичлэг устаж, ` +
    'уг оролдлогыг дахин хийх шаардлагатай болно. Өмнөх оролдлогууд сервэрт хэвээр үлдэнэ. Гарах уу?'
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
  /** attempt index -> its recording and result, held ONLY until that
   *  attempt is filed. Deleted the moment the submission lands: this map
   *  is the run's memory footprint, and it is meant to hold at most one
   *  video at a time.
   *
   *  A ref, not state: the filing worker below reads it across awaits, and
   *  a state mirror would be one render behind. */
  const pendingUploadsRef = useRef<Map<number, { blob: Blob; timeCs: number | null; isDnf: boolean }>>(new Map());
  /** Attempt indices waiting to be filed, oldest first. The head stays put
   *  until it succeeds, so attempts are always filed IN ORDER and a
   *  failure cannot let the run run ahead of it. */
  const filingQueueRef = useRef<number[]>([]);
  /** True while the worker is awake — the single-file guarantee. Two
   *  uploads never overlap: one connection, one attempt, in order. */
  const filingBusyRef = useRef(false);
  const filingRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** attempt index -> automatic retries already spent on it. */
  const filingRetriesRef = useRef<Map<number, number>>(new Map());

  /** What to tell an athlete who is continuing rather than starting — see
   *  resumeNotice in run-resume.ts. Cleared the moment they solve
   *  something, because from then on they can see it for themselves. */
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
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

  /** This ROUND's cutoff onto the captured run shape. A cutoff is per
   *  round, so it can only be resolved once the round is known — which is
   *  either when the resume plan lands or when the gate answers. */
  const applyRoundCutoff = useCallback(
    (round: number) => {
      const forRound = eventCutoffs.find((c) => c.round === round);
      setRunShape((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              cutoffCs: forRound?.cutoffCs ?? null,
              cutoffPhase: forRound ? cutoffPhaseFor(prev.format) : null,
            },
      );
    },
    [eventCutoffs],
  );

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
        // NO uid PARAMETER. The route reads the athlete from a verified
        // Authorization header; sending a uid as well would be a second,
        // unverified source of identity for someone to trust later.
        const qs = new URLSearchParams({
          event: eventId,
          competitionId,
          attempt: String(attemptNumber),
        });
        const res = await authedFetchWithRetry(`/api/online-competition/scramble?${qs.toString()}`);
        if (superseded()) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          // ── AN AUTH FAILURE IS NOT A ROUND REFUSAL ──
          // 401 means the token was rejected — expired mid-run, a device
          // clock behind the server, a refresh that failed offline. It is
          // transient and retryable, and it must NEVER reach the blocked
          // screen: that screen replaces the run, and a run holds an
          // attempt that exists nowhere else.
          //
          // authedFetchWithRetry has ALREADY re-minted the token and tried
          // again by the time we get here, so this is a token that could
          // not be fixed by refreshing it.
          if (res.status === 401) {
            setScrambleError(
              'Нэвтрэлт хүчингүй болсон байна. «Дахин оролдох» дарна уу — эсвэл өөр цонхонд дахин нэвтэрч орно уу.',
            );
            return;
          }
          // A round-gating refusal carries a Mongolian `message`; anything
          // else is a genuine failure. Either way, from attempt 2 on it
          // must NOT reach the blocked screen, for the same reason.
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
        if (typeof data.round === 'number') {
          if (competitionRound === null) {
            // No resume plan reached here first — the gate is then the
            // authority on which round this run belongs to.
            setCompetitionRound(data.round);
            applyRoundCutoff(data.round);
          } else if (data.round !== competitionRound) {
            // The round moved between planning this run and asking for
            // its scramble. Solving on the new round's scramble and
            // filing it into the old round would be worse than stopping.
            setScrambleError(
              'Раунд өөрчлөгдсөн байна. Хуудсаа сэргээгээд дахин оролдоно уу — асуудал давтагдвал зохион байгуулагчид хандана уу.',
            );
            return;
          }
        }
        setBlockedMessage('');
        setScramble(data.scramble);
      } catch (e) {
        if (superseded()) return;
        // Never loadError: its screen is guarded by `!competition`, so
        // mid-run it rendered NOTHING while the run marched on. The wait
        // stage shows this and offers a retry.
        //
        // NotSignedInError is thrown before the request leaves the
        // browser — the session went away mid-run. Same soft landing: the
        // athlete signs in again and presses retry, and the run is still
        // here when they do.
        setScrambleError(
          e instanceof NotSignedInError
            ? 'Та нэвтэрсэн эрхээсээ гарсан байна. Дахин нэвтэрч ороод «Дахин оролдох» дарна уу.'
            : 'Скрамбл авахад алдаа гарлаа. Холболтоо шалгаад дахин оролдоно уу.',
        );
      }
    },
    [eventId, competitionId, solverUid, competitionRound, applyRoundCutoff],
  );

  // ── RESUME ────────────────────────────────────────────────────────────
  // Before anything is solved, find out what this athlete has already
  // FILED for this competition and event. Attempts are written one at a
  // time as they are recorded, so the server — not this tab — is the
  // authority on how far the run got. Leaving therefore stops being a way
  // to discard a solve: come back and you come back to the attempt AFTER
  // the last one you filed.
  //
  // This read has to happen BEFORE the scramble is fetched. The attempt
  // number is a query parameter of that request, and asking for attempt 1
  // when two are already filed would hand the athlete a scramble they
  // have used and then refuse the filing at the end of it.
  //
  // Later attempts fetch their scramble explicitly (in handleEntryConfirm)
  // rather than through a reactive effect — the fetch is part of starting
  // an attempt, not a consequence of a counter moving.
  //
  // Keyed on solverUid: an anonymous or still-loading visitor is sitting
  // on the sign-in gate anyway, and solverUid only ever goes null -> uid,
  // so this runs once per session.
  useEffect(() => {
    if (!solverUid || runShape === null) return;
    let cancelled = false;

    (async () => {
      // Which round is open for this event, from the SAME resolver the
      // scramble route enforces with — so the round this run is planned
      // for is the round it would be admitted to.
      let liveRound: number | null = null;
      let filed: FiledAttempt[] = [];
      try {
        const [accessRes, mine] = await Promise.all([
          // The uid comes from the verified token now, not from the URL.
          authedFetchWithRetry(
            `/api/online-competition/round-access?competitionId=${encodeURIComponent(competitionId)}`,
          ),
          fetchMyFiledAttempts(solverUid, competitionId, eventId),
        ]);
        const accessBody = accessRes.ok
          ? ((await accessRes.json()) as { events?: Record<string, { liveRound: number | null }> })
          : { events: {} };
        liveRound = accessBody.events?.[eventId]?.liveRound ?? null;
        filed = mine;
      } catch (e) {
        // FAIL CLOSED, and visibly. Starting a run that cannot be planned
        // would either re-solve a filed attempt or file into the wrong
        // round. blockedMessage, not loadError: loadError's screen is
        // guarded by `!competition`, which is false by now, so it would
        // have shown the athlete nothing at all. Nothing is at risk yet —
        // no attempt has been recorded — so replacing the page is safe
        // here in a way it is not mid-run.
        console.error('Resume lookup failed:', e);
        if (!cancelled) {
          setBlockedMessage(
            'Өмнөх оролдлогуудыг уншиж чадсангүй. Холболтоо шалгаад хуудсаа сэргээнэ үү.',
          );
        }
        return;
      }
      if (cancelled) return;

      // The cutoff belongs to the round, so it is resolved for the live
      // round before the plan is made — the plan uses it to decide whether
      // a resumed run is already over.
      const forRound = eventCutoffs.find((c) => c.round === liveRound);
      const plan = planResume(filed, liveRound, {
        format: runShape.format,
        attempts: runShape.attempts,
        timeLimitCs: runShape.timeLimitCs,
        cutoffCs: forRound?.cutoffCs ?? null,
        cutoffPhase: forRound ? cutoffPhaseFor(runShape.format) : null,
      });

      if (plan.competitionRound !== null) {
        setCompetitionRound(plan.competitionRound);
        applyRoundCutoff(plan.competitionRound);
      }
      // Rebuilt from the server's own record of them. They are already
      // filed, so they carry no blob and nothing will try to upload them.
      setAttempts(
        plan.priorAttempts.map((a, i) => ({
          timeCs: a.timeCs,
          isDnf: a.isDnf,
          fileState: 'filed' as const,
          uploadPercent: 100,
          submissionId: filed.find((f) => f.competitionRound === plan.competitionRound && f.attempt === i + 1)?.submissionId ?? null,
          fileError: null,
        })),
      );
      setAttemptIndex(plan.nextAttempt - 1);
      setCutOff(plan.cutOff);
      setResumeMessage(resumeNotice(plan));

      if (plan.kind === 'no-live-round') {
        // Nothing can be solved and nothing can be finished. An athlete
        // with a run left part-finished needs more than the stock line:
        // their attempts are safe, and only the organiser can decide what
        // happens to the round.
        setBlockedMessage(
          plan.unfinishedRound !== null
            ? 'Энэ төрлийн раунд хаагдсан байна. Таны хадгалсан оролдлогууд сервэрт хэвээр байгаа боловч ' +
              'үлдсэн оролдлогыг хийх боломжгүй. Зохион байгуулагчтай холбогдоно уу.'
            : 'Энэ төрлийн раунд одоогоор нээлттэй биш байна.',
        );
        return;
      }
      if (plan.kind === 'complete') {
        // They solved the whole round and left before sending the result.
        // Nothing to scramble for; the summary is what they owe.
        setStage('summary');
        return;
      }
      fetchScramble(plan.nextAttempt);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solverUid, runShape !== null]);

  /** Attempts recorded but not yet on the server. At most one, if filing
   *  is keeping up. */
  const unfiledCount = attempts.filter((a) => a.fileState !== 'filed').length;
  /** A filing that has stopped trying on its own and needs the athlete. */
  const filingFailed = attempts.some((a) => a.fileState === 'failed');
  /** Every attempt of the run has been solved. */
  const runComplete = cutOff || (runShape !== null && attempts.length >= runShape.attempts);

  // THE WAIT. Every attempt enters scrambleWait first and is promoted to
  // zeroDisplay — which is what starts the recording — only once a
  // scramble has actually arrived. A fetch that fails simply never
  // promotes: the run sits on the wait stage with a retry button instead
  // of recording an attempt it has no scramble for.
  useEffect(() => {
    if (stage !== 'scrambleWait') return;
    // A filing that has given up stops the run here, before the next
    // attempt starts recording. The queue already guarantees ORDER; this
    // guarantees the athlete finds out, and that unfiled recordings cannot
    // pile up in memory behind a broken connection.
    if (filingFailed) {
      setStage('filing');
      return;
    }
    if (scramble) setStage('zeroDisplay');
  }, [stage, scramble, filingFailed]);

  // Leaving the filing screen: back into the run mid-round, on to the
  // result at the end of it.
  useEffect(() => {
    if (stage !== 'filing') return;
    if (unfiledCount > 0) return;
    setStage(runComplete ? 'summary' : 'scrambleWait');
  }, [stage, unfiledCount, runComplete]);

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
    attemptCountRef.current = attempts.filter((a) => a.fileState !== 'filed').length;
  }, [attempts]);

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


  // ── Filing: one attempt at a time, in the background ──────────────────
  // Each attempt is uploaded and written the moment it is recorded, rather
  // than all five at the end. Two things follow: the run holds at most one
  // video in memory, and losing the page costs at most one attempt instead
  // of the whole round.
  //
  // It runs BEHIND the athlete. The next attempt's ceremony — zeroDisplay,
  // the reveal, the orientation hold, inspection — is around 45 seconds in
  // which nothing needs the network, and a ~2MB clip normally lands well
  // inside it. Nothing waits on it except the summary.
  const patchAttempt = useCallback((index: number, patch: Partial<Attempt>) => {
    setAttempts((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }, []);

  const pumpFiling = useCallback(async () => {
    // ONE AT A TIME. Two uploads never overlap: the queue is worked from
    // the head and the head stays put until it lands, so attempts are also
    // always filed in order and the server never sees a hole.
    if (filingBusyRef.current) return;
    filingBusyRef.current = true;
    try {
      while (filingQueueRef.current.length > 0) {
        const index = filingQueueRef.current[0];
        const held = pendingUploadsRef.current.get(index);
        if (!held) {
          // Already filed — nothing left to send.
          filingQueueRef.current.shift();
          continue;
        }
        if (!solverUid || competitionRound === null) {
          patchAttempt(index, {
            fileState: 'failed',
            fileError: 'Нэвтрэлт эсвэл раундын мэдээлэл олдсонгүй. Хуудсаа сэргээлгүйгээр дахин оролдоно уу.',
          });
          return;
        }
        patchAttempt(index, { fileState: 'uploading', uploadPercent: 0, fileError: null });
        try {
          const { secureUrl, publicId } = await uploadVideoToCloudinary(held.blob, (pct) =>
            patchAttempt(index, { uploadPercent: pct }),
          );
          const submissionId = await createSubmission({
            competitionId,
            uid: solverUid,
            event: eventId,
            round: index + 1,
            competitionRound,
            videoUrl: secureUrl,
            cloudinaryPublicId: publicId,
            reportedTime: held.isDnf ? 0 : (held.timeCs as number),
            isDnf: held.isDnf,
          });
          // FILED — and this is the line the whole changeset is for: the
          // recording is dropped the moment the server has it.
          pendingUploadsRef.current.delete(index);
          filingQueueRef.current.shift();
          patchAttempt(index, { fileState: 'filed', uploadPercent: 100, submissionId, fileError: null });
        } catch (e) {
          console.error('Filing attempt failed:', e);
          // A conflict is not a network problem and will never come good:
          // this attempt is already filed with a different result, which
          // only another session could have done.
          const conflict = e instanceof SubmissionAlreadyFiledError;
          const spent = filingRetriesRef.current.get(index) ?? 0;
          if (!conflict && spent < FILING_AUTO_RETRIES) {
            filingRetriesRef.current.set(index, spent + 1);
            patchAttempt(index, {
              fileState: 'retrying',
              fileError: 'Холболт тасарлаа. Автоматаар дахин оролдож байна...',
            });
            if (filingRetryTimerRef.current) clearTimeout(filingRetryTimerRef.current);
            filingRetryTimerRef.current = setTimeout(() => {
              filingRetryTimerRef.current = null;
              void pumpFiling();
            }, FILING_RETRY_DELAY_MS);
            return;
          }
          patchAttempt(index, {
            fileState: 'failed',
            fileError: conflict
              ? 'Энэ оролдлого өмнө нь өөр цагтайгаар хадгалагдсан байна. Зохион байгуулагчид хандана уу.'
              : 'Бичлэгийг хадгалж чадсангүй. Холболтоо шалгаад дахин илгээнэ үү.',
          });
          return;
        }
      }
    } finally {
      filingBusyRef.current = false;
    }
  }, [patchAttempt, solverUid, competitionRound, competitionId, eventId]);

  /** Hands a just-recorded attempt to the queue. Never awaited — the run
   *  moves on to the next attempt while this works. */
  const enqueueFiling = useCallback(
    (index: number, held: { blob: Blob; timeCs: number | null; isDnf: boolean }) => {
      pendingUploadsRef.current.set(index, held);
      filingQueueRef.current.push(index);
      void pumpFiling();
    },
    [pumpFiling],
  );

  useEffect(() => {
    return () => {
      if (filingRetryTimerRef.current) clearTimeout(filingRetryTimerRef.current);
    };
  }, []);

  /** Ends the recording and hands it to the keypad. The ONLY route from
   *  the closing hold to the time entry.
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

  function handleEntryConfirm(
    result: { timeCs: number | null; isDnf: boolean },
    /** REQUIRED. The attempt's recording, handed in by the keypad's render
     *  gate. Not read from a ref: an attempt cannot be filed without the
     *  video it is evidence for, and that is now a type error rather than
     *  a runtime `?? new Blob([])`. */
    blob: Blob,
  ) {
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

    // From here they can see for themselves that the run is under way.
    setResumeMessage(null);

    const index = attempts.length;
    const newAttempt: Attempt = {
      timeCs: result.timeCs,
      isDnf: result.isDnf,
      fileState: 'queued',
      uploadPercent: 0,
      submissionId: null,
      fileError: null,
    };
    const next = [...attempts, newAttempt];
    setAttempts(next);
    // Straight into the queue, unawaited: the athlete goes on to the next
    // attempt while this uploads behind them.
    enqueueFiling(index, {
      blob,
      timeCs: result.timeCs,
      isDnf: result.isDnf,
    });
    // Cleared with the attempt it belonged to: the next keypad cannot
    // reach a stale recording, because there is none to reach.
    setPendingBlob(null);

    // ── THE CUTOFF ──
    // The SAME evaluation a resumed run gets (run-resume.ts), over the
    // same attempt list — an athlete must not be able to reload their way
    // past a cutoff they already missed, and two copies of this rule is
    // how that would happen.
    const failedCutoff = cutoffFailed(
      next.map((a) => resolveAttemptTime(a, runShape?.timeLimitCs ?? null)),
      runShape?.cutoffPhase ?? null,
      runShape?.cutoffCs ?? null,
    );

    // The run is over — but the summary is not reachable until every
    // attempt is actually on the server.
    if (failedCutoff) {
      setCutOff(true);
      setStage('filing');
    } else if (next.length >= (runShape?.attempts ?? 0)) {
      setStage('filing');
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

  // NO REDO. The summary used to offer "Дахин үзэх" — delete every
  // recording and start the round again — next to the Ao5 it had just
  // shown. That is the exploit in its most convenient form: see your
  // result, dislike it, solve it again. It is also now impossible, because
  // attempts are filed as they happen and athletes cannot delete a filed
  // submission (firestore.rules). Everything it reset went with it; the
  // run has one shape and one set of attempts from start to finish.

  /** "Илгээх" no longer sends anything — every attempt was filed as it
   *  was recorded. What is left is the run's own result, which lives on
   *  the athlete's registration document rather than on any submission,
   *  and the move to the sent screen. */
  async function handleFinish() {
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
    // Also unreachable: the summary is only reached through the filing
    // stage, which does not let go until every attempt has landed. Left in
    // because "the result is computed from attempts that exist on the
    // server" is the property that matters here.
    if (attempts.some((a) => a.fileState !== 'filed')) {
      setSubmitError('Бүх оролдлого хадгалагдаагүй байна.');
      return;
    }
    setSubmitError('');
    setSubmitting(true);

    try {
      // Computed from the SAME in-memory times the athlete was shown on
      // the summary — filing them one at a time changed when each video
      // was sent, not what any attempt scored.
      const times: AttemptTime[] = attempts.map((a) => resolveAttemptTime(a, runShape?.timeLimitCs ?? null));
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
      console.error('Finish failed:', err);
      // The attempts are safe on the server either way — only the run's
      // own result line failed to write, and retrying is harmless.
      setSubmitError('Дүнг хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
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
              if (runAtRisk && !window.confirm(leaveConfirmMessage(unfiledCount))) e.preventDefault();
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

  const filingRows: FilingRow[] = attempts.map((a, i) => ({
    attempt: i + 1,
    timeCs: a.timeCs,
    isDnf: a.isDnf,
    state: a.fileState,
    uploadPercent: a.uploadPercent,
    error: a.fileError,
  }));
  // One line for the header, in priority order: a problem, then work in
  // progress, then how much is safely stored.
  const uploading = attempts.find((a) => a.fileState === 'uploading' || a.fileState === 'retrying');
  const filedCount = attempts.length - unfiledCount;
  const savingLabel = filingFailed
    ? 'ХАДГАЛАГДСАНГҮЙ'
    : uploading?.fileState === 'retrying'
      ? 'ДАХИН ОРОЛДОЖ БАЙНА'
      : uploading
        ? `ХАДГАЛЖ БАЙНА ${uploading.uploadPercent}%`
        : filedCount > 0
          ? `${filedCount} ОРОЛДЛОГО ХАДГАЛАГДСАН`
          : null;

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
            /* What the background filing is doing, in one line. The
               athlete is mid-attempt: it says enough to notice, and not
               enough to distract. */
            savingLabel={savingLabel}
          />
        )}

        {/* Continuing, not starting. Without this the flow looks
            identical to a fresh run — same camera prompt, same countdown —
            and an athlete who thinks they are on attempt 1 would solve it
            again and have the filing refused. Cleared as soon as they
            record something, because from then on the pips say it. */}
        {resumeMessage && (
          <p
            style={{
              marginTop: 14,
              padding: '11px 13px',
              background: '#141210',
              borderLeft: '2px solid #DFFF4F',
              font: '400 12px var(--oc-font-heading), sans-serif',
              color: '#F4F1EA',
              lineHeight: 1.6,
            }}
            role="status"
          >
            {resumeMessage}
          </p>
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
              setPendingBlob(null);
              setStage('zeroDisplay');
            }}
          />
        )}

        {/* THE ATHLETE'S OWN TIMER, at 0.00, held to the camera — the
            proof that the clock they are about to solve against started
            from zero. This used to be a large on-screen "0.00" with no
            camera preview at all, which proved something about this page
            rather than about the athlete's timer. Recording starts here,
            unchanged: the effect is still keyed on this stage name. */}
        {stage === 'zeroDisplay' && (
          <CameraHoldStage
            seconds={HOLD_SECONDS}
            label="ЦАГАА ХАРУУЛ · ЭХЛЭХИЙН ӨМНӨ"
            instruction={(sec) => `Өөрийн цагаа 0.00 дээр байхад нь камерт ${sec} секунд харуулна уу.`}
            videoRef={recorder.videoRef}
            onDone={() => setStage('scrambleReveal')}
          />
        )}

        {stage === 'scrambleReveal' && (
          <RevealStage scramble={scramble} videoRef={recorder.videoRef} onDone={() => setStage('orientationHold')} />
        )}

        {/* The cube in a known orientation before the solve, so a judge
            can verify the scramble was applied to a cube whose
            orientation is provably known. The SAME five seconds and the
            same words as before — CameraHoldStage is OrientationHoldStage
            with its three hard-coded values handed in. */}
        {stage === 'orientationHold' && (
          <CameraHoldStage
            seconds={HOLD_SECONDS}
            label="ШООГОО БАЙРШУУЛ"
            instruction={(sec) =>
              `Шоогоо цагаан тал дээшээ, ногоон тал дэлгэц рүү харагдахаар байрлуулаад ${sec} секунд хөдөлгөөнгүй барина уу.`
            }
            videoRef={recorder.videoRef}
            onDone={() => setStage('readyPrompt')}
          />
        )}

        {stage === 'readyPrompt' && (
          <ReadyPromptStage videoRef={recorder.videoRef} onDone={() => setStage('rec')} />
        )}

        {stage === 'rec' && (
          <RecStage
            videoRef={recorder.videoRef}
            /* The solve is over; the RECORDING IS NOT. It runs through
               the closing hold, where the athlete shows the timer that
               produced the number they are about to type. */
            onFinish={() => setStage('finishHold')}
          />
        )}

        {stage === 'finishHold' && (
          <CameraHoldStage
            seconds={HOLD_SECONDS}
            label="ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА"
            instruction={(sec) => `Хэмжсэн цагаа камерт тод харагдахаар ${sec} секунд барина уу.`}
            videoRef={recorder.videoRef}
            onDone={finishRecording}
          />
        )}

        {/* THE GATE: no blob, no keypad. The only way to reach this
            screen is through finishRecording, which sets the blob and the
            stage together — but this says so structurally rather than
            relying on that ordering holding forever. */}
        {stage === 'entry' && pendingBlob && (
          <EntryStage onConfirm={(result) => handleEntryConfirm(result, pendingBlob)} />
        )}

        {stage === 'filing' && (
          <FilingStage
            rows={filingRows}
            failed={filingFailed}
            runComplete={runComplete}
            /* Manual retry. The worker has already tried once on its own
               (FILING_AUTO_RETRIES) — this is the athlete taking over. */
            onRetry={() => {
              if (filingRetryTimerRef.current) {
                clearTimeout(filingRetryTimerRef.current);
                filingRetryTimerRef.current = null;
              }
              void pumpFiling();
            }}
          />
        )}

        {stage === 'summary' && (
          <SummaryStage
            bests={bests}
            attempts={attempts.map((a) => ({ timeCs: a.timeCs, isDnf: a.isDnf }))}
            resultFormat={runShape.format}
            timeLimitCs={runShape.timeLimitCs}
            cutOff={cutOff}
            cutoffCs={runShape.cutoffCs}
            onSubmit={handleFinish}
            submitting={submitting}
            submitError={submitError}
          />
        )}

        {stage === 'sent' && <SentStage ao5={finalAo5} />}
      </div>
    </div>
  );
}
