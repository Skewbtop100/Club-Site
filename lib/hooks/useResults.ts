'use client';

import { useState, useEffect } from 'react';
import { subscribeResults } from '@/lib/firebase/services/results';
import type { Result } from '@/lib/types';

export function useResults(competitions: { id: string }[]) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeResults(
      (all) => {
        const published = all.filter((r) => r.status === 'published' && r.source !== 'imported');

        if (competitions.length > 0) {
          const validIds = new Set(competitions.map((c) => c.id));
          setResults(published.filter((r) => r.competitionId && validIds.has(r.competitionId)));
        } else {
          setResults(published);
        }
        setLoading(false);
      },
      () => { setError('Failed to load results.'); setLoading(false); },
    );
    return unsub;
  }, [competitions]);

  return { results, loading, error };
}
