'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import {
  fetchAllCompetitions,
  fetchAthleteSeasonPoints,
  fetchCompetition,
  fetchMyRegistrations,
  fetchMySubmissions,
  fetchParticipant,
} from '@/lib/online-competition/data';
import type {
  OnlineCompetition,
  OnlineParticipant,
  OnlineRegistration,
  OnlineSubmission,
} from '@/lib/online-competition/types';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { toMillisOrNull } from '../_components/hub/format';
import HubNav from '../_components/hub/v3/HubNav';
import EmptyBlock from '../_components/hub/v3/EmptyBlock';
import LiveCard from './_components/LiveCard';
import UpcomingCard from './_components/UpcomingCard';
import RecentSubmissions from './_components/RecentSubmissions';
import AuthModal from '../_components/hub/v3/AuthModal';

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

/** Best value across every event the athlete has stats for. With one
 *  event configured today this is the same as "their 3x3 PR"; across
 *  several it reads as a personal best overall, which is what a single
 *  headline number on a profile card should mean. */
function bestAcrossEvents(
  participant: OnlineParticipant | null,
  key: 'pr' | 'ao5',
): number | null {
  const values = Object.values(participant?.stats ?? {})
    .map((e) => e[key])
    .filter((v): v is number => typeof v === 'number');
  return values.length > 0 ? Math.min(...values) : null;
}

function totalSolves(participant: OnlineParticipant | null): number | null {
  const entries = Object.values(participant?.stats ?? {});
  if (entries.length === 0) return null;
  return entries.reduce((sum, e) => sum + (e.solveCount ?? 0), 0);
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useOnlineAuth();
  const uid = user && !user.isAnonymous ? user.uid : null;

  const [authOpen, setAuthOpen] = useState(false);

  const [views, setViews] = useState<RegisteredView[] | null>(null);
  const [submissions, setSubmissions] = useState<OnlineSubmission[] | null>(null);
  const [participant, setParticipant] = useState<OnlineParticipant | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setViews(null);
    setSubmissions(null);
    setParticipant(null);
    setPoints(null);
    setError('');
    if (uid === null) return;
    let cancelled = false;

    // PR / Ao5 / solve count come from the stats rollup the admin
    // recompute writes onto the participant doc.
    fetchParticipant(uid)
      .then((p) => {
        if (!cancelled) setParticipant(p);
      })
      .catch(() => {
        if (!cancelled) setParticipant(null);
      });

    // Points are the real season-points total. Season is derived the same
    // way the hub does it: whichever competition with a season set has the
    // latest startAt.
    fetchAllCompetitions()
      .then(async (list) => {
        const withSeason = list.filter((c) => c.season);
        if (withSeason.length === 0) return null;
        const latest = withSeason.reduce((best, c) =>
          (toMillisOrNull(c.startAt) ?? 0) > (toMillisOrNull(best.startAt) ?? 0) ? c : best,
        );
        return fetchAthleteSeasonPoints(latest.season as string, uid);
      })
      .then((row) => {
        if (!cancelled) setPoints(row?.totalPoints ?? null);
      })
      .catch(() => {
        if (!cancelled) setPoints(null);
      });

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

          {/* Real values from the stats rollup + season points; "—" only
              when the underlying data genuinely isn't there yet (no
              recompute has run, or the athlete has no approved solves). */}
          <div className="oc-v3-stat-grid">
            <StatCell label="ПР" accent value={fmtOrDash(bestAcrossEvents(participant, 'pr'))} />
            <StatCell label="Дундаж" value={fmtOrDash(bestAcrossEvents(participant, 'ao5'))} />
            <StatCell label="Оноо" value={points === null ? '—' : String(points)} />
            <StatCell label="Эвлүүлэлт" value={totalSolves(participant) === null ? '—' : String(totalSolves(participant))} />
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

function fmtOrDash(cs: number | null): string {
  return cs === null ? '—' : fmtCentiseconds(cs);
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="oc-v3-stat-cell">
      <span className="oc-v3-stat-label">{label}</span>
      <span className="oc-v3-stat-value" style={accent ? { color: '#DFFF4F' } : undefined}>
        {value}
      </span>
    </div>
  );
}
