'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchAllCompetitions } from '@/lib/online-competition/data';
import { pickFeatured } from '@/lib/online-competition/featured';
import type { CompetitionAthleteCounts } from '@/app/api/online-competition/competitions/athlete-counts/route';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { toMillisOrNull } from './_components/hub/format';
import FeaturedBanner from './_components/hub/v3/FeaturedBanner';
import HubNav from './_components/hub/v3/HubNav';
import LiveHero from './_components/hub/v3/LiveHero';
import UpcomingCard from './_components/hub/v3/UpcomingCard';
import LiveMiniCard from './_components/hub/v3/LiveMiniCard';

export default function OnlineCompetitionHubPage() {
  const [competitions, setCompetitions] = useState<OnlineCompetition[] | null>(null);
  const [error, setError] = useState('');
  /** The upcoming rows' capacity readout. Same endpoint and same edge cache
   *  the competitions list uses, so opening one after the other costs one
   *  request between them. */
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

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

  // Independent of the list above: a slow count must not hold up the page,
  // and a failed one leaves `counts` null, which the rows render as "—".
  useEffect(() => {
    let cancelled = false;
    fetch('/api/online-competition/competitions/athlete-counts')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CompetitionAthleteCounts | null) => {
        if (!cancelled && data) setCounts(data.counts);
      })
      .catch(() => {
        /* The rows show "—"; a missing count is not a page error. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { live, upcoming, featured } = useMemo(() => {
    const list = competitions ?? [];
    return {
      live: list.filter((c) => c.status === 'live'),
      upcoming: list
        .filter((c) => c.status === 'upcoming')
        .sort((a, b) => (toMillisOrNull(a.startAt) ?? Infinity) - (toMillisOrNull(b.startAt) ?? Infinity)),
      // Drafts cannot reach here: fetchAllCompetitions queries
      // `status != 'draft'`, so an unannounced competition is never in
      // `list` to be picked — the banner inherits that guarantee rather
      // than restating it.
      //
      // Date.now() is read HERE, not inside pickFeatured, so the whole
      // frame is decided against one instant. It is evaluated only after
      // the fetch resolves (competitions is null until then), so there is
      // no server-rendered banner for a client clock to disagree with.
      featured: pickFeatured(
        list.map((c) => ({
          competition: c,
          id: c.id,
          featured: c.featured,
          featuredUntilMs: toMillisOrNull(c.featuredUntil),
          createdAtMs: toMillisOrNull(c.createdAt),
        })),
        Date.now(),
      )?.competition ?? null,
    };
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
          {/* Above everything, including the live hero — a featured
              competition is the one the admin chose to lead with, by the ★
              in the admin list (or the editor's ОНЦЛОХ tick). With none
              featured this renders nothing and the page opens on the live
              hero, or straight on the list. */}
          {featured && <FeaturedBanner competition={featured} />}

          {live[0] && <LiveHero competition={live[0]} />}

          {/* The right column held the season-points leaderboard, which was
              removed. It now exists only while a competition is live, for
              the live card; otherwise the upcoming list takes the full
              width rather than sitting beside an empty column. */}
          {live[0] ? (
            <div className="oc-v3-grid">
              <div className="oc-v3-col">
                <UpcomingCard competitions={upcoming} counts={counts} />
              </div>
              <div className="oc-v3-col">
                <LiveMiniCard competition={live[0]} />
              </div>
            </div>
          ) : (
            <UpcomingCard competitions={upcoming} counts={counts} />
          )}
        </main>
      )}
    </div>
  );
}
