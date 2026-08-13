'use client';

// Calendar-month heatmap for /practice's Activity card — same binary
// filled/unfilled + title-tooltip convention as PracticeHeatMap, but a
// traditional 7-column week-row layout scoped to one calendar month
// (with day-of-month numbers in cells) rather than PracticeHeatMap's
// rolling 12-week GitHub-style grid. Replaces a bar chart that didn't
// read well when a month has only 1-2 non-zero days — every cell here
// carries meaning regardless of how sparse the data is, unlike a mostly-
// empty bar chart implying "nothing to see."
//
// Renders the calendar beside a small stats column (sessions / active
// days / best streak) rather than centering the calendar alone in a
// wide card — all three numbers are derived from the same `points`
// prop already passed in, no new data source.
//
// Presentational only, same as PracticeTrendChart — the page already
// fetches { date, count }[] via getMonthlyActivityTrend; this just needs
// `monthStr` alongside it to know the full month's shape (that function
// stops returning days at "today" for the current month, so any day
// after today simply isn't in `points` and renders as an empty cell,
// same as a practiced-but-empty day — standard calendar-UI behavior).

import { useLang } from '@/lib/i18n';

const CELL = 24;
const GAP = 3;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function weekdayOfMonthStart(monthStr: string): number {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}

function daysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="calc-label">{label}</div>
      <div className="calc-value accent">{value}</div>
    </div>
  );
}

export default function MonthlyActivityGrid({
  monthStr,
  points,
}: {
  monthStr: string; // "YYYY-MM"
  points: { date: string; count: number }[];
}) {
  const { t } = useLang();
  const countByDate = new Map(points.map((p) => [p.date, p.count]));
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const activeDays = points.filter((p) => p.count > 0).length;

  // Longest run of consecutive days with count > 0 this month — `points`
  // is already date-ascending (getMonthlyActivityTrend's own output
  // order), so a single forward walk is enough.
  let bestStreak = 0;
  let run = 0;
  for (const p of points) {
    if (p.count > 0) { run += 1; if (run > bestStreak) bestStreak = run; } else run = 0;
  }

  const lastDay = daysInMonth(monthStr);
  const leadingBlanks = weekdayOfMonthStart(monthStr);

  const cells: (number | null)[] = new Array(leadingBlanks).fill(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);

  return (
    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: `${GAP}px` }}>
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={`h${i}`} style={{
            width: CELL, textAlign: 'center', fontSize: '0.6rem', fontWeight: 700,
            color: 'var(--muted)', opacity: 0.6,
          }}>{w}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const date = `${monthStr}-${String(day).padStart(2, '0')}`;
          const count = countByDate.get(date) ?? 0;
          const practiced = count > 0;
          return (
            <div
              key={date}
              title={practiced ? `${date} — ${count} session(s)` : date}
              style={{
                width: CELL, height: CELL, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.62rem', fontWeight: 600,
                background: practiced ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                color: practiced ? '#fff' : 'var(--muted)',
              }}
            >
              {day}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 110 }}>
        <StatTile value={total} label={t('practice.activity.stat-sessions')} />
        <StatTile value={activeDays} label={t('practice.activity.stat-active-days')} />
        <StatTile value={bestStreak} label={t('practice.activity.stat-best-streak')} />
      </div>
    </div>
  );
}
