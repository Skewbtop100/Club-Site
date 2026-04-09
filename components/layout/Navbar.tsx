'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import LangToggle from './LangToggle';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

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
        CUBEMN
      </Link>

      {/* Desktop nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.6rem' }} className="nav-links">
        <Link href="/#rankings" className="nav-link hide-mobile">Rankings</Link>
        <Link href="/#records" className="nav-link hide-mobile">Records</Link>
        <Link href="/#competitions" className="nav-link">Competitions</Link>
        <Link href="/#live" className="nav-link">Live</Link>
        <Link href="/#athletes" className="nav-link hide-mobile">Athletes</Link>

        {/* Admin dropdown */}
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
            <span>⚡ Admin</span>
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
              style={{ width: 13, height: 13, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s' }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {open && (
            <>
              {/* Backdrop */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: -1 }}
                onClick={() => setOpen(false)}
              />
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
                {/* Sign In */}
                <button
                  onClick={() => { setOpen(false); router.push('/login'); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.58rem 0.65rem', borderRadius: '9px',
                    fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', width: '100%', textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  className="nd-link"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
                  </svg>
                  Sign In
                </button>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '3px 6px' }} />

                {/* Language row */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.42rem 0.65rem', borderRadius: '9px', gap: '0.75rem',
                }}>
                  <span style={{ fontSize: '0.77rem', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    Language
                  </span>
                  <LangToggle />
                </div>

                {/* Theme row */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.42rem 0.65rem', borderRadius: '9px', gap: '0.75rem',
                }}>
                  <span style={{ fontSize: '0.77rem', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    Theme
                  </span>
                  <ThemeToggle />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        .nav-link {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--muted);
          transition: color 0.2s;
          text-decoration: none;
        }
        .nav-link:hover { color: var(--text); }
        .nd-link:hover { background: rgba(124,58,237,0.1); }
        @keyframes ndFadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 700px) {
          .hide-mobile { display: none !important; }
        }
      `}</style>
    </nav>
  );
}
