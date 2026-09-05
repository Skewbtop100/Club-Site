'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { onlineCompAuth } from '@/lib/online-competition/firebase';
import { initials } from './util';

// Canonical in-app paths. The comp.* subdomain rewrite (middleware.ts)
// maps "/" -> "/online-competition" and passes anything already under
// /online-competition straight through, so these full paths are the one
// form that resolves correctly on BOTH the subdomain and the club site's
// own /online-competition path — unlike a bare "/dashboard", which lands
// on the club's (unrelated) dashboard when not on comp.*.
const HUB = '/online-competition';
const DASHBOARD = '/online-competition/dashboard';
const PROFILE = '/online-competition/profile';

/** The hub's dark header (v3). Deliberately a separate component from
 *  ../NavBar.tsx rather than a restyle of it: NavBar is also rendered by
 *  the dashboard, profile and competition-detail pages, which are all
 *  still on the light v2 palette this phase, and this header additionally
 *  needs the hub's live-competition data (for the live tab) that those
 *  pages don't fetch. */
export default function HubNav({ live }: { live: OnlineCompetition | null }) {
  const router = useRouter();
  const { user, loading, signInWithGoogle, signOut } = useOnlineAuth();
  // Anonymous sessions (from the solve page) don't count as "signed in" —
  // same rule the old NavBar and the registration gate use.
  const signedIn = !!user && !user.isAnonymous;

  const [compsOpen, setCompsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const compsRef = useRef<HTMLDivElement | null>(null);
  const userRef = useRef<HTMLDivElement | null>(null);

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

  /** "Миний тэмцээнүүд" needs a real, returning identity — same gate the
   *  detail page's registration button uses: sign in first, then go. */
  async function goToDashboard() {
    setCompsOpen(false);
    setUserOpen(false);
    if (signedIn) {
      router.push(DASHBOARD);
      return;
    }
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // Popup closed / superseded — nothing went wrong, just stay put.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      return;
    }
    if (onlineCompAuth.currentUser && !onlineCompAuth.currentUser.isAnonymous) router.push(DASHBOARD);
  }

  return (
    <nav className="oc-v3-nav">
      <div className="oc-v3-tabs">
        {/* This header only ships on the hub, so "Нүүр" is always the
            active tab — no usePathname() branch needed (and it would
            report the pre-rewrite "/" on comp.* anyway). */}
        <Link href={HUB} className="oc-v3-tab oc-v3-tab-active">
          Нүүр
        </Link>

        {/* TODO(next phase): there is no "all competitions" sub-route yet,
            so both this tab and its "Бүх тэмцээн" item resolve to the hub
            itself rather than inventing a page. */}
        <div
          className="oc-v3-menu-wrap"
          ref={compsRef}
          onMouseEnter={() => setCompsOpen(true)}
          onMouseLeave={() => setCompsOpen(false)}
        >
          <button type="button" className="oc-v3-tab" onClick={() => setCompsOpen((v) => !v)}>
            Тэмцээнүүд
            <span className="oc-v3-tab-caret" aria-hidden>
              ▼
            </span>
          </button>
          {compsOpen && (
            <div className="oc-v3-menu">
              <Link
                href={HUB}
                className="oc-v3-menu-item oc-v3-menu-item-active"
                onClick={() => setCompsOpen(false)}
              >
                <span aria-hidden style={{ color: '#DFFF4F' }}>
                  ●
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

        {/* TODO(next phase): no standalone leaderboard route exists yet —
            the season table lives in the hub's right column, so "Ранк"
            points back at the hub for now. */}
        <Link href={HUB} className="oc-v3-tab">
          Ранк
        </Link>

        {live && (
          <Link href={`${HUB}/${live.id}/details`} className="oc-v3-tab oc-v3-tab-live">
            <span className="oc-v3-dot" aria-hidden />
            {live.name}
          </Link>
        )}
      </div>

      {loading ? null : signedIn ? (
        <div className="oc-v3-menu-wrap" ref={userRef}>
          <button type="button" className="oc-v3-userbtn" onClick={() => setUserOpen((v) => !v)}>
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
      ) : (
        <button type="button" className="oc-v3-signin" onClick={() => signInWithGoogle()}>
          Нэвтрэх
        </button>
      )}
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
