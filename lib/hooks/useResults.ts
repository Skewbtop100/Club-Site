'use client';

import { useState, useEffect, useMemo } from 'react';
import { subscribeResults } from '@/lib/firebase/services/results';
import type { Result } from '@/lib/types';

export function useResults(competitions: { id: string }[]) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable string key so the effect doesn't re-run on every render
  const compIdsKey = useMemo(
    () => competitions.map((c) => c.id).sort().join(','),
    [competitions],
  );

  useEffect(() => {
    const unsub = subscribeResults(
      (all) => {
        const published = all.filter((r) => r.status === 'published' && r.source !== 'imported');
        if (compIdsKey) {
          const validIds = new Set(compIdsKey.split(','));
          setResults(published.filter((r) => r.competitionId && validIds.has(r.competitionId)));
        } else {
          setResults(published);
        }
        setLoading(false);
      },
      () => { setError('Failed to load results.'); setLoading(false); },
    );
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compIdsKey]);

  return { results, loading, error };
}
