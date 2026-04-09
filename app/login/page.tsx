'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { findUserByUsername } from '@/lib/firebase/services/users';
import ThemeToggle from '@/components/layout/ThemeToggle';
import LangToggle from '@/components/layout/LangToggle';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-login check
  useEffect(() => {
    try {
      const session = JSON.parse(localStorage.getItem('cubeAthleteUser') || 'null');
      if (session?.athleteId || session?.role === 'results_entry') {
        router.replace('/dashboard');
      }
    } catch {
      localStorage.removeItem('cubeAthleteUser');
    }
  }, [router]);

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
      router.push('/dashboard');
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
