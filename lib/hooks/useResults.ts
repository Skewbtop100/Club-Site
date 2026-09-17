'use client';

import { useState, useEffect, useMemo } from 'react';
import { subscribeResults } from '@/lib/firebase/services/results';
import type { Result } from '@/lib/types';

/**
 * Subscribe to results visible on the public site.
 *
 * Public-site behavior (rankings, records, athlete profiles, athletes section):
 * a result is visible when its competition is either **finished**, or is the
 * Daily Practice pseudo-competition (which stays `status: 'live'` forever by
 * design — `isDailyPractice` opts it into visibility despite that). Results
 * from any other 'live' or 'upcoming' competition are hidden here. Live
 * results are still available via the dedicated live viewer
 * (`subscribeResultsByComp`), which bypasses this hook.
 *
 * Imported and unpublished results are also excluded.
 *
 * ONE SUBSCRIPTION PER MOUNT. The listener covers the whole results
 * collection, so a subscribe is the most expensive read on the page. It waits
 * for `competitionsLoading` to settle — `competitions` starts as [] — and
 * never restarts when the visible set changes: that is a re-filter of the
 * documents already in hand (the useMemo below), not a new read.
 */
export function useResults(
  competitions: { id: string; status?: 'upcoming' | 'live' | 'finished'; isDailyPractice?: boolean }[],
  competitionsLoading: boolean,
) {
  const [allResults, setAllResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build a stable key encoding both the comp ids AND which are visible, so
  // the filter re-runs when a competition flips to finished.
  const visibleIdsKey = useMemo(
    () =>
      competitions
        .filter((c) => c.status === 'finished' || c.isDailyPractice)
        .map((c) => c.id)
        .sort()
        .join(','),
    [competitions],
  );

  useEffect(() => {
    if (competitionsLoading) return;
    const unsub = subscribeResults(
      (all) => setAllResults(all),
      () => { setError('Failed to load results.'); setAllResults((prev) => prev ?? []); },
    );
    return unsub;
  }, [competitionsLoading]);

  const results = useMemo(() => {
    if (!allResults) return [];
    const published = allResults.filter((r) => r.status === 'published' && r.source !== 'imported');
    const visibleIds = visibleIdsKey ? new Set(visibleIdsKey.split(',')) : new Set<string>();
    return published.filter((r) => r.competitionId && visibleIds.has(r.competitionId));
  }, [allResults, visibleIdsKey]);

  return { results, loading: allResults === null, error };
}
