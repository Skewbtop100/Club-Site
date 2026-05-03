'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { findUserByUsername } from '@/lib/firebase/services/users';
import { useAuth } from '@/lib/auth-context';
import ThemeToggle from '@/components/layout/ThemeToggle';
import LangToggle from '@/components/layout/LangToggle';

export default function LoginPage() {
  // Next 16 requires useSearchParams to live inside a Suspense boundary.
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg)' }} />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signInWithGoogle } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // ?redirect=/foo lets other pages bounce here and come back. We sanitise
  // to relative paths only so a crafted ?redirect=https://evil can't open-
  // redirect us off-site.
  const redirectParam = searchParams.get('redirect');
  const safeRedirect =
    redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//')
      ? redirectParam
      : null;

  // Auto-redirect once a Firebase user resolves (covers both fresh sign-ins
  // and existing sessions restored on mount).
  useEffect(() => {
    if (!user) return;
    if (user.role === 'admin') {
      router.replace(safeRedirect || '/admin/dashboard');
    } else {
      router.replace(safeRedirect || '/profile');
    }
  }, [user, router, safeRedirect]);

  // Legacy localStorage-based auto-login (admin/athlete) — preserved.
  useEffect(() => {
    try {
      const session = JSON.parse(localStorage.getItem('cubeAthleteUser') || 'null');
      if (session?.role === 'admin') {
        router.replace('/admin/dashboard');
      } else if (session?.athleteId || session?.role === 'results_entry') {
        router.replace('/dashboard');
      }
    } catch {
      localStorage.removeItem('cubeAthleteUser');
    }
  }, [router]);

  async function doGoogleSignIn() {
    setError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (!result) return;
      // Mirror admin status into the legacy localStorage flag so
      // /admin/dashboard's existing gate still passes for Google admins
      // without changing the dashboard internals.
      if (result.role === 'admin') {
        try { localStorage.setItem('isAdmin', 'true'); } catch {}
        router.replace(safeRedirect || '/admin/dashboard');
      } else {
        router.replace(safeRedirect || '/profile');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Popup-closed-by-user is benign — don't scare the user.
      if (!/popup-closed-by-user|cancelled-popup-request/i.test(msg)) {
        setError('Google sign-in failed: ' + msg);
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function doLogin() {
    setError('');
    if (!username || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setLoading(true);
    try {
      const user = await findUserByUsername(username);
      if (!user || user.password !== password) {
        setError('Invalid username or password.');
        return;
      }
      localStorage.setItem('cubeAthleteUser', JSON.stringify({
        uid: user.id,
        username: user.username,
        athleteId: user.athleteId || null,
        role: user.role || 'athlete',
      }));
      router.push(user.role === 'admin' ? '/admin/dashboard' : '/dashboard');
    } catch (e: unknown) {
      setError('Login failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-bg" style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '2rem 1rem', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px' }}>
        <a href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none',
          marginBottom: '1.5rem', transition: 'color 0.2s',
        }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
        >
          ← Back to main site
        </a>

        <div style={{
          background: 'var(--card)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '20px', padding: '2.4rem 2.2rem',
          boxShadow: '0 25px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(124,58,237,0.1)',
        }}>
          {/* Brand */}
          <div style={{ textAlign: 'center', marginBottom: '1.8rem' }}>
            <span style={{ fontSize: '2.4rem', display: 'block', marginBottom: '0.35rem' }}>🧊</span>
            <div style={{
              fontSize: '1.8rem', fontWeight: 800, letterSpacing: '0.05em',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>CUBE MN</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: '0.3rem' }}>Athlete Portal</div>
          </div>

          {/* Google sign-in (primary path for members) */}
          <button
            onClick={doGoogleSignIn}
            disabled={googleLoading}
            style={{
              width: '100%', padding: '0.75rem 1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
              background: '#fff', color: '#1f1f1f',
              border: '1px solid #dadce0', borderRadius: '9px',
              fontSize: '0.95rem', fontWeight: 600, fontFamily: 'inherit',
              cursor: googleLoading ? 'not-allowed' : 'pointer',
              opacity: googleLoading ? 0.65 : 1,
              boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
              transition: 'opacity 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { if (!googleLoading) e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.16)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)'; }}
          >
            {/* Google "G" — official 4-colour mark */}
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
              <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
              <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
              <path fill="#EA4335" d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 3.18 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7C13.42 13.62 18.27 9.75 24 9.75z"/>
            </svg>
            <span>{googleLoading ? 'Signing in…' : 'Sign in with Google'}</span>
          </button>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.7rem',
            margin: '1.4rem 0 1rem',
            color: 'var(--muted)', fontSize: '0.72rem',
            letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600,
          }}>
            <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
            <span>or admin login</span>
            <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
          </div>

          {/* Username */}
          <div className="form-group">
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && document.getElementById('pw-input')?.focus()}
              placeholder="Enter your username"
              autoComplete="username"
              style={{
                width: '100%', padding: '0.72rem 0.95rem',
                background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                borderRadius: '9px', color: 'var(--text)', fontSize: '0.95rem',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.15)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--input-border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Password */}
          <div className="form-group">
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              Password
            </label>
            <input
              id="pw-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
              placeholder="Enter your password"
              autoComplete="current-password"
              style={{
                width: '100%', padding: '0.72rem 0.95rem',
                background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                borderRadius: '9px', color: 'var(--text)', fontSize: '0.95rem',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.15)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--input-border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Submit */}
          <button
            onClick={doLogin}
            disabled={loading}
            style={{
              width: '100%', padding: '0.8rem', marginTop: '0.4rem',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              border: 'none', borderRadius: '9px', color: '#fff',
              fontSize: '0.96rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s, transform 0.15s',
              letterSpacing: '0.03em', fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88'; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = '1'; }}
          >
            {loading ? 'Checking credentials…' : 'Sign In to My Profile'}
          </button>

          {/* Error */}
          {error && (
            <div style={{
              marginTop: '0.9rem', padding: '0.65rem 0.9rem',
              background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)',
              borderRadius: '8px', color: '#f87171', fontSize: '0.84rem',
            }}>
              {error}
            </div>
          )}

          {/* Theme / Lang row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.4rem' }}>
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>

      <style>{`
        html[data-theme="soft-light"] .portal-bg > div > div:last-child,
        html[data-theme="purple-light"] .portal-bg > div > div:last-child {
          border-color: rgba(0,0,0,0.09);
          box-shadow: 0 8px 30px rgba(0,0,0,0.08);
        }
      `}</style>
    </div>
  );
}
