'use client';

// Club-wide monthly Practice Log overview — one card per WCA event, each
// showing this month's top-3 "most improved / most active / most PRs".
//
// This replaced the self-entry form + comparison widget from Phase 2/3
// (PracticeEntryPanel / PracticeComparisonWidget / PracticeLeaderboardWidget
// are untouched and still used from components/admin/PracticeEntryTab —
// entry now lives there only; those component files are kept for reuse in
// a later phase, just not imported here anymore).
//
// Content is club-wide and already publicly readable (practiceSessions
// Firestore rule is `allow read: if true`), so this page has no auth guard
// — only the nav link to it is login-gated (see Navbar.tsx).

import { useEffect, useState } from 'react';
import { WCA_EVENTS, type WcaEvent } from '@/lib/wca-events';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import { getMonthlyEventStats, todayInClubTz } from '@/lib/firebase/services/practiceSessions';
import { useLang, type TranslationKey } from '@/lib/i18n';

type MonthlyStats = Awaited<ReturnType<typeof getMonthlyEventStats>>;
type EventStats = MonthlyStats[string];

// Hidden from this grid only — not removed from WCA_EVENTS, so Timer,
// Competition, and admin's PracticeEntryTab are unaffected.
const HIDDEN_GRID_EVENTS = new Set(['333mbf', '555bf', '444bf', '333fm']);
const GRID_EVENTS = WCA_EVENTS.filter((ev) => !HIDDEN_GRID_EVENTS.has(ev.id));

export default function PracticePage() {
  const [stats, setStats] = useState<MonthlyStats>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const monthStr = todayInClubTz().slice(0, 7); // "YYYY-MM"
    getMonthlyEventStats(monthStr)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { if (!cancelled) setStats({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: 'var(--bg)', color: 'var(--text)', padding: '1rem 1rem 3rem' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {loading ? (
          <div className="spinner-row"><span className="spinner-ring" /></div>
        ) : (
          <div className="me-grid">
            {GRID_EVENTS.map((ev) => (
              <EventStatCard key={ev.id} event={ev} stats={stats[ev.id]} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .me-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.1rem;
        }
        .me-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 1.2rem;
          transition: border-color 0.25s;
        }
        .me-card:hover { border-color: rgba(124,58,237,0.25); }
        .me-card-header {
          display: flex; align-items: center; gap: 0.5rem;
          margin-bottom: 0.9rem; padding-bottom: 0.7rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .me-card-title { font-size: 0.95rem; font-weight: 700; color: var(--text-primary); }
        .me-list { margin-bottom: 0.8rem; }
        .me-list:last-child { margin-bottom: 0; }
        .me-list-label {
          font-size: 0.65rem; font-weight: 700; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.35rem;
        }
        .me-list-empty { font-size: 0.78rem; color: var(--muted); opacity: 0.7; padding: 0.1rem 0; }
        .me-list-row {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.2rem 0; font-size: 0.82rem;
        }
        .me-list-rank {
          width: 16px; flex-shrink: 0; text-align: center;
          font-weight: 700; font-size: 0.72rem; color: #a78bfa;
        }
        .me-list-name {
          flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; color: var(--text);
        }
        .me-list-value {
          flex-shrink: 0; font-family: monospace; font-weight: 700;
          color: #a78bfa; font-size: 0.8rem;
        }
      `}</style>
    </div>
  );
}

function EventStatCard({ event, stats }: { event: WcaEvent; stats: EventStats | undefined }) {
  const { t } = useLang();
  const improvement = stats?.improvement ?? [];
  const participation = stats?.participation ?? [];
  const prCount = stats?.prCount ?? [];

  return (
    <div className="me-card">
      <div className="me-card-header">
        <WcaEventIcon eventId={event.id} size={22} />
        <span className="me-card-title">{event.name}</span>
      </div>

      <MiniLeaderboard
        labelKey="practice.grid.improvement"
        rows={improvement.map((r) => ({ name: r.athleteName, value: `-${r.improvementSeconds.toFixed(2)}s` }))}
      />
      <MiniLeaderboard
        labelKey="practice.grid.participation"
        rows={participation.map((r) => ({ name: r.athleteName, value: `${r.count} ${t('practice.grid.times-suffix')}` }))}
      />
      <MiniLeaderboard
        labelKey="practice.grid.pr-count"
        rows={prCount.map((r) => ({ name: r.athleteName, value: `${r.count} ${t('practice.grid.times-suffix')}` }))}
      />
    </div>
  );
}

function MiniLeaderboard({
  labelKey,
  rows,
}: {
  labelKey: TranslationKey;
  rows: { name: string; value: string }[];
}) {
  const { t } = useLang();
  return (
    <div className="me-list">
      <div className="me-list-label">{t(labelKey)}</div>
      {rows.length === 0 ? (
        <div className="me-list-empty">{t('practice.grid.empty')}</div>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="me-list-row">
            <span className="me-list-rank">{i + 1}</span>
            <span className="me-list-name">{r.name}</span>
            <span className="me-list-value">{r.value}</span>
          </div>
        ))
      )}
    </div>
  );
}
