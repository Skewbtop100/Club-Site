'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchAllCompetitions, fetchSeasonLeaderboard } from '@/lib/online-competition/data';
import type { OnlineCompetition, OnlineSeasonAthletePoints } from '@/lib/online-competition/types';
import { toMillisOrNull } from './_components/hub/format';
import HubNav from './_components/hub/v3/HubNav';
import LiveHero from './_components/hub/v3/LiveHero';
import UpcomingCard from './_components/hub/v3/UpcomingCard';
import LiveMiniCard from './_components/hub/v3/LiveMiniCard';
import LeaderboardCard from './_components/hub/v3/LeaderboardCard';

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

  const { live, upcoming } = useMemo(() => {
    const list = competitions ?? [];
    return {
      live: list.filter((c) => c.status === 'live'),
      upcoming: list
        .filter((c) => c.status === 'upcoming')
        .sort((a, b) => (toMillisOrNull(a.startAt) ?? Infinity) - (toMillisOrNull(b.startAt) ?? Infinity)),
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
    <div className="oc-v3-page">
      <HubNav live={live[0] ?? null} />

      {competitions === null ? (
        <p className="oc-v3-status">Ачааллаж байна...</p>
      ) : error ? (
        <p className="oc-v3-status oc-v3-status-error">{error}</p>
      ) : (
        <main className="oc-v3-main">
          {live[0] && <LiveHero competition={live[0]} />}

          <div className="oc-v3-grid">
            <div className="oc-v3-col">
              <UpcomingCard competitions={upcoming} />
            </div>
            <div className="oc-v3-col">
              {live[0] && <LiveMiniCard competition={live[0]} />}
              <LeaderboardCard season={season} leaderboard={leaderboard} />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
