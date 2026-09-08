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
} from '@/lib/online-competition/data';
import { uploadVideoToCloudinary } from '@/lib/online-competition/cloudinary';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useSolveRecorder } from './_lib/useSolveRecorder';
import type { AttemptTime } from '@/lib/online-competition/ao5';
import { computeSummaryStats } from './_lib/summaryStats';
import { beatsPr } from './_lib/prCheck';
import Header from './_components/Header';
import CameraSetupStage from './_components/CameraSetupStage';
import ZeroDisplayStage from './_components/ZeroDisplayStage';
import RevealStage from './_components/RevealStage';
import OrientationHoldStage from './_components/OrientationHoldStage';
import ReadyPromptStage from './_components/ReadyPromptStage';
import RecStage from './_components/RecStage';
import EntryStage from './_components/EntryStage';
import SummaryStage from './_components/SummaryStage';
import SentStage from './_components/SentStage';

type Stage =
  | 'cameraSetup'
  | 'zeroDisplay'
  | 'scrambleReveal'
  | 'orientationHold'
  | 'readyPrompt'
  | 'rec'
  | 'entry'
  | 'summary'
  | 'sent';

/** Attempts in a run — the WCA Ao5 count, and the only value the flow
 *  ever uses. (A `?__testAttempts=N` URL override used to shorten manual
 *  test runs; it was removed with the rest of the test-data feature.) */
const TOTAL_ATTEMPTS = 5;

interface Attempt {
  timeCs: number | null;
  isDnf: boolean;
  videoBlob: Blob | null;
}

const HEADER_STAGES: Stage[] = ['zeroDisplay', 'scrambleReveal', 'orientationHold', 'readyPrompt', 'rec', 'entry'];

export default function SolvePage() {
  const params = useParams<{ competitionId: string; eventId: string }>();
  const { competitionId, eventId } = params;
  const { user, loading: authLoading, signInWithGoogle } = useOnlineAuth();

  const [competition, setCompetition] = useState<OnlineCompetition | null>(null);
  const [loadError, setLoadError] = useState('');

  const [stage, setStage] = useState<Stage>('cameraSetup');
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [scramble, setScramble] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const pendingBlobRef = useRef<Blob | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const [finalAo5, setFinalAo5] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // ── Live PR indicator ────────────────────────────────────────────────
  // The athlete's stored bests for THIS event, read once when the flow
  // loads and cached for the whole 5-attempt session. Read-only: this
  // page never writes stats — stats.{eventId}.pr is computed exclusively
  // by the admin recompute after a judge approves (see
  // lib/online-competition/athleteStats.ts), which is also why every
  // indicator below is labelled provisional.
  // Set when the API refuses this attempt on round grounds (no live round,
  // or not qualified into the live one). Distinct from loadError: this is
  // a legitimate "you can't solve right now" answer, not a failure, and
  // gets its own explanatory screen rather than a red error line.
  const [blockedMessage, setBlockedMessage] = useState('');
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
  const [bests, setBests] = useState<{ pr: number | null; ao5: number | null } | null>(null);
  const [prToast, setPrToast] = useState(false);
  const [signInError, setSignInError] = useState('');

  const recorder = useSolveRecorder();

  useEffect(() => {
    let cancelled = false;
    fetchCompetition(competitionId)
      .then((c) => {
        if (!cancelled) setCompetition(c);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Тэмцээний мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId]);

  // The real (non-anonymous) uid, or null while auth is still resolving.
  // Everything below the auth gate requires it, and the scramble fetch
  // waits for it too — see the effect below.
  const solverUid = user && !user.isAnonymous ? user.uid : null;

  const fetchScramble = useCallback(
    async (attemptNumber: number) => {
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
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          // A round-gating refusal carries a Mongolian `message`; anything
          // else is a genuine failure.
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
        }
      } catch {
        setLoadError('Скрамбл авахад алдаа гарлаа');
      }
    },
    [eventId, competitionId, solverUid],
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

  useEffect(() => {
    return () => recorder.releaseCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One fetch per session, keyed on the real (non-anonymous) uid.
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    let cancelled = false;
    fetchParticipant(user.uid)
      .then((p) => {
        if (cancelled) return;
        const forEvent = p?.stats?.[eventId];
        setBests({ pr: forEvent?.pr ?? null, ao5: forEvent?.ao5 ?? null });
      })
      .catch(() => {
        // Missing bests just means no badge is shown — never blocks solving.
        if (!cancelled) setBests({ pr: null, ao5: null });
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
  // value 'zeroDisplay' at the start of a fresh attempt (from
  // cameraSetup, from handleEntryConfirm, or from handleRedo) — never as
  // an intermediate value while already sitting in zeroDisplay — so this
  // fires exactly once per attempt.
  useEffect(() => {
    if (stage === 'zeroDisplay') {
      recorder.startRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  function handleEntryConfirm(result: { timeCs: number | null; isDnf: boolean }) {
    // Provisional only — a first-ever time for this event counts as a PR
    // too (there is nothing to beat yet).
    if (beatsPr(result.timeCs, result.isDnf, bests)) setPrToast(true);

    const newAttempt: Attempt = { timeCs: result.timeCs, isDnf: result.isDnf, videoBlob: pendingBlobRef.current };
    const next = [...attempts, newAttempt];
    setAttempts(next);
    pendingBlobRef.current = null;

    if (next.length >= TOTAL_ATTEMPTS) {
      setStage('summary');
    } else {
      setAttemptIndex((i) => i + 1);
      // next.length is the count of completed attempts, so the attempt now
      // starting is next.length + 1 (1-based, matching the group scramble
      // array index the API reads).
      fetchScramble(next.length + 1);
      setStage('zeroDisplay');
    }
  }

  // Guarded the same way RegistrationPanel's sign-in gate is: without a
  // pending-flag + disabled button, an impatient double-click here fires
  // signInWithPopup twice on the same auth instance, and the second call
  // cancels the first with an uncaught "auth/cancelled-popup-request" —
  // this button was the one unguarded signInWithGoogle() call site left
  // in the whole solve flow.
  async function handleSignIn() {
    if (signingIn) return;
    setSignInError('');
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // User closed the popup, or a repeat click superseded the first
      // popup — nothing went wrong, just stay on the gate quietly.
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setSignInError('Нэвтрэхэд алдаа гарлаа, дахин оролдоно уу');
      }
    } finally {
      setSigningIn(false);
    }
  }

  function handleRedo() {
    setAttempts([]);
    setAttemptIndex(0);
    setSubmitError('');
    // Cleared so a failed re-fetch can't leave the previous run's round
    // attached to the new one; fetchScramble(1) re-resolves it.
    setCompetitionRound(null);
    fetchScramble(1);
    setStage('zeroDisplay');
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
          round: i + 1,
          competitionRound,
          videoUrl: secureUrl,
          cloudinaryPublicId: publicId,
          reportedTime: attempt.isDnf ? 0 : (attempt.timeCs as number),
          isDnf: attempt.isDnf,
        });
        perAttemptProgress[i] = 100;
        reportAggregate();
      }

      const times: AttemptTime[] = attempts.map((a) => (a.isDnf ? 'DNF' : (a.timeCs as number)));
      const { ao5 } = computeSummaryStats(times);
      await recordAo5Result(user.uid, competitionId, eventId, { ao5, attempts: times });
      setFinalAo5(ao5);

      recorder.releaseCamera();
      setStage('sent');
    } catch (err) {
      console.error('Submit failed:', err);
      setSubmitError('Илгээхэд алдаа гарлаа. Дахин оролдоно уу.');
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
          {signInError && (
            <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C', textAlign: 'center' }}>
              {signInError}
            </p>
          )}
          <button
            type="button"
            className="oc-solve-btn-confirm"
            style={{ width: 'auto', padding: '12px 24px' }}
            disabled={signingIn}
            onClick={handleSignIn}
          >
            {signingIn ? 'Нэвтэрч байна...' : 'Нэвтрэх'}
          </button>
        </div>
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

  if (!competition || !scramble) {
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
      <div className="oc-solve-shell">
        {HEADER_STAGES.includes(stage) && (
          <Header
            competitionName={competition.name}
            eventLabel={eventLabel}
            attemptIndex={attemptIndex}
            totalAttempts={TOTAL_ATTEMPTS}
          />
        )}

        {stage === 'cameraSetup' && (
          <CameraSetupStage
            videoRef={recorder.videoRef}
            hasCamera={recorder.hasCamera}
            error={recorder.error}
            onRequestCamera={recorder.requestCamera}
            onDone={() => setStage('zeroDisplay')}
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
