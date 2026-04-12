'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n';
import ThemeToggle from './ThemeToggle';
import LangToggle from './LangToggle';

type SessionRole = 'admin' | 'athlete' | 'results_entry' | null;

function getSessionRole(): SessionRole {
  try {
    if (localStorage.getItem('isAdmin') === 'true') return 'admin';
    const user =
      JSON.parse(localStorage.getItem('cubeAthleteUser') || 'null') ??
      JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (user?.role === 'admin') return 'admin';
    if (user?.role === 'results_entry') return 'results_entry';
    if (user?.athleteId) return 'athlete';
  } catch {}
  return null;
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<SessionRole>(null);
  const router = useRouter();
  const { t } = useLang();

  useEffect(() => {
    setRole(getSessionRole());
  }, []);

  function signOut() {
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('cubeAthleteUser');
    localStorage.removeItem('currentUser');
    setRole(null);
    setOpen(false);
    router.push('/');
  }

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: 'var(--nav-bg)',
      backdropFilter: 'blur(18px)',
      borderBottom: '1px solid rgba(124,58,237,0.35)',
      padding: '0 2rem',
      height: '60px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      {/* Logo */}
      <Link href="/" style={{
        fontSize: '1.35rem', fontWeight: 800, letterSpacing: '2px',
        background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>
        MS
      </Link>

      {/* Desktop nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.6rem' }} className="nav-links">
        <Link href="/" className="nav-link hide-mobile">{t('nav.home')}</Link>
        <Link href="/competition" className="nav-link">{t('nav.competition')}</Link>
        <Link href="/timer" className="nav-link hide-mobile">{t('nav.timer')}</Link>
        <Link href="/algorithms" className="nav-link hide-mobile">{t('nav.algorithms')}</Link>
        <Link href="/gallery" className="nav-link hide-mobile">{t('nav.gallery')}</Link>

        {/* Auth dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.45rem',
              padding: '0.38rem 0.75rem 0.38rem 0.6rem', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: open ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.05)',
              borderColor: open ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.1)',
              color: 'var(--text)', fontSize: '0.83rem', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            <span>
              {role === 'admin'
                ? t('nav.admin')
                : role === 'athlete' || role === 'results_entry'
                ? t('nav.my-profile-short')
                : t('nav.sign-in')}
            </span>
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
              style={{ width: 13, height: 13, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s' }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {open && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={() => setOpen(false)} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 9px)', right: 0,
                minWidth: '216px',
                background: 'var(--card)',
                border: '1px solid rgba(255,255,255,0.09)',
                borderRadius: '14px', padding: '5px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.45), 0 0 0 1px rgba(124,58,237,0.08)',
                display: 'flex', flexDirection: 'column', gap: '2px',
                zIndex: 1100,
                animation: 'ndFadeIn 0.14s cubic-bezier(.4,0,.2,1)',
              }}>

                {role === null && (
                  <button
                    onClick={() => { setOpen(false); router.push('/login'); }}
                    className="nd-link"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.58rem 0.65rem', borderRadius: '9px',
                      fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit', width: '100%', textAlign: 'left',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
                      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
                    </svg>
                    {t('nav.sign-in')}
                  </button>
                )}

                {role === 'admin' && (
                  <>
                    <a
                      href="/admin/dashboard"
                      className="nd-link"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.58rem 0.65rem', borderRadius: '9px', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}
                      onClick={() => setOpen(false)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                      </svg>
                      {t('nav.admin-short')}
                    </a>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '3px 6px' }} />
                    <button onClick={signOut} className="nd-link" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.58rem 0.65rem', borderRadius: '9px', fontSize: '0.86rem', fontWeight: 600, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                      </svg>
                      {t('nav.sign-out')}
                    </button>
                  </>
                )}

                {(role === 'athlete' || role === 'results_entry') && (
                  <>
                    <a
                      href="/dashboard"
                      className="nd-link"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.58rem 0.65rem', borderRadius: '9px', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}
                      onClick={() => setOpen(false)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      {t('nav.my-profile-short')}
                    </a>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '3px 6px' }} />
                    <button onClick={signOut} className="nd-link" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.58rem 0.65rem', borderRadius: '9px', fontSize: '0.86rem', fontWeight: 600, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                      </svg>
                      {t('nav.sign-out')}
                    </button>
                  </>
                )}

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '3px 6px' }} />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.42rem 0.65rem', borderRadius: '9px', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.77rem', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{t('lang.label')}</span>
                  <LangToggle />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.42rem 0.65rem', borderRadius: '9px', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.77rem', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{t('theme.label')}</span>
                  <ThemeToggle />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        .nav-link {
          font-size: 0.875rem; font-weight: 500; color: var(--muted);
          transition: color 0.2s; text-decoration: none;
        }
        .nav-link:hover { color: var(--text); }
        .nd-link:hover { background: rgba(124,58,237,0.1); }
        @keyframes ndFadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 700px) { .hide-mobile { display: none !important; } }
      `}</style>
    </nav>
  );
}
