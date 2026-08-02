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
// Phase 7 note: this file's data/state logic (getMonthlyEventStats fetch,
// HIDDEN_GRID_EVENTS exclusion, selectedEvent/selectedMetric state) is
// unchanged from Phase 5d — only the JSX/CSS below it was redone for a
// denser, glassier, more "premium" look. No new queries were added.
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

// Medal-tinted rank badge — only ranks 1-3 are ever shown (top 3), so this
// covers every case; the 4th fallback color is defensive only.
const RANK_BADGE = [
  { bg: 'rgba(251,191,36,0.16)', border: 'rgba(251,191,36,0.45)', fg: '#fbbf24' }, // gold
  { bg: 'rgba(203,213,225,0.14)', border: 'rgba(203,213,225,0.4)', fg: '#e2e8f0' }, // silver
  { bg: 'rgba(251,146,60,0.16)', border: 'rgba(251,146,60,0.45)', fg: '#fb923c' }, // bronze
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

  const selectedEventMeta = GRID_EVENTS.find((ev) => ev.id === selectedEvent);

  return (
    <div className="pr-page">
      <div className="pr-container">
        {loading ? (
          <div className="spinner-row"><span className="spinner-ring" /></div>
        ) : (
          <>
            {/* A. Featured Ranking panel */}
            <div className="pr-card">
              <div className="pr-card-title">
                <span className="pr-title-accent" />
                {t('practice.rank.title')}
              </div>

              <div className="pr-tabs">
                {METRIC_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={`pr-tab${selectedMetric === tab.id ? ' active' : ''}`}
                    onClick={() => setSelectedMetric(tab.id)}
                  >
                    {t(tab.labelKey)}
                  </button>
                ))}
              </div>

              {/* Keying on event+metric replays the entrance animation on
                  every switch — pure CSS, no extra render logic. */}
              <div key={`${selectedEvent}-${selectedMetric}`} className="pr-panel-body">
                {rows.length === 0 ? (
                  <div className="pr-empty">
                    <span className="pr-empty-icon" aria-hidden>
                      {selectedEventMeta && <WcaEventIcon eventId={selectedEventMeta.id} size={26} />}
                    </span>
                    <span>{t('practice.grid.empty')}</span>
                  </div>
                ) : (
                  <div className="pr-list">
                    {rows.map((r, i) => {
                      const badge = RANK_BADGE[i] ?? RANK_BADGE[2];
                      return (
                        <div key={i} className="pr-row">
                          <span
                            className="pr-rank"
                            style={{ background: badge.bg, borderColor: badge.border, color: badge.fg }}
                          >
                            {i + 1}
                          </span>
                          <span className="pr-name">{r.name}</span>
                          <span className="pr-value">{r.value}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* B. Horizontal event strip — selector only, no embedded data */}
            <div className="es-wrap">
              <div className="es-fade es-fade-left" aria-hidden />
              <div className="es-fade es-fade-right" aria-hidden />
              <div className="es-strip">
                {GRID_EVENTS.map((ev) => (
                  <button
                    key={ev.id}
                    className={`es-pill${selectedEvent === ev.id ? ' active' : ''}`}
                    onClick={() => setSelectedEvent(ev.id)}
                  >
                    <WcaEventIcon eventId={ev.id} size={19} />
                    <span>{ev.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        .pr-page {
          background: var(--bg);
          color: var(--text);
          padding: 1.25rem 2rem 3rem;
        }
        /* Dashboard-width container — matches app/admin/dashboard's
           maxWidth: 1380 rather than the narrow single-column measure
           used on text-heavy pages (e.g. /profile's 600px). */
        .pr-container {
          max-width: 1380px;
          margin: 0 auto;
        }

        /* ── Featured Ranking card — glassmorphism, same recipe as the
           login card / navbar (rgba surface + backdrop-blur), just tuned
           to this page's dark surface token instead of inventing a new
           palette. ────────────────────────────────────────────────── */
        .pr-card {
          background: rgba(19, 19, 37, 0.62);
          -webkit-backdrop-filter: blur(20px);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          padding: 1.35rem 1.35rem 1rem;
          box-shadow: 0 20px 50px rgba(0,0,0,0.35);
        }
        html[data-theme="soft-light"] .pr-card,
        html[data-theme="purple-light"] .pr-card {
          background: rgba(255,255,255,0.6);
          border-color: rgba(0,0,0,0.06);
        }
        .pr-card-title {
          display: flex; align-items: center; gap: 0.55rem;
          font-size: 1.05rem; font-weight: 800; color: var(--text-primary);
          margin-bottom: 1.1rem;
        }
        .pr-title-accent {
          width: 4px; height: 1.1em; border-radius: 2px;
          background: linear-gradient(180deg, var(--accent), var(--accent2));
          flex-shrink: 0;
        }

        /* Tab bar — same gradient-fill-active idea as the site's global
           .tab-nav/.tab-btn, sized up locally for this page rather than
           editing the shared admin classes (those are reused across every
           admin SectionTabs screen). inline-flex so the 3 tabs keep a
           natural, comfortable width instead of stretching edge-to-edge
           now that the card itself spans the wide container. */
        .pr-tabs {
          display: inline-flex; gap: 0.3rem;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 13px; padding: 0.3rem;
          margin-bottom: 0.9rem;
          max-width: 100%;
        }
        .pr-tab {
          flex: 1; min-width: 0;
          padding: 0.65rem 1.4rem; border: none; border-radius: 10px;
          background: transparent; color: var(--muted);
          font-size: 0.82rem; font-weight: 600; letter-spacing: -0.01em;
          cursor: pointer; font-family: inherit;
          transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease;
          /* Mongolian labels run longer than the English originals — wrap
             to a 2nd line rather than clipping with an ellipsis. */
          white-space: normal; text-align: center; line-height: 1.25;
        }
        .pr-tab:hover { color: var(--text); background: rgba(255,255,255,0.06); }
        .pr-tab.active {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          color: #fff; font-weight: 700;
          box-shadow: 0 6px 16px rgba(124,58,237,0.35);
        }

        /* Card frame spans the wide container, but the actual rank list
           stays capped at a comfortable reading measure — a name/value
           pair stretched across 1300px+ reads as broken, not spacious. */
        .pr-panel-body { min-height: 168px; max-width: 640px; display: flex; flex-direction: column; justify-content: center; }
        @keyframes prFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .pr-panel-body { animation: prFadeIn 200ms ease-out; }

        .pr-empty {
          display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
          padding: 1.6rem 1rem; text-align: center;
          color: var(--muted); font-size: 0.86rem;
        }
        .pr-empty-icon {
          width: 44px; height: 44px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.04); opacity: 0.7;
        }

        .pr-list { display: flex; flex-direction: column; }
        .pr-row {
          display: flex; align-items: center; gap: 0.85rem;
          padding: 0.65rem 0.5rem;
          border-radius: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          transition: background 0.15s ease;
        }
        .pr-row:hover { background: rgba(124,58,237,0.06); }
        .pr-row:last-child { border-bottom: none; }
        .pr-rank {
          width: 34px; height: 34px; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 50%; border: 1px solid;
          font-weight: 800; font-size: 0.95rem;
        }
        .pr-name {
          flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; font-size: 0.98rem; font-weight: 600; color: var(--text);
        }
        .pr-value {
          flex-shrink: 0; font-family: monospace; font-weight: 800;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
          font-size: 1.05rem;
        }

        /* ── Event strip ──────────────────────────────────────────────── */
        .es-wrap { position: relative; margin-top: 1rem; }
        .es-strip {
          display: flex; flex-wrap: nowrap; gap: 0.55rem;
          overflow-x: auto; -webkit-overflow-scrolling: touch;
          padding: 0.25rem 0.15rem 0.7rem;
          scrollbar-width: thin;
        }
        .es-fade {
          position: absolute; top: 0; bottom: 0.7rem; width: 28px;
          pointer-events: none; z-index: 2;
        }
        .es-fade-left { left: 0; background: linear-gradient(to right, var(--bg), transparent); }
        .es-fade-right { right: 0; background: linear-gradient(to left, var(--bg), transparent); }

        .es-pill {
          flex-shrink: 0;
          display: inline-flex; align-items: center; gap: 0.55rem;
          padding: 0.68rem 1.3rem; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.03);
          color: var(--muted); font-size: 0.86rem; font-weight: 600;
          cursor: pointer; font-family: inherit;
          transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
          white-space: nowrap;
        }
        .es-pill:hover { color: var(--text); border-color: rgba(124,58,237,0.4); transform: translateY(-1px); }
        .es-pill.active {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          color: #fff; border-color: transparent;
          box-shadow: 0 6px 16px rgba(124,58,237,0.35);
        }

        @media (max-width: 480px) {
          .pr-page { padding: 1rem 0.7rem 2.5rem; }
          .pr-card { padding: 1.05rem 1rem 0.85rem; border-radius: 16px; }
          .pr-card-title { font-size: 0.98rem; }
          /* Narrow viewport: back to full-width equal-fill tabs — natural
             sizing risks cramping/overflow at this width. */
          .pr-tabs { display: flex; width: 100%; }
          .pr-tab { font-size: 0.74rem; padding: 0.55rem 0.35rem; }
          .pr-rank { width: 30px; height: 30px; font-size: 0.85rem; }
          .pr-name { font-size: 0.9rem; }
          .pr-value { font-size: 0.95rem; }
          .es-pill { padding: 0.55rem 0.85rem; font-size: 0.8rem; }
        }
      `}</style>
    </div>
  );
}
