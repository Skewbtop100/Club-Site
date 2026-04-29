'use client';

import { useState, useEffect } from 'react';
import { subscribeCompetitions } from '@/lib/firebase/services/competitions';
import type { Competition } from '@/lib/types';

export function useCompetitions() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('useCompetitions: subscribing to Firebase');
    const unsub = subscribeCompetitions(
      (data) => {
        console.log('useCompetitions: snapshot received, count:', data.length);
        setCompetitions(data);
        setLoading(false);
      },
      (err) => {
        console.log('useCompetitions: error:', err);
        setError('Failed to load competitions.');
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { competitions, loading, error };
}
