'use client';

import Link from 'next/link';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import Logo from './Logo';

export default function NavBar() {
  const { user, loading, signInWithGoogle, signOut } = useOnlineAuth();
  // Anonymous sessions (from the solve page) don't count as "signed in"
  // here — the nav badge and sign-in button care about a real identity.
  const signedIn = !!user && !user.isAnonymous;

  return (
    <nav className="oc-hub-nav">
      <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <span
            style={{
              font: '600 15px var(--oc-font-heading), sans-serif',
              letterSpacing: '.12em',
              color: '#16140F',
            }}
          >
            ХОРОМ
          </span>
        </div>
        {/* Desktop-only text nav links. "Тамирчид"/"Оноо" have no route yet
            (this phase only ships the hub + detail pages), so they render
            as inert labels rather than dead links. "Миний тэмцээнүүд" only
            makes sense for a real, returning identity (same gate as the
            sign-in/user-badge area below), so it's omitted entirely rather
            than shown disabled when signed out. */}
        <div className="oc-hub-desktop-only oc-hub-nav-links">
          <span className="oc-hub-nav-link oc-hub-nav-link-active">Тэмцээн</span>
          <span className="oc-hub-nav-link">Тамирчид</span>
          <span className="oc-hub-nav-link">Оноо</span>
          {!loading && signedIn && (
            <Link href="/dashboard" className="oc-hub-nav-link">
              Миний тэмцээнүүд
            </Link>
          )}
        </div>
      </div>

      {loading ? null : signedIn ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/dashboard" className="oc-hub-user-badge" style={{ textDecoration: 'none' }}>
            {user.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar
              // comes from Google's CDN, not our own image pipeline.
              <img
                src={user.photoURL}
                alt=""
                width={22}
                height={22}
                style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
              />
            ) : (
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#16140F',
                  color: '#DFFF4F',
                  font: '600 9px var(--oc-font-mono), monospace',
                }}
              >
                {(user.displayName ?? 'Т').trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span style={{ font: '500 12px var(--oc-font-heading), sans-serif', color: '#16140F' }}>
              {user.displayName ?? 'Тамирчин'}
            </span>
          </Link>
          <button
            type="button"
            onClick={() => signOut()}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              font: '400 13px var(--oc-font-heading), sans-serif',
              color: '#8A8474',
            }}
          >
            Гарах
          </button>
        </div>
      ) : (
        <button type="button" className="oc-hub-signin-btn" onClick={() => signInWithGoogle()}>
          Нэвтрэх
        </button>
      )}
    </nav>
  );
}
