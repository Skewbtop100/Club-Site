'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fetchCompetition, createSubmission, recordAo5Result } from '@/lib/online-competition/data';
import { uploadVideoToCloudinary } from '@/lib/online-competition/cloudinary';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useSolveRecorder } from './_lib/useSolveRecorder';
import type { AttemptTime } from '@/lib/online-competition/ao5';
import { computeSummaryStats } from './_lib/summaryStats';
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

const REAL_TOTAL_ATTEMPTS = 5;

// TESTING-ONLY override: ?__testAttempts=2 shortens a manual test run to
// 2 attempts instead of the real Ao5-mandated 5. Never surfaced in any
// UI — only ever read from the URL — and clamped to [1, REAL_TOTAL_
// ATTEMPTS] so a malformed value can't produce 0 or an absurdly long run.
// Real athletes always get the real 5; this only ever changes anything
// when the query param is explicitly present. When active, the summary
// screen's Ao5 falls back to a plain average (see _lib/summaryStats.ts)
// since real Ao5 math only makes sense at exactly 5 attempts.
const TEST_ATTEMPTS_PARAM = '__testAttempts';

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

  const searchParams = useSearchParams();
  const testAttemptsRaw = searchParams.get(TEST_ATTEMPTS_PARAM);
  const parsedTestAttempts = testAttemptsRaw ? parseInt(testAttemptsRaw, 10) : NaN;
  const totalAttempts =
    Number.isInteger(parsedTestAttempts) && parsedTestAttempts >= 1 && parsedTestAttempts <= REAL_TOTAL_ATTEMPTS
      ? parsedTestAttempts
      : REAL_TOTAL_ATTEMPTS;

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

  const fetchScramble = useCallback(async () => {
    try {
      const res = await fetch(`/api/online-competition/scramble?event=${encodeURIComponent(eventId)}`);
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { scramble: string };
      setScramble(data.scramble);
    } catch {
      setLoadError('Скрамбл авахад алдаа гарлаа');
    }
  }, [eventId]);

  // Fetch the first attempt's scramble once. Later attempts fetch theirs
  // explicitly (in handleEntryConfirm/handleRedo below) rather than via a
  // reactive effect — attemptIndex going back to 0 on a redo wouldn't
  // re-trigger an effect keyed on its value.
  useEffect(() => {
    fetchScramble();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => recorder.releaseCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const newAttempt: Attempt = { timeCs: result.timeCs, isDnf: result.isDnf, videoBlob: pendingBlobRef.current };
    const next = [...attempts, newAttempt];
    setAttempts(next);
    pendingBlobRef.current = null;

    if (next.length >= totalAttempts) {
      setStage('summary');
    } else {
      setAttemptIndex((i) => i + 1);
      fetchScramble();
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
    fetchScramble();
    setStage('zeroDisplay');
  }

  async function handleSubmit() {
    if (!user || user.isAnonymous) {
      setSubmitError('Та нэвтрээгүй байна. Дахин нэвтэрнэ үү.');
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

  if (!competition || !scramble) {
    return <div className="oc-solve-page" />;
  }

  const eventConfig = competition.events.find((e) => e.eventId === eventId);
  const eventLabel = eventConfig?.label ?? eventId.toUpperCase();

  return (
    <div className="oc-solve-page">
      <div className="oc-solve-shell">
        {HEADER_STAGES.includes(stage) && (
          <Header
            competitionName={competition.name}
            eventLabel={eventLabel}
            attemptIndex={attemptIndex}
            totalAttempts={totalAttempts}
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
