'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/layout/ThemeToggle';
import LangToggle from '@/components/layout/LangToggle';
import AthleteView from '@/components/dashboard/AthleteView';
import ResultsEntryView from '@/components/dashboard/ResultsEntryView';

interface Session {
  uid: string; username: string; athleteId: string | null; role: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('cubeAthleteUser');
      const s: Session | null = raw ? JSON.parse(raw) : null;
      if (!s || (!s.athleteId && s.role !== 'results_entry')) {
        router.replace('/login');
        return;
      }
      setSession(s);
    } catch {
      localStorage.removeItem('cubeAthleteUser');
      router.replace('/login');
    }
  }, [router]);

  function doLogout() {
    localStorage.removeItem('cubeAthleteUser');
    router.push('/login');
  }

  if (!session) return null;

  const isResultsEntry = session.role === 'results_entry';

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* Nav */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--nav-bg)', backdropFilter: 'blur(18px)',
        borderBottom: '1px solid rgba(124,58,237,0.3)',
        padding: '0 2rem', height: '58px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          fontSize: '1.25rem', fontWeight: 800, letterSpacing: '2px',
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>CUBEMN</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Menu dropdown */}
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
              <span>{session.username || 'Menu'}</span>
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
                  boxShadow: '0 20px 50px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', gap: '2px', zIndex: 1100,
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
                  <button className="nd-signout" onClick={doLogout}>
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
      </nav>

      {/* Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2.5rem 1.5rem 4rem' }}>
        {isResultsEntry
          ? <ResultsEntryView session={session} />
          : <AthleteView session={session} onLogout={doLogout} />
        }
      </div>

      {/* Background glow */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: -1 }}>
        <div style={{ position: 'absolute', top: '-10%', left: '20%', width: '60%', height: '60%', background: 'radial-gradient(ellipse at center, rgba(124,58,237,0.15) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '10%', width: '50%', height: '50%', background: 'radial-gradient(ellipse at center, rgba(236,72,153,0.1) 0%, transparent 70%)', filter: 'blur(40px)' }} />
      </div>
    </div>
  );
}
