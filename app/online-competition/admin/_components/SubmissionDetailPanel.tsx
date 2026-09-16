'use client';

import { useMemo, useRef, useState } from 'react';
import type { OnlineSubmissionAdminView, SolveMarks } from '@/lib/online-competition/types';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { COVER_SECONDS } from '@/lib/online-competition/solve-stage-timing';
// THE JUMP TABLE MOVED, unchanged, to a shared module: a practice run has
// the same stages in the same order, so the offsets are the same offsets
// and two copies of them would be two things to keep in step.
import { JUMPS, at, type Jump, type PhaseKey } from '@/lib/online-competition/solve-jumps';
import type { SubmissionFlagCode } from '@/lib/online-competition/submission-checks';
import {
  cloudinaryStillFull,
  cloudinaryStillThumb,
} from '@/lib/online-competition/cloudinary';
import ScramblePreview from '@/components/shared/ScramblePreview';
import { resolveVideoSrc } from '@/lib/online-competition/video-source';

type ReviewAction = 'approve' | 'approve_plus2' | 'dnf';




/** The phase that lights the scramble block. Named rather than compared
 *  inline so the tie between the two is findable from either end — the
 *  cover segment is the one stretch of the clip where the scramble is
 *  what the judge is checking the cube against. */
const SCRAMBLE_FOCUS_KEY: PhaseKey = 'cover';

/** A FRAME, at the 30fps useSolveRecorder captures at. One constant, so
 *  the two step buttons and anything added later cannot drift apart by
 *  each carrying their own 0.033. */
const FRAME_STEP_S = 1 / 30;

/** The coarse step either side of the frame buttons. */
const SECOND_STEP_S = 1;



/** THE MONGOLIAN WORDING LIVES HERE, not in the API. The server returns
 *  codes, so changing how a check reads to a judge is a change to this
 *  screen and nothing else — and the same code can read differently in a
 *  list and in a panel without the API knowing either exists.
 *
 *  Each line says what was OBSERVED, never what it means about the
 *  athlete. "Бичсэн цаг эвлүүлэлтийн хугацаанаас урт" is a fact a judge
 *  can verify against the video in seconds; an accusation would be a
 *  conclusion this arithmetic has not earned. */
const FLAG_LABELS: Record<SubmissionFlagCode, string> = {
  IMPOSSIBLE: 'Бичсэн цаг эвлүүлэлтийн хугацаанаас урт',
  SUSPICIOUS_GAP: 'Эвлүүлэлтийн хугацаа хэт урт',
  MISSING_MARKS: 'Үе шатын цаг дутуу',
  DURATION_MISMATCH: 'Бичлэгийн урт таарахгүй',
};


/** Which phases have stills, and where they come from.
 *
 *  THE WHOLE POINT OF THIS TABLE is that it is the only thing that knows.
 *  Today the recorder grabs frames during the two closing holds and
 *  nowhere else, so four of the six phases are simply absent from this
 *  map and the frames panel renders its empty state for them. Adding
 *  stills for, say, the cover hold later is one line here plus the field
 *  on the submission — not a change to the panel, the grid, or the empty
 *  state, all of which already handle "this phase has none". */
const PHASE_STILLS: Partial<
  Record<PhaseKey, (s: OnlineSubmissionAdminView) => string[] | undefined>
> = {
  timer: (s) => s.timerShotIds,
  cube: (s) => s.cubeShotIds,
};

/** What each phase is for, shown under the frames-panel heading. Display
 *  copy only — nothing reads these but the heading. */
const PHASE_NOTES: Record<PhaseKey, string> = {
  start: 'БИЧЛЭГИЙН ЭХЛЭЛ · ТАЙМЕР 0.00 ХАРУУЛСАН ЭСЭХ',
  cover: 'ХОЛИЛТЫГ ХАЛХЛАХ · ШООНЫ БАЙРЛАЛ ШАЛГАНА',
  inspect: 'ИНСПЕКЦ ЭХЭЛСЭН МӨЧ · КОВЕР АВАГДСАН',
  finish: 'ЭВЛҮҮЛЭЛТИЙН ТӨГСГӨЛ · ШОО ЭВЛҮҮЛЭГДСЭН ЭСЭХ',
  timer: 'ТАЙМЕРЫН ГАРЦ · ИЛГЭЭСЭН ЦАГТАЙ ТААРАХ ЭСЭХ',
  cube: 'ЭВЛҮҮЛЭГДСЭН ШОО · БҮХ ТАЛААС ХАРУУЛСАН ЭСЭХ',
};

/** m:ss, the mockup's timeline format. Guards NaN, which is what
 *  `duration` reads as until the video's metadata has loaded. */
function fmtClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const r = Math.floor(seconds % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Inline attempt-review panel — three columns, matching the approved
 *  judging mockup (design-mockups/Khorom Judging.dc.html).
 *
 *  LEFT is the evidence: the clip, a timeline with a tick per recorded
 *  mark, and frame-accurate stepping. MIDDLE is navigation: who this is,
 *  the six phases of the run, and the frames captured for whichever phase
 *  is selected. RIGHT is the decision: the time claimed, the time that
 *  would be recorded, the three actions, and the scramble to check the
 *  cube against.
 *
 *  The split is the point. A judge previously scrolled between the video
 *  and the buttons that judge it; now the thing being decided and the
 *  decision are on screen together. */
export default function SubmissionDetailPanel({
  submission,
  athleteName,
  groupLabel,
  scramble,
  queueLeft,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onReview,
  onDelete,
}: {
  submission: OnlineSubmissionAdminView;
  athleteName: string;
  /** The athlete's assigned scramble group for this event+round ("A"),
   *  or null when this competition has no imported scrambles for the
   *  round or the athlete isn't in a group. */
  groupLabel: string | null;
  /** The scramble this athlete was shown for this attempt, or null when
   *  it cannot be established (no imported scrambles, no group, or a
   *  short scramble set). Also feeds the КОВЕР jump's fallback maths —
   *  see that entry in JUMPS. */
  scramble: string | null;
  /** How many attempts in the judge's CURRENT filter still have no
   *  decision. The header pill; nothing acts on it. */
  queueLeft: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onReview: (submissionId: string, action: ReviewAction) => Promise<void>;
  onDelete: (submissionId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** The submission whose video failed to load, if any. Keyed by id rather
   *  than a boolean so moving to the next attempt clears it without an
   *  effect. */
  const [videoFailedFor, setVideoFailedFor] = useState<string | null>(null);
  /** The still opened at full size, or null. A public id rather than a
   *  boolean + index, so the overlay cannot outlive the row it came from
   *  when the panel switches to another submission. */
  const [zoomed, setZoomed] = useState<string | null>(null);
  /** The selected phase card. Drives the frames panel, the highlighted
   *  timeline tick, the overlay label, and the scramble emphasis. */
  const [phase, setPhase] = useState<PhaseKey>('timer');
  /** The decision the judge has PICKED but not yet committed. Null until
   *  they pick one; see the confirm button. */
  const [pending, setPending] = useState<ReviewAction | null>(null);
  /** Video clock, mirrored into state so the timeline can draw. Both read
   *  from the element's own events — nothing here drives playback. */
  const [duration, setDuration] = useState(0);
  const [pos, setPos] = useState(0);

  const marks = submission.marks;
  // R2 key or legacy Cloudinary URL — decided in resolveVideoSrc and
  // nowhere else.
  const videoSrc = resolveVideoSrc(submission);

  // ── WHY THERE IS NO VIDEO, when there is none ──
  // A blank player used to be all a judge got, for three different causes
  // that call for three different responses — and "the athlete sent no
  // recording" is the one a judge could DNF on. So each is named:
  //   none-stored    — the record carries no video reference at all;
  //   not-configured — a video IS stored, but the site cannot build its
  //                    address (the public video base is not configured —
  //                    see video-source.ts);
  //   failed         — the player could not load it (network, 404, codec).
  const storedRef = submission as { videoKey?: unknown; videoUrl?: unknown };
  const hasStoredVideo =
    (typeof storedRef.videoKey === 'string' && storedRef.videoKey.trim() !== '') ||
    (typeof storedRef.videoUrl === 'string' && storedRef.videoUrl.trim() !== '');
  const videoProblem: 'none-stored' | 'not-configured' | 'failed' | null =
    videoSrc === null
      ? hasStoredVideo
        ? 'not-configured'
        : 'none-stored'
      : videoFailedFor === submission.id
        ? 'failed'
        : null;

  /** Where this button should land, in MILLISECONDS, or null when what it
   *  depends on was never recorded. */
  function targetMs(jump: Jump): number | null {
    return jump.resolve(marks, scramble);
  }

  // Nothing usable at all: no field (every submission from before marks
  // existed), or a map that came back empty. The API already collapses
  // both to undefined, so this is one condition rather than three.
  const noMarks = !marks || JUMPS.every((j) => !j.needsMarks || targetMs(j) === null);

  /** Seeks and plays. MILLISECONDS IN, seconds out — currentTime is in
   *  seconds and handing it a millisecond figure would seek ninety
   *  seconds into a clip that is ninety seconds long, i.e. silently to
   *  the end, which is why the conversion happens here and once. */
  function jumpTo(ms: number) {
    const el = videoRef.current;
    if (el === null) return;

    let seconds = ms / 1000;

    // CLAMP. A mark can legitimately sit past the end of the file: the
    // marks are measured from the recorder's own clock, and a truncated
    // upload (a dropped connection, a stream that died mid-attempt) makes
    // a shorter video than the run it recorded. Seeking past the end
    // leaves most browsers parked on the last frame with the controls in
    // a confusing state; landing just inside it plays the little there is.
    // `duration` is NaN until metadata loads, so it is only trusted once
    // it is a real positive number.
    const d = el.duration;
    if (Number.isFinite(d) && d > 0 && seconds > d - 0.1) {
      seconds = d - 0.1;
    }
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;

    el.currentTime = seconds;
    // A play() interrupted by the next seek rejects; that is ordinary use
    // of these buttons, not an error worth surfacing to a judge.
    void el.play().catch(() => {});
  }

  /** Steps the playhead without playing. PAUSES FIRST, deliberately: the
   *  frame buttons exist to hold still on one frame, and a running clock
   *  would move off it before the judge had looked. */
  function stepBy(deltaSeconds: number) {
    const el = videoRef.current;
    if (el === null) return;
    el.pause();
    const d = el.duration;
    const max = Number.isFinite(d) && d > 0 ? d - 0.01 : Number.MAX_SAFE_INTEGER;
    el.currentTime = Math.min(max, Math.max(0, el.currentTime + deltaSeconds));
  }

  /** Selects a phase and seeks to it. The seek target is JUMPS' own —
   *  recomputing it here would be a second opinion about where a phase
   *  starts. */
  function openPhase(jump: Jump) {
    setPhase(jump.key);
    const ms = targetMs(jump);
    if (ms !== null) jumpTo(ms);
  }

  async function act(action: ReviewAction) {
    setBusy(true);
    setError('');
    try {
      await onReview(submission.id, action);
      setPending(null);
      // Panel stays open and re-renders against the patched submission, so
      // the judge can see the decision land instead of the panel vanishing
      // under them. The grid cell recolours at the same time.
    } catch (err) {
      console.error('SubmissionDetailPanel: saving the judgement failed:', err);
      setError('Хадгалахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setBusy(false);
    }
  }

  const decided = submission.status !== 'pending';
  const isDnf = submission.isDnf === true || submission.penalty === 'DNF';

  const currentJump = JUMPS.find((j) => j.key === phase) ?? JUMPS[0];
  const currentTargetMs = targetMs(currentJump);
  const currentStills = PHASE_STILLS[phase]?.(submission) ?? [];

  /** One tick per mark that exists, positioned proportionally. Computed
   *  from the video's real duration, so it is empty until metadata has
   *  loaded rather than drawing ticks at guessed positions. */
  const ticks = useMemo(() => {
    if (!(duration > 0)) return [];
    return JUMPS.map((j) => {
      const ms = targetMs(j);
      if (ms === null) return null;
      const pct = Math.min(100, Math.max(0, (ms / 1000 / duration) * 100));
      return { key: j.key, label: j.label, ms, pct };
    }).filter((t): t is { key: PhaseKey; label: string; ms: number; pct: number } => t !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, marks, scramble]);

  /** THE TIME THAT WOULD BE RECORDED. Before a decision is picked this is
   *  the reported time unchanged — the athlete's claim stands until a
   *  judge moves it. A picked +2 adds its two seconds here so the judge
   *  sees the number they are about to publish, not the arithmetic. */
  const effective = pending ?? (decided ? (isDnf ? 'dnf' : submission.penalty === '+2' ? 'approve_plus2' : 'approve') : null);
  const finalLabel =
    effective === 'dnf'
      ? 'DNF'
      : effective === 'approve_plus2'
        ? `${fmtCentiseconds(submission.reportedTime + 200)} (+2)`
        : fmtCentiseconds(submission.reportedTime);
  const finalColor =
    effective === 'dnf' ? '#FF9C8C' : effective === 'approve_plus2' ? '#E0A020' : effective === 'approve' ? '#4FD07A' : '#9A958A';

  const chip = (text: string, color: string) => (
    <span
      key={text}
      style={{
        border: '1px solid #2A2A31',
        background: '#0D0D10',
        padding: '4px 8px',
        font: `600 8px/1 var(--oc-font-mono), monospace`,
        letterSpacing: '.12em',
        color,
      }}
    >
      {text}
    </span>
  );

  return (
    <div className="oc-rv-panel">
      {/* ── LEFT · the evidence ─────────────────────────────────────── */}
      <section
        className="oc-rv-media"
        style={{
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: '#0A0A0C',
          borderRight: '1px solid #1C1C21',
        }}
      >
        {/* ── THE SHAPE OF A JUDGING VIDEO ──
            NO FIXED RATIO HERE, AND THAT IS THE POINT. The box fills its
            column and `object-fit: contain` on the element inside fits
            the clip within it, whatever shape the clip is. Contain is the
            whole mechanism; a ratio on the box was never what prevented
            cropping, only what guessed at the common case.

            The guess was wrong often enough to matter. A ratio sized for
            a phone held upright turns every laptop-webcam recording into
            a thin strip between two black bars — correct, but most of the
            column spent on nothing.

            THIS EXACT BUG HAS SHIPPED TWICE, both times as a box shaped
            for the wrong clip. First the dashboard put a portrait clip in
            a 16:9 box (see the note in useSolveRecorder, which was
            rewritten around a canvas to chase a rotation bug that was
            really this); then the panel used 3:4 and quietly cropped the
            top and bottom of every recording. A judge cannot see what was
            cut — the frame just looks tight — so it fails silently every
            time.

            The recorder pins no ratio either: it pins a 640x480 BOUNDING
            BOX with `max`, which caps each dimension independently and
            leaves the shape to the camera. So nothing anywhere knows the
            ratio in advance, which is exactly why nothing should declare
            one. See tests/competition-fields/review-video-shape. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#08080A',
          }}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <video
            ref={videoRef}
            src={videoSrc ?? undefined}
            controls
            playsInline
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
            onSeeked={(e) => setPos(e.currentTarget.currentTime)}
            onError={() => setVideoFailedFor(submission.id)}
            style={{ width: '100%', height: '100%', background: '#000', objectFit: 'contain' }}
          />
          {videoProblem && (
            <div
              role="alert"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: 24,
                textAlign: 'center',
                background: '#08080AF2',
                zIndex: 2,
              }}
            >
              <p style={{ font: '600 10px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#E8543C' }}>
                {videoProblem === 'none-stored'
                  ? 'БИЧЛЭГ ХАВСАРГААГҮЙ'
                  : videoProblem === 'not-configured'
                    ? 'БИЧЛЭГ ХАРУУЛАХ БОЛОМЖГҮЙ'
                    : 'БИЧЛЭГ АЧААЛАГДСАНГҮЙ'}
              </p>
              <p style={{ maxWidth: 340, font: '400 12px/1.6 var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
                {videoProblem === 'none-stored'
                  ? 'Энэ илгээмжид бичлэгийн холбоос хадгалагдаагүй байна.'
                  : videoProblem === 'not-configured'
                    ? 'Бичлэг хадгалагдсан боловч сайтын бичлэгийн хаяг тохируулагдаагүй байна. Энэ нь бичлэг байхгүй гэсэн үг биш — техникийн админд хандана уу.'
                    : 'Бичлэгийг ачаалж чадсангүй — энэ нь бичлэг байхгүй гэсэн үг биш. Холболтоо шалгаад дахин ачаална уу.'}
              </p>
              {videoProblem === 'failed' && (
                <button
                  type="button"
                  onClick={() => {
                    setVideoFailedFor(null);
                    videoRef.current?.load();
                  }}
                  style={{
                    border: '1px solid #DFFF4F',
                    background: 'transparent',
                    color: '#DFFF4F',
                    padding: '9px 14px',
                    font: '600 9px var(--oc-font-mono), monospace',
                    letterSpacing: '.1em',
                    cursor: 'pointer',
                  }}
                >
                  ДАХИН АЧААЛАХ
                </button>
              )}
            </div>
          )}
          {/* Position and the selected phase, over the frame, as the
              mockup has them. pointerEvents none so they never take a
              click meant for the video's own controls. */}
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              alignItems: 'flex-start',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                background: '#08080AE6',
                border: '1px solid #2A2A31',
                padding: '4px 7px',
                font: '500 9px/1 var(--oc-font-mono), monospace',
                color: '#F4F1EA',
              }}
            >
              {fmtClock(pos)} / {fmtClock(duration)}
            </span>
            <span
              style={{
                background: '#08080AE6',
                border: '1px solid #2A2A31',
                padding: '4px 7px',
                font: '500 8px/1 var(--oc-font-mono), monospace',
                letterSpacing: '.1em',
                color: '#DFFF4F',
              }}
            >
              {currentJump.label}
            </span>
          </div>
          </div>
        </div>

        <div
          style={{
            flex: 'none',
            borderTop: '1px solid #1C1C21',
            padding: '9px 11px 11px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* ── The timeline ──
              One tick per mark that exists, at its proportional position.
              A missing mark simply has no tick: the bar is a map of what
              was recorded, so an absent phase leaves no gap to explain. */}
          <div style={{ position: 'relative', height: 20 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 4, background: '#16161B' }} />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 8,
                height: 4,
                width: duration > 0 ? `${Math.min(100, (pos / duration) * 100)}%` : 0,
                background: '#DFFF4F',
              }}
            />
            {ticks.map((t) => (
              <button
                key={t.key}
                type="button"
                title={`${t.label} · ${fmtClock(t.ms / 1000)}`}
                onClick={() => {
                  setPhase(t.key);
                  jumpTo(t.ms);
                }}
                style={{
                  position: 'absolute',
                  top: 3,
                  left: `${t.pct}%`,
                  width: 3,
                  height: 14,
                  padding: 0,
                  border: 'none',
                  background: t.key === phase ? '#DFFF4F' : '#6E6A62',
                  cursor: 'pointer',
                }}
              />
            ))}
            {duration > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 2,
                  left: `${Math.min(100, (pos / duration) * 100)}%`,
                  width: 2,
                  height: 16,
                  background: '#F4F1EA',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
            {[
              { label: '−1.0s', delta: -SECOND_STEP_S },
              { label: '−ФРЭЙМ', delta: -FRAME_STEP_S },
              { label: '+ФРЭЙМ', delta: FRAME_STEP_S },
              { label: '+1.0s', delta: SECOND_STEP_S },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                onClick={() => stepBy(b.delta)}
                style={{
                  border: '1px solid #2A2A31',
                  background: 'transparent',
                  color: '#9A958A',
                  padding: '6px 0',
                  cursor: 'pointer',
                  font: '600 8px/1 var(--oc-font-mono), monospace',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── MIDDLE · who, which phase, which frames ─────────────────── */}
      <main
        className="oc-rv-main"
        style={{
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
          padding: '12px 14px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: 'none',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'flex-end',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
              {chip(submission.event.toUpperCase(), '#DFFF4F')}
              {chip(`РАУНД ${submission.competitionRound}`, '#9A958A')}
              {groupLabel ? chip(`ГРУПП ${groupLabel}`, '#9A958A') : chip('ГРУПП ХУВААРИЛААГҮЙ', '#6E6A62')}
              {chip(`ОРОЛДЛОГО ${submission.attempt}`, '#9A958A')}
            </div>
            <span style={{ font: '600 17px/1.1 var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
              {athleteName}
            </span>
          </div>
          {/* Prev / next and the queue pill. They move the judge through
              the SAME list the grid is filtered to, without closing the
              panel — see ReviewGrid's queue memo. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                border: '1px solid #1C1C21',
                background: '#08080A',
                padding: '6px 9px',
              }}
            >
              <span style={{ width: 5, height: 5, background: '#E0A020' }} />
              <span
                style={{
                  font: '500 8px/1 var(--oc-font-mono), monospace',
                  letterSpacing: '.14em',
                  color: '#E0A020',
                  whiteSpace: 'nowrap',
                }}
              >
                {queueLeft} ХҮЛЭЭГДЭЖ
              </span>
            </div>
            {[
              { label: '← ӨМНӨХ', go: onPrev, off: !hasPrev },
              { label: 'ДАРААХ →', go: onNext, off: !hasNext },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                disabled={b.off}
                onClick={b.go}
                style={{
                  border: '1px solid #2A2A31',
                  background: 'transparent',
                  color: '#9A958A',
                  padding: '6px 10px',
                  cursor: b.off ? 'not-allowed' : 'pointer',
                  opacity: b.off ? 0.4 : 1,
                  font: '600 8px/1 var(--oc-font-mono), monospace',
                  letterSpacing: '.12em',
                  whiteSpace: 'nowrap',
                }}
              >
                {b.label}
              </button>
            ))}
            <button
              type="button"
              aria-label="Хаах"
              onClick={onClose}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#6E6A62',
                font: '500 14px var(--oc-font-mono), monospace',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Phase cards ──
            These replaced the jump-button row and target the SAME
            positions — every card calls JUMPS' own resolve through
            openPhase. A card with no mark behind it shows — and is
            inert, rather than seeking to a guessed spot. */}
        <div
          style={{
            flex: 'none',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
            gap: 6,
          }}
        >
          {JUMPS.map((jump) => {
            const ms = targetMs(jump);
            const on = jump.key === phase;
            const dead = ms === null;
            return (
              <button
                key={jump.key}
                type="button"
                disabled={dead}
                onClick={() => openPhase(jump)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  textAlign: 'left',
                  border: `1px solid ${on ? '#DFFF4F' : '#1C1C21'}`,
                  background: on ? '#14170A' : '#0A0A0C',
                  padding: '8px 9px',
                  cursor: dead ? 'not-allowed' : 'pointer',
                  opacity: dead ? 0.45 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span
                    style={{
                      font: '600 10px/1 var(--oc-font-heading), sans-serif',
                      letterSpacing: '.06em',
                      color: on ? '#DFFF4F' : '#F4F1EA',
                    }}
                  >
                    {jump.label}
                  </span>
                  <span style={{ width: 4, height: 4, background: on ? '#DFFF4F' : '#2A2A31' }} />
                </div>
                <span
                  style={{
                    font: '500 9px/1 var(--oc-font-mono), monospace',
                    color: on ? '#DFFF4F' : '#6E6A62',
                  }}
                >
                  {ms === null ? '—' : fmtClock(ms / 1000)}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Frames panel ──
            Always present, whatever the selected phase holds. Four of the
            six phases have no stills yet and say so rather than
            disappearing: a panel that came and went as the judge moved
            across the cards would read as a bug. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            border: '1px solid #1C1C21',
            background: '#0A0A0C',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              flex: 'none',
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 11px',
              borderBottom: '1px solid #1C1C21',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ font: '600 11px/1 var(--oc-font-heading), sans-serif', color: '#F4F1EA', letterSpacing: '.06em' }}>
                {currentJump.label} · КАДРУУД
              </span>
              <span style={{ font: '400 8px/1.4 var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                {noMarks ? 'ЭНЭ БИЧЛЭГТ ҮЕ ШАТЫН ЦАГ БҮРТГЭГДЭЭГҮЙ' : PHASE_NOTES[phase]}
              </span>
            </div>
            <button
              type="button"
              disabled={currentTargetMs === null}
              onClick={() => currentTargetMs !== null && jumpTo(currentTargetMs)}
              style={{
                flex: 'none',
                border: '1px solid #DFFF4F',
                background: '#14170A',
                color: '#DFFF4F',
                padding: '7px 10px',
                cursor: currentTargetMs === null ? 'not-allowed' : 'pointer',
                opacity: currentTargetMs === null ? 0.4 : 1,
                font: '600 8px/1 var(--oc-font-mono), monospace',
                letterSpacing: '.12em',
                whiteSpace: 'nowrap',
              }}
            >
              ҮЗЭХ · {currentTargetMs === null ? '—' : fmtClock(currentTargetMs / 1000)}
            </button>
          </div>

          {currentStills.length > 0 ? (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 8,
                padding: 10,
              }}
            >
              {currentStills.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setZoomed(id)}
                  title="Томруулах"
                  style={{
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 0,
                    border: '1px solid #1C1C21',
                    background: '#08080A',
                    cursor: 'zoom-in',
                    textAlign: 'left',
                    overflow: 'hidden',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cloudinaryStillThumb(id)}
                    alt=""
                    loading="lazy"
                    style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'contain', display: 'block' }}
                  />
                  <span
                    style={{
                      flex: 'none',
                      padding: '7px 8px',
                      font: '400 9px/1.4 var(--oc-font-heading), sans-serif',
                      color: '#9A958A',
                    }}
                  >
                    КАДР {i + 1}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 10,
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  font: '400 9px/1.6 var(--oc-font-mono), monospace',
                  letterSpacing: '.1em',
                  color: '#4A4740',
                }}
              >
                ЭНЭ ҮЕ ШАТАД КАДР АВААГҮЙ
                <br />
                БИЧЛЭГЭЭС ҮЗНЭ ҮҮ
              </span>
            </div>
          )}
        </div>
      </main>

      {/* ── RIGHT · the decision ────────────────────────────────────── */}
      <aside
        className="oc-rv-side"
        style={{
          minHeight: 0,
          background: '#0D0D10',
          borderLeft: '1px solid #1C1C21',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 12,
          overflow: 'auto',
        }}
      >
        <div
          style={{
            flex: 'none',
            border: '1px solid #1C1C21',
            background: '#08080A',
            padding: '11px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ font: '500 8px/1 var(--oc-font-mono), monospace', letterSpacing: '.16em', color: '#6E6A62' }}>
            ТАМИРЧНЫ ИЛГЭЭСЭН ЦАГ
          </span>
          <span
            style={{
              font: '700 32px/1.15 var(--oc-font-mono), monospace',
              color: '#DFFF4F',
              letterSpacing: '-.02em',
            }}
          >
            {fmtCentiseconds(submission.reportedTime)}
          </span>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              borderTop: '1px solid #16161B',
              paddingTop: 8,
            }}
          >
            <span style={{ font: '400 8px/1 var(--oc-font-mono), monospace', letterSpacing: '.1em', color: '#4A4740' }}>
              ШИЙДВЭРИЙН ДАРААХ
            </span>
            <span style={{ font: `700 10px/1 var(--oc-font-mono), monospace`, color: finalColor }}>
              {finalLabel}
            </span>
          </div>
        </div>

        {/* ── What the automatic checks noticed ──
            ADVISORY, and kept directly above the decision buttons: it is
            something to read before judging, not an option to pick.
            Nothing here disables, preselects or colours any of the three
            actions below. */}
        {submission.checks.flags.length > 0 && (
          <div style={{ flex: 'none', border: '1px solid #D8402C', background: '#1A0D0A', padding: 12 }}>
            <p style={{ font: '600 9px/1 var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#E8543C' }}>
              АВТОМАТ ШАЛГАЛТ
            </p>
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
              {submission.checks.flags.map((code) => (
                <li key={code} style={{ padding: '2px 0', font: '400 12px/1.4 var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
                  {FLAG_LABELS[code]}
                </li>
              ))}
            </ul>
            <p style={{ marginTop: 8, font: '400 10px/1.4 var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
              Зөвхөн анхааруулга. Шийдвэрийг шүүгч гаргана.
            </p>
          </div>
        )}

        {decided && (
          <p
            style={{
              flex: 'none',
              font: '500 10px/1 var(--oc-font-mono), monospace',
              letterSpacing: '.1em',
              color: isDnf ? '#D8402C' : '#4FD07A',
            }}
          >
            {isDnf ? 'ХҮЧИНГҮЙ БОЛГОСОН' : submission.penalty === '+2' ? 'БАТАЛСАН · +2' : 'БАТАЛСАН'}
          </p>
        )}
        {error && (
          <p style={{ flex: 'none', font: '400 11px/1.4 var(--oc-font-heading), sans-serif', color: '#E8543C' }}>
            {error}
          </p>
        )}
        {/* The decisions stay available — deciding whether an attempt with
            no watchable video can stand is the judge's call, and disabling
            them would change judging. What changes is that the judge is
            told WHY there is nothing to watch, beside the buttons. */}
        {videoProblem && (
          <p
            role="note"
            style={{
              flex: 'none',
              border: '1px solid #3A3018',
              background: '#14100A',
              padding: '8px 10px',
              font: '400 11px/1.5 var(--oc-font-heading), sans-serif',
              color: '#E0A020',
            }}
          >
            {videoProblem === 'none-stored'
              ? 'Бичлэг хавсаргаагүй илгээмж. Шийдвэр гаргахаасаа өмнө нягтална уу.'
              : 'Бичлэг харагдахгүй байгаа нь тамирчин бичлэг илгээгээгүй гэсэн үг биш. Бичлэг ачаалагдахаас өмнө DNF өгөхгүй байхыг анхаарна уу.'}
          </p>
        )}

        {/* ── The three decisions ──
            PICK, THEN CONFIRM, as the mockup has it. Picking is what
            drives the "after the decision" line above, so the judge sees
            the number they are about to publish before they publish it.
            The three actions themselves are unchanged — each still calls
            the same review action it always did. */}
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPending((p) => (p === 'approve' ? null : 'approve'))}
            style={{
              width: '100%',
              border: `1px solid ${pending === 'approve' ? '#4FD07A' : '#2C4A34'}`,
              background: pending === 'approve' ? '#13291A' : '#0F1A12',
              color: '#4FD07A',
              padding: 12,
              cursor: busy ? 'not-allowed' : 'pointer',
              font: '700 11px/1 var(--oc-font-heading), sans-serif',
              letterSpacing: '.09em',
              textTransform: 'uppercase',
            }}
          >
            Зөвшөөрөх · Цаг зөв
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending((p) => (p === 'approve_plus2' ? null : 'approve_plus2'))}
              style={{
                border: `1px solid ${pending === 'approve_plus2' ? '#E0A020' : '#3A2E10'}`,
                background: pending === 'approve_plus2' ? '#241A06' : '#1A1408',
                color: '#E0A020',
                padding: '11px 0',
                cursor: busy ? 'not-allowed' : 'pointer',
                font: '700 11px/1 var(--oc-font-mono), monospace',
                letterSpacing: '.08em',
              }}
            >
              +2
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending((p) => (p === 'dnf' ? null : 'dnf'))}
              style={{
                border: `1px solid ${pending === 'dnf' ? '#D8402C' : '#3A1410'}`,
                background: pending === 'dnf' ? '#25100C' : '#1A0D0A',
                color: '#FF9C8C',
                padding: '11px 0',
                cursor: busy ? 'not-allowed' : 'pointer',
                font: '700 11px/1 var(--oc-font-mono), monospace',
                letterSpacing: '.08em',
              }}
            >
              DNF
            </button>
          </div>
        </div>

        {pending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(pending)}
            style={{
              flex: 'none',
              width: '100%',
              border: 'none',
              background: busy ? '#16161B' : pending === 'dnf' ? '#E8543C' : pending === 'approve_plus2' ? '#E0A020' : '#4FD07A',
              color: busy ? '#4A4740' : '#08080A',
              padding: 13,
              cursor: busy ? 'not-allowed' : 'pointer',
              font: '700 11px/1 var(--oc-font-heading), sans-serif',
              letterSpacing: '.09em',
              textTransform: 'uppercase',
            }}
          >
            {busy ? 'Хадгалж байна...' : 'Шийдвэр батлах'}
          </button>
        )}

        {/* Deleting a submission (video, stills and doc) — carried over
            unchanged, still behind the same explicit two-step confirm. */}
        <div style={{ flex: 'none', marginTop: 'auto', paddingTop: 14, borderTop: '1px solid #1C1C21' }}>
          {confirmingDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ font: '400 11px/1.4 var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
                Устгах уу? Бичлэг эргэж сэргэхгүй.
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await onDelete(submission.id);
                  } catch (err) {
                    console.error('SubmissionDetailPanel: deleting the submission failed:', err);
                    setError('Устгаж чадсангүй');
                    setBusy(false);
                  }
                }}
                style={{
                  border: '1px solid #D8402C',
                  background: '#1A0D0A',
                  color: '#E8543C',
                  padding: '7px 10px',
                  font: '600 9px/1 var(--oc-font-mono), monospace',
                  letterSpacing: '.1em',
                  cursor: 'pointer',
                }}
              >
                ТИЙМ
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
                style={{
                  border: '1px solid #2A2A31',
                  background: 'transparent',
                  color: '#9A958A',
                  padding: '7px 10px',
                  font: '600 9px/1 var(--oc-font-mono), monospace',
                  letterSpacing: '.1em',
                  cursor: 'pointer',
                }}
              >
                ҮГҮЙ
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#6E6A62',
                font: '500 9px/1 var(--oc-font-mono), monospace',
                letterSpacing: '.1em',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ИЛГЭЭМЖ УСТГАХ
            </button>
          )}
        </div>
      </aside>

      {/* The scramble is its own grid cell rather than part of the
          aside above, and that is a layout decision with one reason:
          collapsed to a single column it has to come LAST, after the
          frames panel, while the decision buttons have to come second.
          Inside the aside it could only be one or the other. On a wide
          screen it sits directly under the aside in the same column
          with the same background, so the seam is invisible. */}
      <div className="oc-rv-scr">
      {/* ── The scramble ──
          Emphasised while the cover phase is selected, which is the one
          stretch of the clip where the cube is checked against it. It
          never hides — only the border and label change. */}
      {scramble && (
        <div
          style={{
            flex: 'none',
            border: `1px solid ${phase === SCRAMBLE_FOCUS_KEY ? '#DFFF4F' : '#1C1C21'}`,
            background: '#08080A',
            display: 'flex',
            flexDirection: 'column',
            transition: 'border-color .15s',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '9px 11px',
              borderBottom: '1px solid #16161B',
            }}
          >
            <span
              style={{
                font: '500 8px/1 var(--oc-font-mono), monospace',
                letterSpacing: '.16em',
                color: phase === SCRAMBLE_FOCUS_KEY ? '#DFFF4F' : '#6E6A62',
              }}
            >
              ХОЛИЛТ{groupLabel ? ` · ГРУПП ${groupLabel}` : ''}
            </span>
            <span style={{ font: '400 8px/1 var(--oc-font-mono), monospace', letterSpacing: '.1em', color: '#4A4740' }}>
              R{submission.competitionRound} · #{submission.attempt}
            </span>
          </div>
          <div style={{ padding: '10px 11px 11px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span
              style={{
                font: '500 10px/1.8 var(--oc-font-mono), monospace',
                letterSpacing: '.04em',
                color: '#F4F1EA',
                wordSpacing: '.3em',
                wordBreak: 'break-word',
              }}
            >
              {scramble}
            </span>
            {/* Definite width AND height: ScramblePreview sizes its
                player to 100% of the container, so an auto-height box
                gives it nothing to resolve against. 4:3 matches the
                unfolded net's own bounding box. */}
            <div style={{ display: 'flex', width: '100%', height: 150, alignSelf: 'center' }}>
              <ScramblePreview eventId={submission.event} scramble={scramble} visualization="2D" />
            </div>
          </div>
        </div>
      )}
      </div>


      {/* Full resolution, because reading the timer digits is the entire
          point of having these. Deliberately plain — click anywhere to
          close, no zoom, no next/previous. */}
      {zoomed && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Хаах"
          onClick={() => setZoomed(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') setZoomed(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(4,4,6,0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            cursor: 'zoom-out',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cloudinaryStillFull(zoomed)}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );
}
