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
 */
export function useResults(
  competitions: { id: string; status?: 'upcoming' | 'live' | 'finished'; isDailyPractice?: boolean }[],
) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Build a stable key encoding both the comp ids AND which are visible, so
  // the effect re-runs when a competition flips to finished.
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
    const unsub = subscribeResults(
      (all) => {
        const published = all.filter((r) => r.status === 'published' && r.source !== 'imported');
        const visibleIds = visibleIdsKey ? new Set(visibleIdsKey.split(',')) : new Set<string>();
        setResults(published.filter((r) => r.competitionId && visibleIds.has(r.competitionId)));
        setLoading(false);
      },
      () => { setError('Failed to load results.'); setLoading(false); },
    );
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIdsKey]);

  return { results, loading, error };
}
