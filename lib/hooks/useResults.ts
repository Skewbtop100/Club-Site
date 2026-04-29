'use client';

import { useState, useEffect, useMemo } from 'react';
import { subscribeResults } from '@/lib/firebase/services/results';
import type { Result } from '@/lib/types';

/**
 * Subscribe to results visible on the public site.
 *
 * Public-site behavior (rankings, records, athlete profiles, athletes section):
 * a result is visible only when its competition is **finished**. Results from
 * 'live' or 'upcoming' competitions are hidden here. Live results are still
 * available via the dedicated live viewer (`subscribeResultsByComp`), which
 * bypasses this hook.
 *
 * Imported and unpublished results are also excluded.
 */
export function useResults(competitions: { id: string; status?: 'upcoming' | 'live' | 'finished' }[]) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Build a stable key encoding both the comp ids AND which are finished, so
  // the effect re-runs when a competition flips to finished.
  const finishedIdsKey = useMemo(
    () =>
      competitions
        .filter((c) => c.status === 'finished')
        .map((c) => c.id)
        .sort()
        .join(','),
    [competitions],
  );

  useEffect(() => {
    const unsub = subscribeResults(
      (all) => {
        const published = all.filter((r) => r.status === 'published' && r.source !== 'imported');
        const finishedIds = finishedIdsKey ? new Set(finishedIdsKey.split(',')) : new Set<string>();
        setResults(published.filter((r) => r.competitionId && finishedIds.has(r.competitionId)));
        setLoading(false);
      },
      () => { setError('Failed to load results.'); setLoading(false); },
    );
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedIdsKey]);

  return { results, loading, error };
}
