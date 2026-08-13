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
// Phase 7 note: this file's original data/state logic (getMonthlyEventStats
// fetch, HIDDEN_GRID_EVENTS exclusion, selectedEvent/selectedMetric state) is
// unchanged from Phase 5d.
//
// Phase 8: below the Featured Ranking card, added a Club Leaderboard card
// (best Ao5/30d for selectedEvent, inline fetch via getPracticeLeaderboard —
// tabbed together with the cross-event Streak Leaderboard as of a later
// pass, see the "Best Times"/"Streaks" tabs below) and a "This Month's
// Activity" card driven by getMonthlyActivityTrend + MonthlyActivityGrid
// (a calendar-month heatmap — an earlier bar-chart version didn't read
// well with only 1-2 non-zero days in a month). The event strip moved
// above the Ranking card since it now filters most widgets below it
// (Streaks is the one exception — cross-event by nature). PracticeEntryPanel
// remains self-entry-only, still used from components/admin/PracticeEntryTab
// (not this page) — PracticeComparisonWidget, by contrast, is reused here
// too, inside the Personal Stats modal (see further down).
//
// Content is club-wide and already publicly readable (practiceSessions
// Firestore rule is `allow read: if true`), so this page has no auth guard
// — only the nav link to it is login-gated (see Navbar.tsx).

import { useEffect, useMemo, useState } from 'react';
import { WCA_EVENTS } from '@/lib/wca-events';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import {
  getMonthlyEventStats, getMonthlyActivityTrend, getTodaysSessionsForEvent, getStreakLeaderboard,
  getPracticeLeaderboard, getPracticeComparison, todayInClubTz,
} from '@/lib/firebase/services/practiceSessions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import MonthlyActivityGrid from '@/components/practice/MonthlyActivityGrid';
import PracticeComparisonWidget from '@/components/practice/PracticeComparisonWidget';
import PracticeHeatMap from '@/components/practice/PracticeHeatMap';
import PracticeTrendChart from '@/components/practice/PracticeTrendChart';
import { fmtMs } from '@/lib/timer-engine';
import { useLang, type TranslationKey } from '@/lib/i18n';
import type { Athlete } from '@/lib/types';
import type { PracticeSession } from '@/lib/types/practice';

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

  const [activity, setActivity] = useState<{ date: string; count: number }[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  // Re-fetched per selectedEvent, same as the Leaderboard tab's fetch below —
  // a second query over largely the same month's docs getMonthlyEventStats
  // already pulled, traded for keeping this aggregation decoupled/reusable.
  useEffect(() => {
    let cancelled = false;
    setActivityLoading(true);
    const monthStr = todayInClubTz().slice(0, 7);
    getMonthlyActivityTrend(monthStr, selectedEvent)
      .then((a) => { if (!cancelled) setActivity(a); })
      .catch(() => { if (!cancelled) setActivity([]); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
  }, [selectedEvent]);

  const [todaysSessions, setTodaysSessions] = useState<(PracticeSession & { isPR: boolean })[]>([]);
  const [todaysLoading, setTodaysLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setTodaysLoading(true);
    getTodaysSessionsForEvent(selectedEvent)
      .then((s) => { if (!cancelled) setTodaysSessions(s); })
      .catch(() => { if (!cancelled) setTodaysSessions([]); })
      .finally(() => { if (!cancelled) setTodaysLoading(false); });
    return () => { cancelled = true; };
  }, [selectedEvent]);

  // Leaderboard + Streak now share one card via tabs (see JSX below) —
  // fetch moved here from the old PracticeLeaderboardWidget's own effect
  // (same getPracticeLeaderboard call, same event-dependency, zero new
  // queries) so both tabs' rows can render inline without nesting two
  // self-titled components.
  const [leaderboardTab, setLeaderboardTab] = useState<'times' | 'streaks'>('times');
  const [leaderboardRows, setLeaderboardRows] = useState<{ athleteId: string; athleteName: string; bestAo5: number; date: string; isPR: boolean }[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLeaderboardLoading(true);
    getPracticeLeaderboard(selectedEvent, 30)
      .then((r) => { if (!cancelled) setLeaderboardRows(r); })
      .catch(() => { if (!cancelled) setLeaderboardRows([]); })
      .finally(() => { if (!cancelled) setLeaderboardLoading(false); });
    return () => { cancelled = true; };
  }, [selectedEvent]);

  const [streakLeaders, setStreakLeaders] = useState<{ athleteId: string; athleteName: string; currentStreak: number; lastPracticeDate: string }[]>([]);
  const [streakLoading, setStreakLoading] = useState(true);

  // Club-wide, cross-event — fetched once on mount, NOT re-run on
  // selectedEvent change (this is the one card that ignores the event
  // strip; a streak counts any event practiced on a given day).
  useEffect(() => {
    let cancelled = false;
    getStreakLeaderboard(90)
      .then((s) => { if (!cancelled) setStreakLeaders(s); })
      .catch(() => { if (!cancelled) setStreakLeaders([]); })
      .finally(() => { if (!cancelled) setStreakLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Athlete View (Option B: additive, opt-in section) ──────────────────
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  useEffect(() => {
    getAthletes().then(setAthletes).catch(() => {});
  }, []);

  const [selectedAthleteId, setSelectedAthleteId] = useState('');
  const [trendPoints, setTrendPoints] = useState<{ date: string; value: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  // Duplicate fetch vs PracticeComparisonWidget's own getPracticeComparison
  // call, accepted deliberately — that widget doesn't expose its `.trend`
  // field, and this only fires for one explicitly-selected athlete, not a
  // roster-wide fan-out.
  useEffect(() => {
    if (!selectedAthleteId) { setTrendPoints([]); return; }
    let cancelled = false;
    setTrendLoading(true);
    getPracticeComparison(selectedAthleteId, selectedEvent)
      .then((c) => {
        if (cancelled) return;
        setTrendPoints(
          c.trend
            .filter((s): s is PracticeSession & { ao5: number } => s.ao5 !== null)
            .map((s) => ({ date: s.date, value: s.ao5 })),
        );
      })
      .catch(() => { if (!cancelled) setTrendPoints([]); })
      .finally(() => { if (!cancelled) setTrendLoading(false); });
    return () => { cancelled = true; };
  }, [selectedAthleteId, selectedEvent]);

  // Personal Stats modal — picker stays inline/tiny; only the 3-widget
  // combo (which used to sit in normal document flow) moves into the
  // modal, which is what actually shrinks the page's default height.
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);

  useEffect(() => {
    if (!isStatsModalOpen) return;
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsStatsModalOpen(false); };
    document.addEventListener('keydown', keyHandler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keyHandler);
      document.body.style.overflow = '';
    };
  }, [isStatsModalOpen]);

  // Pure render-time filter over the single already-fetched result —
  // switching event/tab never triggers a new fetch.
  const rows = useMemo(() => {
    const eventStats = stats[selectedEvent];
    if (!eventStats) return [];
    if (selectedMetric === 'improvement') {
      return eventStats.improvement.map((r) => ({ name: r.athleteName, value: `-${r.improvementSeconds.toFixed(2)}s`, isPR: r.isPR }));
    }
    const list = selectedMetric === 'participation' ? eventStats.participation : eventStats.prCount;
    // Every row on the "Most PRs" tab has isPR === true by definition —
    // showing the chip there would be redundant, so it's suppressed only
    // for that tab (participation still shows it normally).
    return list.map((r) => ({ name: r.athleteName, value: `${r.count} ${t('practice.grid.times-suffix')}`, isPR: selectedMetric === 'prCount' ? false : r.isPR }));
  }, [stats, selectedEvent, selectedMetric, t]);

  const selectedEventMeta = GRID_EVENTS.find((ev) => ev.id === selectedEvent);

  return (
    <div className="pr-page">
      <div className="pr-container">
        {/* Event strip now sits at the top — it filters the Ranking card,
            Leaderboard, and Activity trend below all at once. */}
        <div className="es-wrap">
          <div className="es-fade es-fade-left" aria-hidden />
          <div className="es-fade es-fade-right" aria-hidden />
          <div className="es-strip">
            {GRID_EVENTS.map((ev) => (
              <button
                key={ev.id}
                className={`es-pill${selectedEvent === ev.id ? ' active' : ''}`}
                onClick={() => setSelectedEvent(ev.id)}
                title={ev.name}
                aria-label={ev.name}
              >
                <WcaEventIcon eventId={ev.id} size={19} />
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="spinner-row"><span className="spinner-ring" /></div>
        ) : (
          <>
            {/* A. Featured Ranking panel */}
            <div className="pr-card">
              <div className="pr-card-title">
                <span className="pr-title-accent" />
                {t('practice.rank.title')}
                {selectedEventMeta && <span className="pr-card-subtitle">· {selectedEventMeta.name}</span>}
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
                          {r.isPR && (
                            <span style={{
                              flexShrink: 0, fontSize: '0.6rem', fontWeight: 900,
                              padding: '1px 5px', borderRadius: 4, letterSpacing: '0.03em',
                              background: '#b45309', color: '#fef3c7', border: '1px solid #f59e0b',
                            }}>PR</span>
                          )}
                          <span className="pr-value">{r.value}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* B. Leaderboard + a right column stacking this month's activity
                above today's roster, side by side with Leaderboard on desktop */}
            <div className="pr-below-grid">
              <div className="pr-card">
                <div className="pr-card-title">
                  <span className="pr-title-accent" />
                  {t('practice.lb.title')}
                  <span className="pr-card-subtitle">
                    {leaderboardTab === 'streaks' ? t('practice.streaklb.subtitle') : t('practice.lb.subtitle-times')}
                  </span>
                </div>

                <div className="pr-tabs" style={{ marginBottom: '0.9rem' }}>
                  <button
                    className={`pr-tab${leaderboardTab === 'times' ? ' active' : ''}`}
                    onClick={() => setLeaderboardTab('times')}
                  >
                    {t('practice.lb.tab-times')}
                  </button>
                  <button
                    className={`pr-tab${leaderboardTab === 'streaks' ? ' active' : ''}`}
                    onClick={() => setLeaderboardTab('streaks')}
                  >
                    {t('practice.lb.tab-streaks')}
                  </button>
                </div>

                {leaderboardTab === 'times' ? (
                  leaderboardLoading ? (
                    <div className="spinner-row"><span className="spinner-ring" /></div>
                  ) : leaderboardRows.length === 0 ? (
                    <div className="pr-empty">
                      <span>{t('practice.lb.empty')}</span>
                    </div>
                  ) : (
                    <div className="pr-list">
                      {leaderboardRows.map((r, i) => {
                        const badge = RANK_BADGE[i] ?? RANK_BADGE[2];
                        return (
                          <div key={r.athleteId} className="pr-row">
                            <span
                              className="pr-rank"
                              style={{ background: badge.bg, borderColor: badge.border, color: badge.fg }}
                            >
                              {i + 1}
                            </span>
                            <span className="pr-name">{r.athleteName}</span>
                            {r.isPR && (
                              <span style={{
                                flexShrink: 0, fontSize: '0.6rem', fontWeight: 900,
                                padding: '1px 5px', borderRadius: 4, letterSpacing: '0.03em',
                                background: '#b45309', color: '#fef3c7', border: '1px solid #f59e0b',
                              }}>PR</span>
                            )}
                            <span style={{ flexShrink: 0, fontSize: '0.7rem', color: 'var(--muted)' }}>{r.date}</span>
                            <span className="pr-value">{fmtMs(r.bestAo5)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  streakLoading ? (
                    <div className="spinner-row"><span className="spinner-ring" /></div>
                  ) : streakLeaders.length === 0 ? (
                    <div className="pr-empty">
                      <span>{t('practice.streaklb.empty')}</span>
                    </div>
                  ) : (
                    <div className="pr-list">
                      {streakLeaders.slice(0, 5).map((r, i) => {
                        const badge = RANK_BADGE[i] ?? RANK_BADGE[2];
                        return (
                          <div key={r.athleteId} className="pr-row">
                            <span
                              className="pr-rank"
                              style={{ background: badge.bg, borderColor: badge.border, color: badge.fg }}
                            >
                              {i + 1}
                            </span>
                            <span className="pr-name">{r.athleteName}</span>
                            <span className="pr-value">{r.currentStreak} {t('practice.streak.days-suffix')}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>

              <div className="pr-activity-col">
                <div className="pr-card pr-activity-card">
                  <div className="pr-card-title">
                    <span className="pr-title-accent" />
                    {t('practice.activity.title')}
                    <span className="pr-card-subtitle">{t('practice.activity.caption')}</span>
                  </div>
                  {activityLoading ? (
                    <div className="spinner-row"><span className="spinner-ring" /></div>
                  ) : (
                    <MonthlyActivityGrid monthStr={todayInClubTz().slice(0, 7)} points={activity} />
                  )}
                </div>

                <div className="pr-card pr-today-card">
                  <div className="pr-card-title">
                    <span className="pr-title-accent" />
                    {t('practice.today.title')}
                  </div>
                  {todaysLoading ? (
                    <div className="spinner-row"><span className="spinner-ring" /></div>
                  ) : todaysSessions.length === 0 ? (
                    <div className="pr-empty">
                      <span>{t('practice.today.empty')}</span>
                    </div>
                  ) : (
                    <div className="pr-list">
                      {todaysSessions.map((s) => (
                        <div key={s.id} className="pr-row">
                          <span className="pr-name">{s.athleteName}</span>
                          {s.isPR && (
                            <span style={{
                              flexShrink: 0, fontSize: '0.6rem', fontWeight: 900,
                              padding: '1px 5px', borderRadius: 4, letterSpacing: '0.03em',
                              background: '#b45309', color: '#fef3c7', border: '1px solid #f59e0b',
                            }}>PR</span>
                          )}
                          <span style={{ flexShrink: 0, fontSize: '0.7rem', color: 'var(--muted)' }}>{s.judgeName ?? '—'}</span>
                          <span className="pr-value">{fmtMs(s.ao5 ?? 0, s.ao5 === null)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* C. Athlete View — picker stays inline (tiny, ~one row);
                the actual stats combo now lives in a modal, not normal
                document flow, so nothing here adds page height. */}
            <div className="pr-card" style={{ marginTop: '1rem' }}>
              <div className="pr-card-title">
                <span className="pr-title-accent" />
                {t('practice.athlete.section-title')}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ maxWidth: 340, marginBottom: 0, flex: 1, minWidth: 220 }}>
                  <label>{t('practice.athlete.select-label')}</label>
                  <select
                    value={selectedAthleteId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedAthleteId(id);
                      setIsStatsModalOpen(!!id);
                    }}
                  >
                    <option value="">{t('practice.athlete.select-placeholder')}</option>
                    {[...athletes].sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
                      <option key={a.id} value={a.id}>{`${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`}</option>
                    ))}
                  </select>
                </div>
                {selectedAthleteId && !isStatsModalOpen && (
                  <button className="pr-tab active" style={{ flex: '0 0 auto' }} onClick={() => setIsStatsModalOpen(true)}>
                    {t('practice.athlete.view-stats')}
                  </button>
                )}
              </div>
            </div>

            {isStatsModalOpen && selectedAthleteId && (
              <div className="wca-modal-backdrop" onClick={() => setIsStatsModalOpen(false)}>
                <div className="pas-modal" onClick={(e) => e.stopPropagation()}>
                  <button className="pas-close" onClick={() => setIsStatsModalOpen(false)} aria-label="Close">✕</button>
                  <div className="pr-below-grid" style={{ marginTop: '2rem' }}>
                    <div className="pr-athlete-col">
                      <PracticeComparisonWidget athleteId={selectedAthleteId} event={selectedEvent} todayId={null} />
                      <PracticeHeatMap athleteId={selectedAthleteId} showScopeLabel />
                    </div>

                    <div className="pr-card">
                      <div className="pr-card-title">
                        <span className="pr-title-accent" />
                        {t('practice.trend.title')}
                      </div>
                      {trendLoading ? (
                        <div className="spinner-row"><span className="spinner-ring" /></div>
                      ) : (
                        <PracticeTrendChart points={trendPoints} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        .pr-page {
          background: var(--bg);
          color: var(--text);
          padding: 1.25rem 1rem 1rem;
        }
        /* Fluid width instead of a flat max-width — a fixed cap either
           wastes ~30-40% of the screen on a 1920px monitor or feels tight
           on a 1366px laptop; 92vw tracks the viewport so both ends of
           that range get a reasonable margin, capped at 1300px so it
           doesn't stretch indefinitely on ultra-wide screens (this page's
           widest deliberate content, .pr-panel-body, is self-capped at
           640px anyway). */
        .pr-container {
          width: min(92vw, 1300px);
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
          margin-bottom: 0.8rem;
        }
        .pr-card-subtitle {
          font-size: 0.7rem; font-weight: 500; color: var(--muted);
          letter-spacing: -0.01em;
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
        .pr-panel-body { min-height: 140px; max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; }
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
          padding: 0.25rem 0.15rem 0.25rem;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .es-strip::-webkit-scrollbar { display: none; }
        .es-fade {
          position: absolute; top: 0; bottom: 0.7rem; width: 28px;
          pointer-events: none; z-index: 2;
        }
        .es-fade-left { left: 0; background: linear-gradient(to right, var(--bg), transparent); }
        .es-fade-right { right: 0; background: linear-gradient(to left, var(--bg), transparent); }

        .es-pill {
          flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.03);
          color: var(--muted);
          cursor: pointer; font-family: inherit;
          transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
        }
        .es-pill:hover { color: var(--text); border-color: rgba(124,58,237,0.4); transform: translateY(-1px); }
        .es-pill.active {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          color: #fff; border-color: transparent;
          box-shadow: 0 6px 16px rgba(124,58,237,0.35);
        }

        /* ── Leaderboard + Activity row — asymmetric split, same idiom as
           /profile's .profile-stats-row/-side (fixed narrow column for the
           list-shaped widget, flexible wide column for the chart). ────── */
        .pr-below-grid {
          display: grid;
          grid-template-columns: minmax(300px, 420px) 1fr;
          gap: 1rem;
          margin-top: 1rem;
          align-items: start;
        }
        .pr-activity-col { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
        .pr-athlete-col { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }

        /* Personal Stats modal — reuses the global .wca-modal-backdrop
           (dimmed background, click-outside-to-close via stopPropagation
           on this inner card) but with its own wider content class
           instead of .wca-modal's 420px cap, sized for the 2-column
           Comparison+Heatmap / Trend layout. max-height + overflow-y so a
           short viewport scrolls inside the modal rather than growing
           past it. */
        .pas-modal {
          position: relative;
          width: min(92vw, 960px);
          max-height: 90vh;
          overflow-y: auto;
          background: var(--card, #1a1730);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: 0 24px 60px rgba(0,0,0,0.7);
        }
        .pas-close {
          position: absolute; top: 1rem; right: 1rem; z-index: 1;
          background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px; color: var(--muted); cursor: pointer;
          font-family: inherit; min-width: 2.2rem; min-height: 2.2rem;
          display: flex; align-items: center; justify-content: center;
          font-size: 1rem; transition: all 0.2s;
        }
        .pas-close:hover { border-color: rgba(124,58,237,0.4); color: var(--text); }

        /* Today's Practice empty state only — .pr-empty's default padding
           (1.6rem) is sized for Featured Ranking's icon+text empty state;
           this shell is just one line of muted text, so it doesn't need
           as much air. Scoped to this card so Featured Ranking is untouched. */
        .pr-today-card .pr-empty { padding: 0.9rem 1rem; }

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
          .es-pill { width: 36px; height: 36px; }
          .pr-below-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
