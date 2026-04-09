'use client';

import { useState, useEffect } from 'react';
import { subscribeAthletes } from '@/lib/firebase/services/athletes';
import type { Athlete } from '@/lib/types';

export function useAthletes() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAthletes(
      (data) => { setAthletes(data); setLoading(false); },
      () => { setError('Failed to load athletes.'); setLoading(false); },
    );
    return unsub;
  }, []);

  return { athletes, loading, error };
}
