'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  fetchAllCompetitions,
  fetchCompetition,
  fetchMyRegistrations,
} from '@/lib/online-competition/data';
import type { CompetitionAthleteCounts } from '@/app/api/online-competition/competitions/athlete-counts/route';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import HubNav from '../_components/hub/v3/HubNav';
import CompetitionList from '../_components/hub/v3/CompetitionList';
import MyCompetitions, { type RegisteredView } from '../_components/hub/v3/MyCompetitions';
import AuthModal from '../_components/hub/v3/AuthModal';

type View = 'all' | 'mine';

/** Below this width the header's whole tab strip — the ТЭМЦЭЭНҮҮД dropdown
 *  with it — is display:none, and the bottom bar that replaces it has no
 *  "my competitions" item. So the pill toggle below is the ONLY way to
 *  reach that view on a phone, and it is rendered for this width only;
 *  above it the dropdown already carries both choices, and a second copy on
 *  this one page is the duplicate that was removed.
 *
 *  640px, matching .oc-v3-tabs' own media query in theme.css — whose
 *  comment already points at these pills as the touch replacement for the
 *  suppressed dropdown. Duplicated there rather than shared, because a
 *  media query cannot read a JS constant. */
const MOBILE_MAX_WIDTH = 640;

export default function CompetitionsPage() {
  const { user, loading: authLoading } = useOnlineAuth();
  // Anonymous solve-page sessions don't count as a returning identity.
  const uid = user && !user.isAnonymous ? user.uid : null;
  const signedIn = uid !== null;

  const [view, setView] = useState<View>('all');
  const [authOpen, setAuthOpen] = useState(false);

  const [competitions, setCompetitions] = useState<OnlineCompetition[] | null>(null);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  const [mine, setMine] = useState<RegisteredView[] | null>(null);
  const [mineError, setMineError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAllCompetitions()
      .then((list) => {
        if (!cancelled) setCompetitions(list);
      })
      .catch(() => {
        if (!cancelled) setError('Тэмцээнүүдийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The ТАМИРЧИН column. A separate, independent request: registrations are
  // not publicly readable, so the count has to come from a route — and the
  // list must not wait on it, or a slow count would hold up every row.
  // A failure leaves `counts` null, which renders "—".
  useEffect(() => {
    let cancelled = false;
    fetch('/api/online-competition/competitions/athlete-counts')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CompetitionAthleteCounts | null) => {
        if (!cancelled && data) setCounts(data.counts);
      })
      .catch(() => {
        /* The column shows "—"; a missing count is not a page error. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The pills are a phone-only control, so the view they switch to must not
  // survive the viewport growing past the breakpoint: the toggle disappears
  // with it, and without this a landscape rotation (an iPhone 14 is 844px
  // wide) would leave the МИНИЙ ТЭМЦЭЭН view on screen with nothing to
  // switch back from. A reset only — going narrow again does not restore
  // it, since nobody asked for that view at this width.
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    function sync() {
      if (!mq.matches) setView('all');
    }
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // The same registrations -> competitions join the dashboard does:
  // onlineParticipants/{uid}/registrations is readable only by its owner,
  // so this cannot run until there is a real signed-in identity.
  //
  // Keyed on `uid` (a string), not the `user` object: useOnlineAuth builds
  // a fresh object on every onAuthStateChanged emission, so an object dep
  // refetches on churn that did not change the identity. Keyed on `view`
  // too, which makes it LAZY — the fan-out (one fetchCompetition per
  // registration) never runs for a desktop reader, who has no pills and
  // cannot reach this view.
  useEffect(() => {
    setMine(null);
    setMineError('');
    if (uid === null || view !== 'mine') return;
    let cancelled = false;
    fetchMyRegistrations(uid)
      .then(async (regs) => {
        const joined = await Promise.all(
          regs.map(async (registration) => {
            const competition = await fetchCompetition(registration.competitionId);
            return competition ? { registration, competition } : null;
          }),
        );
        if (!cancelled) setMine(joined.filter((v): v is RegisteredView => v !== null));
      })
      .catch(() => {
        if (!cancelled) setMineError('Бүртгэлийн мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [uid, view]);

  const live = useMemo(
    () => (competitions ?? []).find((c) => c.status === 'live') ?? null,
    [competitions],
  );

  return (
    <div className="oc-v3-page">
      <HubNav live={live} active="competitions" />

      <main className="oc-v3-main">
        {/* Rendered at every width and hidden above the breakpoint by CSS,
            not by MOBILE_MAX_WIDTH here: a width test cannot run during
            SSR, so gating the markup on one would flash the pills in on
            first paint and shift the whole list down. */}
        <div className="oc-v3-clist-tabs">
          <button
            type="button"
            className={`oc-v3-pill${view === 'all' ? ' oc-v3-pill-active' : ''}`}
            onClick={() => setView('all')}
          >
            <span aria-hidden style={{ color: view === 'all' ? '#DFFF4F' : '#3A3A42' }}>
              {view === 'all' ? '●' : '○'}
            </span>
            Бүх тэмцээн
          </button>
          <button
            type="button"
            className={`oc-v3-pill${view === 'mine' ? ' oc-v3-pill-active' : ''}`}
            onClick={() => setView('mine')}
          >
            <span aria-hidden style={{ color: view === 'mine' ? '#DFFF4F' : '#3A3A42' }}>
              {view === 'mine' ? '●' : '○'}
            </span>
            Миний тэмцээнүүд
          </button>
        </div>

        {view === 'all' ? (
          /* Error first: a failed fetch leaves `competitions` null, so the
             loading branch used to swallow it and spin forever. */
          error ? (
            <p className="oc-v3-status oc-v3-status-error">{error}</p>
          ) : competitions === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : (
            <CompetitionList competitions={competitions} counts={counts} />
          )
        ) : authLoading ? (
          <p className="oc-v3-status">Ачааллаж байна...</p>
        ) : !signedIn ? (
          /* The same sign-in gate the dashboard page uses — an anonymous
             solve-page session is not a returning identity. */
          <>
            <div className="oc-v3-card">
              <div className="oc-v3-empty">
                <p className="oc-v3-empty-text">Өөрийн тэмцээнүүдээ харахын тулд нэвтэрнэ үү.</p>
                <button type="button" className="oc-v3-signin" onClick={() => setAuthOpen(true)}>
                  Нэвтрэх
                </button>
              </div>
            </div>
            {/* Plain sign-in: the user is already on the page they want, so
                the modal just closes and this gate re-renders signed-in —
                no queued destination, the same shape as the nav's Нэвтрэх
                button. */}
            <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
          </>
        ) : mineError ? (
          <p className="oc-v3-status oc-v3-status-error">{mineError}</p>
        ) : mine === null ? (
          <p className="oc-v3-status">Ачааллаж байна...</p>
        ) : (
          <MyCompetitions views={mine} account={user?.email ?? user?.displayName ?? null} />
        )}
      </main>
    </div>
  );
}
