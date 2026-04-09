'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/layout/ThemeToggle';

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Skewbtop100@';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('isAdmin') === 'true') {
      router.replace('/admin/dashboard');
    }
  }, [router]);

  function doLogin() {
    if (username.trim() === ADMIN_USER && password === ADMIN_PASS) {
      localStorage.setItem('isAdmin', 'true');
      router.push('/admin/dashboard');
    } else {
      setError(true);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '2rem 1rem', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 20% 20%, rgba(124,58,237,0.18) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 80% 80%, rgba(236,72,153,0.14) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px' }}>
        <div style={{
          background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '20px', padding: '2.5rem 2.2rem',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.1)',
        }}>
          {/* Brand */}
          <div style={{ textAlign: 'center', marginBottom: '1.6rem' }}>
            <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: '0.4rem' }}>🧊</span>
            <div style={{
              fontSize: '1.9rem', fontWeight: 800, letterSpacing: '0.05em',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>CUBE MN</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.2rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Admin Portal</div>
          </div>

          {/* Username */}
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              placeholder="admin"
              autoComplete="username"
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && document.getElementById('admin-pw')?.focus()}
            />
          </div>

          {/* Password */}
          <div className="form-group">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="admin-pw"
                type={showPw ? 'text' : 'password'}
                value={password}
                placeholder="••••••••"
                autoComplete="current-password"
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doLogin()}
                style={{ paddingRight: '2.8rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: '0.8rem', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
                  fontSize: '1rem', padding: '0.2rem',
                }}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button
            onClick={doLogin}
            style={{
              width: '100%', padding: '0.8rem', marginTop: '0.3rem',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              border: 'none', borderRadius: '9px', color: '#fff',
              fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
              transition: 'opacity 0.2s, transform 0.15s', letterSpacing: '0.03em', fontFamily: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            Sign In
          </button>

          {error && (
            <div style={{
              marginTop: '0.8rem', padding: '0.6rem 0.9rem',
              background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.25)',
              borderRadius: '7px', color: '#f43f5e', fontSize: '0.88rem',
            }}>
              Invalid username or password.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.2rem' }}>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
