'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { subscribeResultsByComp } from '@/lib/firebase/services/results';
import { useWcaRecords } from '@/lib/hooks/useWcaRecords';
import { getResultRecordBadges } from '@/lib/record-badges';
import { fmtTime, formatDate } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Competition, Result, Athlete, AdvancementConfig } from '@/lib/types';

// ── helpers ─────────────────────────────────────────────────────────────────

function getRoundLabel(roundNum: number, totalRounds: number): string {
  if (totalRounds === 1) return 'Final';
  if (roundNum === totalRounds) return 'Final';
  if (totalRounds === 4 && roundNum === 3) return 'Semi Final';
  const names: Record<number, string> = { 1: 'First Round', 2: 'Second Round', 3: 'Third Round' };
  return names[roundNum] ?? `Round ${roundNum}`;
}

function getSolveHint(solves: (number | null)[], idx: number): 'best' | 'worst' | null {
  if (!solves || solves.length < 5) return null;
  const rank = (v: number | null): number => {
    if (v === null) return 4e9;
    if (v === -2) return 3e9;
    if (v < 0) return 2e9;
    return v;
  };
  const scored = solves.map((v, i) => ({ r: rank(v), i })).sort((a, b) => a.r !== b.r ? a.r - b.r : a.i - b.i);
  if (scored[0].i === idx) return 'best';
  if (scored[4].i === idx) return 'worst';
  return null;
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

function formatCompDate(date: Competition['date']): string {
  if (!date) return '—';
  if (typeof date === 'object' && 'toDate' in date) {
    return date.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return String(date);
}

interface ClubBestEntry { name: string; time: number; event: string }

// ── component ───────────────────────────────────────────────────────────────

interface Props {
  comp: Competition;
  athletes: Athlete[];
  onClose: () => void;
}

type Section = 'info' | 'results' | 'athletes';

export default function CompetitionHistory({ comp, athletes, onClose }: Props) {
  const [section, setSection] = useState<Section>('info');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [evId, setEvId] = useState('');
  const [round, setRound] = useState(1);
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [medalOpen, setMedalOpen] = useState<'gold' | 'silver' | 'bronze' | null>(null);
  const [athleteProfile, setAthleteProfile] = useState<Athlete | null>(null);
  const wcaRecords = useWcaRecords();

  // Subscribe to results
  useEffect(() => {
    setLoading(true);
    const unsub = subscribeResultsByComp(comp.id, (data) => {
      setResults(data.filter(r => r.status === 'published'));
      setLoading(false);
    });
    return unsub;
  }, [comp.id]);

  // Escape + scroll lock
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Derived data — club athletes = any athlete whose ID exists in allAthletes
  const clubAthleteIds = useMemo(() => new Set(athletes.map(a => a.id)), [athletes]);

  const athleteNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach(a => { m[a.id] = (a.name || '') + (a.lastName ? ' ' + a.lastName : ''); });
    return m;
  }, [athletes]);

  const athleteImageMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach(a => { if (a.imageUrl) m[a.id] = a.imageUrl; });
    return m;
  }, [athletes]);

  const compEvents = useMemo(
    () => comp.events ? WCA_EVENTS.filter(e => (comp.events as Record<string, boolean>)?.[e.id]) : [],
    [comp.events],
  );

  // Detect actual rounds from results data (fallback to eventConfig)
  const actualRoundsMap = useMemo(() => {
    const m: Record<string, number> = {};
    results.forEach(r => {
      const rd = r.round || 1;
      if (!m[r.eventId] || rd > m[r.eventId]) m[r.eventId] = rd;
    });
    return m;
  }, [results]);

  const totalRoundsFor = (ev: string) => {
    const fromConfig = comp.eventConfig?.[ev]?.rounds ?? 1;
    const fromData = actualRoundsMap[ev] ?? 1;
    return Math.max(fromConfig, fromData);
  };

  // Auto-select first event when switching to results
  useEffect(() => {
    if (section === 'results' && !evId && compEvents.length > 0) {
      setEvId(compEvents[0].id);
      setRound(1);
    }
  }, [section, evId, compEvents]);

  // Results table rows
  const tableRows = useMemo(
    () => results.filter(r => r.eventId === evId && (r.round || 1) === round).sort(wcaSort),
    [results, evId, round],
  );

  // Advancement
  const evCfg = comp.eventConfig?.[evId];
  const totalRounds = totalRoundsFor(evId);
  const isFinal = round >= totalRounds;
  const advCfg: AdvancementConfig | undefined =
    !isFinal ? (evCfg?.advancement?.[String(round)] as AdvancementConfig | undefined) : undefined;
  const rawAdv = advCfg
    ? advCfg.type === 'fixed' ? advCfg.value : Math.floor(tableRows.length * advCfg.value / 100)
    : 0;
  const advanceCount = Math.min(rawAdv, tableRows.length - 1);

  // Club athletes summary
  const clubSummary = useMemo(() => {
    const clubResults = results.filter(r => clubAthleteIds.has(r.athleteId));

    // Find which club athletes actually have results in this competition
    const participatingIds = new Set(clubResults.map(r => r.athleteId));

    const athleteMap = new Map<string, {
      id: string;
      name: string;
      events: Set<string>;
      medals: { gold: number; silver: number; bronze: number };
      bestPerEvent: Record<string, { single: number | null; average: number | null }>;
    }>();

    // Initialize from allAthletes who have results in this competition
    athletes.forEach(a => {
      if (!participatingIds.has(a.id)) return;
      athleteMap.set(a.id, {
        id: a.id,
        name: (a.name || '') + (a.lastName ? ' ' + a.lastName : ''),
        events: new Set(),
        medals: { gold: 0, silver: 0, bronze: 0 },
        bestPerEvent: {},
      });
    });

    // Fill events and best results
    clubResults.forEach(r => {
      const entry = athleteMap.get(r.athleteId);
      if (!entry) return;
      entry.events.add(r.eventId);
      if (!entry.bestPerEvent[r.eventId]) {
        entry.bestPerEvent[r.eventId] = { single: null, average: null };
      }
      const bp = entry.bestPerEvent[r.eventId];
      if (r.single != null && r.single > 0 && (bp.single === null || r.single < bp.single)) {
        bp.single = r.single;
      }
      if (r.average != null && r.average > 0 && (bp.average === null || r.average < bp.average)) {
        bp.average = r.average;
      }
    });

    // Calculate medals from final rounds among ALL athletes
    // Get all event IDs that have results in this competition
    const resultEventIds = new Set(results.map(r => r.eventId));
    resultEventIds.forEach(eventId => {
      // Find the maximum round for this event from actual data
      const maxRound = results
        .filter(r => r.eventId === eventId)
        .reduce((max, r) => Math.max(max, r.round || 1), 1);
      const finalResults = results
        .filter(r => r.eventId === eventId && (r.round || 1) === maxRound)
        .sort(wcaSort);
      finalResults.forEach((r, i) => {
        const entry = athleteMap.get(r.athleteId);
        if (!entry) return;
        if (i === 0) entry.medals.gold++;
        else if (i === 1) entry.medals.silver++;
        else if (i === 2) entry.medals.bronze++;
      });
    });

    const athletesList = Array.from(athleteMap.values()).filter(a => a.events.size > 0);

    // Overall stats
    let totalGold = 0, totalSilver = 0, totalBronze = 0;
    athletesList.forEach(a => {
      totalGold += a.medals.gold;
      totalSilver += a.medals.silver;
      totalBronze += a.medals.bronze;
    });

    // Best single / average across all club results
    const bestSingle = clubResults.reduce<ClubBestEntry | null>((best, r) => {
      if (r.single != null && r.single > 0 && (!best || r.single < best.time)) {
        return {
          name: athleteNameMap[r.athleteId] || r.athleteName || r.athleteId,
          time: r.single,
          event: WCA_EVENTS.find(e => e.id === r.eventId)?.name || r.eventId,
        };
      }
      return best;
    }, null);

    const bestAverage = clubResults.reduce<ClubBestEntry | null>((best, r) => {
      if (r.average != null && r.average > 0 && (!best || r.average < best.time)) {
        return {
          name: athleteNameMap[r.athleteId] || r.athleteName || r.athleteId,
          time: r.average,
          event: WCA_EVENTS.find(e => e.id === r.eventId)?.name || r.eventId,
        };
      }
      return best;
    }, null);

    return { athletesList, totalGold, totalSilver, totalBronze, bestSingle, bestAverage };
  }, [results, clubAthleteIds, athleteNameMap, athletes]);

  // Detailed medal list: who won what in which event
  interface MedalDetail { athleteId: string; name: string; eventId: string; eventName: string; time: number | null }
  const medalDetails = useMemo(() => {
    const gold: MedalDetail[] = [];
    const silver: MedalDetail[] = [];
    const bronze: MedalDetail[] = [];
    const resultEventIds = new Set(results.map(r => r.eventId));
    resultEventIds.forEach(eventId => {
      const maxRound = results
        .filter(r => r.eventId === eventId)
        .reduce((max, r) => Math.max(max, r.round || 1), 1);
      const finalResults = results
        .filter(r => r.eventId === eventId && (r.round || 1) === maxRound)
        .sort(wcaSort);
      const evName = WCA_EVENTS.find(e => e.id === eventId)?.name || eventId;
      finalResults.forEach((r, i) => {
        if (!clubAthleteIds.has(r.athleteId)) return;
        const detail: MedalDetail = {
          athleteId: r.athleteId,
          name: athleteNameMap[r.athleteId] || r.athleteName || r.athleteId,
          eventId, eventName: evName,
          time: r.average != null && r.average > 0 ? r.average : r.single,
        };
        if (i === 0) gold.push(detail);
        else if (i === 1) silver.push(detail);
        else if (i === 2) bronze.push(detail);
      });
    });
    return { gold, silver, bronze };
  }, [results, clubAthleteIds, athleteNameMap]);

  // Detailed record list (TR/NR/CR/WR only, skip PR)
  interface RecordDetail { badge: string; athleteId: string; name: string; eventName: string; type: string; time: number }
  const recordDetails = useMemo(() => {
    const list: RecordDetail[] = [];
    const clubOnly = results.filter(r => clubAthleteIds.has(r.athleteId) && r.source !== 'imported' && r.source !== 'import');
    const seen = new Set<string>(); // deduplicate
    clubOnly.forEach(r => {
      (['single', 'average'] as const).forEach(type => {
        const val = r[type];
        if (val == null || val <= 0 || val === -1 || val === -2) return;
        const badges = getResultRecordBadges(r.eventId, type, val, r.athleteId, results, wcaRecords);
        const evName = WCA_EVENTS.find(e => e.id === r.eventId)?.name || r.eventId;
        badges.forEach(b => {
          if (b === 'PR') return; // skip PR
          const key = `${b}-${r.eventId}-${type}-${r.athleteId}`;
          if (seen.has(key)) return;
          seen.add(key);
          list.push({
            badge: b, athleteId: r.athleteId,
            name: athleteNameMap[r.athleteId] || r.athleteName || r.athleteId,
            eventName: evName, type, time: val,
          });
        });
      });
    });
    // Sort by badge priority: WR > CR > NR > TR
    const order: Record<string, number> = { WR: 0, CR: 1, NR: 2, TR: 3 };
    list.sort((a, b) => (order[a.badge] ?? 9) - (order[b.badge] ?? 9));
    return list;
  }, [results, clubAthleteIds, athleteNameMap, wcaRecords]);

  // Club athletes who participated (for the horizontal strip)
  const participatingClubAthletes = useMemo(() => {
    const ids = new Set(results.filter(r => clubAthleteIds.has(r.athleteId)).map(r => r.athleteId));
    return athletes.filter(a => ids.has(a.id));
  }, [results, clubAthleteIds, athletes]);

  // Athlete strip auto-scroll
  const stripRef = useRef<HTMLDivElement>(null);
  const stripIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startStripAutoScroll = useCallback(() => {
    if (stripIntervalRef.current) clearInterval(stripIntervalRef.current);
    stripIntervalRef.current = setInterval(() => {
      const el = stripRef.current;
      if (!el) return;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;
      const next = el.scrollLeft + 110;
      el.scrollTo({ left: next > maxScroll ? 0 : next, behavior: 'smooth' });
    }, 6000);
  }, []);

  useEffect(() => {
    if (section === 'info' && participatingClubAthletes.length > 0) {
      startStripAutoScroll();
    }
    return () => { if (stripIntervalRef.current) clearInterval(stripIntervalRef.current); };
  }, [section, participatingClubAthletes.length, startStripAutoScroll]);

  // ── render ──────────────────────────────────────────────────────────────────

  const dateStr = formatCompDate(comp.date);
  const clubDateStr = formatCompDate(comp.clubDate);
  const eventIds = comp.events ? Object.keys(comp.events) : [];

  return (
    <div className="ch-overlay">
      {/* Top bar */}
      <div className="ch-topbar">
        <div className="ch-topbar-left">
          <span className="ch-topbar-title">{comp.name}</span>
        </div>
        <button className="ch-close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* Section tabs */}
      <div className="ch-section-tabs">
        {([
          { key: 'info' as Section, label: 'Info' },
          { key: 'results' as Section, label: 'Results' },
          { key: 'athletes' as Section, label: 'Our Athletes' },
        ]).map(tab => (
          <button
            key={tab.key}
            className={`ch-section-tab${section === tab.key ? ' active' : ''}`}
            onClick={() => setSection(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="ch-content">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
            <div className="ch-spinner" />
          </div>
        ) : (
          <>
            {/* SECTION A: Info */}
            {section === 'info' && (
              <div className="ch-info-section">
                <div className="ch-info-card">
                  <h1 className="ch-info-title">{comp.name}</h1>
                  <div className="ch-info-meta">
                    {comp.country && (
                      <span className="ch-info-meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        {comp.country}
                      </span>
                    )}
                    {dateStr !== '—' && (
                      <span className="ch-info-meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                        </svg>
                        {dateStr}
                      </span>
                    )}
                    {clubDateStr !== '—' && (
                      <span className="ch-info-meta-item ch-info-club-date">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                        </svg>
                        Club: {clubDateStr}
                      </span>
                    )}
                  </div>

                  {/* Events panel (clickable to expand round details) */}
                  {eventIds.length > 0 && (
                    <div className="ch-info-block">
                      <div className="ch-info-label">Events</div>
                      <div
                        className={`ch-events-panel${eventsExpanded ? ' expanded' : ''}`}
                        onClick={() => setEventsExpanded(v => !v)}
                      >
                        <div className="ch-events-panel-header">
                          <div className="ch-pill-row">
                            {eventIds.map(eid => {
                              const ev = WCA_EVENTS.find(e => e.id === eid);
                              if (!ev) return null;
                              return <span key={eid} className="ch-event-pill">{ev.name}</span>;
                            })}
                          </div>
                          <span className={`ch-ep-chevron${eventsExpanded ? ' open' : ''}`}>▶</span>
                        </div>
                        {eventsExpanded && (
                          <div className="ch-events-detail-grid" onClick={e => e.stopPropagation()}>
                            {eventIds.map(eid => {
                              const ev = WCA_EVENTS.find(e => e.id === eid);
                              if (!ev) return null;
                              const rounds = totalRoundsFor(eid);
                              const cfg = comp.eventConfig?.[eid];
                              return (
                                <div key={eid} className="ch-evd-item">
                                  <div className="ch-evd-name">{ev.name}</div>
                                  <div className="ch-evd-rounds">
                                    {Array.from({ length: rounds }, (_, i) => i + 1).map(rn => {
                                      const adv = cfg?.advancement?.[String(rn)] as AdvancementConfig | undefined;
                                      const advLabel = adv
                                        ? adv.type === 'fixed' ? `Top ${adv.value}` : `Top ${adv.value}%`
                                        : null;
                                      return (
                                        <div key={rn} className="ch-evd-round">
                                          <span className="ch-evd-round-name">{getRoundLabel(rn, rounds)}</span>
                                          {advLabel && <span className="ch-evd-round-adv">→ {advLabel}</span>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Club Medals - detailed breakdown */}
                  <div className="ch-info-block">
                    <div className="ch-info-label">Club Medals</div>
                    {medalDetails.gold.length + medalDetails.silver.length + medalDetails.bronze.length === 0 ? (
                      <div className="ch-empty-note">No medals at this competition</div>
                    ) : (
                      <div className="ch-medal-sections">
                        {([
                          { key: 'gold' as const, icon: '🥇', label: 'Gold', items: medalDetails.gold },
                          { key: 'silver' as const, icon: '🥈', label: 'Silver', items: medalDetails.silver },
                          { key: 'bronze' as const, icon: '🥉', label: 'Bronze', items: medalDetails.bronze },
                        ]).map(sec => sec.items.length > 0 && (
                          <div key={sec.key} className="ch-medal-block">
                            <button
                              className={`ch-medal-header${medalOpen === sec.key ? ' open' : ''}`}
                              onClick={() => setMedalOpen(v => v === sec.key ? null : sec.key)}
                            >
                              <span className="ch-medal-header-left">
                                <span>{sec.icon}</span>
                                <span className="ch-medal-header-label">{sec.label}</span>
                                <span className="ch-medal-header-count">{sec.items.length}</span>
                              </span>
                              <span className={`ch-ep-chevron${medalOpen === sec.key ? ' open' : ''}`}>▶</span>
                            </button>
                            {medalOpen === sec.key && (
                              <div className="ch-medal-list">
                                {sec.items.map((m, i) => (
                                  <div key={i} className="ch-medal-entry">
                                    {athleteImageMap[m.athleteId] ? (
                                      <img src={athleteImageMap[m.athleteId]} alt="" className="ch-me-avatar" />
                                    ) : (
                                      <div className="ch-me-avatar ch-me-avatar-ph">
                                        {m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                      </div>
                                    )}
                                    <div className="ch-me-info">
                                      <div className="ch-me-name">{m.name}</div>
                                      <div className="ch-me-event">{m.eventName}</div>
                                    </div>
                                    <div className="ch-me-time">{fmtTime(m.time)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Club Records - detailed breakdown (TR/NR/CR/WR only) */}
                  <div className="ch-info-block">
                    <div className="ch-info-label">Club Records</div>
                    {recordDetails.length === 0 ? (
                      <div className="ch-empty-note">No national/world records set</div>
                    ) : (
                      <div className="ch-record-list">
                        {recordDetails.map((rd, i) => (
                          <div key={i} className="ch-record-entry">
                            <span className={`ch-rb ch-rb-${rd.badge.toLowerCase()}`}>{rd.badge}</span>
                            <div className="ch-re-info">
                              <div className="ch-re-name">{rd.name}</div>
                              <div className="ch-re-event">{rd.eventName} · {rd.type}</div>
                            </div>
                            <div className="ch-re-time">{fmtTime(rd.time)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Club Athletes horizontal strip */}
                  {participatingClubAthletes.length > 0 && (
                    <div className="ch-info-block" style={{ marginBottom: 0 }}>
                      <div className="ch-info-label">Our Athletes</div>
                      <div
                        className="ch-athlete-strip"
                        ref={stripRef}
                        onMouseEnter={() => { if (stripIntervalRef.current) clearInterval(stripIntervalRef.current); }}
                        onMouseLeave={() => startStripAutoScroll()}
                        onTouchStart={() => { if (stripIntervalRef.current) clearInterval(stripIntervalRef.current); }}
                        onTouchEnd={() => startStripAutoScroll()}
                      >
                        {participatingClubAthletes.map(a => {
                          const fullName = (a.name || '') + (a.lastName ? ' ' + a.lastName : '');
                          const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                          return (
                            <div
                              key={a.id}
                              className="ch-strip-card"
                              onClick={() => setAthleteProfile(a)}
                            >
                              {a.imageUrl ? (
                                <img src={a.imageUrl} alt={fullName} className="ch-strip-avatar" />
                              ) : (
                                <div className="ch-strip-avatar ch-strip-avatar-ph">{initials}</div>
                              )}
                              <div className="ch-strip-name">{fullName}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Inline athlete profile modal */}
            {athleteProfile && (() => {
              const ap = athleteProfile;
              const fullName = (ap.name || '') + (ap.lastName ? ' ' + ap.lastName : '');
              const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              const apResults = results.filter(r => r.athleteId === ap.id);
              const pbs: Record<string, { single: number | null; average: number | null }> = {};
              apResults.forEach(r => {
                if (!pbs[r.eventId]) pbs[r.eventId] = { single: null, average: null };
                const e = pbs[r.eventId];
                if (r.single != null && r.single > 0 && (e.single === null || r.single < e.single)) e.single = r.single;
                if (r.average != null && r.average > 0 && (e.average === null || r.average < e.average)) e.average = r.average;
              });
              return (
                <div className="ch-ap-overlay" onClick={() => setAthleteProfile(null)}>
                  <div className="ch-ap-modal" onClick={e => e.stopPropagation()}>
                    <div className="ch-ap-header">
                      <div className="ch-ap-header-left">
                        {ap.imageUrl ? (
                          <img src={ap.imageUrl} alt={fullName} className="ch-ap-avatar" />
                        ) : (
                          <div className="ch-ap-avatar ch-ap-avatar-ph">{initials}</div>
                        )}
                        <div>
                          <div className="ch-ap-name">{fullName}</div>
                          {ap.wcaId && <div className="ch-ap-wca">{ap.wcaId}</div>}
                        </div>
                      </div>
                      <button className="ch-close-btn" onClick={() => setAthleteProfile(null)} style={{ minWidth: '2rem', minHeight: '2rem', fontSize: '0.9rem' }}>✕</button>
                    </div>
                    <div className="ch-ap-body">
                      <div className="ch-info-label">Results at this competition</div>
                      {Object.keys(pbs).length === 0 ? (
                        <div className="ch-empty-note">No results</div>
                      ) : (
                        <div className="ch-ap-results">
                          {Object.entries(pbs).map(([eid, pb]) => {
                            const ev = WCA_EVENTS.find(e => e.id === eid);
                            return (
                              <div key={eid} className="ch-ap-result-row">
                                <span className="ch-ap-ev">{ev?.name || eid}</span>
                                <div className="ch-ap-times">
                                  {pb.single != null && <span className="ch-ae-time"><span className="ch-ae-label">S</span>{fmtTime(pb.single)}</span>}
                                  {pb.average != null && <span className="ch-ae-time"><span className="ch-ae-label">A</span>{fmtTime(pb.average)}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* SECTION B: Results */}
            {section === 'results' && (
              <div className="ch-results-section">
                <div className="wca-live-layout ch-results-layout">
                  {/* Sidebar */}
                  <div className="wca-sidebar">
                    <div className="wca-sidebar-events">
                      {compEvents.length === 0 && (
                        <div style={{ padding: '0.9rem 0.85rem', color: 'var(--muted)', fontSize: '0.8rem' }}>
                          No events configured
                        </div>
                      )}
                      {compEvents.map(ev => {
                        const total = totalRoundsFor(ev.id);
                        const hasActive = evId === ev.id;
                        return (
                          <div key={ev.id} className="wca-ev-group">
                            <div
                              className={`wca-ev-header${hasActive ? ' has-active' : ''}`}
                              onClick={() => { setEvId(ev.id); setRound(1); }}
                            >
                              <div className="wca-ev-header-left">
                                <span className="wca-ev-name">{ev.name}</span>
                              </div>
                              {total > 1 && <span className="ch-rounds-indicator">{total}R</span>}
                            </div>
                            {hasActive && total > 1 && Array.from({ length: total }, (_, i) => i + 1).map(r => {
                              const isActive = round === r;
                              return (
                                <div
                                  key={r}
                                  className={`wca-ev-round-item${isActive ? ' active' : ''}`}
                                  onClick={() => { setEvId(ev.id); setRound(r); }}
                                >
                                  <span>{getRoundLabel(r, total)}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Main area */}
                  <div className="wca-main" style={{ overflowY: 'auto' }}>
                    {evId && (
                      <div className="wca-round-header">
                        <div className="wca-round-header-left">
                          <span className="wca-round-event-name">{WCA_EVENTS.find(e => e.id === evId)?.name}</span>
                          <span className="wca-round-label">{getRoundLabel(round, totalRoundsFor(evId))}</span>
                        </div>
                        {totalRoundsFor(evId) > 1 && (
                          <div className="wca-round-header-right">
                            <div className="wca-round-tabs">
                              {Array.from({ length: totalRoundsFor(evId) }, (_, i) => i + 1).map(r => (
                                <button
                                  key={r}
                                  className={`wca-round-tab${round === r ? ' active' : ''}`}
                                  onClick={() => setRound(r)}
                                >
                                  {getRoundLabel(r, totalRoundsFor(evId))}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="wca-table-wrap">
                      {!evId ? (
                        <div className="wca-empty">Select an event to view results.</div>
                      ) : tableRows.length === 0 ? (
                        <div className="wca-empty">No results for this round.</div>
                      ) : (
                        <table className="wca-results-table">
                          <thead>
                            <tr>
                              <th style={{ width: '2rem' }}>#</th>
                              <th>Athlete</th>
                              <th>Country</th>
                              <th className="th-r">1</th>
                              <th className="th-r">2</th>
                              <th className="th-r">3</th>
                              <th className="th-r">4</th>
                              <th className="th-r">5</th>
                              <th className="th-r">Average</th>
                              <th className="th-r">Best</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableRows.flatMap((r, i) => {
                              const isAdvancing = advanceCount > 0 && i < advanceCount;
                              const isLastAdvancing = advanceCount > 0 && i === advanceCount - 1;
                              const isClub = clubAthleteIds.has(r.athleteId);
                              const rowCls = i === 0 ? 'row-gold' : i === 1 ? 'row-silver' : i === 2 ? 'row-bronze' : isClub ? 'row-club' : '';

                              const displayName = isClub
                                ? (athleteNameMap[r.athleteId] || r.athleteName || r.athleteId)
                                : (r.athleteName || r.athleteId);

                              const displayCountry = isClub ? 'Mongolia' : (r.country || '—');

                              const dataRow = (
                                <tr
                                  key={r.id}
                                  className={rowCls}
                                  style={isAdvancing ? { borderLeft: '3px solid #22c55e' } : { borderLeft: '3px solid transparent' }}
                                >
                                  <td
                                    className={`wca-td-rank${i < 3 ? ` wca-rank-${i + 1}` : ''}`}
                                    style={isAdvancing ? { color: '#4ade80' } : undefined}
                                  >
                                    {i + 1}
                                  </td>
                                  <td className="wca-td-name">
                                    <div className={`wca-name${isClub ? ' ch-club-name' : ''}`}>{displayName}</div>
                                  </td>
                                  <td className="wca-td-country">{displayCountry}</td>
                                  {([0, 1, 2, 3, 4] as const).map(si => {
                                    const sv = r.solves?.[si] ?? null;
                                    const hint = getSolveHint(r.solves ?? [], si);
                                    const isDnf = sv !== null && sv < 0;
                                    const text = hint ? `(${fmtTime(sv)})` : fmtTime(sv);
                                    return (
                                      <td
                                        key={si}
                                        className={`wca-td-solve${isDnf ? ' dnf-solve' : hint === 'best' ? ' hint-best' : hint === 'worst' ? ' hint-worst' : ''}`}
                                      >
                                        {text}
                                      </td>
                                    );
                                  })}
                                  <td className={`wca-td-avg${r.average != null && r.average < 0 ? ' dnf-avg' : ''}`}>
                                    {fmtTime(r.average)}
                                  </td>
                                  <td className={`wca-td-best${r.single != null && r.single < 0 ? ' dnf-solve' : ''}`}>
                                    {fmtTime(r.single)}
                                  </td>
                                </tr>
                              );

                              if (isLastAdvancing) {
                                const label = advCfg?.type === 'fixed'
                                  ? `✓ Top ${advanceCount} advance to next round`
                                  : `✓ Top ${advCfg?.value}% advance (${advanceCount} athletes)`;
                                return [
                                  dataRow,
                                  <tr key="adv-cutoff">
                                    <td colSpan={10} style={{ padding: 0, borderBottom: 'none' }}>
                                      <div style={{
                                        borderTop: '2px dashed #22c55e', padding: '0.25rem 0.75rem',
                                        fontSize: '0.72rem', color: '#4ade80',
                                        background: 'rgba(34,197,94,0.05)', letterSpacing: '0.01em',
                                      }}>
                                        {label}
                                      </div>
                                    </td>
                                  </tr>,
                                ];
                              }
                              return [dataRow];
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION C: Our Athletes */}
            {section === 'athletes' && (
              <div className="ch-athletes-section">
                {clubSummary.athletesList.length === 0 ? (
                  <div className="wca-empty" style={{ padding: '3rem' }}>
                    No club athletes participated in this competition.
                  </div>
                ) : (
                  <>
                    {/* Overall summary */}
                    <div className="ch-overall-summary">
                      <div className="ch-summary-card">
                        <div className="ch-summary-title">Total Medals</div>
                        <div className="ch-medal-row">
                          {clubSummary.totalGold > 0 && <span className="ch-medal-item gold">🥇 {clubSummary.totalGold}</span>}
                          {clubSummary.totalSilver > 0 && <span className="ch-medal-item silver">🥈 {clubSummary.totalSilver}</span>}
                          {clubSummary.totalBronze > 0 && <span className="ch-medal-item bronze">🥉 {clubSummary.totalBronze}</span>}
                          {clubSummary.totalGold + clubSummary.totalSilver + clubSummary.totalBronze === 0 && (
                            <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No medals</span>
                          )}
                        </div>
                      </div>
                      {clubSummary.bestSingle && (
                        <div className="ch-summary-card">
                          <div className="ch-summary-title">Best Single</div>
                          <div className="ch-summary-value">{fmtTime(clubSummary.bestSingle.time)}</div>
                          <div className="ch-summary-detail">{clubSummary.bestSingle.name} · {clubSummary.bestSingle.event}</div>
                        </div>
                      )}
                      {clubSummary.bestAverage && (
                        <div className="ch-summary-card">
                          <div className="ch-summary-title">Best Average</div>
                          <div className="ch-summary-value">{fmtTime(clubSummary.bestAverage.time)}</div>
                          <div className="ch-summary-detail">{clubSummary.bestAverage.name} · {clubSummary.bestAverage.event}</div>
                        </div>
                      )}
                    </div>

                    {/* Athlete grid */}
                    <div className="ch-athlete-grid">
                      {clubSummary.athletesList.map(a => {
                        const totalMedals = a.medals.gold + a.medals.silver + a.medals.bronze;
                        const imgUrl = athleteImageMap[a.id];
                        const initials = a.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

                        return (
                          <div key={a.id} className="ch-athlete-card">
                            <div className="ch-athlete-top">
                              {imgUrl ? (
                                <img src={imgUrl} alt={a.name} className="ch-athlete-avatar" />
                              ) : (
                                <div className="ch-athlete-avatar ch-avatar-placeholder">{initials}</div>
                              )}
                              <div>
                                <div className="ch-athlete-name">{a.name}</div>
                                {totalMedals > 0 && (
                                  <div className="ch-athlete-medals">
                                    {a.medals.gold > 0 && <span>🥇{a.medals.gold > 1 ? `×${a.medals.gold}` : ''}</span>}
                                    {a.medals.silver > 0 && <span>🥈{a.medals.silver > 1 ? `×${a.medals.silver}` : ''}</span>}
                                    {a.medals.bronze > 0 && <span>🥉{a.medals.bronze > 1 ? `×${a.medals.bronze}` : ''}</span>}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Events */}
                            <div className="ch-athlete-events">
                              {Array.from(a.events).map(eid => {
                                const ev = WCA_EVENTS.find(e => e.id === eid);
                                const bp = a.bestPerEvent[eid];
                                return (
                                  <div key={eid} className="ch-athlete-event-row">
                                    <span className="ch-ae-name">{ev?.short || eid}</span>
                                    {bp?.single != null && (
                                      <span className="ch-ae-time">
                                        <span className="ch-ae-label">S</span>{fmtTime(bp.single)}
                                      </span>
                                    )}
                                    {bp?.average != null && (
                                      <span className="ch-ae-time">
                                        <span className="ch-ae-label">A</span>{fmtTime(bp.average)}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        /* ── Competition History Overlay ──────────────────────────── */
        .ch-overlay {
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          z-index: 9999; background: var(--bg);
          display: flex; flex-direction: column;
          animation: chFadeIn 0.2s ease;
        }
        @keyframes chFadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* Top bar */
        .ch-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.7rem 1.25rem; border-bottom: 1px solid rgba(124,58,237,0.2);
          flex-shrink: 0; background: var(--surface);
        }
        .ch-topbar-left { min-width: 0; flex: 1; }
        .ch-topbar-title {
          font-size: 1rem; font-weight: 700; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
        }
        .ch-close-btn {
          background: none; border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px; color: var(--muted); cursor: pointer;
          font-family: inherit; flex-shrink: 0;
          min-width: 2.5rem; min-height: 2.5rem;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.1rem; line-height: 1; transition: all 0.2s;
        }
        .ch-close-btn:hover { border-color: rgba(124,58,237,0.4); color: var(--text); }

        /* Section tabs */
        .ch-section-tabs {
          display: flex; gap: 0; border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0; background: var(--surface);
        }
        .ch-section-tab {
          flex: 1; padding: 0.65rem 1rem; background: none; border: none;
          font-size: 0.82rem; font-weight: 600; color: var(--muted);
          cursor: pointer; font-family: inherit; transition: all 0.2s;
          border-bottom: 2px solid transparent; text-align: center;
        }
        .ch-section-tab:hover { color: var(--text); background: rgba(255,255,255,0.03); }
        .ch-section-tab.active {
          color: #a78bfa; border-bottom-color: var(--accent);
          background: rgba(124,58,237,0.06);
        }

        /* Content area */
        .ch-content { flex: 1; overflow-y: auto; min-height: 0; }

        /* Spinner */
        .ch-spinner {
          width: 32px; height: 32px; border-radius: 50%;
          border: 3px solid rgba(124,58,237,0.2); border-top-color: var(--accent);
          animation: chSpin 0.8s linear infinite;
        }
        @keyframes chSpin { to { transform: rotate(360deg); } }

        /* ── Section A: Info ──────────────────────────────────────── */
        .ch-info-section { padding: 1.5rem; max-width: 800px; margin: 0 auto; }
        .ch-info-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 1.8rem;
        }
        .ch-info-title {
          font-size: 1.5rem; font-weight: 800; color: var(--text-primary);
          margin-bottom: 1rem; line-height: 1.3;
        }
        .ch-info-meta {
          display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;
        }
        .ch-info-meta-item {
          display: inline-flex; align-items: center; gap: 0.4rem;
          font-size: 0.85rem; color: var(--muted);
        }
        .ch-info-club-date { color: #a78bfa; }
        .ch-info-block { margin-bottom: 1.5rem; }
        .ch-info-label {
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--muted); margin-bottom: 0.6rem;
        }
        .ch-pill-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .ch-event-pill {
          display: inline-flex; align-items: center; gap: 0.35rem;
          font-size: 0.78rem; font-weight: 600; padding: 0.3rem 0.7rem;
          border-radius: 999px; background: rgba(124,58,237,0.1);
          border: 1px solid rgba(124,58,237,0.2); color: #a78bfa;
        }
        .ch-rounds-indicator {
          font-size: 0.62rem; font-weight: 700; color: var(--muted); opacity: 0.7;
        }
        .ch-empty-note {
          font-size: 0.82rem; color: var(--muted); padding: 0.6rem 0;
        }

        /* Events panel */
        .ch-events-panel {
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px; padding: 0.8rem 1rem; cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .ch-events-panel:hover { border-color: rgba(124,58,237,0.25); background: rgba(124,58,237,0.03); }
        .ch-events-panel.expanded { cursor: default; background: rgba(124,58,237,0.03); border-color: rgba(124,58,237,0.2); }
        .ch-events-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
        .ch-ep-chevron {
          font-size: 0.5rem; color: var(--muted); transition: transform 0.2s;
          flex-shrink: 0; margin-top: 0.3rem;
        }
        .ch-ep-chevron.open { transform: rotate(90deg); }
        .ch-events-detail-grid {
          display: flex; flex-direction: column; gap: 0.5rem;
          margin-top: 0.8rem; padding-top: 0.8rem;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .ch-evd-item {
          display: flex; align-items: flex-start; gap: 0.8rem;
          padding: 0.4rem 0;
        }
        .ch-evd-name {
          font-size: 0.82rem; font-weight: 600; color: var(--text);
          min-width: 130px; flex-shrink: 0;
        }
        .ch-evd-rounds { display: flex; flex-direction: column; gap: 0.2rem; }
        .ch-evd-round { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; }
        .ch-evd-round-name { color: var(--muted); }
        .ch-evd-round-adv { color: #4ade80; font-weight: 600; font-size: 0.72rem; }

        /* Medal sections */
        .ch-medal-sections { display: flex; flex-direction: column; gap: 0.4rem; }
        .ch-medal-block {
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px; overflow: hidden;
        }
        .ch-medal-header {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%; padding: 0.6rem 0.8rem; background: none; border: none;
          cursor: pointer; font-family: inherit; transition: background 0.2s;
        }
        .ch-medal-header:hover { background: rgba(255,255,255,0.03); }
        .ch-medal-header-left { display: flex; align-items: center; gap: 0.5rem; }
        .ch-medal-header-label { font-size: 0.85rem; font-weight: 600; color: var(--text); }
        .ch-medal-header-count {
          font-size: 0.72rem; font-weight: 700; color: var(--muted);
          background: rgba(255,255,255,0.06); padding: 0.1rem 0.4rem; border-radius: 999px;
        }
        .ch-medal-list { padding: 0 0.8rem 0.6rem; display: flex; flex-direction: column; gap: 0.3rem; }
        .ch-medal-entry {
          display: flex; align-items: center; gap: 0.6rem;
          padding: 0.4rem 0.5rem; border-radius: 8px;
          background: rgba(255,255,255,0.02);
        }
        .ch-me-avatar {
          width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
        }
        .ch-me-avatar-ph {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          display: flex; align-items: center; justify-content: center;
          font-size: 0.52rem; font-weight: 800; color: #fff;
        }
        .ch-me-info { flex: 1; min-width: 0; }
        .ch-me-name { font-size: 0.82rem; font-weight: 600; color: var(--text); }
        .ch-me-event { font-size: 0.72rem; color: var(--muted); }
        .ch-me-time {
          font-family: monospace; font-size: 0.88rem; font-weight: 700;
          color: #a78bfa; flex-shrink: 0;
        }

        /* Record details */
        .ch-rb {
          font-size: 0.58rem; font-weight: 900; letter-spacing: 0.04em;
          line-height: 1; padding: 2px 5px; border-radius: 4px; flex-shrink: 0;
        }
        .ch-rb-wr { background: #b45309; color: #fef3c7; border: 1px solid #f59e0b; }
        .ch-rb-cr { background: #1d4ed8; color: #dbeafe; border: 1px solid #60a5fa; }
        .ch-rb-nr { background: #166534; color: #dcfce7; border: 1px solid #4ade80; }
        .ch-rb-tr { background: #4c1d95; color: #ede9fe; border: 1px solid #a78bfa; }
        .ch-rb-pr { background: #0e7490; color: #cffafe; border: 1px solid #22d3ee; }
        .ch-record-list { display: flex; flex-direction: column; gap: 0.35rem; }
        .ch-record-entry {
          display: flex; align-items: center; gap: 0.6rem;
          padding: 0.5rem 0.7rem; border-radius: 8px;
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
        }
        .ch-re-info { flex: 1; min-width: 0; }
        .ch-re-name { font-size: 0.82rem; font-weight: 600; color: var(--text); }
        .ch-re-event { font-size: 0.72rem; color: var(--muted); }
        .ch-re-time {
          font-family: monospace; font-size: 0.88rem; font-weight: 700;
          color: #a78bfa; flex-shrink: 0;
        }

        /* Athlete horizontal strip */
        .ch-athlete-strip {
          display: flex; gap: 0.6rem; overflow-x: auto;
          padding: 0.3rem 0; scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .ch-athlete-strip::-webkit-scrollbar { display: none; }
        .ch-strip-card {
          flex: 0 0 90px; display: flex; flex-direction: column;
          align-items: center; gap: 0.35rem; cursor: pointer;
        }
        .ch-strip-avatar {
          width: 48px; height: 48px; border-radius: 50%; object-fit: cover;
          border: 2px solid rgba(124,58,237,0.3);
          transition: border-color 0.2s, transform 0.2s;
        }
        .ch-strip-card:hover .ch-strip-avatar { border-color: var(--accent); transform: scale(1.08); }
        .ch-strip-card:hover .ch-strip-name { color: var(--text); }
        .ch-strip-avatar-ph {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          display: flex; align-items: center; justify-content: center;
          font-size: 0.72rem; font-weight: 800; color: #fff;
        }
        .ch-strip-name {
          font-size: 0.68rem; font-weight: 600; color: var(--muted);
          text-align: center; line-height: 1.2;
          max-width: 90px; overflow: hidden; text-overflow: ellipsis;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          transition: color 0.2s;
        }

        /* Athlete profile modal */
        .ch-ap-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 1rem;
          animation: chFadeIn 0.15s ease;
        }
        .ch-ap-modal {
          width: 100%; max-width: 440px; max-height: 80vh;
          background: var(--bg); border: 1px solid rgba(124,58,237,0.25);
          border-radius: 16px; display: flex; flex-direction: column;
          animation: chSlideIn 0.2s cubic-bezier(.4,0,.2,1);
        }
        @keyframes chSlideIn { from { transform: scale(0.95) translateY(10px); opacity:0; } to { transform: none; opacity:1; } }
        .ch-ap-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1.1rem 1.3rem; border-bottom: 1px solid rgba(124,58,237,0.2); flex-shrink: 0;
        }
        .ch-ap-header-left { display: flex; align-items: center; gap: 0.7rem; }
        .ch-ap-avatar {
          width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
          border: 2px solid rgba(124,58,237,0.3);
        }
        .ch-ap-avatar-ph {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          display: flex; align-items: center; justify-content: center;
          font-size: 0.8rem; font-weight: 800; color: #fff;
        }
        .ch-ap-name { font-size: 1rem; font-weight: 700; color: var(--text); }
        .ch-ap-wca { font-size: 0.72rem; color: var(--accent); font-family: monospace; margin-top: 0.1rem; }
        .ch-ap-body { overflow-y: auto; flex: 1; padding: 1.1rem 1.3rem; }
        .ch-ap-results { display: flex; flex-direction: column; gap: 0.4rem; }
        .ch-ap-result-row {
          display: flex; align-items: center; justify-content: space-between; gap: 0.6rem;
          padding: 0.45rem 0.6rem; border-radius: 8px;
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
        }
        .ch-ap-ev { font-size: 0.82rem; font-weight: 600; color: var(--text); }
        .ch-ap-times { display: flex; gap: 0.6rem; align-items: center; }

        /* ── Section B: Results ───────────────────────────────────── */
        .ch-results-section { flex: 1; display: flex; flex-direction: column; height: 100%; }
        .ch-results-layout { flex: 1; min-height: 400px; border: none; border-radius: 0; }
        .ch-club-name { font-weight: 800 !important; color: #c4b5fd !important; }

        /* ── Section C: Athletes ──────────────────────────────────── */
        .ch-athletes-section { padding: 1.5rem; max-width: 1000px; margin: 0 auto; }

        .ch-overall-summary {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 0.8rem; margin-bottom: 1.5rem;
        }
        .ch-summary-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px; padding: 1.1rem;
        }
        .ch-summary-title {
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--muted); margin-bottom: 0.5rem;
        }
        .ch-summary-value {
          font-size: 1.4rem; font-weight: 800; font-family: monospace; color: #a78bfa;
          margin-bottom: 0.2rem;
        }
        .ch-summary-detail { font-size: 0.78rem; color: var(--muted); }
        .ch-medal-row { display: flex; gap: 0.8rem; align-items: center; flex-wrap: wrap; }
        .ch-medal-item {
          font-size: 1.1rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.2rem;
        }

        .ch-athlete-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.8rem;
        }
        .ch-athlete-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px; padding: 1.1rem;
          transition: border-color 0.2s;
        }
        .ch-athlete-card:hover { border-color: rgba(124,58,237,0.3); }
        .ch-athlete-top { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.8rem; }
        .ch-athlete-avatar {
          width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
        }
        .ch-avatar-placeholder {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          display: flex; align-items: center; justify-content: center;
          font-size: 0.72rem; font-weight: 800; color: #fff;
        }
        .ch-athlete-name { font-size: 0.92rem; font-weight: 700; color: var(--text); }
        .ch-athlete-medals { display: flex; gap: 0.4rem; margin-top: 0.15rem; font-size: 0.82rem; }
        .ch-athlete-events {
          display: flex; flex-direction: column; gap: 0.3rem;
          border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.6rem;
        }
        .ch-athlete-event-row {
          display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem;
        }
        .ch-ae-name {
          font-weight: 700; color: #a78bfa; font-size: 0.72rem; letter-spacing: 0.03em;
          min-width: 36px;
        }
        .ch-ae-time {
          font-family: monospace; font-size: 0.82rem; color: var(--text);
          display: inline-flex; align-items: center; gap: 0.2rem;
        }
        .ch-ae-label {
          font-size: 0.58rem; font-weight: 800; color: var(--muted);
          background: rgba(255,255,255,0.06); padding: 0.05rem 0.25rem;
          border-radius: 3px; letter-spacing: 0.03em;
        }

        /* ── Mobile ──────────────────────────────────────────────── */
        @media (max-width: 700px) {
          .ch-info-section { padding: 1rem; }
          .ch-info-card { padding: 1.2rem; }
          .ch-info-title { font-size: 1.2rem; }
          .ch-evd-item { flex-direction: column; gap: 0.3rem; }
          .ch-evd-name { min-width: auto; }
          .ch-athletes-section { padding: 1rem; }
          .ch-athlete-grid { grid-template-columns: 1fr; }
          .ch-overall-summary { grid-template-columns: 1fr; }
          .ch-results-section { overflow: hidden; }
          .ch-results-layout { min-height: 300px; }
          .ch-ap-overlay { align-items: flex-end; padding: 0; }
          .ch-ap-modal { max-width: 100%; max-height: 85vh; border-radius: 16px 16px 0 0; border-bottom: none; }
        }
      `}</style>
    </div>
  );
}
