'use client';

import { useEffect } from 'react';

// Registers the timer's service worker on mount. Failures are swallowed —
// the app must still work when SW registration is blocked (private mode,
// http origin, etc.).
export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/timer' })
      .catch(() => { /* ignore */ });
  }, []);
  return null;
}
