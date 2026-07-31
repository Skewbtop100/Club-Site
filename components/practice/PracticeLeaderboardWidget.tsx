'use client';

// Club-wide "best Ao5 per athlete, last 30 days" for one event. Placed on
// /practice below the athlete's own comparison rather than as a new route —
// it rides the same event selector already in PracticeEntryPanel, so there's
// no second/duplicate event picker on the page.

import { useEffect, useState } from 'react';
import { getPracticeLeaderboard } from '@/lib/firebase/services/practiceSessions';
import { fmtMs } from '@/lib/timer-engine';
import { useLang } from '@/lib/i18n';

const WINDOW_DAYS = 30;

const RANK_COLOR = ['#fbbf24', '#d1d5db', '#fb923c'];

export default function PracticeLeaderboardWidget({ event }: { event: string }) {
  const { t } = useLang();
  const [rows, setRows] = useState<{ athleteId: string; athleteName: string; bestAo5: number; date: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPracticeLeaderboard(event, WINDOW_DAYS)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [event]);

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <div className="card-title"><span className="title-accent" />{t('practice.lb.title')}</div>

      {loading ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
          {t('practice.checking')}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
          {t('practice.lb.empty')}
        </div>
      ) : (
        <div>
          {rows.map((r, i) => (
            <div
              key={r.athleteId}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.1rem',
                borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
            >
              <span style={{
                width: 22, textAlign: 'center', fontWeight: 800, fontSize: '0.85rem',
                color: RANK_COLOR[i] ?? 'var(--muted)',
              }}>{i + 1}</span>
              <span style={{
                flex: 1, fontSize: '0.86rem', color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.athleteName}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{r.date}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#a78bfa', fontSize: '0.88rem', minWidth: 60, textAlign: 'right' }}>
                {fmtMs(r.bestAo5)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
