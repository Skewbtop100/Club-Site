'use client';

import { useState, useEffect } from 'react';
import { subscribeEventVisibility } from '@/lib/firebase/services/records';
import type { EventVisibility } from '@/lib/types';

export function useEventVisibility() {
  const [visibility, setVisibility] = useState<EventVisibility>({});

  useEffect(() => {
    const unsub = subscribeEventVisibility(setVisibility, () => setVisibility({}));
    return unsub;
  }, []);

  return visibility;
}
