'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import ThemeToggle from '@/components/layout/ThemeToggle';
import LangToggle from '@/components/layout/LangToggle';

// Lazy-load heavy tab components
const AthletesTab     = dynamic(() => import('@/components/admin/AthletesTab'),     { ssr: false });
const CompetitionsTab = dynamic(() => import('@/components/admin/CompetitionsTab'), { ssr: false });
const ResultsEntryTab = dynamic(() => import('@/components/admin/ResultsEntryTab'), { ssr: false });
const CompResultsTab  = dynamic(() => import('@/components/admin/CompResultsTab'),  { ssr: false });
const HistoryTab      = dynamic(() => import('@/components/admin/HistoryTab'),      { ssr: false });
const UsersTab        = dynamic(() => import('@/components/admin/UsersTab'),        { ssr: false });
const WcaImportTab    = dynamic(() => import('@/components/admin/WcaImportTab'),    { ssr: false });
const EventSettingsTab = dynamic(() => import('@/components/admin/EventSettingsTab'),{ ssr: false });
const AnalyticsTab    = dynamic(() => import('@/components/admin/AnalyticsTab'),    { ssr: false });
const AssignmentsTab  = dynamic(() => import('@/components/admin/AssignmentsTab'),  { ssr: false });

type Tab =
  | 'athletes' | 'competitions' | 'results' | 'compResults'
  | 'history'  | 'users'        | 'wcaImport' | 'events'
  | 'analytics' | 'assignments';

const TABS: { id: Tab; label: string }[] = [
  { id: 'athletes',     label: '👤 Athletes' },
  { id: 'competitions', label: '🏆 Competitions' },
  { id: 'results',      label: '✎ Results Entry' },
  { id: 'compResults',  label: '📋 Competition Results' },
  { id: 'history',      label: '📄 History' },
  { id: 'users',        label: '🔑 Users' },
  { id: 'wcaImport',   label: '🌍 WCA Import' },
  { id: 'events',       label: '⚙ Events' },
  { id: 'analytics',   label: '📊 Analytics' },
  { id: 'assignments',  label: '👥 Assignments' },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('athletes');
  const [menuOpen, setMenuOpen]   = useState(false);

  useEffect(() => {
    if (localStorage.getItem('isAdmin') !== 'true') {
      router.replace('/admin');
    }
  }, [router]);

  function signOut() {
    localStorage.removeItem('isAdmin');
    router.push('/admin');
  }

  function renderTab() {
    switch (activeTab) {
      case 'athletes':     return <AthletesTab />;
      case 'competitions': return <CompetitionsTab />;
      case 'results':      return <ResultsEntryTab />;
      case 'compResults':  return <CompResultsTab />;
      case 'history':      return <HistoryTab />;
      case 'users':        return <UsersTab />;
      case 'wcaImport':    return <WcaImportTab />;
      case 'events':       return <EventSettingsTab />;
      case 'analytics':    return <AnalyticsTab />;
      case 'assignments':  return <AssignmentsTab />;
      default:             return null;
    }
  }

  return (
    <div style={{
      background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Background */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 20% 20%, rgba(124,58,237,0.18) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 80% 80%, rgba(236,72,153,0.14) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '1380px', width: '100%', margin: '0 auto', padding: '2rem 1rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{
              fontSize: '1.32rem', fontWeight: 800,
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>Admin Dashboard</h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.1rem' }}>Cube MN Competition Management</p>
          </div>

          {/* Admin menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.45rem',
                padding: '0.38rem 0.75rem 0.38rem 0.6rem', borderRadius: '10px',
                border: `1px solid ${menuOpen ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.1)'}`,
                background: menuOpen ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.05)',
                color: 'var(--text)', fontSize: '0.83rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              <span>Admin</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                style={{ width: 13, height: 13, opacity: 0.5, transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={() => setMenuOpen(false)} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 9px)', right: 0, minWidth: '220px',
                  background: 'var(--card)', border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: '14px', padding: '5px',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
                  display: 'flex', flexDirection: 'column', gap: '2px', zIndex: 1100,
                }}>
                  <a href="/" className="nd-link">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                    Homepage
                  </a>
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '3px 6px' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.42rem 0.65rem', borderRadius: '9px', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.77rem', color: 'var(--muted)', fontWeight: 500 }}>Language</span>
                    <LangToggle />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.42rem 0.65rem', borderRadius: '9px', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.77rem', color: 'var(--muted)', fontWeight: 500 }}>Theme</span>
                    <ThemeToggle />
                  </div>
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '3px 6px' }} />
                  <button className="nd-signout" onClick={signOut}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                    </svg>
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tab Nav */}
        <div className="tab-nav" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {renderTab()}
      </div>

      <style>{`
        @media (max-width: 700px) {
          .tab-nav { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          .tab-nav::-webkit-scrollbar { display: none; }
          .tab-btn { flex-shrink: 0; font-size: 0.75rem; padding: 0.38rem 0.7rem; }
        }
      `}</style>
    </div>
  );
}
