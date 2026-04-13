'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useLang } from '@/lib/i18n';
import { WCA_EVENTS } from '@/lib/wca-events';
import { fmtTime, betterTime, formatDate } from '@/lib/time-utils';
import type { Result, Athlete, EventVisibility } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';

interface Props {
  results: Result[];
  athletes: Athlete[];
  eventVisibility: EventVisibility;
}

function isEventVisible(eventId: string, visibility: EventVisibility, results: Result[]): boolean {
  const vis = visibility[eventId] || 'auto';
  if (vis === 'hide') return false;
  if (vis === 'show') return true;
  return results.some((r) => r.eventId === eventId);
}

interface RecordEntry { time: number; name: string; athleteId: string }

interface HistoryEntry {
  time: number;
  name: string;
  athleteId: string;
  competitionName: string;
  date: string;
  isCurrent: boolean;
}

function toSortableDate(ts: unknown): number {
  if (!ts) return 0;
  if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (typeof ts === 'number') return ts;
  return 0;
}

function buildRecordHistory(
  results: Result[],
  eventId: string,
  type: 'single' | 'average',
  nameMap: Record<string, string>,
): HistoryEntry[] {
  const eligible = results
    .filter((r) => {
      if (r.eventId !== eventId) return false;
      if (r.source === 'imported' || r.source === 'import') return false;
      if (r.status !== 'published') return false;
      const val = type === 'single' ? r.single : r.average;
      if (val === null || val === undefined || val === -1 || val === -2) return false;
      if (val <= 0) return false;
      return true;
    })
    .sort((a, b) => toSortableDate(a.submittedAt) - toSortableDate(b.submittedAt));

  const history: HistoryEntry[] = [];
  let currentBest: number | null = null;

  for (const r of eligible) {
    const val = (type === 'single' ? r.single : r.average)!;
    if (currentBest === null || val < currentBest) {
      currentBest = val;
      history.push({
        time: val,
        name: nameMap[r.athleteId] || r.athleteName || r.athleteId,
        athleteId: r.athleteId,
        competitionName: r.competitionName || r.competitionId || '—',
        date: formatDate(r.submittedAt),
        isCurrent: false,
      });
    }
  }

  if (history.length > 0) {
    history[history.length - 1].isCurrent = true;
  }

  return history;
}

export default function RecordsSection({ results, athletes, eventVisibility }: Props) {
  const { t } = useLang();
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<'single' | 'average'>('single');

  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach((a) => { m[a.id] = (a.name || '') + (a.lastName ? ' ' + a.lastName : ''); });
    return m;
  }, [athletes]);

  const { bestSingle, bestAverage } = useMemo(() => {
    const s: Record<string, RecordEntry> = {};
    const a: Record<string, RecordEntry> = {};
    results.forEach((r) => {
      const name = nameMap[r.athleteId] || r.athleteName || r.athleteId;
      if (r.single !== null && r.single !== undefined) {
        if (!s[r.eventId] || betterTime(r.single, s[r.eventId].time)) {
          s[r.eventId] = { time: r.single, name, athleteId: r.athleteId };
        }
      }
      if (r.average !== null && r.average !== undefined) {
        if (!a[r.eventId] || betterTime(r.average, a[r.eventId].time)) {
          a[r.eventId] = { time: r.average, name, athleteId: r.athleteId };
        }
      }
    });
    return { bestSingle: s, bestAverage: a };
  }, [results, nameMap]);

  const visibleEvents = WCA_EVENTS.filter((ev) => isEventVisible(ev.id, eventVisibility, results));

  // Mobile sort: cards with records first (preferred order), then empty
  const PREFERRED_ORDER = ['333', '222', 'pyram', 'skewb'];
  const mobileSorted = useMemo(() => {
    return [...visibleEvents].sort((a, b) => {
      const aHas = !!(bestSingle[a.id] || bestAverage[a.id]);
      const bHas = !!(bestSingle[b.id] || bestAverage[b.id]);
      if (aHas !== bHas) return aHas ? -1 : 1;
      const aIdx = PREFERRED_ORDER.indexOf(a.id);
      const bIdx = PREFERRED_ORDER.indexOf(b.id);
      const aPrio = aIdx >= 0 ? aIdx : 100;
      const bPrio = bIdx >= 0 ? bIdx : 100;
      return aPrio - bPrio;
    });
  }, [visibleEvents, bestSingle, bestAverage]);

  const selectedEventName = selectedEvent
    ? WCA_EVENTS.find((e) => e.id === selectedEvent)?.name || selectedEvent
    : '';

  const history = useMemo(() => {
    if (!selectedEvent) return [];
    return buildRecordHistory(results, selectedEvent, historyTab, nameMap);
  }, [results, selectedEvent, historyTab, nameMap]);

  // Reset tab when opening a new event
  useEffect(() => { setHistoryTab('single'); }, [selectedEvent]);

  // Lock body scroll when modal open
  useEffect(() => {
    if (!selectedEvent) return;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedEvent(null); };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handler);
    };
  }, [selectedEvent]);

  return (
    <section id="records" style={{ padding: '6rem 2rem', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">{t('section-tag.records')}</div>
          <h2 className="section-title">{t('section-title.records')}</h2>
          <p className="section-desc">{t('section-desc.records')}</p>
        </div>

        {/* Desktop grid */}
        <div className="records-grid-desktop" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: '1rem',
        }}>
          {visibleEvents.map((ev) => (
            <RecordCard key={ev.id} ev={ev} s={bestSingle[ev.id]} a={bestAverage[ev.id]} t={t} onSelect={setSelectedEvent} />
          ))}
        </div>

        {/* Mobile carousel */}
        <MobileRecordsCarousel
          events={mobileSorted}
          bestSingle={bestSingle}
          bestAverage={bestAverage}
          t={t}
          onSelect={setSelectedEvent}
        />
      </div>

      {/* Record History Modal */}
      {selectedEvent && (
        <div
          className="rh-overlay"
          onClick={() => setSelectedEvent(null)}
        >
          <div className="rh-modal" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="rh-header">
              <div>
                <div className="rh-title">{selectedEventName}</div>
                <div className="rh-subtitle">Record History</div>
              </div>
              <button className="rh-close" onClick={() => setSelectedEvent(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="rh-tabs">
              {(['single', 'average'] as const).map((tab) => (
                <button
                  key={tab}
                  className={`rh-tab${historyTab === tab ? ' active' : ''}`}
                  onClick={() => setHistoryTab(tab)}
                >
                  {tab === 'single' ? t('rankings.single') : t('rankings.average')}
                </button>
              ))}
            </div>

            {/* Timeline */}
            <div className="rh-body">
              {history.length === 0 ? (
                <div className="rh-empty">
                  <div style={{ fontSize: '2rem', marginBottom: '0.6rem', opacity: 0.4 }}>📊</div>
                  No records yet for this event.
                </div>
              ) : history.length === 1 ? (
                <div>
                  <div className="rh-first-badge">First Record!</div>
                  <div className="rh-row rh-current">
                    <div className="rh-row-date">{history[0].date}</div>
                    <div className="rh-row-main">
                      <span className="rh-row-time">{fmtTime(history[0].time)}</span>
                      <span className="rh-row-name">{history[0].name}</span>
                    </div>
                    <div className="rh-row-comp">{history[0].competitionName}</div>
                    <span className="rh-current-badge">Current Record</span>
                  </div>
                  <div className="rh-empty" style={{ paddingTop: '1rem' }}>
                    No previous records — this is the first record!
                  </div>
                </div>
              ) : (
                <div className="rh-timeline">
                  {history.map((entry, i) => (
                    <div key={i} className={`rh-row${entry.isCurrent ? ' rh-current' : ''}`}>
                      <div className="rh-tl-dot" />
                      <div className="rh-row-date">{entry.date}</div>
                      <div className="rh-row-main">
                        <span className="rh-row-time">{fmtTime(entry.time)}</span>
                        <span className="rh-row-name">{entry.name}</span>
                      </div>
                      <div className="rh-row-comp">{entry.competitionName}</div>
                      {entry.isCurrent && <span className="rh-current-badge">Current Record</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title {
          font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800;
          color: var(--text-primary); margin-bottom: 0.6rem; text-align: center;
          display: block; border-bottom: none; padding-bottom: 0; text-transform: none; letter-spacing: normal;
        }
        .section-title::before { display: none; }
        .section-desc { font-size: 1rem; color: var(--muted); max-width: 580px; margin: 0 auto; line-height: 1.65; }
        .record-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 1.4rem;
          transition: border-color 0.25s, box-shadow 0.25s; cursor: pointer;
        }
        .record-card:hover { border-color: rgba(124,58,237,0.4); box-shadow: 0 0 18px var(--glow); }

        /* Record History Modal */
        .rh-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2000;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 1rem;
          animation: rhFadeIn 0.18s ease;
        }
        .rh-modal {
          width: 100%; max-width: 600px; max-height: 90vh;
          background: var(--bg); border: 1px solid rgba(124,58,237,0.25);
          border-radius: 16px; display: flex; flex-direction: column;
          animation: rhSlideIn 0.22s cubic-bezier(.4,0,.2,1);
        }
        .rh-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1.2rem 1.5rem; border-bottom: 1px solid rgba(124,58,237,0.2); flex-shrink: 0;
        }
        .rh-title {
          font-size: 1.1rem; font-weight: 700; color: var(--text);
        }
        .rh-subtitle {
          font-size: 0.78rem; color: var(--muted); margin-top: 0.1rem;
        }
        .rh-close {
          background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
          color: var(--muted); cursor: pointer; padding: 0.35rem;
          display: flex; align-items: center; justify-content: center;
          transition: border-color 0.2s, color 0.2s;
        }
        .rh-close:hover { border-color: rgba(124,58,237,0.4); color: var(--text); }
        .rh-tabs {
          display: flex; gap: 0.4rem; padding: 0.8rem 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .rh-tab {
          padding: 0.35rem 0.9rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600;
          border: 1px solid rgba(255,255,255,0.1); background: transparent; color: var(--muted);
          cursor: pointer; transition: all 0.2s; font-family: inherit;
        }
        .rh-tab:hover { color: var(--text); border-color: rgba(124,58,237,0.4); }
        .rh-tab.active { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; border-color: transparent; }
        .rh-body {
          overflow-y: auto; flex: 1; padding: 1.2rem 1.5rem;
        }
        .rh-empty {
          text-align: center; padding: 2rem 1rem; color: var(--muted); font-size: 0.9rem;
        }
        .rh-first-badge {
          text-align: center; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: #4ade80; margin-bottom: 1rem;
        }
        .rh-timeline { position: relative; padding-left: 1.2rem; }
        .rh-timeline::before {
          content: ''; position: absolute; left: 5px; top: 0.6rem; bottom: 0.6rem;
          width: 2px; background: rgba(124,58,237,0.25); border-radius: 1px;
        }
        .rh-row {
          position: relative; padding: 0.8rem 1rem; margin-bottom: 0.5rem;
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px; transition: border-color 0.2s;
        }
        .rh-row:hover { border-color: rgba(124,58,237,0.3); }
        .rh-current {
          border-color: rgba(124,58,237,0.4);
          background: rgba(124,58,237,0.08);
        }
        .rh-tl-dot {
          position: absolute; left: -1.2rem; top: 1.1rem;
          width: 10px; height: 10px; border-radius: 50%;
          background: rgba(124,58,237,0.5); border: 2px solid var(--bg);
        }
        .rh-current .rh-tl-dot {
          background: var(--accent); box-shadow: 0 0 8px rgba(124,58,237,0.5);
        }
        .rh-row-date {
          font-size: 0.7rem; color: var(--muted); margin-bottom: 0.25rem; white-space: nowrap;
        }
        .rh-row-main {
          display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.15rem;
        }
        .rh-row-time {
          font-family: monospace; font-size: 1.15rem; font-weight: 700; color: #a78bfa;
        }
        .rh-row-name {
          font-size: 0.88rem; font-weight: 600; color: var(--text);
        }
        .rh-row-comp {
          font-size: 0.78rem; color: var(--muted);
        }
        .rh-current-badge {
          display: inline-block; margin-top: 0.4rem;
          font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          background: rgba(124,58,237,0.2); color: #a78bfa;
          border: 1px solid rgba(124,58,237,0.3);
          padding: 0.15rem 0.5rem; border-radius: 999px;
        }

        @keyframes rhFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rhSlideIn { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }

        .rec-mobile-carousel { display: none; }
        @media (max-width: 700px) {
          #records { padding: 1rem 0.75rem; }
          #records > div { max-width: none; padding: 0; }
          .records-grid-desktop { display: none !important; }
          .rec-mobile-carousel { display: block; }
          .rh-overlay { align-items: flex-end; padding: 0; }
          .rh-modal {
            max-width: 100%; max-height: 85vh;
            border-radius: 16px 16px 0 0;
            border-bottom: none;
            animation: rhSlideUp 0.25s cubic-bezier(.4,0,.2,1);
          }
          .rh-header { padding: 1rem 1.2rem; }
          .rh-tabs { padding: 0.6rem 1.2rem; }
          .rh-body { padding: 1rem 1.2rem; }
        }
        @keyframes rhSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </section>
  );
}

function RecordRow({ label, entry, isAvg }: { label: string; entry: RecordEntry | undefined; isAvg?: boolean }) {
  return (
    <div style={{
      marginBottom: 0,
      ...(isAvg ? { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.8rem', marginTop: '0.8rem' } : {}),
    }}>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.2rem' }}>
        {label}
      </div>
      {entry ? (
        <>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'monospace', color: '#a78bfa', marginBottom: '0.2rem' }}>
            {fmtTime(entry.time)}
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{entry.name}</div>
        </>
      ) : (
        <div style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: '1.1rem' }}>—</div>
      )}
    </div>
  );
}

interface WcaEvent { id: string; name: string; short: string }

function RecordCard({ ev, s, a, t, onSelect }: {
  ev: WcaEvent;
  s: RecordEntry | undefined;
  a: RecordEntry | undefined;
  t: (k: TranslationKey) => string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="record-card" onClick={() => onSelect(ev.id)}>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.9rem' }}>
        {ev.name}
      </div>
      <RecordRow label={t('records.single-record')} entry={s} />
      <RecordRow label={t('records.average-record')} entry={a} isAvg />
    </div>
  );
}

// ── Mobile Records Carousel ─────────────────────────────────────────────────

const CARDS_PER_SLIDE = 2;
const AUTO_INTERVAL = 6000;

function MobileRecordsCarousel({ events, bestSingle, bestAverage, t, onSelect }: {
  events: WcaEvent[];
  bestSingle: Record<string, RecordEntry>;
  bestAverage: Record<string, RecordEntry>;
  t: (k: TranslationKey) => string;
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const startX = useRef(0);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalPages = Math.ceil(events.length / CARDS_PER_SLIDE);

  // Build slides: array of 2-card groups
  const slides = useMemo(() => {
    const s: WcaEvent[][] = [];
    for (let i = 0; i < events.length; i += CARDS_PER_SLIDE) {
      s.push(events.slice(i, i + CARDS_PER_SLIDE));
    }
    return s;
  }, [events]);

  function resetAuto() {
    if (autoRef.current) clearInterval(autoRef.current);
    if (totalPages <= 1) return;
    autoRef.current = setInterval(() => {
      setPage((p) => (p + 1) % totalPages);
    }, AUTO_INTERVAL);
  }

  useEffect(() => {
    resetAuto();
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  }, [totalPages]);

  function onTouchStart(e: React.TouchEvent) { startX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    const diff = startX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) < 40) return;
    if (diff > 0) setPage((p) => Math.min(p + 1, totalPages - 1));
    else setPage((p) => Math.max(p - 1, 0));
    resetAuto();
  }

  return (
    <div className="rec-mobile-carousel">
      {/* Viewport — clips overflow */}
      <div
        style={{ overflow: 'hidden' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Track — all slides side by side, moved via translateX */}
        <div
          className="rec-carousel-track"
          style={{
            display: 'flex',
            transform: `translateX(-${page * 100}%)`,
          }}
        >
          {slides.map((group, si) => (
            <div
              key={si}
              className={`rec-carousel-slide${si === page ? ' rec-slide-active' : ''}`}
              style={{
                minWidth: '100%', flex: '0 0 100%',
                display: 'flex', flexDirection: 'column', gap: '0.75rem',
              }}
            >
              {group.map((ev) => (
                <RecordCard
                  key={ev.id}
                  ev={ev}
                  s={bestSingle[ev.id]}
                  a={bestAverage[ev.id]}
                  t={t}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '1.2rem' }}>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => { setPage(i); resetAuto(); }}
              className={`rec-dot${i === page ? ' rec-dot-active' : ''}`}
            />
          ))}
        </div>
      )}

      <style>{`
        .rec-carousel-track {
          transition: transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          will-change: transform;
        }
        .rec-carousel-slide { opacity: 0.4; transition: opacity 0.45s ease; }
        .rec-slide-active { opacity: 1; animation: recSlideIn 0.45s ease; }
        @keyframes recSlideIn {
          from { opacity: 0.7; transform: scale(0.95); }
          to   { opacity: 1;   transform: scale(1); }
        }
        .rec-dot {
          height: 8px; border-radius: 999px; border: none; padding: 0; cursor: pointer;
          background: rgba(255,255,255,0.2); width: 8px;
          transition: width 0.3s ease, background 0.3s ease;
        }
        .rec-dot-active {
          width: 20px; background: var(--accent);
        }
      `}</style>
    </div>
  );
}
