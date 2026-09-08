'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import {
  fetchCompetition,
  fetchMyRegistrations,
  fetchMySubmissions,
} from '@/lib/online-competition/data';
import type {
  OnlineCompetition,
  OnlineRegistration,
  OnlineSubmission,
} from '@/lib/online-competition/types';
import { toMillisOrNull } from '../_components/hub/format';
import HubNav from '../_components/hub/v3/HubNav';
import EmptyBlock from '../_components/hub/v3/EmptyBlock';
import LiveCard from './_components/LiveCard';
import UpcomingCard from './_components/UpcomingCard';
import RecentSubmissions from './_components/RecentSubmissions';
import AuthModal from '../_components/hub/v3/AuthModal';

const COMPETITIONS = '/online-competition/competitions';

interface RegisteredView {
  registration: OnlineRegistration;
  competition: OnlineCompetition;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="oc-v3-page">
      <HubNav live={null} />
      <main className="oc-v3-main">{children}</main>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useOnlineAuth();
  const uid = user && !user.isAnonymous ? user.uid : null;

  const [authOpen, setAuthOpen] = useState(false);

  const [views, setViews] = useState<RegisteredView[] | null>(null);
  const [submissions, setSubmissions] = useState<OnlineSubmission[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setViews(null);
    setSubmissions(null);
    setError('');
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
        if (!cancelled) setViews(joined.filter((v): v is RegisteredView => v !== null));
      })
      .catch(() => {
        if (!cancelled) setError('Мэдээллийг ачааллаж чадсангүй');
      });

    // Independent of the registrations join — a failed submissions read
    // shouldn't blank the competitions column, so it settles to [] instead
    // of raising the page-level error.
    fetchMySubmissions(uid, 5)
      .then((list) => {
        if (!cancelled) setSubmissions(list);
      })
      .catch(() => {
        if (!cancelled) setSubmissions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (authLoading) return <Shell>{null}</Shell>;

  if (!user || uid === null) {
    return (
      <Shell>
        <div className="oc-v3-card">
          <div className="oc-v3-empty">
            <p className="oc-v3-empty-text">Хувийн самбараа харахын тулд нэвтэрнэ үү.</p>
            <button type="button" className="oc-v3-signin" onClick={() => setAuthOpen(true)}>
              Нэвтрэх
            </button>
          </div>
        </div>
        {/* Plain sign-in: the user is already on the page they want, so
            the modal just closes and this gate re-renders signed-in — no
            queued destination, same shape as the nav's Нэвтрэх button. */}
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </Shell>
    );
  }

  if (views === null) return <Shell><p className="oc-v3-status">Ачааллаж байна...</p></Shell>;

  // Skip finished for now — no results data model exists yet to determine
  // a "done" competition's outcome per event.
  const live = views
    .filter((v) => v.competition.status === 'live')
    .sort((a, b) => (toMillisOrNull(a.competition.startAt) ?? 0) - (toMillisOrNull(b.competition.startAt) ?? 0));
  const upcoming = views
    .filter((v) => v.competition.status === 'upcoming')
    .sort(
      (a, b) =>
        (toMillisOrNull(a.competition.startAt) ?? Infinity) - (toMillisOrNull(b.competition.startAt) ?? Infinity),
    );

  return (
    <Shell>
      {error && <p className="oc-v3-status oc-v3-status-error">{error}</p>}

      {/* ── Competitions + submissions ──────────────────────────────── */}
      <div className="oc-v3-col">
        <div className="oc-v3-card">
          <div className="oc-v3-card-head">
            <span className="oc-v3-label">Миний тэмцээнүүд</span>
            <span className="oc-v3-season">
              {live.length} ЯВАГДАЖ БУЙ · {upcoming.length} УДАХГҮЙ
            </span>
          </div>

          {live.length === 0 && upcoming.length === 0 ? (
            <EmptyBlock
              text="Бүртгүүлсэн тэмцээн алга."
              hint={<Link href={COMPETITIONS}>БҮХ ТЭМЦЭЭН ҮЗЭХ →</Link>}
            />
          ) : (
            <>
              {live.map((v) => (
                <LiveCard key={v.competition.id} competition={v.competition} registration={v.registration} />
              ))}
              {upcoming.map((v) => (
                <UpcomingCard key={v.competition.id} competition={v.competition} registration={v.registration} />
              ))}
            </>
          )}
        </div>

        {submissions === null ? (
          <p className="oc-v3-status">Ачааллаж байна...</p>
        ) : (
          <RecentSubmissions submissions={submissions} />
        )}
      </div>
    </Shell>
  );
}
