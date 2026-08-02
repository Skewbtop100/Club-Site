'use client';

// Vertical "Today → Yesterday → 7d ago → 30d ago → All-Time Best" timeline
// for one athlete+event. Each row (except All-Time Best) shows its delta
// vs the row directly above it — not all rows compared against Today the
// way PracticeComparisonWidget (Phase 3) does. The up/down color + arrow
// convention itself (green ↓ faster, red ↑ slower) is reused as-is from
// that component.
//
// Only ever mounted inside AthleteProfileOverlay's "Дасгал" tab, which
// stays hardcoded (no i18n) per the Phase 3 exception — this component
// matches that same hardcoded-copy convention rather than adding i18n
// keys nothing else would use.

import { useEffect, useState } from 'react';
import { getPracticeComparison } from '@/lib/firebase/services/practiceSessions';
import { fmtMs } from '@/lib/timer-engine';

interface ComparisonData {
  today: { ao5: number | null } | null;
  yesterday: { ao5: number | null } | null;
  sevenDaysAgo: { ao5: number | null } | null;
  thirtyDaysAgo: { ao5: number | null } | null;
  allTimeBest: number | null;
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const delta = current - previous; // negative = current is faster = improvement
  if (delta === 0) return null;
  const color = delta < 0 ? '#4ade80' : '#f87171';
  const arrow = delta < 0 ? '↓' : '↑';
  const sign = delta < 0 ? '−' : '+';
  return (
    <span style={{ color, fontWeight: 700, fontSize: '0.8rem' }}>
      {arrow} {sign}{(Math.abs(delta) / 1000).toFixed(2)}
    </span>
  );
}

function TimelineRow({
  label,
  ao5,
  previousAo5,
  compact,
}: {
  label: string;
  ao5: number | null;
  previousAo5?: number | null;
  compact?: boolean;
}) {
  const hasDelta = previousAo5 !== undefined && previousAo5 !== null && ao5 !== null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.55rem 0.2rem',
      borderBottom: compact ? 'none' : '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{ fontSize: '0.85rem', color: 'var(--muted)', fontWeight: compact ? 700 : 500 }}>
        {label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        {ao5 === null ? (
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Одоогоор мэдээлэл алга</span>
        ) : (
          <span style={{ fontFamily: 'monospace', fontWeight: compact ? 800 : 600, color: 'var(--text)' }}>
            {compact ? '' : 'Ao5 '}{fmtMs(ao5)}
          </span>
        )}
        {hasDelta && <DeltaBadge current={ao5 as number} previous={previousAo5 as number} />}
      </span>
    </div>
  );
}

export default function ProgressTimeline({ athleteId, event }: { athleteId: string; event: string }) {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPracticeComparison(athleteId, event)
      .then((c) => { if (!cancelled) setData(c); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [athleteId, event]);

  if (loading) {
    return <div className="spinner-row"><span className="spinner-ring" /></div>;
  }
  if (!data) return null;

  const todayAo5 = data.today?.ao5 ?? null;
  const yesterdayAo5 = data.yesterday?.ao5 ?? null;
  const sevenAo5 = data.sevenDaysAgo?.ao5 ?? null;
  const thirtyAo5 = data.thirtyDaysAgo?.ao5 ?? null;

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12, padding: '0.9rem 1rem', marginBottom: '1rem',
    }}>
      <TimelineRow label="Today" ao5={todayAo5} />
      <TimelineRow label="Yesterday" ao5={yesterdayAo5} previousAo5={todayAo5} />
      <TimelineRow label="7 Days ago" ao5={sevenAo5} previousAo5={yesterdayAo5} />
      <TimelineRow label="30 Days ago" ao5={thirtyAo5} previousAo5={sevenAo5} />
      <TimelineRow label="All-Time Best" ao5={data.allTimeBest} compact />
    </div>
  );
}
