'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchAllCompetitions, fetchSeasonLeaderboard } from '@/lib/online-competition/data';
import type { OnlineCompetition, OnlineSeasonAthletePoints } from '@/lib/online-competition/types';
import { toMillisOrNull } from '../_components/hub/format';
import HubNav from '../_components/hub/v3/HubNav';
import EmptyBlock from '../_components/hub/v3/EmptyBlock';

const COMPETITIONS = '/online-competition/competitions';

// Full season standings. Exactly the same data source the hub's top-5
// sidebar widget uses — fetchSeasonLeaderboard reads
// onlineSeasonPoints/{season}/athletes, written by the admin
// points-recompute action — just uncapped and full width.
export default function RankPage() {
  const [competitions, setCompetitions] = useState<OnlineCompetition[] | null>(null);
  const [season, setSeason] = useState('');
  const [leaderboard, setLeaderboard] = useState<OnlineSeasonAthletePoints[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAllCompetitions()
      .then((list) => {
        if (!cancelled) setCompetitions(list);
      })
      .catch(() => {
        if (!cancelled) setError('Мэдээллийг ачааллаж чадсангүй');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "Current" season = the season of whichever competition (with a season
  // set at all) has the latest startAt — the same heuristic the hub uses,
  // since seasons have no doc or dates of their own to compare.
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

    let cancelled = false;
    // No count cap that matters here — the hub widget takes the default
    // 10, this page is the "see everything" destination.
    fetchSeasonLeaderboard(currentSeason, 500)
      .then((rows) => {
        if (!cancelled) setLeaderboard(rows);
      })
      .catch(() => {
        if (!cancelled) setLeaderboard([]);
      });
    return () => {
      cancelled = true;
    };
  }, [competitions]);

  return (
    <div className="oc-v3-page">
      <HubNav live={competitions?.find((c) => c.status === 'live') ?? null} active="rank" />

      <main className="oc-v3-main" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <div>
          <p className="oc-v3-eyebrow">Онооны хүснэгт</p>
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <h1 className="oc-v3-title">Ранк</h1>
            {season && <span className="oc-v3-season">{season.toUpperCase()}</span>}
          </div>
        </div>

        {error ? (
          <p className="oc-v3-status oc-v3-status-error">{error}</p>
        ) : leaderboard === null ? (
          <p className="oc-v3-status">Ачааллаж байна...</p>
        ) : (
          <div className="oc-v3-card">
            <div className="oc-v3-card-head oc-v3-card-head-sm">
              <span className="oc-v3-label">Улирлын оноо</span>
              <span className="oc-v3-season">{leaderboard.length} тамирчин</span>
            </div>

            {leaderboard.length === 0 ? (
              <EmptyBlock
                text="Онооны мэдээлэл алга."
                hint={
                  <>
                    <span>Улирлын оноо тэмцээн дууссаны дараа тооцогдоно</span>
                    <Link href={COMPETITIONS}>БҮХ ТЭМЦЭЭН ҮЗЭХ →</Link>
                  </>
                }
              />
            ) : (
              leaderboard.map((athlete, i) => (
                <div key={athlete.uid} className="oc-v3-lb-row">
                  <span className={`oc-v3-lb-rank${i < 3 ? ' oc-v3-lb-rank-top' : ''}`}>{i + 1}</span>
                  <span className="oc-v3-lb-name">{athlete.displayName}</span>
                  <span className="oc-v3-lb-points">{athlete.totalPoints}</span>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
