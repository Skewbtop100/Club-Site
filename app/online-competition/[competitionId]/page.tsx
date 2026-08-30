// ── DEAD CODE (Phase 5) ──────────────────────────────────────────────────
// Superseded by app/online-competition/[competitionId]/solve/[eventId]/
// page.tsx — the real Ao5 solve flow (scramble reveal, camera countdown,
// manual time entry, 5 attempts, submit). Nothing links here anymore (the
// dashboard's "Эхлүүлэх" now points at the new route); this old
// single-attempt auto-stopwatch + anonymous-auth page is kept in place,
// unrouted, purely for reference/rollback. Do not build on this file —
// build on the new one instead. Safe to delete once Phase 5 has been in
// use long enough that rollback is no longer a concern.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ensureOnlineCompAuth } from '@/lib/online-competition/firebase';
import { uploadVideoToCloudinary } from '@/lib/online-competition/cloudinary';
import {
  fetchCompetition,
  fetchParticipant,
  getNextEventRound,
  getOrCreateScramble,
  upsertParticipant,
  createSubmission,
} from '@/lib/online-competition/data';
import type { NextEventRound, OnlineCompetition } from '@/lib/online-competition/types';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { useCameraRecorder } from './_lib/useCameraRecorder';
import { StickerTag } from '../_components/StickerChip';

type Stage =
  | 'loading'
  | 'error'
  | 'nickname'
  | 'camera-setup'
  | 'ready'
  | 'recording'
  | 'review'
  | 'uploading'
  | 'done';

// Shared button styles — deliberately plain (rounded-lg, not the sticker
// motif), so the sticker chips stay the one distinctive signature.
//
// Padding lives in the *_STYLE companions below, not as `py-*`/`px-*`
// classes on these strings — app/globals.css's unlayered
// `*, *::before, *::after { margin: 0; padding: 0; }` reset always wins
// over Tailwind's layered utility classes regardless of specificity (CSS
// Cascade Layers: an unlayered rule beats any layered one), so every
// Tailwind margin/padding class in this file was silently a no-op.
// Inline styles always win regardless of layers, so that's what carries
// spacing throughout this file now.
const BTN_PRIMARY =
  'rounded-xl bg-[var(--oc-accent)] font-semibold text-[var(--oc-bg)] transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--oc-text-primary)]';
const BTN_PRIMARY_STYLE: React.CSSProperties = { paddingTop: 12, paddingBottom: 12 }; // py-3
const BTN_DANGER =
  'w-full rounded-xl bg-[var(--oc-danger)] text-lg font-bold text-[var(--oc-bg)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--oc-text-primary)]';
const BTN_DANGER_STYLE: React.CSSProperties = { paddingTop: 16, paddingBottom: 16 }; // py-4
const BTN_GHOST =
  'flex-1 rounded-xl border border-[var(--oc-border)] font-semibold text-[var(--oc-text-muted)] transition hover:bg-[var(--oc-surface-raised)] hover:text-[var(--oc-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--oc-text-primary)]';
const BTN_GHOST_STYLE: React.CSSProperties = { paddingTop: 12, paddingBottom: 12 }; // py-3
const CARD = 'w-full rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)]';
const CARD_STYLE: React.CSSProperties = { padding: 24 }; // p-6
const HEADING = 'font-[family-name:var(--oc-font-heading)]';
const INPUT =
  'w-full rounded-lg border border-[var(--oc-border)] bg-[var(--oc-bg)] text-[var(--oc-text-primary)] outline-none transition focus:border-[var(--oc-accent)] focus:ring-2 focus:ring-[var(--oc-accent)]/30';
const INPUT_STYLE: React.CSSProperties = { paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }; // px-4 py-3

export default function OnlineCompetitionPage() {
  const params = useParams<{ competitionId: string }>();
  const competitionId = params.competitionId;

  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [uid, setUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [competition, setCompetition] = useState<OnlineCompetition | null>(null);
  const [eventRound, setEventRound] = useState<NextEventRound | null>(null);
  const [scramble, setScramble] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const stageRef = useRef<Stage>('loading');
  stageRef.current = stage;

  const recorder = useCameraRecorder();

  // ── Bootstrap: auth, competition, participant, scramble ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await ensureOnlineCompAuth();
        if (!user) throw new Error('Нэвтрэх амжилтгүй боллоо');
        if (cancelled) return;
        setUid(user.uid);

        const comp = await fetchCompetition(competitionId);
        if (!comp) {
          setErrorMsg('Тэмцээн олдсонгүй.');
          setStage('error');
          return;
        }
        if (cancelled) return;
        setCompetition(comp);

        const nextEr = getNextEventRound(comp);
        setEventRound(nextEr);

        const [participant, scrambleText] = await Promise.all([
          fetchParticipant(user.uid),
          getOrCreateScramble(competitionId, nextEr.event, nextEr.round),
        ]);
        if (cancelled) return;
        setScramble(scrambleText);

        if (participant?.displayName) {
          setDisplayName(participant.displayName);
          setStage('camera-setup');
        } else {
          setStage('nickname');
        }
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : 'Алдаа гарлаа');
        setStage('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [competitionId]);

  // ── Spacebar: start/stop recording ──────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (stageRef.current === 'ready') {
        e.preventDefault();
        setStage('recording');
        recorder.startRecording();
      } else if (stageRef.current === 'recording') {
        e.preventDefault();
        recorder.stopRecording();
        setStage('review');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recorder]);

  const handleNicknameSubmit = useCallback(async () => {
    const trimmed = nicknameInput.trim();
    if (!trimmed || !uid) return;
    await upsertParticipant(uid, trimmed);
    setDisplayName(trimmed);
    setStage('camera-setup');
  }, [nicknameInput, uid]);

  const handleCameraReady = useCallback(async () => {
    await recorder.requestCamera();
    setStage('camera-setup');
  }, [recorder]);

  const handleProceedToSolve = useCallback(() => {
    setStage('ready');
  }, []);

  const handleStartSolve = useCallback(() => {
    setStage('recording');
    recorder.startRecording();
  }, [recorder]);

  const handleStopSolve = useCallback(() => {
    recorder.stopRecording();
    setStage('review');
  }, [recorder]);

  const handleRetry = useCallback(() => {
    recorder.resetRecording();
    setStage('ready');
  }, [recorder]);

  const handleSubmit = useCallback(async () => {
    if (!recorder.recordedBlob || !uid || !eventRound) return;
    setStage('uploading');
    setUploadProgress(0);
    try {
      const { secureUrl, publicId } = await uploadVideoToCloudinary(
        recorder.recordedBlob,
        setUploadProgress,
      );

      await createSubmission({
        competitionId,
        uid,
        event: eventRound.event,
        round: eventRound.round,
        videoUrl: secureUrl,
        cloudinaryPublicId: publicId,
        reportedTime: recorder.elapsedCs,
      });

      recorder.releaseCamera();
      setStage('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Илгээхэд алдаа гарлаа');
      setStage('review');
    }
  }, [recorder, uid, eventRound, competitionId]);

  return (
    // Full-bleed dark background lives here now, not on the shared
    // oc-theme wrapper (app/online-competition/layout.tsx) — that wrapper
    // used to hardcode these v1 tokens for every route under
    // /online-competition, including the v2 admin dashboard. Same pattern
    // admin/page.tsx already uses: an outer min-h-screen/w-full div paints
    // the background, and the narrower `max-w-xl` content column just
    // constrains layout, not the canvas behind it.
    <div className="min-h-screen w-full bg-[var(--oc-bg)] text-[var(--oc-text-primary)]">
      <main
        className="oc-v1-main-padding flex min-h-screen max-w-xl flex-col items-center justify-center gap-6"
        style={{ margin: '0 auto' }}
      >
        <header className="text-center" style={{ marginBottom: 8 }}>
          <h1 className={`${HEADING} text-2xl font-extrabold tracking-tight text-[var(--oc-text-primary)]`}>
            {competition?.name ?? 'Онлайн тэмцээн'}
          </h1>
          {displayName && (
            <p className="text-sm text-[var(--oc-text-muted)]" style={{ marginTop: 4 }}>
              Тамирчин: {displayName}
            </p>
          )}
        </header>

        {stage === 'loading' && <Loading />}

        {stage === 'error' && <ErrorPanel message={errorMsg} />}

        {stage === 'nickname' && (
          <NicknameStep
            value={nicknameInput}
            onChange={setNicknameInput}
            onSubmit={handleNicknameSubmit}
          />
        )}

        {stage === 'camera-setup' && (
          <CameraSetupStep
            videoRef={recorder.videoRef}
            hasCamera={recorder.hasCamera}
            error={recorder.error}
            onRequestCamera={handleCameraReady}
            onProceed={handleProceedToSolve}
          />
        )}

        {stage === 'ready' && (
          <SolveReadyStep
            videoRef={recorder.videoRef}
            eventRound={eventRound}
            scramble={scramble}
            onStart={handleStartSolve}
          />
        )}

        {stage === 'recording' && (
          <RecordingStep
            videoRef={recorder.videoRef}
            elapsedCs={recorder.elapsedCs}
            onStop={handleStopSolve}
          />
        )}

        {stage === 'review' && (
          <ReviewStep
            elapsedCs={recorder.elapsedCs}
            blob={recorder.recordedBlob}
            errorMsg={errorMsg}
            onRetry={handleRetry}
            onSubmit={handleSubmit}
          />
        )}

        {stage === 'uploading' && <UploadingStep progress={uploadProgress} />}

        {stage === 'done' && <DoneStep />}
      </main>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────

/** A live/preview <video> wrapped in a subtle frame matching the card
 *  surface color — used on every stage that shows the camera. */
function VideoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface-raised)]"
      style={{ padding: 6 }} // p-1.5
    >
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">{children}</div>
    </div>
  );
}

// ── Small stage components ────────────────────────────────────────────────

function Loading() {
  return <p className="text-[var(--oc-text-muted)]">Ачааллаж байна...</p>;
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border text-center text-[var(--oc-danger)]"
      style={{
        background: 'var(--oc-danger-bg)',
        borderColor: 'var(--oc-danger-border)',
        paddingLeft: 24, // px-6
        paddingRight: 24,
        paddingTop: 16, // py-4
        paddingBottom: 16,
      }}
    >
      {message || 'Алдаа гарлаа'}
    </div>
  );
}

function NicknameStep({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className={CARD} style={CARD_STYLE}>
      <label className="block text-sm text-[var(--oc-text-muted)]" style={{ marginBottom: 8 }}>
        Нэрээ оруулна уу
      </label>
      <input
        className={INPUT}
        style={INPUT_STYLE}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Таны нэр"
        maxLength={40}
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim()}
        className={`${BTN_PRIMARY} w-full`}
        style={{ ...BTN_PRIMARY_STYLE, marginTop: 16 }}
      >
        Үргэлжлүүлэх
      </button>
    </div>
  );
}

function CameraSetupStep({
  videoRef,
  hasCamera,
  error,
  onRequestCamera,
  onProceed,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hasCamera: boolean;
  error: string | null;
  onRequestCamera: () => void;
  onProceed: () => void;
}) {
  return (
    <div className={CARD} style={CARD_STYLE}>
      <VideoFrame>
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      </VideoFrame>
      <p className="text-center text-sm leading-relaxed text-[var(--oc-warning)]" style={{ marginTop: 16 }}>
        Тавцан дээрх шоо, гар хоёулаа камерт харагдаж байгаа эсэхээ шалгана уу
      </p>
      {error && (
        <p className="text-center text-sm text-[var(--oc-danger)]" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      <button
        onClick={hasCamera ? onProceed : onRequestCamera}
        className={`${BTN_PRIMARY} w-full`}
        style={{ ...BTN_PRIMARY_STYLE, marginTop: 16 }}
      >
        {hasCamera ? 'Бэлэн боллоо' : 'Камер асаах'}
      </button>
    </div>
  );
}

function SolveReadyStep({
  videoRef,
  eventRound,
  scramble,
  onStart,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  eventRound: NextEventRound | null;
  scramble: string;
  onStart: () => void;
}) {
  return (
    <div className={CARD} style={CARD_STYLE}>
      <VideoFrame>
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      </VideoFrame>
      {eventRound && (
        <div className="flex justify-center" style={{ marginTop: 16 }}>
          <StickerTag tone="neutral">
            {eventRound.event.toUpperCase()} · Раунд {eventRound.round}
          </StickerTag>
        </div>
      )}
      <p
        className="break-words text-center text-lg text-[var(--oc-text-primary)]"
        style={{ fontFamily: 'var(--oc-font-mono)', marginTop: 12 }}
      >
        {scramble}
      </p>
      <button
        onClick={onStart}
        className={`${BTN_PRIMARY} w-full text-lg`}
        style={{ ...BTN_PRIMARY_STYLE, marginTop: 16, paddingTop: 16, paddingBottom: 16 }}
      >
        Эхлэх
      </button>
      <p className="text-center text-xs text-[var(--oc-text-muted)]" style={{ marginTop: 8 }}>
        Эсвэл хоосон зай товч (Space) дарна уу
      </p>
    </div>
  );
}

function RecordingStep({
  videoRef,
  elapsedCs,
  onStop,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  elapsedCs: number;
  onStop: () => void;
}) {
  return (
    <div className={CARD} style={{ ...CARD_STYLE, borderColor: 'var(--oc-danger-border)' }}>
      <VideoFrame>
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      </VideoFrame>
      <p
        className="text-center text-5xl font-bold tabular-nums tracking-wide text-[var(--oc-text-primary)] sm:text-6xl"
        style={{ fontFamily: 'var(--oc-font-mono)', marginTop: 16 }}
      >
        {fmtCentiseconds(elapsedCs)}
      </p>
      <button onClick={onStop} className={BTN_DANGER} style={{ ...BTN_DANGER_STYLE, marginTop: 16 }}>
        Зогсоох
      </button>
      <p className="text-center text-xs text-[var(--oc-text-muted)]" style={{ marginTop: 8 }}>
        Эсвэл хоосон зай товч (Space) дарна уу
      </p>
    </div>
  );
}

function ReviewStep({
  elapsedCs,
  blob,
  errorMsg,
  onRetry,
  onSubmit,
}: {
  elapsedCs: number;
  blob: Blob | null;
  errorMsg: string;
  onRetry: () => void;
  onSubmit: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return (
    <div className={CARD} style={CARD_STYLE}>
      {previewUrl && (
        <VideoFrame>
          <video src={previewUrl} controls playsInline className="h-full w-full object-cover" />
        </VideoFrame>
      )}
      <p
        className="text-center text-4xl font-bold tabular-nums tracking-wide text-[var(--oc-text-primary)] sm:text-5xl"
        style={{ fontFamily: 'var(--oc-font-mono)', marginTop: 16 }}
      >
        {fmtCentiseconds(elapsedCs)}
      </p>
      {errorMsg && (
        <p className="text-center text-sm text-[var(--oc-danger)]" style={{ marginTop: 8 }}>
          {errorMsg}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row" style={{ marginTop: 16 }}>
        <button onClick={onRetry} className={BTN_GHOST} style={BTN_GHOST_STYLE}>
          Дахин оролдох
        </button>
        <button onClick={onSubmit} className={`${BTN_PRIMARY} flex-1`} style={BTN_PRIMARY_STYLE}>
          Илгээх
        </button>
      </div>
    </div>
  );
}

function UploadingStep({ progress }: { progress: number }) {
  return (
    <div className={`${CARD} text-center`} style={CARD_STYLE}>
      <p className="text-[var(--oc-text-muted)]" style={{ marginBottom: 16 }}>
        Илгээж байна...
      </p>
      <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--oc-surface-raised)]">
        <div
          className="h-full rounded-full bg-[var(--oc-accent)] transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p
        className="text-sm text-[var(--oc-text-muted)]"
        style={{ fontFamily: 'var(--oc-font-mono)', marginTop: 8 }}
      >
        {progress}%
      </p>
    </div>
  );
}

function DoneStep() {
  return (
    <div className={`${CARD} text-center`} style={CARD_STYLE}>
      <div className="flex justify-center" style={{ marginBottom: 16 }}>
        <StickerTag tone="success" size="md">
          ✓
        </StickerTag>
      </div>
      <p className={`${HEADING} text-lg font-bold text-[var(--oc-text-primary)]`}>
        Илгээгдлээ. Шүүгч хянасны дараа дүн батлагдана.
      </p>
    </div>
  );
}
