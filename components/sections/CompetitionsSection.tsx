'use client';

import { useMemo, useState, useEffect } from 'react';
import { useLang } from '@/lib/i18n';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Competition, Athlete } from '@/lib/types';
import CompetitionResultsViewer from '@/components/shared/CompetitionResultsViewer';
import CompetitionHistory from '@/components/shared/CompetitionHistory';

interface Props {
  competitions: Competition[];
  athletes: Athlete[];
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

export default function CompetitionsSection({ competitions, athletes, loading }: Props) {
  const { t } = useLang();
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
          <div className="section-tag">{t('section-tag.competitions')}</div>
          <h2 className="section-title">{t('section-title.competitions')}</h2>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.8rem' }}>
          {(['upcoming', 'live', 'finished'] as Status[]).map((s) => (
            <button key={s} onClick={() => setTab(s)} className={`tab-btn${activeTab === s ? ' active' : ''}`}>
              {s === 'upcoming' ? t('comp.upcoming') : s === 'live' ? t('comp.live-tab') : t('comp.finished')}
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
            {activeTab === 'upcoming' ? t('comp.no-upcoming') : activeTab === 'live' ? t('comp.no-live') : t('comp.no-finished')}
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
        overlay.type === 'assignments'
          ? <AssignmentsOverlay comp={overlay.comp} onClose={() => setOverlay(null)} />
          : overlay.type === 'results'
            ? <CompetitionHistory
                comp={overlay.comp}
                athletes={athletes}
                onClose={() => setOverlay(null)}
              />
            : <CompetitionResultsViewer
                comp={overlay.comp}
                onClose={() => setOverlay(null)}
                isLive
              />
      )}

      <style>{`
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; color: var(--text-primary); margin-bottom: 0.6rem; text-align: center; display: block; border-bottom: none; padding-bottom: 0; text-transform: none; letter-spacing: normal; }
        .section-title::before { display: none; }
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
        @media (max-width: 700px) {
          #competitions { padding: 1rem 0.75rem; }
          #competitions > div { max-width: none; padding: 0; }
        }
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
  const { t } = useLang();
  const statusClass = comp.status === 'live' ? 'status-live' : comp.status === 'upcoming' ? 'status-upcoming' : 'status-finished';
  const dateStr = formatCompDate(comp.date);
  const clubDateStr = formatCompDate(comp.clubDate);
  const eventIds = comp.events ? Object.keys(comp.events) : [];
  const meta = [comp.country, dateStr !== '—' ? dateStr : ''].filter(Boolean).join(' · ');

  return (
    <div className="comp-card">
      <div className={`status-pill ${statusClass}`}>
        {comp.status === 'live' && <span className="live-dot" />}
        {comp.status === 'live' ? t('comp.status.live') : comp.status === 'upcoming' ? t('comp.status.upcoming') : t('comp.status.finished')}
      </div>

      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
        {comp.name || '—'}
      </div>
      <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: clubDateStr !== '—' ? '0.4rem' : '0.8rem' }}>{meta}</div>
      {clubDateStr !== '—' && (
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ opacity: 0.6, flexShrink: 0 }}>
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          <span style={{ opacity: 0.7 }}>Club event:</span>
          <span style={{ color: '#a78bfa', fontWeight: 500 }}>{clubDateStr}</span>
        </div>
      )}

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
          <button className="comp-action" onClick={onViewLive}>{t('comp.view-live')}</button>
        )}
        {comp.status === 'finished' && (
          <button className="comp-action" onClick={onViewResults}>{t('comp.view-results')}</button>
        )}
        <button className="comp-action-outline" onClick={onViewAssignments}>{t('comp.assignments')}</button>
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
  const { t } = useLang();
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
              {t('common.back')}
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

// ── AssignmentsOverlay ────────────────────────────────────────────────────────

function AssignmentsOverlay({ comp, onClose }: { comp: Competition; onClose: () => void }) {
  const { t } = useLang();
  const dateStr = formatCompDate(comp.date);
  const meta = [comp.country, dateStr !== '—' ? dateStr : ''].filter(Boolean).join(' · ');

  return (
    <OverlayShell title={comp.name} subtitle={meta} onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.6rem' }}>📋</div>
        {t('comp.no-assignments')}
      </div>
    </OverlayShell>
  );
}
