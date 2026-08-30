'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchAllCompetitions, fetchSeasonLeaderboard } from '@/lib/online-competition/data';
import type { OnlineCompetition, OnlineSeasonAthletePoints } from '@/lib/online-competition/types';
import { toMillisOrNull } from './_components/hub/format';
import NavBar from './_components/hub/NavBar';
import LiveBanner from './_components/hub/LiveBanner';
import CompetitionGroups from './_components/hub/CompetitionGroups';
import Sidebar from './_components/hub/Sidebar';
import MobileHub from './_components/hub/MobileHub';

export default function OnlineCompetitionHubPage() {
  const [competitions, setCompetitions] = useState<OnlineCompetition[] | null>(null);
  const [error, setError] = useState('');
  const [leaderboard, setLeaderboard] = useState<OnlineSeasonAthletePoints[]>([]);
  const [season, setSeason] = useState('');

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

  const { live, upcoming, finished } = useMemo(() => {
    const list = competitions ?? [];
    return {
      live: list.filter((c) => c.status === 'live'),
      upcoming: list.filter((c) => c.status === 'upcoming'),
      finished: list.filter((c) => c.status === 'finished'),
    };
  }, [competitions]);

  // "Current" season = the season of whichever competition (with a
  // season set at all) has the latest startAt — a simple, good-enough
  // heuristic since seasons don't have their own doc/dates to compare.
  useEffect(() => {
    if (!competitions) return;
    const withSeason = competitions.filter((c) => c.season);
    if (withSeason.length === 0) {
      setSeason('');
      setLeaderboard([]);
      return;
    }
    const latest = withSeason.reduce((best, c) =>
      (toMillisOrNull(c.startAt) ?? 0) > (toMillisOrNull(best.startAt) ?? 0) ? c : best,
    );
    const currentSeason = latest.season as string;
    setSeason(currentSeason);
    fetchSeasonLeaderboard(currentSeason)
      .then(setLeaderboard)
      .catch(() => setLeaderboard([]));
  }, [competitions]);

  return (
    <div className="min-h-screen w-full" style={{ background: '#FFFDF8' }}>
      <NavBar />

      {competitions === null ? (
        <p style={{ padding: 24, font: '400 13px var(--oc-font-heading), sans-serif', color: '#8A8474' }}>
          Ачааллаж байна...
        </p>
      ) : error ? (
        <p style={{ padding: 24, font: '400 13px var(--oc-font-heading), sans-serif', color: '#D8402C' }}>
          {error}
        </p>
      ) : (
        <>
          {live[0] && <LiveBanner competition={live[0]} />}

          <div className="oc-hub-desktop-only">
            <div className="oc-hub-grid">
              <CompetitionGroups live={live} upcoming={upcoming} finished={finished} />
              <Sidebar season={season} leaderboard={leaderboard} />
            </div>
          </div>

          <div className="oc-hub-mobile-only">
            <MobileHub live={live} upcoming={upcoming} finished={finished} />
          </div>
        </>
      )}
    </div>
  );
}
