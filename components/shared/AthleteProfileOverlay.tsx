'use client';

import { useEffect, useState, useMemo } from 'react';
import { getResultsByAthlete } from '@/lib/firebase/services/results';
import { getCompetitions } from '@/lib/firebase/services/competitions';
import { getResultRecordBadges } from '@/lib/record-badges';
import { useWcaRecords } from '@/lib/hooks/useWcaRecords';
import { fmtTime, formatDate } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Athlete, Result, Competition } from '@/lib/types';
import type { RecordBadge } from '@/lib/record-badges';

// ── helpers ─────────────────────────────────────────────────────────────────

function getRoundLabel(roundNum: number, totalRounds: number): string {
  if (totalRounds === 1) return 'Final';
  if (roundNum === totalRounds) return 'Final';
  if (totalRounds === 4 && roundNum === 3) return 'Semi Final';
  const names: Record<number, string> = { 1: 'First Round', 2: 'Second Round', 3: 'Third Round' };
  return names[roundNum] ?? `Round ${roundNum}`;
}

function wcaSort(a: Result, b: Result) {
  const s = (r: Result): [number, number] => {
    const avg = r.average != null && r.average > 0 ? r.average : null;
    const sng = r.single != null && r.single > 0 ? r.single : null;
    return [avg ?? Infinity, sng ?? Infinity];
  };
  const [pa, sa] = s(a), [pb, sb] = s(b);
  return pa !== pb ? pa - pb : sa - sb;
}

function toSortableDate(ts: unknown): number {
  if (!ts) return 0;
  if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function')
    return (ts as { toDate: () => Date }).toDate().getTime();
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (typeof ts === 'number') return ts;
  return 0;
}

const BADGE_STYLES: Record<string, React.CSSProperties> = {
  WR: { background: '#b45309', color: '#fef3c7', border: '1px solid #f59e0b' },
  CR: { background: '#1d4ed8', color: '#dbeafe', border: '1px solid #60a5fa' },
  NR: { background: '#166534', color: '#dcfce7', border: '1px solid #4ade80' },
  TR: { background: '#4c1d95', color: '#ede9fe', border: '1px solid #a78bfa' },
};

const EVENT_ORDER = ['333', '222', 'pyram', 'skewb'];

// ── component ───────────────────────────────────────────────────────────────

interface Props {
  athlete: Athlete;
  onClose: () => void;
}

type Tab = 'history' | 'records' | 'medals';

export default function AthleteProfileOverlay({ athlete, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('history');
  const [allResults, setAllResults] = useState<Result[]>([]);
  const [allComps, setAllComps] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyEvent, setHistoryEvent] = useState<string | null>(null);
  const [solvesPopup, setSolvesPopup] = useState<{ solves: (number | null)[]; x: number; y: number } | null>(null);
  const [badgePopup, setBadgePopup] = useState<string | null>(null);
  const [highlightResultId, setHighlightResultId] = useState<string | null>(null);
  const wcaRecords = useWcaRecords();

  const fullName = (athlete.name || '') + (athlete.lastName ? ' ' + athlete.lastName : '');
  const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // Fetch all results for this athlete + all competitions
  useEffect(() => {
    setLoading(true);
    Promise.all([
      getResultsByAthlete(athlete.id),
      getCompetitions(),
    ]).then(([res, comps]) => {
      setAllResults(res.filter(r => r.status === 'published'));
      setAllComps(comps);
      setLoading(false);
    });
  }, [athlete.id]);

  // Escape + scroll lock + click-outside for solves popup
  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (solvesPopup) setSolvesPopup(null);
        else if (badgePopup) setBadgePopup(null);
        else onClose();
      }
    };
    const clickHandler = () => {
      if (solvesPopup) setSolvesPopup(null);
      if (badgePopup) setBadgePopup(null);
    };
    document.addEventListener('keydown', keyHandler);
    document.addEventListener('click', clickHandler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keyHandler);
      document.removeEventListener('click', clickHandler);
      document.body.style.overflow = '';
    };
  }, [onClose, solvesPopup, badgePopup]);

  // Derived data
  const compMap = useMemo(() => {
    const m: Record<string, Competition> = {};
    allComps.forEach(c => { m[c.id] = c; });
    return m;
  }, [allComps]);

  const compNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    allComps.forEach(c => { m[c.id] = c.name; });
    return m;
  }, [allComps]);

  // Events this athlete has results for, sorted
  const athleteEvents = useMemo(() => {
    const ids = new Set(allResults.map(r => r.eventId));
    const evts = WCA_EVENTS.filter(e => ids.has(e.id));
    evts.sort((a, b) => {
      const ai = EVENT_ORDER.indexOf(a.id);
      const bi = EVENT_ORDER.indexOf(b.id);
      return (ai >= 0 ? ai : 100) - (bi >= 0 ? bi : 100);
    });
    return evts;
  }, [allResults]);

  // Auto-select first event
  useEffect(() => {
    if (athleteEvents.length > 0 && !historyEvent) {
      setHistoryEvent(athleteEvents[0].id);
    }
  }, [athleteEvents, historyEvent]);

  // Stats
  const stats = useMemo(() => {
    const compIds = new Set(allResults.map(r => r.competitionId));
    const eventIds = new Set(allResults.map(r => r.eventId));
    let totalSolves = 0;
    allResults.forEach(r => { totalSolves += (r.solves?.length || 0); });
    return { comps: compIds.size, events: eventIds.size, solves: totalSolves };
  }, [allResults]);

  // Medals (across all competitions)
  const medals = useMemo(() => {
    interface MedalItem {
      type: 'gold' | 'silver' | 'bronze';
      eventId: string; eventName: string;
      compId: string; compName: string; compDate: unknown;
      roundLabel: string; time: number | null; solves: (number | null)[];
    }
    const list: MedalItem[] = [];
    // Group all results by competition+event, find final rounds
    const compEventMap = new Map<string, Result[]>();
    // We need ALL results (not just this athlete) to determine placement.
    // But we only have this athlete's results. We'll use comp.athletes or determine from results.
    // Actually, for proper placement we need all results in the final round.
    // Since we only fetched this athlete's results, we need to check placement differently.
    // We'll look at the result's round and use the competition's eventConfig to identify final rounds.
    // However the simplest approach: for each competition, find all events, determine final round results.
    // We don't have other athletes' results here. Let's use a different approach:
    // Group by compId+eventId, take the highest round, then we need to know placement.
    // Since we can't determine placement from just this athlete's results, let's skip full placement logic
    // and instead check if the athlete was in top 3 by fetching per-comp results.
    // Actually that's too expensive. Let's fetch all results once (getAllResults is already in our results service).
    // But that could be heavy. For now, let's approximate: we'll mark medals based on actual placement
    // which requires competition results. Let's use a lazy approach - fetch per comp only when needed.
    // SIMPLIFICATION: We'll compute medals only from results we have by checking placement info if available.
    // The best approach: since we're inside a competition history overlay that already has results for ONE comp,
    // and this overlay can be opened outside that context, let's just do a light calculation.
    // We'll store medal info as "place unknown" and show events/times without placement.
    // Actually - let me reconsider. We DO have getResultsByComp. Let's not over-engineer.
    // We'll compute medals properly by grouping by comp and fetching all results per comp.
    // But that's N queries. For now, let's just show the competition history and skip placement in medals.
    // UPDATE: The user wants medals. Let's do it in a batch - we already have allComps.
    // The cleanest: just show "results where this athlete participated" grouped by comp for the medals tab,
    // and compute placement from allResults if we subscribe to all results.
    // For now: return empty, we'll fill this using a subscription.
    return { items: list, gold: 0, silver: 0, bronze: 0 };
  }, []);

  // Fetch all published results for placement/medal/record calculations
  const [globalResults, setGlobalResults] = useState<Result[] | null>(null);
  useEffect(() => {
    import('@/lib/firebase/services/results').then(mod => {
      mod.getAllResults().then(all => {
        setGlobalResults(all.filter(r => r.status === 'published'));
      });
    });
  }, []);

  // Compute medals from global results
  const medalData = useMemo(() => {
    if (!globalResults) return { items: [] as { type: 'gold' | 'silver' | 'bronze'; eventId: string; eventName: string; compId: string; compName: string; compDate: unknown; roundLabel: string; time: number | null; solves: (number | null)[] }[], gold: 0, silver: 0, bronze: 0 };
    type MedalItem = { type: 'gold' | 'silver' | 'bronze'; eventId: string; eventName: string; compId: string; compName: string; compDate: unknown; roundLabel: string; time: number | null; solves: (number | null)[] };
    const items: MedalItem[] = [];
    // Get all competitions this athlete participated in
    const myCompIds = new Set(allResults.map(r => r.competitionId));
    myCompIds.forEach(compId => {
      const comp = compMap[compId];
      const compResults = globalResults.filter(r => r.competitionId === compId);
      const eventIds = new Set(compResults.map(r => r.eventId));
      eventIds.forEach(eventId => {
        const evResults = compResults.filter(r => r.eventId === eventId);
        const maxRound = evResults.reduce((m, r) => Math.max(m, r.round || 1), 1);
        const finalResults = evResults.filter(r => (r.round || 1) === maxRound).sort(wcaSort);
        const totalRounds = comp?.eventConfig?.[eventId]?.rounds ?? maxRound;
        const rLabel = getRoundLabel(maxRound, totalRounds);
        finalResults.forEach((r, i) => {
          if (r.athleteId !== athlete.id) return;
          if (i > 2) return;
          const evName = WCA_EVENTS.find(e => e.id === eventId)?.name || eventId;
          items.push({
            type: i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze',
            eventId, eventName: evName,
            compId, compName: comp?.name || r.competitionName || compId,
            compDate: comp?.date || r.submittedAt,
            roundLabel: rLabel,
            time: r.average != null && r.average > 0 ? r.average : r.single,
            solves: r.solves ? [...r.solves] : [],
          });
        });
      });
    });
    // Sort by date descending
    items.sort((a, b) => toSortableDate(b.compDate) - toSortableDate(a.compDate));
    let gold = 0, silver = 0, bronze = 0;
    items.forEach(m => { if (m.type === 'gold') gold++; else if (m.type === 'silver') silver++; else bronze++; });
    return { items, gold, silver, bronze };
  }, [globalResults, allResults, compMap, athlete.id]);

  // Records: TR/NR/CR/WR for this athlete
  const recordData = useMemo(() => {
    interface RecItem {
      eventId: string; eventName: string; type: 'single' | 'average';
      badge: RecordBadge; time: number; compName: string; roundLabel: string;
      solves: (number | null)[];
    }
    const items: RecItem[] = [];
    if (!globalResults) return items;
    const seen = new Set<string>();
    allResults.forEach(r => {
      (['single', 'average'] as const).forEach(type => {
        const val = r[type];
        if (val == null || val <= 0 || val === -1 || val === -2) return;
        const badges = getResultRecordBadges(r.eventId, type, val, r.athleteId, globalResults, wcaRecords);
        const significant = badges.filter(b => b !== 'PR') as RecordBadge[];
        if (significant.length === 0) return;
        const best = significant[0]; // most prominent
        const key = `${r.eventId}-${type}`;
        if (seen.has(key)) return;
        seen.add(key);
        const evName = WCA_EVENTS.find(e => e.id === r.eventId)?.name || r.eventId;
        const comp = compMap[r.competitionId];
        const totalRounds = comp?.eventConfig?.[r.eventId]?.rounds ?? 1;
        items.push({
          eventId: r.eventId, eventName: evName, type, badge: best, time: val,
          compName: comp?.name || r.competitionName || r.competitionId || '—',
          roundLabel: getRoundLabel(r.round || 1, totalRounds),
          solves: r.solves ? [...r.solves] : [],
        });
      });
    });
    // Group by event order
    items.sort((a, b) => {
      const ai = EVENT_ORDER.indexOf(a.eventId);
      const bi = EVENT_ORDER.indexOf(b.eventId);
      const ap = ai >= 0 ? ai : 100;
      const bp = bi >= 0 ? bi : 100;
      if (ap !== bp) return ap - bp;
      return a.type === 'single' ? -1 : 1;
    });
    return items;
  }, [allResults, globalResults, wcaRecords, compMap]);

  // All record badges for header display (includes PR)
  interface BadgeDetail {
    badge: RecordBadge; eventId: string; eventName: string;
    type: 'single' | 'average'; time: number;
    compName: string; roundLabel: string;
  }
  const allBadgeData = useMemo(() => {
    const byBadge: Record<string, BadgeDetail[]> = { WR: [], CR: [], NR: [], TR: [], PR: [] };
    if (!globalResults) return byBadge;
    const seen = new Set<string>();
    allResults.forEach(r => {
      (['single', 'average'] as const).forEach(type => {
        const val = r[type];
        if (val == null || val <= 0 || val === -1 || val === -2) return;
        const badges = getResultRecordBadges(r.eventId, type, val, r.athleteId, globalResults, wcaRecords);
        const evName = WCA_EVENTS.find(e => e.id === r.eventId)?.name || r.eventId;
        const comp = compMap[r.competitionId];
        const maxRd = globalResults.filter(gr => gr.competitionId === r.competitionId && gr.eventId === r.eventId)
          .reduce((m, gr) => Math.max(m, gr.round || 1), 1);
        badges.forEach(b => {
          const key = `${b}-${r.eventId}-${type}`;
          if (seen.has(key)) return;
          seen.add(key);
          byBadge[b]?.push({
            badge: b, eventId: r.eventId, eventName: evName, type, time: val,
            compName: comp?.name || r.competitionName || r.competitionId || '—',
            roundLabel: getRoundLabel(r.round || 1, maxRd),
          });
        });
      });
    });
    return byBadge;
  }, [allResults, globalResults, wcaRecords, compMap]);

  // Per-result badge map: resultId → { single: best badge, average: best badge }
  const resultBadgesMap = useMemo(() => {
    const m: Record<string, { single: RecordBadge | null; average: RecordBadge | null }> = {};
    if (!globalResults) return m;
    allResults.forEach(r => {
      const entry = { single: null as RecordBadge | null, average: null as RecordBadge | null };
      (['single', 'average'] as const).forEach(type => {
        const val = r[type];
        if (val == null || val <= 0 || val === -1 || val === -2) return;
        const badges = getResultRecordBadges(r.eventId, type, val, r.athleteId, globalResults, wcaRecords);
        if (badges.length > 0) entry[type] = badges[0]; // most prominent
      });
      if (entry.single || entry.average) m[r.id] = entry;
    });
    return m;
  }, [allResults, globalResults, wcaRecords]);

  // Competition history for selected event, grouped by competition
  interface HistoryRow extends Result {
    compName: string; compDate: unknown; roundLabel: string; roundNum: number; maxRound: number; sortDate: number;
  }
  interface HistoryGroup {
    compId: string; compName: string; compDate: unknown; sortDate: number;
    rows: HistoryRow[];
  }
  const historyGroups = useMemo((): HistoryGroup[] => {
    if (!historyEvent) return [];
    const eventResults = allResults.filter(r => r.eventId === historyEvent);

    // Find max round per competition for this event (from ALL results, not just this athlete)
    const maxRoundPerComp: Record<string, number> = {};
    // Use global results if available for accurate max round, else use athlete's own
    const sourceForMax = globalResults ?? allResults;
    sourceForMax.forEach(r => {
      if (r.eventId !== historyEvent) return;
      const rd = r.round || 1;
      if (!maxRoundPerComp[r.competitionId] || rd > maxRoundPerComp[r.competitionId]) {
        maxRoundPerComp[r.competitionId] = rd;
      }
    });

    const rows: HistoryRow[] = eventResults.map(r => {
      const comp = compMap[r.competitionId];
      const totalRounds = maxRoundPerComp[r.competitionId] ?? 1;
      const roundNum = r.round || 1;
      return {
        ...r,
        compName: comp?.name || r.competitionName || r.competitionId || '—',
        compDate: comp?.date || r.submittedAt,
        roundLabel: getRoundLabel(roundNum, totalRounds),
        roundNum,
        maxRound: totalRounds,
        sortDate: toSortableDate(comp?.date || r.submittedAt),
      };
    });

    // Group by competition
    const groupMap = new Map<string, HistoryGroup>();
    rows.forEach(r => {
      let g = groupMap.get(r.competitionId);
      if (!g) {
        g = { compId: r.competitionId, compName: r.compName, compDate: r.compDate, sortDate: r.sortDate, rows: [] };
        groupMap.set(r.competitionId, g);
      }
      g.rows.push(r);
    });

    const groups = Array.from(groupMap.values());
    // Sort groups by date descending
    groups.sort((a, b) => b.sortDate - a.sortDate);
    // Sort rows within each group: highest round first (Final at top)
    groups.forEach(g => {
      g.rows.sort((a, b) => b.roundNum - a.roundNum);
    });
    return groups;
  }, [allResults, historyEvent, compMap, globalResults]);

  // Placement for history rows
  const placementMap = useMemo(() => {
    const m: Record<string, number> = {};
    if (!globalResults) return m;
    allResults.forEach(r => {
      if (r.eventId !== historyEvent) return;
      const roundResults = globalResults
        .filter(gr => gr.competitionId === r.competitionId && gr.eventId === r.eventId && (gr.round || 1) === (r.round || 1))
        .sort(wcaSort);
      const idx = roundResults.findIndex(gr => gr.athleteId === r.athleteId);
      if (idx >= 0) m[r.id] = idx + 1;
    });
    return m;
  }, [globalResults, allResults, historyEvent]);

  const openSolves = (e: React.MouseEvent, solves: (number | null)[]) => {
    if (!solves || solves.length === 0) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSolvesPopup({ solves, x: rect.left + rect.width / 2, y: rect.bottom + 4 });
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="apo-overlay">
      {/* Close button */}
      <button className="apo-close" onClick={onClose} aria-label="Close">✕</button>

      <div className="apo-scroll">
        {/* Header */}
        <div className="apo-header">
          {athlete.imageUrl ? (
            <img src={athlete.imageUrl} alt={fullName} className="apo-avatar" />
          ) : (
            <div className="apo-avatar apo-avatar-ph">{initials}</div>
          )}
          <div className="apo-name">{fullName}</div>
          <div className="apo-meta">
            {athlete.wcaId && <span className="apo-meta-item apo-wca">{athlete.wcaId}</span>}
            <span className="apo-meta-item">Mongolia</span>
            {athlete.birthDate && <span className="apo-meta-item">{athlete.birthDate}</span>}
          </div>

          {/* Stats: activity + medals side-by-side on desktop */}
          <div className="apo-stats-pair">
            <div className="apo-stats-row">
              <div className="apo-stat">
                <div className="apo-stat-num">{stats.comps}</div>
                <div className="apo-stat-label">Comps</div>
              </div>
              <div className="apo-stat">
                <div className="apo-stat-num">{stats.events}</div>
                <div className="apo-stat-label">Events</div>
              </div>
              <div className="apo-stat">
                <div className="apo-stat-num">{stats.solves}</div>
                <div className="apo-stat-label">Solves</div>
              </div>
            </div>
            <div className="apo-stats-row apo-stats-gold">
              <div className="apo-stat">
                <div className="apo-stat-num">🥇 {medalData.gold}</div>
                <div className="apo-stat-label">Gold</div>
              </div>
              <div className="apo-stat">
                <div className="apo-stat-num">🥈 {medalData.silver}</div>
                <div className="apo-stat-label">Silver</div>
              </div>
              <div className="apo-stat">
                <div className="apo-stat-num">🥉 {medalData.bronze}</div>
                <div className="apo-stat-label">Bronze</div>
              </div>
            </div>
          </div>

          {/* Record badge cards */}
          {(() => {
            const badges: { key: RecordBadge; label: string; sub: string }[] = [
              { key: 'WR', label: 'WR', sub: 'World' },
              { key: 'CR', label: 'CR', sub: 'Continental' },
              { key: 'NR', label: 'NR', sub: 'National' },
              { key: 'TR', label: 'TR', sub: 'Club' },
              { key: 'PR', label: 'PR', sub: 'Personal' },
            ];
            // Unique event IDs for the selected badge
            const badgeEventIds = badgePopup
              ? [...new Set((allBadgeData[badgePopup] ?? []).map(d => d.eventId))]
              : [];
            return (
              <>
                <div className="apo-bc-grid">
                  {badges.map(b => {
                    const count = allBadgeData[b.key]?.length ?? 0;
                    const active = count > 0;
                    const selected = badgePopup === b.key;
                    return (
                      <div
                        key={b.key}
                        className={`apo-bc${active ? ' apo-bc-active' : ' apo-bc-dim'} apo-bc-${b.key.toLowerCase()}${selected ? ' apo-bc-selected' : ''}`}
                        onClick={active ? (e) => { e.stopPropagation(); setBadgePopup(bp => bp === b.key ? null : b.key); } : undefined}
                      >
                        <span className={`apo-bc-label apo-bp-${b.key.toLowerCase()}`}>{b.label}</span>
                        <span className="apo-bc-num">{count}</span>
                        <span className="apo-bc-sub">{b.sub}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Event pills for the selected badge */}
                {badgePopup && badgeEventIds.length > 0 && (
                  <div className="apo-bc-events">
                    {badgeEventIds.map(eid => {
                      const ev = WCA_EVENTS.find(e => e.id === eid);
                      return (
                        <button
                          key={eid}
                          className={`apo-bc-ev-pill apo-bc-ev-${badgePopup.toLowerCase()}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const selectedBadge = badgePopup;
                            setHistoryEvent(eid);
                            setTab('history');
                            setBadgePopup(null);
                            // Find matching result(s) for this event+badge
                            const matches = allResults.filter(r => {
                              if (r.eventId !== eid) return false;
                              const rb = resultBadgesMap[r.id];
                              if (!rb) return false;
                              return rb.single === selectedBadge || rb.average === selectedBadge;
                            });
                            if (matches.length > 0) {
                              setHighlightResultId(matches[0].id);
                              setTimeout(() => setHighlightResultId(null), 3000);
                              setTimeout(() => {
                                document.getElementById(`apo-row-${matches[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }, 150);
                            }
                          }}
                        >{ev?.name || eid}</button>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Tabs */}
        <div className="apo-tabs">
          {([
            { key: 'history' as Tab, label: 'Competition History' },
            { key: 'records' as Tab, label: 'Records' },
            { key: 'medals' as Tab, label: 'Medals' },
          ]).map(t => (
            <button
              key={t.key}
              className={`apo-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >{t.label}</button>
          ))}
        </div>

        {/* Content */}
        <div className="apo-content">
          {loading ? (
            <div className="apo-loading"><div className="apo-spinner" /></div>
          ) : (
            <>
              {/* TAB 1: Competition History */}
              {tab === 'history' && (
                <div className="apo-tab-content">
                  {/* Event pills - centered */}
                  <div className="apo-event-pills" style={{ justifyContent: 'center' }}>
                    {athleteEvents.map(ev => (
                      <button
                        key={ev.id}
                        className={`apo-ep${historyEvent === ev.id ? ' active' : ''}`}
                        onClick={() => setHistoryEvent(ev.id)}
                      >{ev.name}</button>
                    ))}
                  </div>

                  {historyGroups.length === 0 ? (
                    <div className="apo-empty">No results for this event</div>
                  ) : (
                    <div className="apo-table-wrap">
                      <table className="apo-table apo-history-table">
                        <thead>
                          <tr>
                            <th>Round</th>
                            <th className="r">Place</th>
                            <th className="r">Single</th>
                            <th className="r">Average</th>
                            <th className="r">1</th><th className="r">2</th><th className="r">3</th><th className="r">4</th><th className="r">5</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyGroups.flatMap(g => {
                            const compLabelRow = (
                              <tr key={`comp-${g.compId}`} className="apo-comp-label-row">
                                <td colSpan={9} className="apo-comp-label-cell">
                                  <span className="apo-comp-label-text">Competition</span>
                                  <span className="apo-comp-label-name">{g.compName}</span>
                                </td>
                              </tr>
                            );
                            const dataRows = g.rows.map(r => {
                              const place = placementMap[r.id];
                              const isFinalRound = r.roundNum === r.maxRound;
                              const medalEmoji = isFinalRound && place != null && place <= 3
                                ? (place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉')
                                : '';
                              const solves = [...(r.solves ?? [])];
                              while (solves.length < 5) solves.push(null);
                              const rb = resultBadgesMap[r.id];
                              const isHighlighted = highlightResultId === r.id;
                              return (
                                <tr key={r.id} id={`apo-row-${r.id}`} className={isHighlighted ? 'apo-row-glow' : ''}>
                                  <td className="apo-td-round">{r.roundLabel}</td>
                                  <td className="apo-td-place r">
                                    {medalEmoji && <span className="apo-medal-emoji">{medalEmoji}</span>}
                                    {place || '—'}
                                  </td>
                                  <td className={`r mono apo-time-cell${r.single != null && r.single < 0 ? ' dnf' : ''}`}>
                                    {fmtTime(r.single)}
                                    {rb?.single && <span className={`apo-time-badge apo-tb-${rb.single.toLowerCase()}`}>{rb.single}</span>}
                                  </td>
                                  <td className={`r mono bold apo-time-cell${r.average != null && r.average < 0 ? ' dnf' : ''}`}>
                                    {fmtTime(r.average)}
                                    {rb?.average && <span className={`apo-time-badge apo-tb-${rb.average.toLowerCase()}`}>{rb.average}</span>}
                                  </td>
                                  {solves.slice(0, 5).map((s, i) => (
                                    <td key={i} className={`r mono solve${s !== null && s < 0 ? ' dnf' : ''}`}>{fmtTime(s)}</td>
                                  ))}
                                </tr>
                              );
                            });
                            return [compLabelRow, ...dataRows];
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Records */}
              {tab === 'records' && (
                <div className="apo-tab-content">
                  {(globalResults === null) ? (
                    <div className="apo-loading"><div className="apo-spinner" /></div>
                  ) : recordData.length === 0 ? (
                    <div className="apo-empty">No national/world records yet</div>
                  ) : (
                    <div className="apo-records-list">
                      {(() => {
                        let lastEvent = '';
                        return recordData.map((rd, i) => {
                          const showHeader = rd.eventId !== lastEvent;
                          lastEvent = rd.eventId;
                          return (
                            <div key={i}>
                              {showHeader && <div className="apo-rec-event-header">{rd.eventName}</div>}
                              <div className="apo-rec-row">
                                <span className="apo-rec-badge" style={BADGE_STYLES[rd.badge] || {}}>{rd.badge}</span>
                                <span className="apo-rec-type">{rd.type}</span>
                                <span className="apo-rec-time mono bold">{fmtTime(rd.time)}</span>
                                <span className="apo-rec-comp">{rd.compName}</span>
                                <span className="apo-rec-round">{rd.roundLabel}</span>
                                {rd.type === 'average' && rd.solves.length > 0 && (
                                  <span
                                    className="apo-rec-solves-btn"
                                    onClick={e => openSolves(e, rd.solves)}
                                  >solves</span>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Medals */}
              {tab === 'medals' && (
                <div className="apo-tab-content">
                  {(globalResults === null) ? (
                    <div className="apo-loading"><div className="apo-spinner" /></div>
                  ) : medalData.items.length === 0 ? (
                    <div className="apo-empty">No medals yet</div>
                  ) : (
                    <>
                      {/* Summary */}
                      <div className="apo-medal-summary">
                        <span>🥇 {medalData.gold}</span>
                        <span>🥈 {medalData.silver}</span>
                        <span>🥉 {medalData.bronze}</span>
                      </div>

                      {/* Group by competition */}
                      {(() => {
                        const groups: { compId: string; compName: string; compDate: unknown; items: typeof medalData.items }[] = [];
                        const gMap = new Map<string, typeof groups[0]>();
                        medalData.items.forEach(m => {
                          let g = gMap.get(m.compId);
                          if (!g) {
                            g = { compId: m.compId, compName: m.compName, compDate: m.compDate, items: [] };
                            gMap.set(m.compId, g);
                            groups.push(g);
                          }
                          g.items.push(m);
                        });
                        return groups.map(g => (
                          <div key={g.compId} className="apo-medal-group">
                            <div className="apo-medal-group-header">
                              <span className="apo-mg-name">{g.compName}</span>
                              <span className="apo-mg-date">{formatDate(g.compDate)}</span>
                            </div>
                            {g.items.map((m, i) => (
                              <div key={i} className="apo-medal-row">
                                <span className="apo-medal-icon">{m.type === 'gold' ? '🥇' : m.type === 'silver' ? '🥈' : '🥉'}</span>
                                <span className="apo-medal-ev">{m.eventName}</span>
                                <span className="apo-medal-round">{m.roundLabel}</span>
                                <span
                                  className={`apo-medal-time mono bold${m.solves.length > 0 ? ' apo-clickable' : ''}`}
                                  onClick={m.solves.length > 0 ? e => openSolves(e, m.solves) : undefined}
                                >{fmtTime(m.time)}</span>
                              </div>
                            ))}
                          </div>
                        ));
                      })()}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Solves popup */}
      {solvesPopup && (
        <div
          className="apo-solves-popup"
          style={{ left: solvesPopup.x, top: solvesPopup.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="apo-solves-row">
            {(solvesPopup.solves.length >= 5 ? solvesPopup.solves.slice(0, 5) : solvesPopup.solves).map((s, i) => {
              const valid = solvesPopup.solves.slice(0, 5).filter((v): v is number => v !== null && v > 0);
              const best = valid.length > 0 ? Math.min(...valid) : null;
              const isBest = s !== null && s > 0 && s === best;
              return (
                <span key={i} className={`apo-solve-cell${isBest ? ' best' : ''}${s !== null && s < 0 ? ' dnf' : ''}`}>
                  <span className="apo-solve-label">S{i + 1}</span>
                  <span className="apo-solve-val">{fmtTime(s)}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        .apo-overlay {
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          z-index: 10000; background: var(--bg);
          display: flex; flex-direction: column;
          animation: apoFadeIn 0.22s ease;
        }
        @keyframes apoFadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

        .apo-close {
          position: fixed; top: 0.8rem; right: 1rem; z-index: 10001;
          background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px; color: var(--muted); cursor: pointer;
          font-family: inherit; min-width: 2.5rem; min-height: 2.5rem;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.1rem; transition: all 0.2s; backdrop-filter: blur(4px);
        }
        .apo-close:hover { border-color: rgba(124,58,237,0.4); color: var(--text); }

        .apo-scroll { flex: 1; overflow-y: auto; }

        /* Header */
        .apo-header {
          display: flex; flex-direction: column; align-items: center;
          padding: 2.5rem 1.5rem 1.5rem; text-align: center;
          background: linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 100%);
        }
        .apo-avatar {
          width: 120px; height: 120px; border-radius: 50%; object-fit: cover;
          border: 3px solid rgba(124,58,237,0.3); margin-bottom: 1rem;
        }
        .apo-avatar-ph {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          display: flex; align-items: center; justify-content: center;
          font-size: 2.2rem; font-weight: 800; color: #fff;
        }
        .apo-name {
          font-size: 2rem; font-weight: 800; color: var(--text-primary);
          margin-bottom: 0.4rem;
        }
        .apo-meta { display: flex; gap: 0.6rem; flex-wrap: wrap; justify-content: center; margin-bottom: 1.2rem; }
        .apo-meta-item {
          font-size: 0.78rem; color: var(--muted);
          background: rgba(255,255,255,0.04); padding: 0.2rem 0.6rem;
          border-radius: 999px; border: 1px solid rgba(255,255,255,0.06);
        }
        .apo-wca { color: var(--accent); font-family: monospace; font-weight: 600; font-size: 0.95rem; }

        /* Stats rows */
        .apo-stats-pair {
          display: flex; gap: 0.6rem; width: 100%; max-width: 600px;
          align-items: stretch;
        }
        .apo-stats-row {
          display: flex; gap: 0; flex: 1;
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px; overflow: hidden;
        }
        .apo-stats-gold {
          border-color: rgba(250,204,21,0.15);
          background: rgba(250,204,21,0.04);
        }
        .apo-stat {
          flex: 1; padding: 1.2rem 1.5rem; text-align: center;
          border-right: 1px solid rgba(255,255,255,0.06);
        }
        .apo-stat:last-child { border-right: none; }
        .apo-stats-gold .apo-stat { border-right-color: rgba(250,204,21,0.1); }
        .apo-stat-num { font-size: 1.8rem; font-weight: 800; color: var(--text); font-family: monospace; }
        .apo-stat-label { font-size: 0.8rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 0.15rem; }

        /* Record badge cards */
        .apo-bc-grid {
          display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem;
          width: 100%; max-width: 560px; margin-top: 1rem;
        }
        .apo-bc {
          display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
          padding: 1rem 0.5rem; border-radius: 10px; min-width: 100px;
          border: 1px solid rgba(255,255,255,0.06);
          background: var(--card); transition: all 0.2s;
        }
        .apo-bc-active { cursor: pointer; }
        .apo-bc-active:hover { transform: translateY(-2px); }
        .apo-bc-dim { opacity: 0.35; }
        .apo-bc-selected { transform: translateY(-2px); }

        /* Per-badge glow colors */
        .apo-bc-active.apo-bc-wr { border-color: rgba(251,191,36,0.4); box-shadow: 0 0 12px rgba(251,191,36,0.15); }
        .apo-bc-active.apo-bc-cr { border-color: rgba(249,115,22,0.4); box-shadow: 0 0 12px rgba(249,115,22,0.15); }
        .apo-bc-active.apo-bc-nr { border-color: rgba(74,222,128,0.4); box-shadow: 0 0 12px rgba(74,222,128,0.15); }
        .apo-bc-active.apo-bc-tr { border-color: rgba(167,139,250,0.4); box-shadow: 0 0 12px rgba(167,139,250,0.15); }
        .apo-bc-active.apo-bc-pr { border-color: rgba(56,189,248,0.4); box-shadow: 0 0 12px rgba(56,189,248,0.15); }

        .apo-bc-label {
          font-size: 0.85rem; font-weight: 800; letter-spacing: 0.04em;
          padding: 3px 8px; border-radius: 4px; line-height: 1;
        }
        .apo-bp-wr { background: #b45309; color: #fef3c7; border: 1px solid #f59e0b; }
        .apo-bp-cr { background: #9a3412; color: #ffedd5; border: 1px solid #f97316; }
        .apo-bp-nr { background: #166534; color: #dcfce7; border: 1px solid #4ade80; }
        .apo-bp-tr { background: #4c1d95; color: #ede9fe; border: 1px solid #a78bfa; }
        .apo-bp-pr { background: #0e7490; color: #cffafe; border: 1px solid #22d3ee; }

        .apo-bc-num { font-size: 2rem; font-weight: 800; color: var(--text); font-family: monospace; line-height: 1; }
        .apo-bc-sub { font-size: 0.72rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }

        /* Badge event pills */
        .apo-bc-events {
          display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: center;
          width: 100%; max-width: 560px; margin-top: 0.6rem;
          animation: apoBcFade 0.2s ease;
        }
        @keyframes apoBcFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        .apo-bc-ev-pill {
          padding: 0.3rem 0.7rem; border-radius: 999px; font-size: 0.78rem; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: all 0.2s;
          border: 1px solid; background: transparent;
        }
        .apo-bc-ev-pill:hover { transform: translateY(-1px); }
        .apo-bc-ev-wr { color: #fbbf24; border-color: rgba(251,191,36,0.4); }
        .apo-bc-ev-wr:hover { background: rgba(251,191,36,0.12); }
        .apo-bc-ev-cr { color: #f97316; border-color: rgba(249,115,22,0.4); }
        .apo-bc-ev-cr:hover { background: rgba(249,115,22,0.12); }
        .apo-bc-ev-nr { color: #4ade80; border-color: rgba(74,222,128,0.4); }
        .apo-bc-ev-nr:hover { background: rgba(74,222,128,0.12); }
        .apo-bc-ev-tr { color: #a78bfa; border-color: rgba(167,139,250,0.4); }
        .apo-bc-ev-tr:hover { background: rgba(167,139,250,0.12); }
        .apo-bc-ev-pr { color: #38bdf8; border-color: rgba(56,189,248,0.4); }
        .apo-bc-ev-pr:hover { background: rgba(56,189,248,0.12); }

        /* Tabs */
        .apo-tabs {
          display: grid; grid-template-columns: 1fr 1fr 1fr;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          position: sticky; top: 0; z-index: 5; background: var(--bg);
        }
        .apo-tab {
          padding: 1rem 0.5rem; background: none; border: none;
          font-size: 1rem; font-weight: 600; color: var(--muted);
          cursor: pointer; font-family: inherit; transition: all 0.2s;
          border-bottom: 3px solid transparent; white-space: nowrap;
          text-align: center;
        }
        .apo-tab:hover { color: var(--text); background: rgba(255,255,255,0.02); }
        .apo-tab.active { color: #a78bfa; border-bottom-color: var(--accent); }

        /* Content */
        .apo-content { min-height: 300px; }
        .apo-tab-content { padding: 1.5rem; max-width: 1000px; margin: 0 auto; }
        .apo-loading { display: flex; align-items: center; justify-content: center; padding: 3rem; }
        .apo-spinner {
          width: 28px; height: 28px; border-radius: 50%;
          border: 3px solid rgba(124,58,237,0.2); border-top-color: var(--accent);
          animation: apoSpin 0.8s linear infinite;
        }
        @keyframes apoSpin { to { transform: rotate(360deg); } }
        .apo-empty { text-align: center; padding: 3rem 1rem; color: var(--muted); font-size: 0.88rem; }

        /* Event pills */
        .apo-event-pills {
          display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 1rem;
        }
        .apo-ep {
          padding: 0.4rem 1rem; border-radius: 999px; font-size: 0.9rem; font-weight: 600;
          border: 1px solid rgba(255,255,255,0.1); background: transparent; color: var(--muted);
          cursor: pointer; font-family: inherit; transition: all 0.2s;
        }
        .apo-ep:hover { color: var(--text); border-color: rgba(124,58,237,0.4); }
        .apo-ep.active { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; border-color: transparent; }

        /* Table */
        .apo-table-wrap { overflow-x: auto; }
        .apo-table { width: 100%; border-collapse: collapse; font-size: 1rem; }
        .apo-table th {
          text-align: left; padding: 0.8rem 1rem; font-size: 0.8rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted);
          border-bottom: 2px solid rgba(255,255,255,0.07); white-space: nowrap;
          position: sticky; top: 0; background: var(--bg); z-index: 2;
        }
        .apo-table th.r, .apo-table td.r { text-align: right; }
        .apo-table td { padding: 0.8rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
        .apo-table tr:hover td { background: rgba(124,58,237,0.05); }
        .apo-table .mono { font-family: monospace; font-size: 1.05rem; }
        .apo-table .bold { font-weight: 700; color: #a78bfa; }
        .apo-table .dnf { color: #f87171; }
        .apo-table .solve { color: var(--muted); font-size: 0.92rem; }

        /* History table: competition label row */
        .apo-comp-label-row td { border-bottom: none; }
        .apo-comp-label-cell {
          padding: 0.6rem 0.8rem 0.25rem !important;
          background: rgba(124,58,237,0.04);
          border-top: 1px solid rgba(124,58,237,0.12);
        }
        .apo-comp-label-text {
          font-size: 0.65rem; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--muted); margin-right: 0.5rem;
        }
        .apo-comp-label-name {
          font-size: 0.88rem; font-weight: 700; color: #c4b5fd;
          cursor: pointer; transition: color 0.2s;
        }
        .apo-comp-label-name:hover { color: #e0d4ff; text-decoration: underline; }
        .apo-td-round { color: var(--muted); white-space: nowrap; }
        .apo-td-place { font-weight: 700; font-size: 1rem; }
        .apo-medal-emoji { margin-right: 0.15rem; }

        /* Time cell with record badge */
        .apo-time-cell { position: relative; }
        .apo-time-badge {
          position: absolute; top: -4px; right: -4px; z-index: 2;
          font-size: 0.6rem; font-weight: 900; letter-spacing: 0.03em;
          padding: 2px 4px; border-radius: 3px; line-height: 1;
        }
        .apo-tb-wr { background: #b45309; color: #fef3c7; border: 1px solid #f59e0b; }
        .apo-tb-cr { background: #9a3412; color: #ffedd5; border: 1px solid #f97316; }
        .apo-tb-nr { background: #166534; color: #dcfce7; border: 1px solid #4ade80; }
        .apo-tb-tr { background: #4c1d95; color: #ede9fe; border: 1px solid #a78bfa; }
        .apo-tb-pr { background: #0e7490; color: #cffafe; border: 1px solid #22d3ee; }

        /* Row glow highlight */
        .apo-row-glow td { animation: apoRowGlow 0.8s ease 3; }
        @keyframes apoRowGlow {
          0%, 100% { background: transparent; }
          50% { background: rgba(124,58,237,0.15); }
        }

        /* Records */
        .apo-records-list { display: flex; flex-direction: column; gap: 0.2rem; }
        .apo-rec-event-header {
          font-size: 0.9rem; font-weight: 700; color: var(--text);
          padding: 0.8rem 0 0.3rem; border-bottom: 1px solid rgba(255,255,255,0.06);
          margin-bottom: 0.3rem;
        }
        .apo-rec-event-header:first-child { padding-top: 0; }
        .apo-rec-row {
          display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
          padding: 0.45rem 0.6rem; border-radius: 8px;
          background: rgba(255,255,255,0.02);
        }
        .apo-rec-badge {
          font-size: 0.58rem; font-weight: 900; letter-spacing: 0.04em;
          padding: 2px 5px; border-radius: 4px; flex-shrink: 0;
        }
        .apo-rec-type {
          font-size: 0.75rem; font-weight: 600; color: var(--muted);
          min-width: 48px; text-transform: capitalize;
        }
        .apo-rec-time { font-size: 0.92rem; }
        .apo-rec-comp { font-size: 0.75rem; color: var(--muted); }
        .apo-rec-round { font-size: 0.72rem; color: var(--muted); opacity: 0.7; }
        .apo-rec-solves-btn {
          font-size: 0.68rem; color: var(--accent); cursor: pointer;
          border-bottom: 1px dashed rgba(167,139,250,0.4); padding-bottom: 1px;
        }
        .apo-rec-solves-btn:hover { color: #c4b5fd; }

        /* Medals */
        .apo-medal-summary {
          display: flex; gap: 1.5rem; justify-content: center;
          font-size: 1.1rem; font-weight: 700; margin-bottom: 1.2rem;
          padding: 0.8rem; background: rgba(250,204,21,0.04);
          border: 1px solid rgba(250,204,21,0.12); border-radius: 10px;
        }
        .apo-medal-group { margin-bottom: 1rem; }
        .apo-medal-group-header {
          display: flex; align-items: baseline; gap: 0.6rem;
          padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.06);
          margin-bottom: 0.3rem;
        }
        .apo-mg-name { font-size: 0.88rem; font-weight: 700; color: var(--text); }
        .apo-mg-date { font-size: 0.72rem; color: var(--muted); }
        .apo-medal-row {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.4rem 0.5rem; border-radius: 8px;
          transition: background 0.15s;
        }
        .apo-medal-row:hover { background: rgba(255,255,255,0.03); }
        .apo-medal-icon { font-size: 1rem; flex-shrink: 0; }
        .apo-medal-ev { font-size: 0.82rem; font-weight: 600; color: var(--text); flex: 1; }
        .apo-medal-round { font-size: 0.72rem; color: var(--muted); }
        .apo-medal-time { font-size: 0.88rem; flex-shrink: 0; }
        .apo-clickable {
          cursor: pointer; border-bottom: 1px dashed rgba(167,139,250,0.4); padding-bottom: 1px;
        }
        .apo-clickable:hover { color: #c4b5fd; }

        /* Solves popup */
        .apo-solves-popup {
          position: fixed; z-index: 10002;
          transform: translateX(-50%);
          background: var(--bg); border: 1px solid rgba(124,58,237,0.35);
          border-radius: 10px; padding: 0.5rem 0.6rem;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          animation: apoFadeIn 0.12s ease;
        }
        .apo-solves-row { display: flex; gap: 0.35rem; }
        .apo-solve-cell {
          display: flex; flex-direction: column; align-items: center; gap: 0.1rem; min-width: 40px;
        }
        .apo-solve-label { font-size: 0.55rem; font-weight: 700; color: var(--muted); text-transform: uppercase; }
        .apo-solve-val { font-family: monospace; font-size: 0.82rem; color: var(--muted); white-space: nowrap; }
        .apo-solve-cell.best .apo-solve-val { color: var(--text); font-weight: 700; }
        .apo-solve-cell.dnf .apo-solve-val { color: #f87171; }

        /* Mobile */
        @media (max-width: 700px) {
          .apo-header { padding: 2rem 1rem 1rem; }
          .apo-avatar { width: 90px; height: 90px; }
          .apo-avatar-ph { font-size: 1.6rem; }
          .apo-name { font-size: 1.3rem; }
          .apo-wca { font-size: 0.78rem; }
          .apo-stats-pair { flex-direction: column; max-width: 100%; }
          .apo-stats-row { max-width: 100%; }
          .apo-stat { padding: 0.6rem 0.3rem; }
          .apo-stat-num { font-size: 1rem; }
          .apo-stat-label { font-size: 0.62rem; }
          .apo-tab { font-size: 0.9rem; padding: 0.7rem 0.3rem; }
          .apo-tab-content { padding: 1rem 0.75rem; }
          .apo-ep { font-size: 0.78rem; padding: 0.35rem 0.8rem; }
          .apo-table { min-width: 700px; font-size: 0.85rem; }
          .apo-table th { padding: 0.5rem 0.5rem; font-size: 0.68rem; }
          .apo-table td { padding: 0.55rem 0.5rem; }
          .apo-table .mono { font-size: 0.88rem; }
          .apo-table .solve { font-size: 0.78rem; }
          .apo-td-place { font-size: 0.88rem; }
          .apo-comp-label-name { font-size: 0.8rem; }
          .apo-close { top: 0.5rem; right: 0.5rem; }
          .apo-bc-grid { grid-template-columns: repeat(3, 1fr); max-width: 100%; }
          .apo-bc { padding: 0.55rem 0.3rem; min-width: auto; }
          .apo-bc-label { font-size: 0.6rem; padding: 2px 6px; }
          .apo-bc-num { font-size: 1.15rem; }
          .apo-bc-sub { font-size: 0.55rem; }
          .apo-bc-events { max-width: 100%; }
          .apo-time-badge { top: -6px; right: -6px; font-size: 0.55rem; }
        }
      `}</style>
    </div>
  );
}
