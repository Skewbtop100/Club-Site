'use client';

import { useState, useEffect } from 'react';
import { subscribeWcaRecords } from '@/lib/firebase/services/records';
import type { WcaRecords } from '@/lib/types';

export function useWcaRecords() {
  const [wcaRecords, setWcaRecords] = useState<WcaRecords>({});

  useEffect(() => {
    const unsub = subscribeWcaRecords(setWcaRecords);
    return unsub;
  }, []);

  return wcaRecords;
}
