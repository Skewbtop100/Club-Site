'use client';

import { fmtCentiseconds } from '@/lib/online-competition/time-utils';

export interface FilingRow {
  /** 1-based attempt number. */
  attempt: number;
  timeCs: number | null;
  isDnf: boolean;
  state: 'queued' | 'uploading' | 'retrying' | 'filed' | 'failed';
  uploadPercent: number;
  error: string | null;
}

/** Where the run waits for its recordings to reach the server.
 *
 *  Each attempt is uploaded and filed the moment it is recorded, in the
 *  background, so this screen is normally seen ONCE — after the last
 *  attempt, for as long as that one upload takes. It also appears mid-run
 *  if a filing failed, because the next attempt must not start on top of
 *  a hole in the attempt order.
 *
 *  It offers no way off the page: an attempt that has not been filed
 *  exists only as a blob in this tab's memory, and a run cannot yet be
 *  resumed after leaving (that is PR-3). */
export default function FilingStage({
  rows,
  failed,
  runComplete,
  onRetry,
}: {
  rows: FilingRow[];
  /** True when at least one attempt is in the failed state — the screen
   *  stops being a progress report and starts being a decision. */
  failed: boolean;
  /** The last attempt of the run has been recorded, so the only thing
   *  between the athlete and their result is this upload. */
  runComplete: boolean;
  onRetry: () => void;
}) {
  const filed = rows.filter((r) => r.state === 'filed').length;
  return (
    <div className="oc-solve-go">
      <div>
        <p
          style={{
            font: '500 9px var(--oc-font-mono), monospace',
            letterSpacing: '.2em',
            color: failed ? '#D8402C' : '#8A8474',
          }}
        >
          {failed ? 'ХАДГАЛАГДСАНГҮЙ' : 'ХАДГАЛЖ БАЙНА'}
        </p>
        <p
          style={{
            marginTop: 12,
            font: '400 14px var(--oc-font-heading), sans-serif',
            color: '#F4F1EA',
            lineHeight: 1.6,
          }}
        >
          {failed
            ? 'Бичлэгийг сервэрт хүргэж чадсангүй. Холболтоо шалгана уу — автоматаар дахин оролдсон боловч болсонгүй.'
            : runComplete
              ? 'Сүүлийн бичлэгийг хадгалж дуустал хүлээнэ үү. Дүн дараа нь гарна.'
              : 'Өмнөх оролдлогын бичлэг хадгалагдаж дуустал дараагийн оролдлого эхлэхгүй.'}
        </p>

        <div className="oc-solve-attempt-list" style={{ marginTop: 16 }}>
          {rows.map((r) => (
            <div key={r.attempt} className="oc-solve-attempt-row">
              <span style={{ font: '500 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
                {r.attempt}-Р ОРОЛДЛОГО
              </span>
              <span className={`oc-solve-attempt-time${r.isDnf ? ' oc-solve-attempt-time-dnf' : ''}`}>
                {r.isDnf || r.timeCs === null ? 'DNF' : fmtCentiseconds(r.timeCs)}
              </span>
              <span
                style={{
                  font: '500 10px var(--oc-font-mono), monospace',
                  letterSpacing: '.08em',
                  color: r.state === 'filed' ? '#4FD07A' : r.state === 'failed' ? '#D8402C' : '#8A8474',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.state === 'filed' && '✓ ХАДГАЛСАН'}
                {r.state === 'uploading' && `${r.uploadPercent}%`}
                {r.state === 'retrying' && 'ДАХИН ОРОЛДОЖ БАЙНА'}
                {r.state === 'queued' && 'ЭЭЛЖЭЭ ХҮЛЭЭЖ БАЙНА'}
                {r.state === 'failed' && 'АЛДАА'}
              </span>
            </div>
          ))}
        </div>

        {(failed || rows.some((r) => r.state === 'retrying')) && (
          <p style={{ marginTop: 12, font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>
            {rows.find((r) => r.state === 'failed' || r.state === 'retrying')?.error}
          </p>
        )}
        {/* The reason this screen has no way out. */}
        <p
          style={{
            marginTop: 14,
            font: '400 12px var(--oc-font-heading), sans-serif',
            color: '#8A8474',
            lineHeight: 1.6,
          }}
        >
          {filed > 0
            ? `Хадгалагдсан ${filed} оролдлого сервэрт байгаа. Үлдсэнийг нь хадгалтал хуудсаа хаахгүй байна уу.`
            : 'Хуудсыг хаавал энэ оролдлогын бичлэг устана.'}
        </p>
      </div>

      {failed && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="oc-solve-btn-confirm"
            style={{ width: 'auto', padding: '12px 24px' }}
            onClick={onRetry}
          >
            Дахин илгээх
          </button>
          <p
            style={{
              font: '400 11px var(--oc-font-heading), sans-serif',
              color: '#8A8474',
              textAlign: 'center',
            }}
          >
            Дахин оролдсоор байвал зохион байгуулагчид хандана уу.
          </p>
        </div>
      )}
    </div>
  );
}
