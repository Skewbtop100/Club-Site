'use client';

import { useMemo, useState } from 'react';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Competition } from '@/lib/types';

interface Props {
  competitions: Competition[];
  loading: boolean;
}

type Status = 'upcoming' | 'live' | 'finished';

function formatCompDate(date: Competition['date']): string {
  if (!date) return '—';
  if (typeof date === 'object' && 'toDate' in date) {
    return date.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return String(date);
}

export default function CompetitionsSection({ competitions, loading }: Props) {
  const defaultTab = useMemo<Status>(() => {
    if (competitions.some((c) => c.status === 'upcoming')) return 'upcoming';
    if (competitions.some((c) => c.status === 'live')) return 'live';
    return 'finished';
  }, [competitions]);

  const [tab, setTab] = useState<Status | null>(null);
  const activeTab = tab ?? defaultTab;

  const filtered = competitions.filter((c) => c.status === activeTab);

  return (
    <section id="competitions" style={{ padding: '6rem 2rem', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">COMPETITIONS</div>
          <h2 className="section-title">Competition Schedule</h2>
        </div>

        {/* Status tabs */}
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
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '1.1rem',
          }}>
            {filtered.map((comp) => <CompCard key={comp.id} comp={comp} />)}
          </div>
        )}
      </div>

      <style>{`
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; color: var(--text-primary); margin-bottom: 0.6rem; }
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
        @media (max-width: 768px) { .comp-grid { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}

function CompCard({ comp }: { comp: Competition }) {
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
          <button className="comp-action">View Live Results</button>
        )}
        {comp.status === 'finished' && (
          <button className="comp-action">View Results</button>
        )}
        <button className="comp-action-outline">Assignments</button>
      </div>
    </div>
  );
}
