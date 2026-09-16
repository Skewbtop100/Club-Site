'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveVideoSrc } from '@/lib/online-competition/video-source';
import ScramblePreview from '@/components/shared/ScramblePreview';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import {
  PRACTICE_REFUSAL_REASONS,
  practiceReviewValid,
  type PracticeDecision,
} from '@/lib/online-competition/practice';
import { JUMPS, type Jump, type PhaseKey } from '@/lib/online-competition/solve-jumps';
import type { AdminPracticeRow } from '@/app/api/online-competition/admin-practice/route';

// ── The practice review panel ───────────────────────────────────────────
// THE COMPETITION DETAIL PANEL'S ARRANGEMENT, not its content: the evidence
// on the left with the decision it feeds directly under it, everything that
// describes the run on the right, and the same 1100px break where the two
// columns become one.
//
// WHAT REUSES, LITERALLY:
//   · JUMPS and its resolve arithmetic — lib/online-competition/solve-jumps,
//     the one table both screens read. A practice run goes through the same
//     stages recorded by the same hook, so the offsets ARE the same offsets.
//   · ScramblePreview at visualization="2D", the same component at the same
//     150px height.
//   · resolveVideoSrc, fmtCentiseconds, practiceReviewValid.
//
// WHAT CANNOT, AND WHY:
//   · THE DECISIONS. Зөв / Буруу-with-a-reason / Дахин илгээх, and no time
//     entry, no +2, no DNF: the question here is whether the sequence was
//     followed, and approve/+2/DNF has no answer to it. The competition
//     panel's decision column is built around a time it might change.
//   · THE THREE-COLUMN GRID. That panel's middle column is a frames panel
//     (stills per phase) and a queue navigator over a round's submissions.
//     Practice has no stills and no round, so a third column would be an
//     empty one.
//   · jumpTo's clamp and fmtClock. Both are file-local helpers inside
//     SubmissionDetailPanel, and hoisting them would mean editing it a
//     second time — only the JUMPS extraction was authorised. They are
//     copied here, marked, and named in the report as the next extraction.

/** m:ss. A copy of SubmissionDetailPanel's own, not a variation: guards the
 *  NaN that `duration` reads as before metadata loads. */
function fmtClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const r = Math.floor(seconds % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const DECISIONS: { key: PracticeDecision; label: string; tone: string }[] = [
  { key: 'correct', label: 'ЗӨВ', tone: '#4FD07A' },
  { key: 'incorrect', label: 'БУРУУ', tone: '#E8543C' },
  { key: 'redo', label: 'ДАХИН ИЛГЭЭХ', tone: '#E0A020' },
];

export const PRACTICE_STATUS_LABEL: Record<string, string> = {
  pending: 'ХЯНАГДААГҮЙ',
  correct: 'ЗӨВ',
  incorrect: 'БУРУУ',
  redo: 'ДАХИН ИЛГЭЭХ',
};

export const PRACTICE_STATUS_TONE: Record<string, string> = {
  pending: '#E0A020',
  correct: '#4FD07A',
  incorrect: '#E8543C',
  redo: '#E0A020',
};

function fmtWhen(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PracticeRunPanel({
  run,
  reason,
  onReason,
  busy,
  error,
  reasonMax,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onDecide,
}: {
  run: AdminPracticeRow;
  /** The draft refusal reason, held by the screen so it survives moving
   *  between runs — the same way the competition panel's pending decision
   *  lives above itself. */
  reason: string;
  onReason: (text: string) => void;
  busy: boolean;
  error: string | null;
  reasonMax: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDecide: (decision: PracticeDecision) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<PhaseKey>('inspect');
  const src = resolveVideoSrc({ videoKey: run.videoKey });

  // A new run means a new file: the selected phase resets rather than
  // leaving the previous run's highlighted.
  useEffect(() => {
    setPhase('inspect');
  }, [run.id]);

  /** Where a button lands, in MILLISECONDS, or null when the mark it needs
   *  was never recorded. JUMPS' own arithmetic — a second opinion about
   *  where a phase starts is exactly what the shared table exists to
   *  prevent. */
  const targetMs = useMemo(
    () => (jump: Jump) => jump.resolve(run.marks, run.scramble || null),
    [run.marks, run.scramble],
  );

  /** Nothing to aim at anywhere. EVERY RUN FILED BEFORE MARKS WERE STORED
   *  reads this way — readPracticeMarks turns a missing field into {} — so
   *  it is said out loud rather than left as five dead buttons. */
  const noMarks = JUMPS.every((j) => !j.needsMarks || targetMs(j) === null);

  /** MILLISECONDS IN, SECONDS OUT. Copied from SubmissionDetailPanel with
   *  its clamp intact: a mark can legitimately sit past the end of the file
   *  (the marks come from the recorder's clock, and a truncated upload is
   *  shorter than the run it recorded), and seeking past the end parks most
   *  browsers on the last frame with the controls in a confusing state. */
  function jumpTo(ms: number) {
    const el = videoRef.current;
    if (el === null) return;
    let seconds = ms / 1000;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0 && seconds > d - 0.1) seconds = d - 0.1;
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    el.currentTime = seconds;
    // A play() interrupted by the next seek rejects; that is ordinary use of
    // these buttons, not an error worth surfacing.
    void el.play().catch(() => {});
  }

  function openPhase(jump: Jump) {
    setPhase(jump.key);
    const ms = targetMs(jump);
    if (ms !== null) jumpTo(ms);
  }

  const timeLabel = run.isDnf
    ? 'DNF'
    : run.timeCs !== null
      ? fmtCentiseconds(run.timeCs)
      : 'цаг бичээгүй';

  return (
    <div className="oc-prv-panel">
      {/* ── LEFT · the evidence, and the decision it feeds ─────────── */}
      <div className="oc-prv-media">
        <div className="oc-prv-videobox">
          {src === null ? (
            <p className="oc-sc-msg-err" style={{ padding: 14 }}>
              Бичлэг байхгүй (устсан эсвэл тохируулаагүй).
            </p>
          ) : (
            <video
              ref={videoRef}
              className="oc-prv-video"
              src={src}
              controls
              playsInline
              preload="metadata"
            />
          )}
        </div>

        <div className="oc-prv-decide">
          <span className="oc-adm-sublabel">ТАТГАЛЗАХ ШАЛТГААН</span>
          <div className="oc-prv-chips">
            {PRACTICE_REFUSAL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`oc-prv-chip${reason === r ? ' oc-prv-chip-on' : ''}`}
                onClick={() => onReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            className="oc-v3-input"
            rows={2}
            maxLength={reasonMax}
            value={reason}
            placeholder="Эсвэл өөрөө бичнэ үү"
            onChange={(e) => onReason(e.target.value)}
          />

          <div className="oc-prv-actions">
            {DECISIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                className="oc-prv-verdict"
                style={{ borderColor: d.tone, color: d.tone }}
                // THE SAME CHECK THE ROUTE MAKES, from the same function, so
                // the button is disabled for exactly the reasons the server
                // would refuse.
                disabled={busy || !practiceReviewValid(d.key, reason)}
                title={practiceReviewValid(d.key, reason) ? undefined : 'Татгалзахын тулд шалтгаан бичнэ үү'}
                onClick={() => onDecide(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="oc-prv-note">
            ДАХИН ИЛГЭЭХ нь тамирчны 10 бичлэгт тооцогдохгүй — өөр бичлэг хийх боломж нэмэгдэнэ.
          </p>
          {error && <p className="oc-sc-msg-err">{error}</p>}
        </div>
      </div>

      {/* ── RIGHT · who, when, where to look, and the scramble ─────── */}
      <div className="oc-prv-side">
        <div className="oc-prv-head">
          <div style={{ minWidth: 0 }}>
            <p className="oc-prv-name">{run.displayName}</p>
            <p className="oc-prv-meta">
              {run.event.toUpperCase()} · {timeLabel} · {fmtWhen(run.createdAtMs)}
            </p>
          </div>
          <span style={{ flex: 1 }} />
          {/* Move WITHIN the panel, as the judging panel does, so the admin
              keeps their place instead of being returned to the grid between
              every run. */}
          <button type="button" className="oc-prv-nav" disabled={!hasPrev} onClick={onPrev} aria-label="Өмнөх">
            ‹
          </button>
          <button type="button" className="oc-prv-nav" disabled={!hasNext} onClick={onNext} aria-label="Дараах">
            ›
          </button>
          <button type="button" className="oc-prv-nav" onClick={onClose} aria-label="Хаах">
            ✕
          </button>
        </div>

        <p className="oc-prv-status" style={{ color: PRACTICE_STATUS_TONE[run.status] ?? '#9A958A' }}>
          {PRACTICE_STATUS_LABEL[run.status] ?? run.status.toUpperCase()}
          {run.status === 'incorrect' && run.reason && (
            <span className="oc-prv-oldreason"> · {run.reason}</span>
          )}
        </p>

        {/* ── THE JUMP BUTTONS ──
            The same six targets as the judging panel, from the same table:
            every one of them calls JUMPS' own resolve. A button whose mark
            was never recorded shows and is inert rather than seeking to a
            guessed spot. */}
        <div className="oc-prv-jumps">
          {JUMPS.map((jump) => {
            const ms = targetMs(jump);
            const dead = ms === null;
            const on = jump.key === phase;
            return (
              <button
                key={jump.key}
                type="button"
                className={`oc-prv-jump${on ? ' oc-prv-jump-on' : ''}`}
                disabled={dead || src === null}
                onClick={() => openPhase(jump)}
              >
                <span className="oc-prv-jump-label">{jump.label}</span>
                <span className="oc-prv-jump-at">{ms === null ? '—' : fmtClock(ms / 1000)}</span>
              </button>
            );
          })}
        </div>
        {noMarks && (
          <p className="oc-prv-nomarks">
            ЭНЭ БИЧЛЭГТ ҮЕ ШАТЫН ЦАГ БҮРТГЭГДЭЭГҮЙ — бичлэгийг гараар шалгана уу.
          </p>
        )}

        {/* THE SCRAMBLE THE ATHLETE WAS SHOWN, as notation AND as the state
            it should produce. Without it the review question is
            unanswerable; without the diagram it is answerable but slow. */}
        <div className="oc-prv-scr">
          <span className="oc-adm-sublabel">ХОЛИЛТ</span>
          <code>{run.scramble || '—'}</code>
          {/* Definite width AND height: ScramblePreview sizes its player to
              100% of the container, so an auto-height box gives it nothing to
              resolve against. 150px is the judging panel's own. */}
          {run.scramble && (
            <div className="oc-prv-diagram">
              <ScramblePreview eventId={run.event} scramble={run.scramble} visualization="2D" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
