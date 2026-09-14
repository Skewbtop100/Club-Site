'use client';

import { useRef, useState } from 'react';
import type { OnlineSubmissionAdminView, SolveMarks } from '@/lib/online-competition/types';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { coverMidpointMs } from '@/lib/online-competition/solve-stage-timing';

type ReviewAction = 'approve' | 'approve_plus2' | 'dnf';

/** How far before `solveEnd` ТӨГСГӨЛ lands — far enough back to see the
 *  last few moves land rather than the cube already finished and still. */
const BEFORE_END_MS = 5000;

/** How far into a hold the two hold buttons land. A mark names the
 *  instant a button was PRESSED, which is the instant a stage BEGAN, and
 *  at +0 the athlete is still moving their hands: the timer (or the cube)
 *  is not yet up and steady. Three seconds into an eight-second hold is
 *  the settled middle of it. */
const INTO_HOLD_MS = 3000;

// ── Jumping to the moments a judge actually watches ────────────────────
// The clip runs about ninety seconds and four of them matter: the
// scramble going on, the solve starting, the timer being shown, the cube
// being shown. Finding those by dragging a scrubber is the slowest part
// of judging a round, and the submission already knows where they are —
// `marks` stores each stage press as a millisecond offset into the video
// (SolveMarks in types.ts).
//
// THE +3s ON THREE OF THEM IS NOT PADDING FOR ITS OWN SAKE. A mark names
// the instant a button was PRESSED, which is the instant a stage BEGAN —
// and for the three holds, what a judge needs to see is the thing being
// held up, which is not yet in frame at that instant. The athlete is
// still moving their hands at +0. Three seconds into an eight-second hold
// is the middle of it: the timer (or the cube) is up, steady, and being
// shown deliberately. `solveStart` takes no offset because it is the
// opposite kind of moment — not a hold to settle into but an act to
// catch, and the interesting frame is the one where the cover comes off.
/** One mark, or null when it was never recorded. Null is what disables a
 *  button — the guard that keeps a missing mark from becoming a NaN seek. */
function at(marks: Partial<SolveMarks> | undefined, key: keyof SolveMarks): number | null {
  const ms = marks?.[key];
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

const JUMPS: {
  label: string;
  /** False only for ЭХЛЭЛ, which is correct whatever was recorded. Used
   *  to tell "this submission has no marks" from "this one button has
   *  nothing to aim at". */
  needsMarks: boolean;
  resolve: (marks: Partial<SolveMarks> | undefined, scramble: string | null) => number | null;
}[] = [
  { label: 'ЭХЛЭЛ', needsMarks: false, resolve: () => 0 },

  // THE MIDDLE OF THE COVER STAGE, where the athlete is holding the
  // scrambled cube steady in the orientation a judge verifies.
  //
  // It is reached by adding the reveal's length to `scrambleShown`, and
  // THE REVEAL'S LENGTH IS NOT A CONSTANT: it plays the scramble one
  // chunk at a time, so it runs ten seconds for a 2x2, twenty for a 3x3
  // and forty-five for a 4x4. Hence the scramble itself as an input —
  // without it, this button would be right for 3x3 and land mid-scramble
  // on a 4x4 and past the cover entirely on a 2x2. See coverMidpointMs.
  {
    label: 'КОВЕР',
    needsMarks: true,
    resolve: (marks, scramble) => {
      const shown = at(marks, 'scrambleShown');
      if (shown === null || scramble === null) return null;
      return coverMidpointMs(shown, scramble);
    },
  },

  // No offset: not a hold to settle into but an act to catch, and the
  // frame that matters is the one where the cover comes off.
  { label: 'ЭВЛҮҮЛЭХ', needsMarks: true, resolve: (m) => at(m, 'solveStart') },

  // JUST BEFORE THE SOLVE ENDS — the cube being completed, which is the
  // thing a judge is actually checking.
  //
  // Backwards from a mark, so it is the one target that can land before
  // the stage it belongs to. A solve faster than BEFORE_END_MS would seek
  // back past its own start, into the cover stage, and show a scrambled
  // cube at the moment labelled "the finish". Clamped to solveStart.
  {
    label: 'ТӨГСГӨЛ',
    needsMarks: true,
    resolve: (m) => {
      const end = at(m, 'solveEnd');
      if (end === null) return null;
      const start = at(m, 'solveStart');
      const target = end - BEFORE_END_MS;
      return start !== null && target < start ? start : target;
    },
  },

  { label: 'ЦАГ', needsMarks: true, resolve: (m) => {
    const end = at(m, 'solveEnd');
    return end === null ? null : end + INTO_HOLD_MS;
  } },
  { label: 'ШОО', needsMarks: true, resolve: (m) => {
    const shown = at(m, 'cubeShown');
    return shown === null ? null : shown + INTO_HOLD_MS;
  } },
];

/** Inline attempt-review panel — the video treatment and the three
 *  decision actions are the same ones the old card-list ReviewDashboard
 *  used (aspect-[3/4] + object-contain, and the same POST to
 *  /api/online-competition/review); this is where that logic now lives so
 *  the grid doesn't duplicate it. Renders below the grid and pushes
 *  content down rather than overlaying it. */
export default function SubmissionDetailPanel({
  submission,
  athleteName,
  groupLabel,
  scramble,
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
   *  short scramble set). Used ONLY to work out how long the reveal ran,
   *  which is what says where the cover stage starts — see the КОВЕР
   *  entry in JUMPS. Nothing displays it. */
  scramble: string | null;
  onClose: () => void;
  onReview: (submissionId: string, action: ReviewAction) => Promise<void>;
  onDelete: (submissionId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const marks = submission.marks;

  /** Where this button should land, in MILLISECONDS, or null when what it
   *  depends on was never recorded. */
  function targetMs(jump: (typeof JUMPS)[number]): number | null {
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
    const duration = el.duration;
    if (Number.isFinite(duration) && duration > 0 && seconds > duration - 0.1) {
      seconds = duration - 0.1;
    }
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;

    el.currentTime = seconds;
    // A play() interrupted by the next seek rejects; that is ordinary use
    // of these buttons, not an error worth surfacing to a judge.
    void el.play().catch(() => {});
  }

  async function act(action: ReviewAction) {
    setBusy(true);
    setError('');
    try {
      await onReview(submission.id, action);
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

  return (
    <div className="oc-rv-panel">
      <div style={{ padding: 16 }}>
        <div className="aspect-[3/4] w-full overflow-hidden" style={{ border: '1px solid #2A2A31' }}>
          <video
            ref={videoRef}
            src={submission.videoUrl}
            controls
            playsInline
            className="h-full w-full bg-black object-contain"
          />
        </div>

        {/* ── The jump row ──
            NAVIGATION, NOT A DECISION, and it is styled to say so. The
            three buttons below the fold commit a verdict and wear the
            palette that goes with it — green, amber, red, one per
            outcome. These move the playhead and nothing else, so they
            take the muted border and text this file already uses for its
            non-committal actions (the ҮГҮЙ cancel), at the same height
            and gap as the decision row. A judge should never have to
            look twice to tell which row changes a result.

            Read-only in the strictest sense: nothing here writes, and
            nothing here can reach the review actions. */}
        {noMarks && (
          <p
            style={{
              marginTop: 12,
              font: '400 10px var(--oc-font-mono), monospace',
              letterSpacing: '.06em',
              color: '#6E6A62',
            }}
          >
            Энэ бичлэгт үе шатын цаг бүртгэгдээгүй
          </p>
        )}
        {/* flexWrap, so six labels become two rows on a narrow screen
            rather than a horizontal scrollbar under the video. Each
            button may grow but starts from its content width, which keeps
            the wrap points at sensible places instead of stretching one
            orphan across a whole row. */}
        <div style={{ marginTop: noMarks ? 8 : 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {JUMPS.map((jump) => {
            const ms = targetMs(jump);
            // Two ways to be dead, and they are deliberately different
            // questions: this submission has no marks at all (the whole
            // row goes, including ЭХЛЭЛ, because the row as a whole has
            // nothing to offer), or this ONE mark is missing while its
            // neighbours are fine.
            const disabled = noMarks || ms === null;
            return (
              <button
                key={jump.label}
                type="button"
                disabled={disabled}
                onClick={() => ms !== null && jumpTo(ms)}
                style={{
                  flex: '1 1 auto',
                  border: '1px solid #2A2A31',
                  background: 'transparent',
                  color: '#9A958A',
                  padding: 12,
                  font: '600 11px var(--oc-font-mono), monospace',
                  letterSpacing: '.08em',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                {jump.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="oc-rv-panel-info">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            {/* THE ROUND, and then the attempt — two different numbers.
                This line used to print the field the admin view now calls
                `attempt`, which is the ATTEMPT INDEX, under the label
                РАУНД: the header showed the same number twice under two
                names, so attempt 2 of a single-round competition read
                "РАУНД 2". The field was renamed at the boundary so that
                mistake no longer compiles. */}
            <p style={{ font: '500 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
              {submission.event.toUpperCase()} · РАУНД {submission.competitionRound}
            </p>
            <h2 style={{ marginTop: 6, font: '600 18px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
              {athleteName} · Оролдлого {submission.attempt}
            </h2>
          </div>
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

        {/* Real assignment data from onlineCompetitions/{id}/
            groupAssignments (see admin/scrambles). Falls back to the
            original "not assigned" note — unchanged — for competitions
            with no imported scrambles and for athletes not in a group,
            rather than implying an assignment that doesn't exist. */}
        <div className="oc-rv-note" style={{ marginTop: 16 }}>
          <p
            style={{
              font: '500 9px var(--oc-font-mono), monospace',
              letterSpacing: '.12em',
              color: groupLabel ? '#DFFF4F' : '#9A958A',
            }}
          >
            {groupLabel ? `ХОЛИЛТ · ГРУПП ${groupLabel}` : 'ХОЛИЛТ · ГРУПП ХУВААРИЛААГҮЙ'}
          </p>
          {!groupLabel && (
            <p style={{ marginTop: 6, font: '400 9px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
              ТАМИРЧИН ГРУППЭД ХУВААРИЛАГДААГҮЙ · ХОЛИЛТ ХЭСГЭЭС ХУВААРИЛНА
            </p>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          <span className="oc-v3-stat-label">Бичсэн цаг</span>
          <p
            style={{
              marginTop: 8,
              font: '700 32px var(--oc-font-mono), monospace',
              fontVariantNumeric: 'tabular-nums',
              color: '#DFFF4F',
            }}
          >
            {isDnf ? 'DNF' : fmtCentiseconds(submission.reportedTime)}
            {submission.penalty === '+2' && (
              <span style={{ font: '500 16px var(--oc-font-mono), monospace', color: '#E0A020' }}> +2</span>
            )}
          </p>
          {/* The raw keypad digit sequence the athlete typed is not stored
              anywhere on the submission (see OnlineSubmission in types.ts —
              only the parsed `reportedTime` centiseconds survive), so
              there is nothing to prefill an override field with. Shown
              read-only instead of an editable raw-digit input. */}
          <p style={{ marginTop: 6, font: '400 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
            ТАМИРЧНЫ БИЧСЭН · {submission.reportedTime} сентисекунд
          </p>
        </div>

        {decided && (
          <p style={{ marginTop: 14, font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.1em', color: isDnf ? '#D8402C' : '#4FD07A' }}>
            {isDnf ? 'ХҮЧИНГҮЙ БОЛГОСОН' : submission.penalty === '+2' ? 'БАТАЛСАН · +2' : 'БАТАЛСАН'}
          </p>
        )}
        {error && (
          <p style={{ marginTop: 10, font: '400 11px var(--oc-font-heading), sans-serif', color: '#E8543C' }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="oc-rv-decide oc-rv-decide-ok"
            disabled={busy}
            onClick={() => act('approve')}
          >
            ЗӨВШӨӨРӨХ · ЦАГ СЭРГЭЭХ
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="oc-rv-decide oc-rv-decide-warn"
              disabled={busy}
              onClick={() => act('approve_plus2')}
            >
              +2
            </button>
            <button
              type="button"
              className="oc-rv-decide oc-rv-decide-dnf"
              disabled={busy}
              onClick={() => act('dnf')}
            >
              DNF
            </button>
          </div>
        </div>

        <p style={{ marginTop: 12, font: '400 10px var(--oc-font-heading), sans-serif', color: '#6E6A62' }}>
          Шийдвэр гаргаснаар тухайн оролдлого шууд эцэглэлд тооцогдоно.
        </p>

        {/* Not in the mockup, but carried over deliberately: deleting a
            submission (video + doc) was only reachable from the old
            card-list dashboard this page replaces, and dropping the grid
            in without it would have silently removed a working feature.
            Same endpoint and same explicit two-step confirm as before. */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #1C1C21' }}>
          {confirmingDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ font: '400 11px var(--oc-font-heading), sans-serif', color: '#9A958A' }}>
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
                style={{ border: '1px solid #D8402C', background: '#1A0D0A', color: '#E8543C', padding: '7px 10px', font: '600 9px var(--oc-font-mono), monospace', letterSpacing: '.1em', cursor: 'pointer' }}
              >
                ТИЙМ
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
                style={{ border: '1px solid #2A2A31', background: 'transparent', color: '#9A958A', padding: '7px 10px', font: '600 9px var(--oc-font-mono), monospace', letterSpacing: '.1em', cursor: 'pointer' }}
              >
                ҮГҮЙ
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              style={{ border: 'none', background: 'transparent', color: '#6E6A62', font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.1em', cursor: 'pointer', padding: 0 }}
            >
              ИЛГЭЭМЖ УСТГАХ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
