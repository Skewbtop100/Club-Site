'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fetchCompetition, createSubmission, recordAo5Result } from '@/lib/online-competition/data';
import { uploadVideoToCloudinary } from '@/lib/online-competition/cloudinary';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useSolveRecorder } from './_lib/useSolveRecorder';
import { computeAo5, type AttemptTime } from '@/lib/online-competition/ao5';
import Header from './_components/Header';
import RevealStage from './_components/RevealStage';
import GoStage from './_components/GoStage';
import GoNowStage from './_components/GoNowStage';
import RecStage from './_components/RecStage';
import EntryStage from './_components/EntryStage';
import SummaryStage from './_components/SummaryStage';
import SentStage from './_components/SentStage';

type Stage = 'reveal' | 'go' | 'goNow' | 'rec' | 'entry' | 'summary' | 'sent';

const TOTAL_ATTEMPTS = 5;

interface Attempt {
  timeCs: number | null;
  isDnf: boolean;
  videoBlob: Blob | null;
}

const HEADER_STAGES: Stage[] = ['reveal', 'go', 'rec', 'entry'];

export default function SolvePage() {
  const params = useParams<{ competitionId: string; eventId: string }>();
  const { competitionId, eventId } = params;
  const { user, loading: authLoading, signInWithGoogle } = useOnlineAuth();

  const [competition, setCompetition] = useState<OnlineCompetition | null>(null);
  const [loadError, setLoadError] = useState('');

  const [stage, setStage] = useState<Stage>('reveal');
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [scramble, setScramble] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const pendingBlobRef = useRef<Blob | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const [finalAo5, setFinalAo5] = useState<number | null>(null);

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

  function handleEntryConfirm(result: { timeCs: number | null; isDnf: boolean }) {
    const newAttempt: Attempt = { timeCs: result.timeCs, isDnf: result.isDnf, videoBlob: pendingBlobRef.current };
    const next = [...attempts, newAttempt];
    setAttempts(next);
    pendingBlobRef.current = null;

    if (next.length >= TOTAL_ATTEMPTS) {
      setStage('summary');
    } else {
      setAttemptIndex((i) => i + 1);
      fetchScramble();
      setStage('reveal');
    }
  }

  function handleRedo() {
    setAttempts([]);
    setAttemptIndex(0);
    setSubmitError('');
    fetchScramble();
    setStage('reveal');
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
    const perAttemptProgress = new Array(TOTAL_ATTEMPTS).fill(0);
    const reportAggregate = () => {
      const avg = perAttemptProgress.reduce((a, b) => a + b, 0) / TOTAL_ATTEMPTS;
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
      const { ao5 } = computeAo5(times);
      await recordAo5Result(user.uid, competitionId, eventId, { ao5, attempts: times });
      setFinalAo5(ao5);

      recorder.releaseCamera();
      setStage('sent');
    } catch {
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
          <button type="button" className="oc-solve-btn-confirm" style={{ width: 'auto', padding: '12px 24px' }} onClick={() => signInWithGoogle()}>
            Нэвтрэх
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
          <Header competitionName={competition.name} eventLabel={eventLabel} attemptIndex={attemptIndex} />
        )}

        {stage === 'reveal' && <RevealStage scramble={scramble} onDone={() => setStage('go')} />}

        {stage === 'go' && (
          <GoStage
            videoRef={recorder.videoRef}
            cameraError={recorder.error}
            onStartRecording={recorder.startCameraAndRecording}
            onDone={() => setStage('goNow')}
          />
        )}

        {stage === 'goNow' && <GoNowStage onDone={() => setStage('rec')} />}

        {stage === 'rec' && (
          <RecStage
            videoRef={recorder.videoRef}
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
