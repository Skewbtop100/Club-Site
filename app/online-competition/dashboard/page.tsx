'use client';

import { useEffect, useState } from 'react';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fetchCompetition, fetchMyRegistrations } from '@/lib/online-competition/data';
import type { OnlineCompetition, OnlineRegistration } from '@/lib/online-competition/types';
import { toMillisOrNull } from '../_components/hub/format';
import Header from './_components/Header';
import LiveCard from './_components/LiveCard';
import UpcomingCard from './_components/UpcomingCard';
import EmptyDashboard from './_components/EmptyDashboard';

interface RegisteredView {
  registration: OnlineRegistration;
  competition: OnlineCompetition;
}

// Centers the content column regardless of viewport — the mockup is a
// phone-frame layout, but this should still look reasonable at desktop
// width rather than stretching edge to edge.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full" style={{ background: '#FFFDF8' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading: authLoading, signInWithGoogle } = useOnlineAuth();
  const [views, setViews] = useState<RegisteredView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setViews(null);
      return;
    }
    let cancelled = false;
    setError('');
    fetchMyRegistrations(user.uid)
      .then(async (regs) => {
        const joined = await Promise.all(
          regs.map(async (registration) => {
            const competition = await fetchCompetition(registration.competitionId);
            return competition ? { registration, competition } : null;
          }),
        );
        if (!cancelled) {
          setViews(joined.filter((v): v is RegisteredView => v !== null));
        }
      })
      .catch(() => {
        if (!cancelled) setError('Мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading) {
    return <Shell>{null}</Shell>;
  }

  if (!user || user.isAnonymous) {
    return (
      <Shell>
        <div style={{ padding: '48px 20px', textAlign: 'center' }}>
          <p style={{ marginBottom: 16, font: '400 13px var(--oc-font-heading), sans-serif', color: '#4C473C' }}>
            Хувийн самбараа харахын тулд нэвтэрнэ үү.
          </p>
          <button type="button" className="oc-hub-signin-btn" onClick={() => signInWithGoogle()}>
            Нэвтрэх
          </button>
        </div>
      </Shell>
    );
  }

  if (views === null) {
    return (
      <Shell>
        <Header user={user} />
        <p style={{ padding: '18px 20px', font: '400 13px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>
          Ачааллаж байна...
        </p>
      </Shell>
    );
  }

  // Skip finished for now — no results data model exists yet to
  // determine a "done" competition's outcome per event.
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
      <Header user={user} />
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span className="oc-mono-label">Миний тэмцээнүүд</span>

        {error && <p style={{ font: '400 12px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>{error}</p>}

        {live.length === 0 && upcoming.length === 0 ? (
          <EmptyDashboard />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {live.map((v) => (
              <LiveCard key={v.competition.id} competition={v.competition} registration={v.registration} />
            ))}
            {upcoming.map((v) => (
              <UpcomingCard key={v.competition.id} competition={v.competition} registration={v.registration} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
