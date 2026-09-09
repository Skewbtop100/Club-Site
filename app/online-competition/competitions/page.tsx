'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  fetchAllCompetitions,
  fetchCompetition,
  fetchMyRegistrations,
} from '@/lib/online-competition/data';
import type { OnlineCompetition, OnlineCompetitionStatus } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { toMillisOrNull } from '../_components/hub/format';
import HubNav from '../_components/hub/v3/HubNav';
import AllCompetitionsTable from '../_components/hub/v3/AllCompetitionsTable';
import MyCompetitions, { type RegisteredView } from '../_components/hub/v3/MyCompetitions';
import AuthModal from '../_components/hub/v3/AuthModal';

type View = 'all' | 'mine';

export default function CompetitionsPage() {
  const { user, loading: authLoading } = useOnlineAuth();
  // Anonymous solve-page sessions don't count as a returning identity.
  const uid = user && !user.isAnonymous ? user.uid : null;
  const signedIn = uid !== null;

  const [authOpen, setAuthOpen] = useState(false);

  const [view, setView] = useState<View>('all');
  const [competitions, setCompetitions] = useState<OnlineCompetition[] | null>(null);
  const [error, setError] = useState('');

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

  // Same registrations -> competitions join the "Миний тэмцээнүүд"
  // dashboard does: onlineParticipants/{uid}/registrations is only
  // readable by its owner, so this can't run until there's a real signed-in
  // identity.
  //
  // Keyed on `uid` (a string), not the `user` object: useOnlineAuth builds
  // a fresh object on every onAuthStateChanged emission, so an object dep
  // refetches on churn that didn't change the identity. `setMine(null)`
  // runs unconditionally at the top so rows read for a previous account
  // can never stay on screen while the new account's fetch is in flight.
  useEffect(() => {
    setMine(null);
    setMineError('');
    if (uid === null) return;
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
  }, [uid]);

  const { live, sorted } = useMemo(() => {
    const list = competitions ?? [];
    // Typed on the status union, not Record<string, number>: with a loose
    // key type an unlisted status yields undefined, and `undefined - n` is
    // NaN, which makes the comparator below incoherent rather than merely
    // mis-ordered. Drafts are filtered out server-side and never arrive
    // here — this keeps that assumption compiler-checked instead of
    // implicit, and sorts them first if one ever does.
    const order: Record<OnlineCompetitionStatus, number> = { draft: 0, live: 1, upcoming: 2, finished: 3 };
    return {
      live: list.find((c) => c.status === 'live') ?? null,
      // Live first, then soonest upcoming, then most-recent finished.
      sorted: [...list].sort((a, b) => {
        const byStatus = order[a.status] - order[b.status];
        if (byStatus !== 0) return byStatus;
        const at = toMillisOrNull(a.startAt) ?? Infinity;
        const bt = toMillisOrNull(b.startAt) ?? Infinity;
        return a.status === 'finished' ? bt - at : at - bt;
      }),
    };
  }, [competitions]);

  return (
    <div className="oc-v3-page">
      <HubNav live={live} active="competitions" />

      <main className="oc-v3-main">
        <div className="oc-v3-pill-row">
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
          competitions === null ? (
            <p className="oc-v3-status">Ачааллаж байна...</p>
          ) : error ? (
            <p className="oc-v3-status oc-v3-status-error">{error}</p>
          ) : (
            <AllCompetitionsTable competitions={sorted} />
          )
        ) : authLoading ? (
          <p className="oc-v3-status">Ачааллаж байна...</p>
        ) : !signedIn ? (
          /* Same sign-in gate the dashboard page uses — an anonymous
             solve-page session isn't a returning identity. */
          <>
            <div className="oc-v3-card">
              <div className="oc-v3-empty">
                <p className="oc-v3-empty-text">Өөрийн тэмцээнүүдээ харахын тулд нэвтэрнэ үү.</p>
                <button type="button" className="oc-v3-signin" onClick={() => setAuthOpen(true)}>
                  Нэвтрэх
                </button>
              </div>
            </div>
            {/* Plain sign-in: the user is already on the page they want,
                so the modal just closes and this gate re-renders signed-in
                — no queued destination, same shape as the nav's Нэвтрэх
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
