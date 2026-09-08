'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { initials } from './util';
import NotificationBell from './NotificationBell';
import AuthModal from './AuthModal';

// Canonical in-app paths. The comp.* subdomain rewrite (middleware.ts)
// maps "/" -> "/online-competition" and passes anything already under
// /online-competition straight through, so these full paths are the one
// form that resolves correctly on BOTH the subdomain and the club site's
// own /online-competition path — unlike a bare "/dashboard", which lands
// on the club's (unrelated) dashboard when not on comp.*.
const HUB = '/online-competition';
const COMPETITIONS = '/online-competition/competitions';

// Same 3x3 mark as ../Logo.tsx, repainted for the dark header (that
// component's "ink" tone is #16140F — invisible on #0D0D10).
const LOGO_PATTERN = ['ink', 'ink', 'volt', 'ink', 'volt', 'ink', 'volt', 'ink', 'ink'] as const;
const LOGO_COLOR = { ink: '#F4F1EA', volt: '#DFFF4F' } as const;
const RANK = '/online-competition/rank';
const DASHBOARD = '/online-competition/dashboard';
const PROFILE = '/online-competition/profile';

/** The hub's dark header (v3). Deliberately a separate component from
 *  ../NavBar.tsx rather than a restyle of it: NavBar is also rendered by
 *  the dashboard, profile and competition-detail pages, which are all
 *  still on the light v2 palette this phase, and this header additionally
 *  needs the hub's live-competition data (for the live tab) that those
 *  pages don't fetch. */
export default function HubNav({
  live,
  active = 'home',
}: {
  live: OnlineCompetition | null;
  /** Which top-level tab this page is. Passed explicitly rather than read
   *  from usePathname(), which reports the pre-rewrite "/" on comp.*. */
  active?: 'home' | 'competitions' | 'rank';
}) {
  const router = useRouter();
  const { user, loading, signOut } = useOnlineAuth();
  // Anonymous sessions (from the solve page) don't count as "signed in" —
  // same rule the old NavBar and the registration gate use.
  const signedIn = !!user && !user.isAnonymous;

  const [compsOpen, setCompsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  // The bell popup and the user menu are mutually exclusive — opening one
  // closes the other — so this lives here rather than inside the bell.
  const [notifOpen, setNotifOpen] = useState(false);
  // "Нэвтрэх" now opens the sign-in modal; the Google popup fires
  // from inside it. The auth call itself is unchanged — see AuthModal.
  const [authOpen, setAuthOpen] = useState(false);
  // Where to go once sign-in succeeds, for entry points that mean "sign in
  // AND THEN take me somewhere". null for the plain Нэвтрэх button, which
  // leaves the user where they are. Cleared on every dismiss, so a
  // cancelled trip to the dashboard can't redirect a later sign-in.
  const [authRedirect, setAuthRedirect] = useState<string | null>(null);
  const compsRef = useRef<HTMLDivElement | null>(null);
  const userRef = useRef<HTMLDivElement | null>(null);
  const signInRef = useRef<HTMLButtonElement | null>(null);
  const closeNotif = useCallback(() => setNotifOpen(false), []);

  // Click-anywhere-else closes whichever menu is open.
  useEffect(() => {
    if (!compsOpen && !userOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (compsRef.current && !compsRef.current.contains(target)) setCompsOpen(false);
      if (userRef.current && !userRef.current.contains(target)) setUserOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [compsOpen, userOpen]);

  /** "Миний тэмцээнүүд" needs a real, returning identity: sign in
   *  first, then go. Signed in, it just goes — no modal. Signed out, it
   *  queues the destination and opens the same AuthModal the Нэвтрэх
   *  button uses, rather than firing the Google popup bare; the navigation
   *  happens in onSignedIn below. */
  function goToDashboard() {
    setCompsOpen(false);
    setUserOpen(false);
    setNotifOpen(false);
    if (signedIn) {
      router.push(DASHBOARD);
      return;
    }
    setAuthRedirect(DASHBOARD);
    setAuthOpen(true);
  }

  return (
    <nav className="oc-v3-nav">
      {/* Brand row — hidden on desktop (the approved desktop header has no
          wordmark; tabs sit flush left). Below 640px the header splits into
          two stacked rows and this becomes row 1's left half. */}
      <Link href={HUB} className="oc-v3-nav-brand">
        <span className="oc-v3-logo" aria-hidden>
          {LOGO_PATTERN.map((tone, i) => (
            <span key={i} style={{ width: 5, height: 5, background: LOGO_COLOR[tone] }} />
          ))}
        </span>
        ХОРОМ
      </Link>

      <div className="oc-v3-tabs">
        <Link href={HUB} className={`oc-v3-tab${active === 'home' ? ' oc-v3-tab-active' : ''}`}>
          Нүүр
        </Link>

        <div
          className="oc-v3-menu-wrap"
          ref={compsRef}
          onMouseEnter={() => setCompsOpen(true)}
          onMouseLeave={() => setCompsOpen(false)}
        >
          <button
            type="button"
            className={`oc-v3-tab${active === 'competitions' ? ' oc-v3-tab-active' : ''}`}
            onClick={() => router.push(COMPETITIONS)}
          >
            Тэмцээнүүд
            <span className="oc-v3-tab-caret" aria-hidden>
              ▼
            </span>
          </button>
          {compsOpen && (
            <div className="oc-v3-menu">
              <Link
                href={COMPETITIONS}
                className={`oc-v3-menu-item${active === 'competitions' ? ' oc-v3-menu-item-active' : ''}`}
                onClick={() => setCompsOpen(false)}
              >
                <span aria-hidden style={{ color: active === 'competitions' ? '#DFFF4F' : '#3A3A42' }}>
                  {active === 'competitions' ? '●' : '○'}
                </span>
                Бүх тэмцээн
              </Link>
              <button type="button" className="oc-v3-menu-item" onClick={goToDashboard}>
                <span aria-hidden style={{ color: '#3A3A42' }}>
                  ○
                </span>
                Миний тэмцээнүүд
              </button>
            </div>
          )}
        </div>

        <Link href={RANK} className={`oc-v3-tab${active === 'rank' ? ' oc-v3-tab-active' : ''}`}>
          Ранк
        </Link>

        {live && (
          <Link href={`${HUB}/${live.id}/details`} className="oc-v3-tab oc-v3-tab-live">
            <span className="oc-v3-dot" aria-hidden />
            {live.name}
          </Link>
        )}
      </div>

      <div className="oc-v3-nav-auth" style={{ gap: 10 }}>
      {loading ? null : signedIn ? (
        <>
        <NotificationBell
          uid={user.uid}
          open={notifOpen}
          onToggle={() => {
            setNotifOpen((v) => !v);
            setUserOpen(false);
          }}
          onClose={closeNotif}
        />
        <div className="oc-v3-menu-wrap" ref={userRef}>
          <button
            type="button"
            className="oc-v3-userbtn"
            onClick={() => {
              setUserOpen((v) => !v);
              setNotifOpen(false);
            }}
          >
            <Avatar user={user} />
            <span style={{ font: '500 12px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
              {user.displayName ?? 'Тамирчин'}
            </span>
            <span className="oc-v3-tri" aria-hidden />
          </button>
          {userOpen && (
            <div className="oc-v3-menu oc-v3-menu-right">
              <div className="oc-v3-menu-head">
                <Avatar user={user} large />
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      font: '500 12px var(--oc-font-heading), sans-serif',
                      color: '#F4F1EA',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {user.displayName ?? 'Тамирчин'}
                  </p>
                  {/* No per-athlete stat aggregate exists client-side yet
                      (season points are keyed by uid but only fetched for
                      the top-10 leaderboard, and solve counts aren't
                      publicly readable) — "—" placeholders, same
                      convention the dashboard uses. */}
                  <p style={{ marginTop: 3, font: '400 9px var(--oc-font-mono), monospace', color: '#6E6A62' }}>
                    — оноо · — тэмцээн
                  </p>
                </div>
              </div>
              <Link
                href={PROFILE}
                className="oc-v3-menu-item oc-v3-menu-item-split"
                onClick={() => setUserOpen(false)}
              >
                Профайл
              </Link>
              <button type="button" className="oc-v3-menu-item oc-v3-menu-item-split" onClick={goToDashboard}>
                Миний тэмцээнүүд
              </button>
              <button
                type="button"
                className="oc-v3-menu-item oc-v3-menu-item-split"
                onClick={() => {
                  setUserOpen(false);
                  signOut();
                }}
              >
                Гарах
              </button>
            </div>
          )}
        </div>
        </>
      ) : (
        <button
          ref={signInRef}
          type="button"
          className="oc-v3-signin"
          onClick={() => setAuthOpen(true)}
        >
          Нэвтрэх
        </button>
      )}
      </div>

      {/* onClose is the DISMISS path only — Escape, the overlay, and the ×
          button all route through here. It drops any queued destination:
          someone who backed out of "Миний тэмцээнүүд" must not be
          bounced to the dashboard the next time they sign in from the
          Нэвтрэх button. Focus returns to that trigger; after a
          successful sign-in it has unmounted, so the optional call is a
          no-op rather than an error. */}
      <AuthModal
        open={authOpen}
        onClose={() => {
          setAuthOpen(false);
          setAuthRedirect(null);
          signInRef.current?.focus();
        }}
        onSignedIn={() => {
          setAuthOpen(false);
          const destination = authRedirect;
          setAuthRedirect(null);
          // No destination is the plain Нэвтрэх path: stay put, exactly
          // as before this entry point existed.
          if (destination) router.push(destination);
        }}
      />
    </nav>
  );
}

function Avatar({ user, large = false }: { user: { displayName: string | null; photoURL: string | null }; large?: boolean }) {
  const cls = `oc-v3-avatar${large ? ' oc-v3-avatar-lg' : ''}`;
  if (user.photoURL) {
    // eslint-disable-next-line @next/next/no-img-element -- avatar comes
    // from Google's CDN, not our own image pipeline.
    return <img src={user.photoURL} alt="" className={cls} />;
  }
  return (
    <span aria-hidden className={cls}>
      {initials(user.displayName)}
    </span>
  );
}
