'use client';

// Club-wide monthly Practice Log overview.
//
// Layout: a single "Featured Ranking" panel (tabs: improvement / participation
// / PRs, top-3 for whichever event is selected) above a horizontally
// scrollable strip of event pills that drives which event the panel shows.
// Replaced the earlier one-card-per-event grid (each card embedding all 3
// leaderboards at once) — same underlying data, just one event/metric shown
// at a time instead of all 17 cards rendered simultaneously.
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

import { useEffect, useMemo, useState } from 'react';
import { WCA_EVENTS } from '@/lib/wca-events';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import { getMonthlyEventStats, todayInClubTz } from '@/lib/firebase/services/practiceSessions';
import { useLang, type TranslationKey } from '@/lib/i18n';

type MonthlyStats = Awaited<ReturnType<typeof getMonthlyEventStats>>;
type MetricTab = 'improvement' | 'participation' | 'prCount';

// Hidden from this page only — not removed from WCA_EVENTS, so Timer,
// Competition, and admin's PracticeEntryTab are unaffected.
const HIDDEN_GRID_EVENTS = new Set(['333mbf', '555bf', '444bf', '333fm', '333bf']);
const GRID_EVENTS = WCA_EVENTS.filter((ev) => !HIDDEN_GRID_EVENTS.has(ev.id));

const METRIC_TABS: { id: MetricTab; labelKey: TranslationKey }[] = [
  { id: 'improvement', labelKey: 'practice.grid.improvement' },
  { id: 'participation', labelKey: 'practice.grid.participation' },
  { id: 'prCount', labelKey: 'practice.grid.pr-count' },
];

export default function PracticePage() {
  const { t } = useLang();
  const [stats, setStats] = useState<MonthlyStats>({});
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<string>(GRID_EVENTS[0]?.id ?? '333');
  const [selectedMetric, setSelectedMetric] = useState<MetricTab>('improvement');

  useEffect(() => {
    let cancelled = false;
    const monthStr = todayInClubTz().slice(0, 7); // "YYYY-MM"
    getMonthlyEventStats(monthStr)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { if (!cancelled) setStats({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Pure render-time filter over the single already-fetched result —
  // switching event/tab never triggers a new fetch.
  const rows = useMemo(() => {
    const eventStats = stats[selectedEvent];
    if (!eventStats) return [];
    if (selectedMetric === 'improvement') {
      return eventStats.improvement.map((r) => ({ name: r.athleteName, value: `-${r.improvementSeconds.toFixed(2)}s` }));
    }
    const list = selectedMetric === 'participation' ? eventStats.participation : eventStats.prCount;
    return list.map((r) => ({ name: r.athleteName, value: `${r.count} ${t('practice.grid.times-suffix')}` }));
  }, [stats, selectedEvent, selectedMetric, t]);

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: 'var(--bg)', color: 'var(--text)', padding: '1rem 1rem 3rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {loading ? (
          <div className="spinner-row"><span className="spinner-ring" /></div>
        ) : (
          <>
            {/* A. Featured Ranking panel */}
            <div className="card">
              <div className="card-title"><span className="title-accent" />{t('practice.rank.title')}</div>

              <div className="tab-nav">
                {METRIC_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={`tab-btn${selectedMetric === tab.id ? ' active' : ''}`}
                    onClick={() => setSelectedMetric(tab.id)}
                  >
                    {t(tab.labelKey)}
                  </button>
                ))}
              </div>

              {rows.length === 0 ? (
                <div className="pr-empty">{t('practice.grid.empty')}</div>
              ) : (
                <div className="pr-list">
                  {rows.map((r, i) => (
                    <div key={i} className="pr-row">
                      <span className="pr-rank">{i + 1}</span>
                      <span className="pr-name">{r.name}</span>
                      <span className="pr-value">{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* B. Horizontal event strip — selector only, no embedded data */}
            <div className="me-strip">
              {GRID_EVENTS.map((ev) => (
                <button
                  key={ev.id}
                  className={`me-pill${selectedEvent === ev.id ? ' active' : ''}`}
                  onClick={() => setSelectedEvent(ev.id)}
                >
                  <WcaEventIcon eventId={ev.id} size={16} />
                  <span>{ev.short}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <style>{`
        .pr-empty { font-size: 0.85rem; color: var(--muted); opacity: 0.7; padding: 1.5rem 0.2rem; text-align: center; }
        .pr-list { display: flex; flex-direction: column; }
        .pr-row {
          display: flex; align-items: center; gap: 0.8rem;
          padding: 0.65rem 0.2rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .pr-row:last-child { border-bottom: none; }
        .pr-rank {
          width: 28px; height: 28px; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 50%; background: rgba(124,58,237,0.12);
          font-weight: 800; font-size: 0.9rem; color: #a78bfa;
        }
        .pr-name {
          flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; font-size: 1rem; font-weight: 600; color: var(--text);
        }
        .pr-value {
          flex-shrink: 0; font-family: monospace; font-weight: 800;
          color: #a78bfa; font-size: 1.05rem;
        }

        .me-strip {
          display: flex; flex-wrap: nowrap; gap: 0.5rem;
          overflow-x: auto; -webkit-overflow-scrolling: touch;
          padding: 0.2rem 0.1rem 0.6rem;
          scrollbar-width: thin;
        }
        .me-pill {
          flex-shrink: 0;
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.5rem 0.9rem; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.1); background: transparent;
          color: var(--muted); font-size: 0.85rem; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: all 0.2s;
          white-space: nowrap;
        }
        .me-pill:hover { color: var(--text); border-color: rgba(124,58,237,0.4); }
        .me-pill.active {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          color: #fff; border-color: transparent;
        }
      `}</style>
    </div>
  );
}
