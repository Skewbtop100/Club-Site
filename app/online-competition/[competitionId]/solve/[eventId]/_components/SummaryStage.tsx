'use client';

import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import type { AttemptTime } from '@/lib/online-competition/ao5';
import { computeResult, type ResultFormat } from '@/lib/online-competition/ao5';
import { beatsAo5, beatsPr, type StoredBests } from '../_lib/prCheck';

export interface AttemptResult {
  timeCs: number | null;
  isDnf: boolean;
}

/** Provisional PR marker. Reads the athlete's stored bests (fetched once
 *  by the page); never writes them — stats.{eventId} is only ever
 *  computed by the admin recompute once a judge approves. */
function PrTag() {
  return (
    <span className="oc-solve-pr-badge" title="шүүгч баталгаажуулснаар эцэслэнэ">
      ШИНЭ PR!
    </span>
  );
}

export default function SummaryStage({
  attempts,
  resultFormat,
  bests,
  onRedo,
  onSubmit,
  submitting,
  submitProgress,
  submitError,
}: {
  attempts: AttemptResult[];
  /** The run's captured format — decides how these attempts collapse into
   *  one number, and which of them (if any) are excluded. */
  resultFormat: ResultFormat;
  /** The athlete's stored bests for this event, or null while still
   *  loading / unavailable — in which case no marker is shown. */
  bests: StoredBests | null;
  onRedo: () => void;
  onSubmit: () => void;
  submitting: boolean;
  /** Aggregate 0-100 across all 5 video uploads — no specific mockup
   *  state was given for this, so it's folded into the submit button's
   *  own label rather than a separate progress bar. */
  submitProgress: number;
  submitError: string;
}) {
  const times: AttemptTime[] = attempts.map((a) => (a.isDnf ? 'DNF' : (a.timeCs as number)));
  const { value: ao5, excludedIndices } = computeResult(times, resultFormat);

  // Same predicate the live toast uses, so a row can't disagree with the
  // badge the athlete already saw mid-session.
  const prRows = attempts.map((a) => beatsPr(a.timeCs, a.isDnf, bests));
  const anyPr = prRows.some(Boolean);
  // A first-ever Ao5 for this event counts, same rule as a first single.
  const ao5IsPr = beatsAo5(ao5, bests);

  function handleRedo() {
    if (window.confirm('Бүх бичлэгийг устгаад дахин эхлэх үү?')) {
      onRedo();
    }
  }

  return (
    <div className="oc-solve-summary">
      <div>
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
          {attempts.length} ОРОЛДЛОГО
        </p>

        <div className="oc-solve-attempt-list" style={{ marginTop: 10 }}>
          {attempts.map((a, i) => {
            // Ao5 drops its best and worst; Mo3 counts all three and a
            // best-of excludes nothing, so for those excludedIndices is
            // empty and no row is greyed or tagged.
            const isExcluded = excludedIndices.includes(i);
            const tag = excludedIndices[0] === i ? 'ХАМГИЙН БАГА' : excludedIndices[1] === i ? 'ХАМГИЙН ИХ' : '';
            return (
              <div key={i} className="oc-solve-attempt-row" style={isExcluded ? { opacity: 0.55 } : undefined}>
                <span style={{ font: '500 10px var(--oc-font-mono), monospace', color: '#5B564B' }}>#{i + 1}</span>
                <span className={`oc-solve-attempt-time${a.isDnf ? ' oc-solve-attempt-time-dnf' : ''}`}>
                  {a.isDnf ? 'DNF' : fmtCentiseconds(a.timeCs as number)}
                </span>
                {tag && (
                  <span style={{ font: '500 8px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#5B564B' }}>
                    {tag}
                  </span>
                )}
                {prRows[i] && <PrTag />}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="oc-solve-ao5-box">
          <span style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#8A8474' }}>
            AO5
          </span>
          <span className="oc-solve-ao5-value">{ao5 === null ? 'DNF' : fmtCentiseconds(ao5)}</span>
          {ao5IsPr && (
            <div style={{ marginTop: 8 }}>
              <PrTag />
            </div>
          )}
        </div>

        {(anyPr || ao5IsPr) && (
          <span className="oc-solve-pr-note" style={{ marginTop: 0 }}>
            шүүгч баталгаажуулснаар эцэслэнэ
          </span>
        )}

        {submitError && (
          <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>{submitError}</p>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="oc-solve-btn-redo" disabled={submitting} onClick={handleRedo}>
            Дахин үзэх
          </button>
          <button type="button" className="oc-solve-btn-submit" disabled={submitting} onClick={onSubmit}>
            {submitting ? `Илгээж байна... ${submitProgress}%` : 'Илгээх'}
          </button>
        </div>
      </div>
    </div>
  );
}
