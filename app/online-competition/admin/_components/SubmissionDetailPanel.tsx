'use client';

import { useState } from 'react';
import type { OnlineSubmissionAdminView } from '@/lib/online-competition/types';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';

type ReviewAction = 'approve' | 'approve_plus2' | 'dnf';

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
  onClose: () => void;
  onReview: (submissionId: string, action: ReviewAction) => Promise<void>;
  onDelete: (submissionId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
            src={submission.videoUrl}
            controls
            playsInline
            className="h-full w-full bg-black object-contain"
          />
        </div>
      </div>

      <div className="oc-rv-panel-info">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            {/* THE ROUND, and then the attempt — two different numbers.
                This line used to print `submission.round` after "РАУНД",
                and `submission.round` is the ATTEMPT INDEX: the header
                showed the same number twice under two names, so attempt 2
                of a single-round competition read "РАУНД 2". */}
            <p style={{ font: '500 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
              {submission.event.toUpperCase()} · РАУНД {submission.competitionRound}
            </p>
            <h2 style={{ marginTop: 6, font: '600 18px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
              {athleteName} · Оролдлого {submission.round}
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
