'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import ThemeToggle from '@/components/layout/ThemeToggle';
import LangToggle from '@/components/layout/LangToggle';

// Path → human-readable section name shown in the header. Keep in sync
// with the page files under app/admin/*.
const SECTION_NAMES: { match: (p: string) => boolean; name: string }[] = [
  { match: (p) => p === '/admin/dashboard',                            name: 'Хяналтын самбар' },
  { match: (p) => p === '/admin/competitions' || p.startsWith('/admin/competitions/'), name: 'Тэмцээн' },
  { match: (p) => p === '/admin/club'         || p.startsWith('/admin/club/'),         name: 'Клуб' },
  { match: (p) => p === '/admin/users'        || p.startsWith('/admin/users/'),        name: 'Хэрэглэгчид' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The /admin login page lives at this same route segment. It must NOT
  // be wrapped in chrome (the user isn't authenticated yet) or gated
  // (would cause an infinite redirect loop).
  const isLoginPage = pathname === '/admin';

  if (isLoginPage) return <>{children}</>;

  return (
    <AdminGate>
      <AdminChrome pathname={pathname}>{children}</AdminChrome>
    </AdminGate>
  );
}

// ── Auth gate ─────────────────────────────────────────────────────────────
//
// Accepts any of: Firebase Google admin (user.role === 'admin'), the legacy
// localStorage `isAdmin` flag (set by /admin login), or the legacy session
// blob `cubeAthleteUser` with role: 'admin'. This matches the gating logic
// the old single-page dashboard used so we don't break either auth path.
function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    let legacyAdmin = false;
    try {
      if (typeof window !== 'undefined') {
        legacyAdmin = window.localStorage.getItem('isAdmin') === 'true';
        if (!legacyAdmin) {
          const session = JSON.parse(window.localStorage.getItem('cubeAthleteUser') || 'null');
          legacyAdmin = session?.role === 'admin';
        }
      }
    } catch { /* corrupt session blob — treat as not admin */ }

    const isAdmin = user?.role === 'admin' || legacyAdmin;
    if (!isAdmin) {
      router.replace('/admin');
      setAllowed(false);
    } else {
      setAllowed(true);
    }
  }, [loading, user, router]);

  if (allowed !== true) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <div
          aria-label="Loading"
          style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.12)',
            borderTopColor: 'var(--accent)',
            animation: 'admin-gate-spin 0.85s linear infinite',
          }}
        />
        <style>{`@keyframes admin-gate-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <>{children}</>;
}

// ── Chrome ────────────────────────────────────────────────────────────────
function AdminChrome({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const sectionName = useMemo(
    () => SECTION_NAMES.find(s => s.match(pathname))?.name ?? '',
    [pathname],
  );

  async function handleSignOut() {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('isAdmin');
      // cubeAthleteUser left intact — other parts of the app may still need it.
    }
    try { await signOut(); } catch { /* ignore — best effort */ }
    setMenuOpen(false);
    router.push('/admin');
  }

  return (
    <div style={{
      background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Background — radial glow + grid, fixed so it stays put while scrolling */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 20% 20%, rgba(124,58,237,0.18) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 80% 80%, rgba(236,72,153,0.14) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      {/* Sticky top header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'rgba(10,10,16,0.78)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{
          maxWidth: 1380, margin: '0 auto',
          padding: '0.7rem 1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '1rem',
        }}>
          <Link
            href="/admin/dashboard"
            style={{
              display: 'inline-flex', alignItems: 'baseline', gap: '0.55rem',
              textDecoration: 'none', minWidth: 0,
            }}
          >
            <span style={{
              fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.04em',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              whiteSpace: 'nowrap',
            }}>
              Админ хэсэг
            </span>
            {sectionName && (
              <>
                <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }} aria-hidden="true">/</span>
                <span style={{
                  fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{sectionName}</span>
              </>
            )}
          </Link>

          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.32rem 0.65rem 0.32rem 0.5rem', borderRadius: 10,
                border: `1px solid ${menuOpen ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.1)'}`,
                background: menuOpen ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.05)',
                color: 'var(--text)', fontSize: '0.8rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
                {user?.displayName ?? 'Админ'}
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                style={{ width: 12, height: 12, opacity: 0.55, transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={() => setMenuOpen(false)} />
                <div role="menu" style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  minWidth: 220,
                  background: 'var(--card)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: 14, padding: 5,
                  boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
                  display: 'flex', flexDirection: 'column', gap: 2, zIndex: 1100,
                }}>
                  <a href="/" onClick={() => setMenuOpen(false)} style={menuLink}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                    Нүүр хуудас руу буцах
                  </a>
                  <div style={menuDivider} />
                  <div style={menuToggleRow}>
                    <span style={menuToggleLabel}>Хэл</span>
                    <LangToggle />
                  </div>
                  <div style={menuToggleRow}>
                    <span style={menuToggleLabel}>Загвар</span>
                    <ThemeToggle />
                  </div>
                  <div style={menuDivider} />
                  <button onClick={handleSignOut} style={{ ...menuLink, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                    </svg>
                    Гарах
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </main>
    </div>
  );
}

const menuLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.5rem',
  padding: '0.55rem 0.65rem', borderRadius: 9,
  fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)',
  textDecoration: 'none', fontFamily: 'inherit',
};
const menuDivider: React.CSSProperties = {
  height: 1, background: 'rgba(255,255,255,0.07)', margin: '3px 6px',
};
const menuToggleRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0.42rem 0.65rem', borderRadius: 9, gap: '0.75rem',
};
const menuToggleLabel: React.CSSProperties = {
  fontSize: '0.77rem', color: 'var(--muted)', fontWeight: 500,
};
