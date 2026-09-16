'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { ONLINE_COMP_EVENTS, onlineCompEventLabel } from '@/lib/online-competition/events';
import { generateScramble } from '@/lib/scramble';
import { COVER_SECONDS } from '@/lib/online-competition/solve-stage-timing';
import { PRACTICE_ROUTE, uploadAndFilePracticeRun } from '@/lib/online-competition/practice-upload-client';
import { authedFetchWithRetry } from '@/lib/online-competition/authed-fetch';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import {
  leaveConfirmMessage,
  useSolveRun,
} from '@/app/online-competition/[competitionId]/solve/[eventId]/_lib/useSolveRun';
import { useSolveRecorder } from '@/app/online-competition/[competitionId]/solve/[eventId]/_lib/useSolveRecorder';
import LobbyStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/LobbyStage';
import AttemptIntroStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/AttemptIntroStage';
import CameraHoldStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/CameraHoldStage';
import RevealStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/RevealStage';
import CoverStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/CoverStage';
import ReadyPromptStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/ReadyPromptStage';
import RecStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/RecStage';
import EntryStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/EntryStage';
import RecordingFailedStage from '@/app/online-competition/[competitionId]/solve/[eventId]/_components/RecordingFailedStage';
import AuthModal from '@/app/online-competition/_components/hub/v3/AuthModal';
import PracticeHeader from '../_components/PracticeHeader';

// ── ТУРШИЛТ: one recorded run, no competition ───────────────────────────
// THE SAME SEQUENCE AS A COMPETITION ATTEMPT, and that is the entire point:
// an athlete who has been through this once knows what a recorded solve
// asks of them, so finding out does not cost them a round of DNFs.
//
// IT COMPOSES useSolveRun. The Stage union, every transition, the recording
// boundary and the leave guards are that hook's, unmodified — this file
// supplies what a run needs that the machine has no opinion about, and for
// practice those are all different from a competition's:
//
//   THE SCRAMBLE is generated here, client-side, by generateScramble — the
//     same function the timer page uses. No admin import, no group, no
//     scramble route, so THE SCRAMBLE GATE IS NOT INVOLVED AT ALL. That is
//     deliberate: the gate exists to hand an athlete the official scramble
//     for their assigned group in a live round, and a practice run has
//     none of those things.
//   THERE IS NO ROUND, no attempt number and no resume. One run, one clip.
//   FILING goes to practiceRuns through the practice route, never to
//     onlineSubmissions. Nothing here can reach the review queue, the
//     standings, the qualifier or the athlete stats rollup.
//
// The stages that exist in a competition and not here are `scrambleWait`
// (the scramble is generated synchronously, so there is nothing to wait
// for), `between` and `summary` (one run has no next attempt and no Ao5).
//
// ── THE LAYOUT IS THE COMPETITION'S, NOT A COPY OF IT ──
// The DOM below is the competition page's, element for element and class
// for class:
//
//     .oc-solve-takeover        fixed, 100dvh, flex column
//       <bar>                   flex:none, 56px
//       .oc-solve-body          flex:1, min-height:0, overflow-y:auto,
//                               justify-content:center, padding 26px
//                               (16px at <=460px), isolation:isolate
//         .oc-solve-stage       the column every stage renders into
//
// .oc-solve-body IS LOAD-BEARING AND IS EASY TO MISS, which is exactly what
// happened the first time this page was written. Without it:
//   · `flex: 1` is absent, so the stage column takes its content height and
//     sits at the top of the takeover with the background showing below —
//     the reported symptom;
//   · `overflow-y: auto` is absent, so a stage taller than the viewport
//     cannot be scrolled to;
//   · the 26px/16px padding is absent, so every stage sits flush to the
//     bezel;
//   · `isolation: isolate` is absent, and ScreenFill's z-index:-1 fill
//     escapes to the takeover's background and becomes INVISIBLE — so the
//     full-bleed screens (zeroDisplay, cover, rec) render differently, not
//     merely off-position.
//
// Nothing here adds or overrides a single line of that CSS: the parity is
// the DOM's, so it survives changes to theme.css instead of having to track
// them. See the report on this changeset for why the layout still lives in
// two places rather than in a shared shell.

const HOLD_SECONDS = 8;
const PRACTICE_HREF = '/online-competition/practice';

export default function PracticeRunPage() {
  const router = useRouter();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const { user, loading: authLoading } = useOnlineAuth();
  const signedIn = !!user && !user.isAnonymous;

  const [authOpen, setAuthOpen] = useState(false);
  /** THE SERVER'S ANSWER to "may this athlete practise", asked BEFORE the
   *  run is shown. Without it an unverified athlete reached by a bookmark or
   *  a stale tab would record a whole solve and be refused at the upload —
   *  a run spent for nothing. `null` while asking; 'unavailable' when the
   *  answer could not be had, which shows nothing to record either. */
  const [mayPractise, setMayPractise] = useState<boolean | 'unavailable' | null>(null);
  const recorder = useSolveRecorder();

  /** Generated ONCE per run, client-side. Held in state rather than derived
   *  per render so a re-render cannot hand the athlete a different scramble
   *  half-way through the reveal. */
  const [scramble, setScramble] = useState('');
  useEffect(() => {
    setScramble(generateScramble(eventId));
  }, [eventId]);

  /** Where the recording stands after the keypad. `uploading` is the window
   *  in which the clip exists only in this tab — which is what the hook's
   *  leave guards protect, so it is what `unfiledCount` reports. */
  const [filing, setFiling] = useState<'idle' | 'uploading' | 'filed' | 'failed'>('idle');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [fileError, setFileError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  /** The athlete's own result, kept for the closing screen. Nothing scores
   *  it; it is theirs to read. */
  const [result, setResult] = useState<{ timeCs: number | null; isDnf: boolean } | null>(null);
  /** Held across the upload so a retry does not need the keypad again. */
  const pendingRef = useRef<{
    blob: Blob;
    timeCs: number | null;
    isDnf: boolean;
    marks: Partial<Record<string, number>>;
  } | null>(null);

  /** How many recordings exist only in this tab: 0 or 1, because a practice
   *  run is one clip.
   *
   *  HELD IN STATE AND SYNCED BY AN EFFECT, not computed inline, because the
   *  honest answer depends on the hook's own `pendingBlob` — and the hook
   *  cannot be handed a value derived from its own return. The effect below
   *  closes that loop, which leaves the guard one render behind the blob
   *  appearing. That window is a single commit in the same tick, during
   *  which the athlete cannot navigate; every way OUT of this page (the bar,
   *  Back, a reload) is reachable only after it has closed. */
  const [unfiledCount, setUnfiledCount] = useState(0);

  const run = useSolveRun({
    recorder,
    scramble,
    unfiledCount,
    // A failed filing is the athlete's to retry. In a one-run flow the hook
    // uses this only to keep a broken upload from being followed by another
    // recording, which here means it keeps them on the retry.
    filingFailed: filing === 'failed',
  });

  useEffect(() => {
    // The clip exists nowhere else while it is in the keypad's hands
    // (`pendingBlob`), while it is uploading, and while it waits on a retry.
    // Once filed it is on the server and leaving costs nothing.
    const atRisk = run.pendingBlob !== null || filing === 'uploading' || filing === 'failed';
    setUnfiledCount(atRisk ? 1 : 0);
  }, [run.pendingBlob, filing]);

  useEffect(() => {
    if (!signedIn) {
      setMayPractise(null);
      return;
    }
    let cancelled = false;
    authedFetchWithRetry(PRACTICE_ROUTE)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { gate?: { allowed?: boolean } };
        // FAIL CLOSED: anything but an explicit allowed:true is a no.
        if (!cancelled) setMayPractise(body.gate?.allowed === true);
      })
      .catch((err) => {
        console.error('PracticeRunPage: checking verification failed:', err);
        if (!cancelled) setMayPractise('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // NOT VERIFIED: back to the practice page, which is where the explanation
  // and the route to the profile live — one place for that wording, not two.
  useEffect(() => {
    if (mayPractise === false) router.replace(PRACTICE_HREF);
  }, [mayPractise, router]);

  const eventLabel = useMemo(() => onlineCompEventLabel(eventId), [eventId]);
  const known = useMemo(() => ONLINE_COMP_EVENTS.some((e) => e.id === eventId), [eventId]);

  const file = useCallback(
    async (payload: {
      blob: Blob;
      timeCs: number | null;
      isDnf: boolean;
      marks: Partial<Record<string, number>>;
    }) => {
      setFiling('uploading');
      setFileError('');
      setUploadPercent(0);
      try {
        const res = await uploadAndFilePracticeRun(
          payload.blob,
          { event: eventId, scramble, timeCs: payload.timeCs, isDnf: payload.isDnf, marks: payload.marks },
          setUploadPercent,
        );
        setRemaining(res.remaining);
        pendingRef.current = null;
        setFiling('filed');
        run.setStage('sent');
      } catch (err) {
        console.error('PracticeRunPage: filing the run failed:', err);
        setFileError(err instanceof Error ? err.message : 'Бичлэгийг хадгалж чадсангүй');
        setFiling('failed');
      }
    },
    [eventId, scramble, run],
  );

  if (!known) {
    return (
      <Shell>
        <p className="oc-v3-status oc-v3-status-error">Ийм төрөл байхгүй.</p>
        <Link href={PRACTICE_HREF} className="oc-rp-submit" style={{ alignSelf: 'flex-start' }}>
          Буцах
        </Link>
      </Shell>
    );
  }

  if (authLoading) return <Shell><p className="oc-v3-status">Ачааллаж байна...</p></Shell>;

  if (!signedIn) {
    return (
      <Shell>
        <p className="oc-v3-status">Туршилтын бичлэг хийхийн тулд нэвтэрнэ үү.</p>
        <button type="button" className="oc-v3-signin" onClick={() => setAuthOpen(true)}>
          Нэвтрэх
        </button>
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </Shell>
    );
  }

  // Nothing that could start a camera renders until the server has said yes.
  if (mayPractise === 'unavailable') {
    return (
      <Shell>
        <p className="oc-v3-status oc-v3-status-error">Профайлын мэдээлэл шалгахад алдаа гарлаа, дахин оролдоно уу.</p>
        <Link href={PRACTICE_HREF} className="oc-rp-submit" style={{ alignSelf: 'flex-start' }}>
          Буцах
        </Link>
      </Shell>
    );
  }
  if (mayPractise !== true) return <Shell><p className="oc-v3-status">Ачааллаж байна...</p></Shell>;

  return (
    <div className="oc-solve-takeover">
      <PracticeHeader
        eventLabel={eventLabel}
        /* The two screens that are not inside the attempt, the same two the
           competition bar drops its attempt block on. */
        attempt={run.stage === 'lobby' || run.stage === 'sent' ? null : { index: 0, total: 1 }}
        /* The SAME confirm the competition run uses, from the same function
           in the hook's module — so leaving mid-recording says the same
           thing in both places. */
        onExit={() => {
          if (run.runAtRisk && !window.confirm(leaveConfirmMessage(1))) return;
          recorder.releaseCamera();
          router.push(PRACTICE_HREF);
        }}
      />

      <div className="oc-solve-body">
        <div className="oc-solve-stage">
          {/* THE SAVING LINE, in the same place and the same class as the
              competition's: a banner at the top of the stage column, not a
              bar pinned to the viewport. A fixed bar was the other layout
              difference — it sat over whichever stage was on screen instead
              of pushing it down, so the stage it covered was a different
              height from the competition's. */}
          {filing === 'uploading' && (
            <p className="oc-solve-banner oc-solve-banner-quiet">
              БИЧЛЭГ ХАДГАЛАГДАЖ БАЙНА · {uploadPercent}%
            </p>
          )}
          {filing === 'failed' && (
            <p className="oc-solve-banner oc-solve-banner-quiet oc-solve-banner-bad">
              {fileError}{' '}
              <button
                type="button"
                className="oc-practice-retry"
                onClick={() => {
                  const pending = pendingRef.current;
                  if (pending) void file(pending);
                }}
              >
                ДАХИН ОРОЛДОХ
              </button>
            </p>
          )}

        {run.stage === 'lobby' && (
          <LobbyStage
            /* Nothing filed and nothing before it: a practice run is one
               attempt, numbered 1, every time. */
            filedAttempts={0}
            nextAttempt={1}
            hasCamera={recorder.hasCamera}
            cameraError={recorder.error}
            videoRef={recorder.videoRef}
            onRequestCamera={recorder.requestCamera}
            note="Энэ бичлэг тэмцээнд тооцогдохгүй. Дарааллыг сурахад зориулсан."
            onStart={() => run.setStage('attemptIntro')}
          />
        )}

        {run.stage === 'recordingFailed' && run.recordingFailure !== null && (
          <RecordingFailedStage
            reason={run.recordingFailure}
            attemptNumber={1}
            cameraError={recorder.error}
            hasCamera={recorder.hasCamera}
            /* Nothing is lost by restarting: a practice run has no earlier
               attempts to protect. */
            recordedAttempts={0}
            videoRef={recorder.videoRef}
            onReconnectCamera={() => {
              recorder.releaseCamera();
              void recorder.requestCamera();
            }}
            onRestartAttempt={() => {
              run.setRecordingFailure(null);
              run.setPendingBlob(null);
              run.setStage('attemptIntro');
            }}
          />
        )}

        {run.stage === 'attemptIntro' && (
          <AttemptIntroStage onDone={() => run.setStage('zeroDisplay')} />
        )}

        {run.stage === 'zeroDisplay' && (
          <CameraHoldStage
            seconds={HOLD_SECONDS}
            label="ЦАГАА ХАРУУЛАХ ХЭСЭГ"
            instruction={() => 'Цагийг 0.00 болгож, хугацаа дуустал камерт харуулна уу.'}
            footnote={null}
            endLabel="ХОЛИЛТ ХАРАХ"
            videoRef={recorder.videoRef}
            onDone={() => {
              recorder.mark('scrambleShown');
              run.setStage('scrambleReveal');
            }}
          />
        )}

        {run.stage === 'scrambleReveal' && (
          <RevealStage
            scramble={scramble}
            videoRef={recorder.videoRef}
            onDone={() => {
              recorder.mark('coverStart');
              run.setStage('cover');
            }}
          />
        )}

        {run.stage === 'cover' && (
          <CoverStage seconds={COVER_SECONDS} videoRef={recorder.videoRef} onDone={() => run.setStage('readyPrompt')} />
        )}

        {run.stage === 'readyPrompt' && (
          <ReadyPromptStage
            onDone={() => {
              recorder.mark('solveStart');
              run.setStage('rec');
            }}
          />
        )}

        {run.stage === 'rec' && (
          <RecStage
            videoRef={recorder.videoRef}
            onFinish={() => {
              recorder.mark('solveEnd');
              run.setStage('finishHold');
            }}
          />
        )}

        {run.stage === 'finishHold' && (
          <CameraHoldStage
            seconds={HOLD_SECONDS}
            label="ЦАГАА ХАРУУЛ · ЭВЛҮҮЛЭЛТИЙН ДАРАА"
            instruction={() => 'Цагийг хугацаа дуустал камерт харуулна уу.'}
            footnote={null}
            endLabel="ШООГОО ХАРУУЛАХ"
            videoRef={recorder.videoRef}
            onDone={() => {
              recorder.mark('cubeShown');
              run.setStage('cubeCheck');
            }}
          />
        )}

        {run.stage === 'cubeCheck' && (
          <CameraHoldStage
            seconds={HOLD_SECONDS}
            label="ШООГОО ХАРУУЛ · ЭЦСИЙН БАЙДАЛ"
            instruction={() =>
              'Шоонд гар хүрэлгүйгээр, камераар дохио дуугартал шоог тойруулан бүх талыг харуулна уу.'
            }
            footnote={null}
            endLabel="ҮЗҮҮЛЭЛТ БИЧИХ"
            onElapsed={recorder.playBeep}
            videoRef={recorder.videoRef}
            /* THE RECORDING BOUNDARY, and it is the hook's: finishRecording
               stops the clip, checks it is not empty and hands the blob on.
               Nothing about it is re-implemented here. */
            onDone={run.finishRecording}
          />
        )}

        {/* The same gate the competition run has: no blob, no keypad. */}
        {run.stage === 'entry' && run.pendingBlob && (
          <EntryStage
            onConfirm={(entered) => {
              const blob = run.pendingBlob!;
              setResult(entered);
              // READ HERE, where the attempt is closed: the recording
              // stopped in the hook's finishRecording (which set the last
              // mark) and nothing else will be recorded. Taken as a value,
              // the same way the competition run takes it, so a retry files
              // the marks of the clip it is retrying.
              const marks = recorder.readMarks();
              pendingRef.current = { blob, ...entered, marks };
              run.setPendingBlob(null);
              void file({ blob, ...entered, marks });
            }}
          />
        )}

        {run.stage === 'sent' && (
          <div className="oc-practice-done">
            <p className="oc-practice-done-title">БИЧЛЭГ ХАДГАЛАГДЛАА</p>
            <p className="oc-practice-done-body">
              {result && !result.isDnf && result.timeCs !== null
                ? `Таны цаг: ${fmtCentiseconds(result.timeCs)}. `
                : result?.isDnf
                  ? 'DNF. '
                  : ''}
              Админ бичлэгийг шалгаж, холилтоо зөв хийсэн эсэхийг хэлнэ. Энэ цаг хаана ч тооцогдохгүй.
            </p>
            {remaining !== null && (
              <p className="oc-practice-done-left">{remaining} бичлэг үлдсэн</p>
            )}
            <Link href={PRACTICE_HREF} className="oc-rp-submit" style={{ alignSelf: 'flex-start' }}>
              Миний туршилтууд
            </Link>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="oc-v3-page">
      <main className="oc-v3-main">{children}</main>
    </div>
  );
}
