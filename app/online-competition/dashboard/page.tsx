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

const COMPETITIONS = '/online-competition/competitions';
const PROFILE = '/online-competition/profile';

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

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Т';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

// Every one of these needs an aggregate the schema doesn't produce: there
// is no per-athlete PR, rolling average, points total or solve count
// anywhere in Firestore (season points exist only as a top-10 leaderboard
// document, and submissions carry single attempts). Placeholders rather
// than invented numbers, same convention as the hub's empty leaderboard.
const STATS: { label: string; accent?: boolean }[] = [
  { label: 'ПР', accent: true },
  { label: 'Дундаж' },
  { label: 'Оноо' },
  { label: 'Эвлүүлэлт' },
];

export default function DashboardPage() {
  const { user, loading: authLoading, signInWithGoogle } = useOnlineAuth();
  const uid = user && !user.isAnonymous ? user.uid : null;

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
            <button type="button" className="oc-v3-signin" onClick={() => signInWithGoogle()}>
              Нэвтрэх
            </button>
          </div>
        </div>
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

      <div className="oc-v3-dash-grid">
        {/* ── Profile sidebar ─────────────────────────────────────────── */}
        <div className="oc-v3-card">
          <div className="oc-v3-side-top">
            {user.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar
              // comes from Google's CDN, not our own image pipeline.
              <img src={user.photoURL} alt="" className="oc-v3-avatar-96" />
            ) : (
              <span className="oc-v3-avatar-96" aria-hidden>
                {initials(user.displayName)}
              </span>
            )}
            <p style={{ font: '600 20px var(--oc-font-heading), sans-serif', color: '#F4F1EA', textAlign: 'center' }}>
              {user.displayName ?? 'Тамирчин'}
            </p>
            {/* No join-date or location field exists on onlineParticipants
                (createdAt is set by a merge-write that can post-date the
                real first sign-in, and there is no location at all), so
                this slot carries the verified email instead of a
                fabricated "ULAANBAATAR · 2024-Н ХОЙШ" line. */}
            {user.email && (
              <p
                style={{
                  marginTop: -6,
                  font: '400 10px var(--oc-font-mono), monospace',
                  color: '#6E6A62',
                  overflowWrap: 'anywhere',
                  textAlign: 'center',
                }}
              >
                {user.email}
              </p>
            )}
            <Link href={PROFILE} className="oc-v3-ghost-btn">
              ПРОФАЙЛ ЗАСАХ
            </Link>
          </div>

          <div className="oc-v3-stat-grid">
            {STATS.map((s) => (
              <div key={s.label} className="oc-v3-stat-cell">
                <span className="oc-v3-stat-label">{s.label}</span>
                <span className="oc-v3-stat-value" style={s.accent ? { color: '#DFFF4F' } : undefined}>
                  —
                </span>
              </div>
            ))}
          </div>
        </div>

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
      </div>
    </Shell>
  );
}
