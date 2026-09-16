'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchAllCompetitions } from '@/lib/online-competition/data';
import type { CompetitionAthleteCounts } from '@/app/api/online-competition/competitions/athlete-counts/route';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import HubNav from '../_components/hub/v3/HubNav';
import CompetitionList from '../_components/hub/v3/CompetitionList';

/** The competitions list. ONE view — every public competition, grouped by
 *  state — with no БҮХ ТЭМЦЭЭН / МИНИЙ ТЭМЦЭЭН toggle of its own.
 *
 *  That toggle used to sit here as a pair of pills AND in the header's
 *  ТЭМЦЭЭНҮҮД dropdown, with the same two labels. The pills are the copy
 *  that went: the dropdown is reachable from every page, these were
 *  reachable only from this one, and the two were not even equivalent —
 *  the dropdown's МИНИЙ ТЭМЦЭЭН goes to the dashboard, while the pill
 *  swapped in a smaller inline list here. */
export default function CompetitionsPage() {
  const [competitions, setCompetitions] = useState<OnlineCompetition[] | null>(null);
  const [error, setError] = useState('');
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

  const live = useMemo(
    () => (competitions ?? []).find((c) => c.status === 'live') ?? null,
    [competitions],
  );

  return (
    <div className="oc-v3-page">
      <HubNav live={live} active="competitions" />

      <main className="oc-v3-main">
        {/* Error first: a failed fetch leaves `competitions` null, so the
            loading branch used to swallow it and spin forever. */}
        {error ? (
          <p className="oc-v3-status oc-v3-status-error">{error}</p>
        ) : competitions === null ? (
          <p className="oc-v3-status">Ачааллаж байна...</p>
        ) : (
          <CompetitionList competitions={competitions} counts={counts} />
        )}
      </main>
    </div>
  );
}
