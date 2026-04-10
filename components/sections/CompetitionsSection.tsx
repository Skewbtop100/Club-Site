'use client';

import { useMemo, useState, useEffect } from 'react';
import { WCA_EVENTS } from '@/lib/wca-events';
import { fmtTime, compareTime } from '@/lib/time-utils';
import { getResultsByComp } from '@/lib/firebase/services/results';
import { subscribeResultsByComp } from '@/lib/firebase/services/results';
import type { Competition, Result } from '@/lib/types';

interface Props {
  competitions: Competition[];
  loading: boolean;
}

type Status = 'upcoming' | 'live' | 'finished';
type OverlayType = 'results' | 'live' | 'assignments';

function formatCompDate(date: Competition['date']): string {
  if (!date) return '—';
  if (typeof date === 'object' && 'toDate' in date) {
    return date.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return String(date);
}

export default function CompetitionsSection({ competitions, loading }: Props) {
  const defaultTab = useMemo<Status>(() => {
    if (competitions.some((c) => c.status === 'live')) return 'live';
    if (competitions.some((c) => c.status === 'upcoming')) return 'upcoming';
    return 'finished';
  }, [competitions]);

  const [tab, setTab] = useState<Status | null>(null);
  const activeTab = tab ?? defaultTab;
  const filtered = competitions.filter((c) => c.status === activeTab);

  const [overlay, setOverlay] = useState<{ comp: Competition; type: OverlayType } | null>(null);

  return (
    <section id="competitions" style={{ padding: '6rem 2rem', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">COMPETITIONS</div>
          <h2 className="section-title">Competition Schedule</h2>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.8rem' }}>
          {(['upcoming', 'live', 'finished'] as Status[]).map((s) => (
            <button key={s} onClick={() => setTab(s)} className={`tab-btn${activeTab === s ? ' active' : ''}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            No {activeTab} competitions.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.1rem' }}>
            {filtered.map((comp) => (
              <CompCard
                key={comp.id}
                comp={comp}
                onViewResults={() => setOverlay({ comp, type: 'results' })}
                onViewLive={() => setOverlay({ comp, type: 'live' })}
                onViewAssignments={() => setOverlay({ comp, type: 'assignments' })}
              />
            ))}
          </div>
        )}
      </div>

      {overlay && (
        overlay.type === 'live'
          ? <LiveResultsOverlay comp={overlay.comp} onClose={() => setOverlay(null)} />
          : overlay.type === 'assignments'
          ? <AssignmentsOverlay comp={overlay.comp} onClose={() => setOverlay(null)} />
          : <CompResultsOverlay comp={overlay.comp} onClose={() => setOverlay(null)} />
      )}

      <style>{`
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; color: var(--text-primary); margin-bottom: 0.6rem; text-align: center; }
        .tab-btn {
          flex-shrink: 0; padding: 0.4rem 0.95rem; border-radius: 999px;
          font-size: 0.8rem; font-weight: 600; border: 1px solid rgba(255,255,255,0.1);
          background: transparent; color: var(--muted); cursor: pointer; transition: all 0.2s; font-family: inherit;
        }
        .tab-btn:hover { color: var(--text); border-color: rgba(124,58,237,0.4); }
        .tab-btn.active { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; border-color: transparent; }
        .comp-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 1.4rem;
          transition: border-color 0.25s, transform 0.25s;
        }
        .comp-card:hover { border-color: rgba(124,58,237,0.25); transform: translateY(-3px); }
        .status-pill {
          display: inline-flex; align-items: center; gap: 0.35rem;
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.07em;
          text-transform: uppercase; padding: 0.25rem 0.7rem; border-radius: 999px; margin-bottom: 0.8rem;
        }
        .status-upcoming { background: rgba(124,58,237,0.15); color: #a78bfa; border: 1px solid rgba(124,58,237,0.25); }
        .status-live { background: rgba(74,222,128,0.1); color: #4ade80; border: 1px solid rgba(74,222,128,0.25); }
        .status-finished { background: rgba(100,116,139,0.15); color: var(--muted); border: 1px solid rgba(100,116,139,0.2); }
        .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; animation: pulseDot 1.4s ease-in-out infinite; display: inline-block; }
        @keyframes pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.7); } }
        .event-pill { font-size: 0.78rem; padding: 0.18rem 0.42rem; border-radius: 999px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.2); color: #a78bfa; display: inline-flex; align-items: center; }
        .comp-action, .comp-action-outline {
          height: 2.2rem; padding: 0 1.1rem; border-radius: 8px;
          font-size: 0.82rem; font-weight: 600; cursor: pointer; white-space: nowrap;
          display: inline-flex; align-items: center; justify-content: center; font-family: inherit;
        }
        .comp-action { background: linear-gradient(135deg,var(--accent),var(--accent2)); color: #fff; border: none; transition: opacity 0.2s; }
        .comp-action:hover { opacity: 0.85; }
        .comp-action-outline { background: transparent; color: #a78bfa; border: 1px solid rgba(124,58,237,0.38); transition: all 0.2s; }
        .comp-action-outline:hover { background: rgba(124,58,237,0.12); border-color: rgba(124,58,237,0.65); }
        .spinner { width:32px;height:32px;border-radius:50%;border:3px solid rgba(124,58,237,0.2);border-top-color:var(--accent);animation:spin .8s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        .empty-state { text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.95rem; }
        .empty-icon { font-size:2.5rem;margin-bottom:.7rem;opacity:.4; }
      `}</style>
    </section>
  );
}

// ── CompCard ──────────────────────────────────────────────────────────────────

function CompCard({
  comp,
  onViewResults,
  onViewLive,
  onViewAssignments,
}: {
  comp: Competition;
  onViewResults: () => void;
  onViewLive: () => void;
  onViewAssignments: () => void;
}) {
  const statusClass = comp.status === 'live' ? 'status-live' : comp.status === 'upcoming' ? 'status-upcoming' : 'status-finished';
  const dateStr = formatCompDate(comp.date);
  const eventIds = comp.events ? Object.keys(comp.events) : [];
  const meta = [comp.country, dateStr !== '—' ? dateStr : ''].filter(Boolean).join(' · ');

  return (
    <div className="comp-card">
      <div className={`status-pill ${statusClass}`}>
        {comp.status === 'live' && <span className="live-dot" />}
        {comp.status === 'live' ? 'LIVE' : comp.status === 'upcoming' ? '● UPCOMING' : '✓ FINISHED'}
      </div>

      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
        {comp.name || '—'}
      </div>
      <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '0.8rem' }}>{meta}</div>

      {eventIds.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '1rem' }}>
          {eventIds.map((eid) => {
            const ev = WCA_EVENTS.find((e) => e.id === eid);
            return ev ? (
              <span key={eid} className="event-pill" title={ev.name}>
                <span style={{ fontSize: '0.85em', fontWeight: 600 }}>{ev.short}</span>
              </span>
            ) : null;
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'nowrap', marginTop: '0.5rem', alignItems: 'center' }}>
        {comp.status === 'live' && (
          <button className="comp-action" onClick={onViewLive}>View Live Results</button>
        )}
        {comp.status === 'finished' && (
          <button className="comp-action" onClick={onViewResults}>View Results</button>
        )}
        <button className="comp-action-outline" onClick={onViewAssignments}>Assignments</button>
      </div>
    </div>
  );
}

// ── Shared overlay shell ──────────────────────────────────────────────────────

function OverlayShell({
  title,
  subtitle,
  onClose,
  children,
  liveIndicator,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  liveIndicator?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', animation: 'overlayIn 0.18s ease' }}
      onClick={onClose}
    >
        <div
          style={{ width: '100%', maxWidth: '760px', maxHeight: '90vh', background: 'var(--bg)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: '16px', display: 'flex', flexDirection: 'column', animation: 'slideIn 0.22s cubic-bezier(.4,0,.2,1)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ borderBottom: '1px solid rgba(124,58,237,0.2)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {liveIndicator && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 700, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', animation: 'pulseDot 1.4s ease-in-out infinite', display: 'inline-block' }} />
                    LIVE
                  </span>
                )}
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
              </div>
              {subtitle && <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.15rem' }}>{subtitle}</div>}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer', padding: '0.35rem 0.8rem', fontSize: '0.82rem', fontFamily: 'inherit' }}>
              ← Back
            </button>
          </div>
          {/* Body */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
            {children}
          </div>
        </div>
      <style>{`
        @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.7); } }
      `}</style>
    </div>
  );
}

// ── Results table ─────────────────────────────────────────────────────────────

function ResultsTable({ results }: { results: Result[] }) {
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const [activeRound, setActiveRound] = useState<number>(1);

  const eventIds = useMemo(() => {
    const order = WCA_EVENTS.map((e) => e.id);
    const ids = [...new Set(results.map((r) => r.eventId))];
    return ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [results]);

  const selectedEvent = activeEvent ?? eventIds[0] ?? null;

  const rounds = useMemo(() => {
    if (!selectedEvent) return [];
    const rSet = new Set(results.filter((r) => r.eventId === selectedEvent).map((r) => r.round || 1));
    return [...rSet].sort((a, b) => a - b);
  }, [results, selectedEvent]);

  // Reset round when event changes
  useEffect(() => {
    setActiveRound(rounds[rounds.length - 1] ?? 1);
  }, [selectedEvent, rounds.length]);

  const tableRows = useMemo(() => {
    if (!selectedEvent) return [];
    return results
      .filter((r) => r.eventId === selectedEvent && (r.round || 1) === activeRound)
      .sort((a, b) => compareTime(
        a.average !== null && a.average > 0 ? a.average : a.single,
        b.average !== null && b.average > 0 ? b.average : b.single
      ));
  }, [results, selectedEvent, activeRound]);

  if (eventIds.length === 0) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>No results yet.</div>;
  }

  return (
    <div>
      {/* Event tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {eventIds.map((eid) => {
          const ev = WCA_EVENTS.find((e) => e.id === eid);
          return (
            <button
              key={eid}
              onClick={() => setActiveEvent(eid)}
              style={{
                padding: '0.3rem 0.7rem', borderRadius: '999px', border: 'none',
                fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: selectedEvent === eid ? 'linear-gradient(135deg,var(--accent),var(--accent2))' : 'rgba(124,58,237,0.1)',
                color: selectedEvent === eid ? '#fff' : '#a78bfa',
              }}
            >
              {ev?.short || eid}
            </button>
          );
        })}
      </div>

      {/* Round tabs */}
      {rounds.length > 1 && (
        <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1rem' }}>
          {rounds.map((r) => (
            <button
              key={r}
              onClick={() => setActiveRound(r)}
              style={{
                padding: '0.25rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
                fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: activeRound === r ? 'rgba(124,58,237,0.25)' : 'transparent',
                color: activeRound === r ? '#c4b5fd' : 'var(--muted)',
              }}
            >
              Round {r}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['#', 'Athlete', 'Single', 'Average', '1', '2', '3', '4', '5'].map((h) => (
                <th key={h} style={{ padding: '0.6rem 0.8rem', textAlign: 'left', fontSize: '0.68rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r, i) => (
              <tr key={r.id || i} style={{ borderBottom: i < tableRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <td style={{ padding: '0.55rem 0.8rem', fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600 }}>{i + 1}</td>
                <td style={{ padding: '0.55rem 0.8rem', fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 500 }}>{r.athleteName || r.athleteId}</td>
                <td style={{ padding: '0.55rem 0.8rem', fontFamily: 'monospace', fontSize: '0.88rem', color: '#a78bfa', fontWeight: 600 }}>{fmtTime(r.single)}</td>
                <td style={{ padding: '0.55rem 0.8rem', fontFamily: 'monospace', fontSize: '0.88rem', color: r.average !== null && r.average > 0 ? '#a78bfa' : 'var(--muted)', fontWeight: r.average !== null && r.average > 0 ? 600 : 400 }}>{r.average !== null ? fmtTime(r.average) : '—'}</td>
                {[0, 1, 2, 3, 4].map((si) => (
                  <td key={si} style={{ padding: '0.55rem 0.8rem', fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {r.solves?.[si] !== undefined ? fmtTime(r.solves[si]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CompResultsOverlay ────────────────────────────────────────────────────────

function CompResultsOverlay({ comp, onClose }: { comp: Competition; onClose: () => void }) {
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    getResultsByComp(comp.id).then((r) => {
      setResults(r.filter((x) => x.status === 'published'));
    }).catch(() => setResults([]));
  }, [comp.id]);

  const dateStr = formatCompDate(comp.date);
  const meta = [comp.country, dateStr !== '—' ? dateStr : ''].filter(Boolean).join(' · ');

  return (
    <OverlayShell title={comp.name} subtitle={meta} onClose={onClose}>
      {results === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div className="spinner" />
        </div>
      ) : (
        <ResultsTable results={results} />
      )}
    </OverlayShell>
  );
}

// ── LiveResultsOverlay ────────────────────────────────────────────────────────

function LiveResultsOverlay({ comp, onClose }: { comp: Competition; onClose: () => void }) {
  const [results, setResults] = useState<Result[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = subscribeResultsByComp(comp.id, (r) => {
      setResults(r.filter((x) => x.status === 'published'));
      setReady(true);
    });
    return unsub;
  }, [comp.id]);

  const dateStr = formatCompDate(comp.date);
  const meta = [comp.country, dateStr !== '—' ? dateStr : ''].filter(Boolean).join(' · ');

  return (
    <OverlayShell title={comp.name} subtitle={meta} onClose={onClose} liveIndicator>
      {!ready ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div className="spinner" />
        </div>
      ) : (
        <ResultsTable results={results} />
      )}
    </OverlayShell>
  );
}

// ── AssignmentsOverlay ────────────────────────────────────────────────────────

function AssignmentsOverlay({ comp, onClose }: { comp: Competition; onClose: () => void }) {
  const dateStr = formatCompDate(comp.date);
  const meta = [comp.country, dateStr !== '—' ? dateStr : ''].filter(Boolean).join(' · ');

  return (
    <OverlayShell title={comp.name} subtitle={meta} onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.6rem' }}>📋</div>
        No assignments published for this competition yet.
      </div>
    </OverlayShell>
  );
}
