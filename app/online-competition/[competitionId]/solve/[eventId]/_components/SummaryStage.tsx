'use client';

import { fmtCentiseconds, fmtTimeLimit } from '@/lib/online-competition/time-utils';
import type { AttemptTime } from '@/lib/online-competition/ao5';
import { computeResult, formatLabel, type ResultFormat } from '@/lib/online-competition/ao5';
import { beatsAverage, beatsPr, type StoredBests } from '../_lib/prCheck';

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
  timeLimitCs,
  cutOff,
  cutoffCs,
  bests,
  onSubmit,
  submitting,
  submitError,
}: {
  attempts: AttemptResult[];
  /** The run's captured format — decides how these attempts collapse into
   *  one number, and which of them (if any) are excluded. */
  resultFormat: ResultFormat;
  /** null = no limit. Applied here so the provisional result the athlete
   *  sees matches what effectiveAttemptTime will compute at scoring. */
  timeLimitCs: number | null;
  /** True when the run ended early because the cutoff was not beaten. The
   *  result is then a SINGLE, not an average. */
  cutOff: boolean;
  cutoffCs: number | null;
  /** The athlete's stored bests for this event, or null while still
   *  loading / unavailable — in which case no marker is shown. */
  bests: StoredBests | null;
  /** Finishes the run. It uploads NOTHING — every attempt was filed as it
   *  was recorded, and this screen is only reachable once they all
   *  landed. It writes the run's own result and moves to the sent
   *  screen. */
  onSubmit: () => void;
  submitting: boolean;
  submitError: string;
}) {
  // An over-limit attempt shows as DNF here, exactly as it will score.
  const times: AttemptTime[] = attempts.map((a) =>
    a.isDnf || a.timeCs === null || (timeLimitCs !== null && a.timeCs > timeLimitCs)
      ? 'DNF'
      : a.timeCs,
  );
  // A cut-off run has no average. computeResult is NOT called for one:
  // its ao5 branch is deliberately unlength-guarded (step A), so a
  // two-attempt slice returns a fabricated average faster than either
  // attempt. The result is the best single, and nothing is "excluded" —
  // no attempt was dropped, the round simply ended.
  const finished = times.filter((t): t is number => t !== 'DNF');
  const cutoffSingle = finished.length > 0 ? Math.min(...finished) : null;
  const { value: ao5, excludedIndices } = cutOff
    ? { value: cutoffSingle, excludedIndices: [] as number[] }
    : computeResult(times, resultFormat);

  // Same predicate the live toast uses, so a row can't disagree with the
  // badge the athlete already saw mid-session.
  const prRows = attempts.map((a) => beatsPr(a.timeCs, a.isDnf, bests));
  const anyPr = prRows.some(Boolean);
  // A first-ever Ao5 for this event counts, same rule as a first single.
  const ao5IsPr = beatsAverage(ao5, resultFormat, bests);

  return (
    <div className="oc-solve-summary">
      <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#6E6A62' }}>
        {attempts.length} ОРОЛДЛОГО
      </p>

      <div className="oc-solve-attempt-list">
        {attempts.map((a, i) => {
          // Ao5 drops its best and worst; Mo3 counts all three and a
          // best-of excludes nothing, so for those excludedIndices is
          // empty and no row is greyed or tagged.
          const isExcluded = excludedIndices.includes(i);
          const tag = excludedIndices[0] === i ? 'ХАМГИЙН БАГА' : excludedIndices[1] === i ? 'ХАМГИЙН ИХ' : '';
          return (
            <div key={i} className="oc-solve-attempt-row" style={isExcluded ? { opacity: 0.55 } : undefined}>
              <span style={{ font: '500 10px var(--oc-font-mono), monospace', color: '#6E6A62' }}>{i + 1}</span>
              <span className={`oc-solve-attempt-time${a.isDnf ? ' oc-solve-attempt-time-dnf' : ''}`}>
                {a.isDnf ? 'DNF' : fmtCentiseconds(a.timeCs as number)}
              </span>
              {tag && (
                <span style={{ font: '500 8px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#6E6A62' }}>
                  {tag}
                </span>
              )}
              {prRows[i] && <PrTag />}
            </div>
          );
        })}
      </div>

      {cutOff && cutoffCs !== null && (
        <div className="oc-solve-cutoff-note" role="status">
          <span className="oc-solve-cutoff-title">ШҮҮЛТҮҮР ДАВААГҮЙ</span>
          <span>
            Эхний {attempts.length} оролдлогод {fmtTimeLimit(cutoffCs)}-аас хурдан үр дүн
            гараагүй тул раунд эндээ дуусч, зөвхөн ганц үзүүлэлт бүртгэгдэнэ.
          </span>
          <span className="oc-solve-pr-note">шүүгч баталгаажуулснаар эцэслэнэ</span>
        </div>
      )}

      <div className="oc-solve-ao5-box">
        {/* A cut-off round produces a single, so labelling it AO5 would
            be a lie about what the number is. */}
        <span className="oc-solve-ao5-label">
          {cutOff ? 'ГАНЦ ҮЗҮҮЛЭЛТ' : formatLabel(resultFormat).toUpperCase()}
        </span>
        <span className="oc-solve-ao5-value">{ao5 === null ? 'DNF' : fmtCentiseconds(ao5)}</span>
      </div>

      {/* Out of the average box: the mockup's box is a two-item row with
          the number hard against its right edge, and a badge inside it
          pushed the number off that edge. */}
      {ao5IsPr && <PrTag />}

      {(anyPr || ao5IsPr) && (
        <span className="oc-solve-pr-note" style={{ marginTop: 0 }}>
          шүүгч баталгаажуулснаар эцэслэнэ
        </span>
      )}

      {submitError && (
        <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>{submitError}</p>
      )}

      {/* One action. The old "Дахин үзэх" beside it deleted every
          recording and restarted the round — offered right under the
          athlete's own Ao5, which made it a way to discard a result you
          did not like. Attempts are filed as they happen now, and a filed
          attempt cannot be deleted by the person who filed it.

          The label stays «Илгээх». The mockup's «Бүгдийг илгээх» comes
          with the attestation checkbox above it, and its colours are
          bound to that checkbox's state — both are changeset 5. */}
      <button type="button" className="oc-solve-btn-submit" disabled={submitting} onClick={onSubmit}>
        {submitting ? 'Илгээж байна...' : 'Илгээх'}
      </button>
    </div>
  );
}
