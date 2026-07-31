'use client';

// Compact "quick motivational glance" — today's Ao5 vs the closest prior
// session at yesterday / 7 days / 30 days ago, no chart. Refetches whenever
// `event` or `todayId` change (the latter bumps after a new save, via the
// parent's onTodayChange from PracticeEntryPanel).

import { useEffect, useState } from 'react';
import { getPracticeComparison } from '@/lib/firebase/services/practiceSessions';
import { fmtMs } from '@/lib/timer-engine';
import { useLang, type TranslationKey } from '@/lib/i18n';
import type { PracticeSession } from '@/lib/types/practice';

interface Comparison {
  today: PracticeSession | null;
  yesterday: PracticeSession | null;
  sevenDaysAgo: PracticeSession | null;
  thirtyDaysAgo: PracticeSession | null;
  trend: PracticeSession[];
}

function DeltaRow({ labelKey, reference, todayAo5 }: {
  labelKey: TranslationKey;
  reference: PracticeSession | null;
  todayAo5: number | null;
}) {
  const { t } = useLang();
  const refAo5 = reference?.ao5 ?? null;

  let body: React.ReactNode;
  if (refAo5 === null) {
    body = <span style={{ color: 'var(--muted)' }}>{t('practice.cmp.no-data')}</span>;
  } else if (todayAo5 === null) {
    body = <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{fmtMs(refAo5)}</span>;
  } else {
    const delta = todayAo5 - refAo5; // negative = today is faster = improvement
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    const deltaStr = `${sign}${(Math.abs(delta) / 1000).toFixed(2)}s`;
    const color = delta < 0 ? '#4ade80' : delta > 0 ? '#f87171' : 'var(--muted)';
    const arrow = delta < 0 ? '↓' : delta > 0 ? '↑' : '=';
    body = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{fmtMs(refAo5)}</span>
        <span style={{ color, fontWeight: 700, fontSize: '0.82rem' }}>{arrow} {deltaStr}</span>
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0' }}>
      <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{t(labelKey)}</span>
      {body}
    </div>
  );
}

export default function PracticeComparisonWidget({
  athleteId,
  event,
  todayId,
}: {
  athleteId: string;
  event: string;
  todayId: string | null;
}) {
  const { t } = useLang();
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPracticeComparison(athleteId, event)
      .then((c) => { if (!cancelled) setComparison(c); })
      .catch(() => { if (!cancelled) setComparison(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // todayId isn't read here — it only exists to retrigger this fetch
    // right after a new session is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, event, todayId]);

  if (loading || !comparison) return null;

  const todayAo5 = comparison.today?.ao5 ?? null;

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <div className="card-title"><span className="title-accent" />{t('practice.cmp.title')}</div>

      <div style={{ textAlign: 'center', marginBottom: '0.6rem' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {t('practice.cmp.today')}
        </div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'monospace', color: todayAo5 === null ? '#f43f5e' : '#a78bfa' }}>
          {fmtMs(todayAo5 ?? 0, todayAo5 === null)}
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <DeltaRow labelKey="practice.cmp.yesterday" reference={comparison.yesterday} todayAo5={todayAo5} />
        <DeltaRow labelKey="practice.cmp.7d"         reference={comparison.sevenDaysAgo} todayAo5={todayAo5} />
        <DeltaRow labelKey="practice.cmp.30d"        reference={comparison.thirtyDaysAgo} todayAo5={todayAo5} />
      </div>
    </div>
  );
}
