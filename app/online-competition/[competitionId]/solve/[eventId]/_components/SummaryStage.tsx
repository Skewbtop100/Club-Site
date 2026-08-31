'use client';

import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import type { AttemptTime } from '@/lib/online-competition/ao5';
import { computeSummaryStats } from '../_lib/summaryStats';

export interface AttemptResult {
  timeCs: number | null;
  isDnf: boolean;
}

export default function SummaryStage({
  attempts,
  onRedo,
  onSubmit,
  submitting,
  submitProgress,
  submitError,
}: {
  attempts: AttemptResult[];
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
  const { ao5, bestIndex, worstIndex } = computeSummaryStats(times);

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
            const isExcluded = i === bestIndex || i === worstIndex;
            const tag = i === bestIndex ? 'ХАМГИЙН БАГА' : i === worstIndex ? 'ХАМГИЙН ИХ' : '';
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
        </div>

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
