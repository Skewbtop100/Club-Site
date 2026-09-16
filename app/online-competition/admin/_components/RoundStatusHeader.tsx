'use client';

import type { RoundAdminView, RoundsSummary } from '@/app/api/online-competition/admin-rounds/route';

// ── The status header of Раунд удирдах ──────────────────────────────────
// What is running now, how far through it the athletes are, and what comes
// next. Everything here is read off the `rounds` array the list below
// renders — nothing is fetched or derived twice, so the header cannot
// disagree with the row it is summarising.
//
// Styling follows the rest of the admin section: literal inline styles or
// `.oc-*` classes from theme.css, no runtime-assembled Tailwind, and no
// margin/padding utility that globals.css's unlayered reset would zero.

/** "2026-09-12 18:00", or "—". The admin's own timezone, which is the right
 *  one here: unlike the athlete-facing countdown, this is read by the person
 *  standing in the room running the competition. */
function fmtSlot(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "18:00–18:40" from a slot's two ends, or just the start when the
 *  programme gives no duration to speak of. */
export function fmtWindow(startMs: number | null, endMs: number | null): string {
  if (startMs === null) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  const clock = (ms: number) => {
    const d = new Date(ms);
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return endMs !== null && endMs > startMs ? `${clock(startMs)}–${clock(endMs)}` : clock(startMs);
}

const COMPETITION_STATUS_LABEL: Record<string, string> = {
  draft: 'НООРОГ',
  upcoming: 'УДАХГҮЙ',
  live: 'ЯВАГДАЖ БУЙ',
  finished: 'ДУУССАН',
};

/** One of the three numbers. `tone` is the ink, not a judgement: the point
 *  is that an admin can find the number they want without reading a label
 *  twice, so the colours stay stable per slot rather than turning red when
 *  a value is high. */
function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span
        style={{
          font: '700 20px/1 var(--oc-font-mono), monospace',
          fontVariantNumeric: 'tabular-nums',
          color: tone,
        }}
      >
        {value}
      </span>
      <span
        style={{
          font: '500 8px/1.2 var(--oc-font-mono), monospace',
          letterSpacing: '.12em',
          color: '#6E6A62',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </span>
  );
}

export default function RoundStatusHeader({
  summary,
  rounds,
  onOpenDetail,
}: {
  summary: RoundsSummary | null;
  rounds: RoundAdminView[];
  /** Jump to the running round's athlete table. */
  onOpenDetail: (key: string) => void;
}) {
  if (!summary) return null;

  const byKey = (key: string | null) =>
    key === null ? null : rounds.find((r) => `${r.eventId}_${r.round}` === key) ?? null;
  const now = byKey(summary.nowKey);
  const next = byKey(summary.nextKey);

  return (
    <div className="oc-rd-header">
      <div className="oc-rd-header-top">
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              font: '600 15px var(--oc-font-heading), sans-serif',
              color: '#F4F1EA',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {summary.competitionName || '—'}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: 4,
              font: '500 9px var(--oc-font-mono), monospace',
              letterSpacing: '.14em',
              color: '#6E6A62',
            }}
          >
            {COMPETITION_STATUS_LABEL[summary.competitionStatus] ?? summary.competitionStatus.toUpperCase()}
          </span>
        </span>
      </div>

      {/* ── WHAT IS RUNNING NOW ──
          With nothing live this is the whole of it: the competition above,
          this line, and the next round below. No zeroed stat row — three
          zeros look like a round that is going badly rather than one that
          has not started. */}
      {now === null ? (
        <p
          style={{
            margin: 0,
            font: '500 12px var(--oc-font-heading), sans-serif',
            color: '#9A958A',
          }}
        >
          Явагдаж буй раунд байхгүй.
        </p>
      ) : (
        <div className="oc-rd-header-now">
          <span style={{ minWidth: 0, flex: '1 1 190px' }}>
            <span className="oc-rd-badge oc-rd-badge-live" style={{ marginBottom: 7 }}>
              ЯВАГДАЖ БУЙ
            </span>
            <span
              style={{
                display: 'block',
                font: '600 14px var(--oc-font-heading), sans-serif',
                color: '#F4F1EA',
              }}
            >
              {now.label} · Раунд {now.round}
            </span>
            <span
              style={{
                display: 'block',
                marginTop: 4,
                font: '500 10px var(--oc-font-mono), monospace',
                fontVariantNumeric: 'tabular-nums',
                color: '#6E6A62',
              }}
            >
              {now.participants} тамирчин
              {now.scheduledStartMs !== null
                ? ` · хуваарь ${fmtWindow(now.scheduledStartMs, now.scheduledEndMs)}`
                : ' · хуваарьт байхгүй'}
            </span>
          </span>

          <div className="oc-rd-header-stats">
            <Stat label="ДУУСГАСАН" value={now.complete} tone="#4FD07A" />
            <Stat label="ДУУСГААГҮЙ" value={now.incomplete} tone="#F4F1EA" />
            {/* Submissions, not athletes — it is the judge's queue. The
                label says ТАЙЛАЛТ for that reason. */}
            <Stat label="ХҮЛЭЭГДЭЖ БУЙ ТАЙЛАЛТ" value={now.pendingSubmissions} tone="#DFFF4F" />
          </div>

          <button
            type="button"
            className="oc-sc-btn"
            onClick={() => onOpenDetail(`${now.eventId}_${now.round}`)}
          >
            ТАМИРЧИД
          </button>
        </div>
      )}

      {/* ── WHAT COMES NEXT ──
          The earliest round by programme order that is closed and not yet
          advanced — which is not the same as the next one that CAN open. A
          round still blocked on its predecessor's cut is exactly what an
          admin needs to see here, and `canOpen` is what says so. */}
      <div className="oc-rd-header-next">
        <span
          style={{
            font: '500 8px var(--oc-font-mono), monospace',
            letterSpacing: '.14em',
            color: '#4A4740',
            whiteSpace: 'nowrap',
          }}
        >
          ДАРААГИЙНХ
        </span>
        {next === null ? (
          <span style={{ font: '500 11px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
            Хуваарь дууссан.
          </span>
        ) : (
          <>
            <span style={{ font: '600 12px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
              {next.label} · Раунд {next.round}
            </span>
            <span
              style={{
                font: '500 11px var(--oc-font-mono), monospace',
                fontVariantNumeric: 'tabular-nums',
                color: '#9A958A',
              }}
            >
              {next.scheduledStartMs !== null ? fmtSlot(next.scheduledStartMs) : 'хуваарьт байхгүй'}
            </span>
            {!next.canOpen && (
              <span
                style={{
                  font: '500 9px var(--oc-font-mono), monospace',
                  letterSpacing: '.08em',
                  color: '#E0A020',
                }}
              >
                ▲ {next.round - 1}-Р РАУНД ШАЛГАРУУЛААГҮЙ
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
