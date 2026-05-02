'use client';

import { useEffect, useRef } from 'react';

// Local minimal types — `WakeLockSentinel` ships in modern lib.dom, but
// projects targeting older lib versions can miss it. Defining the shape we
// actually use keeps this hook portable.
interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

/**
 * Keep the screen awake while `active` is true.
 *
 * The browser auto-releases the wake lock when the tab/page becomes hidden,
 * so we re-acquire on `visibilitychange` whenever the page returns to view
 * AND the caller still wants to be active. Releases on `active=false` and
 * on unmount. Fails silently on browsers without the API (Firefox today,
 * older Safari) — wake lock is a nice-to-have.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  // Mirror `active` into a ref so the visibilitychange listener (which
  // outlives a single render closure) can read the *current* value.
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    let cancelled = false;

    const acquire = async () => {
      if (sentinelRef.current) return;
      const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithWakeLock | undefined;
      if (!nav?.wakeLock) return;
      try {
        const sentinel = await nav.wakeLock.request('screen');
        if (cancelled) {
          try { await sentinel.release(); } catch { /* ignore */ }
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // request() rejects when document isn't visible / focused, when the
        // OS is in low-power mode, etc. None of these are user-actionable.
      }
    };

    const release = async () => {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (!s) return;
      try { await s.release(); } catch { /* ignore */ }
    };

    if (active) {
      // The browser rejects request() when the document isn't visible, so
      // gate on visibility here too. The visibilitychange handler will
      // re-acquire when the user comes back to the tab.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void acquire();
      }
    } else {
      void release();
    }

    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') {
        if (activeRef.current) void acquire();
      } else {
        // Hidden tab — the browser has already auto-released the lock,
        // we just need to drop our stale reference so the next visible
        // tick re-requests fresh.
        sentinelRef.current = null;
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      void release();
    };
  }, [active]);
}
