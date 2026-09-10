'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineRegistration } from '@/lib/online-competition/types';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { fetchRegistration } from '@/lib/online-competition/data';

/** The signed-in athlete's registration for one competition.
 *
 *  Lifted out of RegistrationPanel so the detail page's SIDEBAR can show
 *  the registration's status too — the panel only mounts when its tab is
 *  open, and a status that appears only after a click is not much of a
 *  status. One fetch, one source, handed to both.
 *
 *  `refresh()` re-reads after a save WITHOUT flipping `loading` back on:
 *  the panel keeps showing what it has until the new copy lands, rather
 *  than flashing "Ачааллаж байна..." after every save. `loading` is only
 *  true for the first read, and again when the signed-in account changes. */
export function useMyRegistration(competitionId: string) {
  const { user } = useOnlineAuth();
  const uid = user && !user.isAnonymous ? user.uid : null;

  const [registration, setRegistration] = useState<OnlineRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setRegistration(null);
      setLoading(false);
      loadedFor.current = null;
      return;
    }
    let cancelled = false;
    // A different account (or the first read) starts from nothing, so a
    // previous athlete's registration can never stay on screen.
    if (loadedFor.current !== uid) {
      setRegistration(null);
      setLoading(true);
    }
    fetchRegistration(uid, competitionId)
      .then((reg) => {
        if (cancelled) return;
        setRegistration(reg);
        loadedFor.current = uid;
      })
      .catch((err) => {
        // Best-effort, as the panel's own read always was: on failure the
        // athlete sees the unregistered state and can register normally.
        console.error('useMyRegistration: loading the registration failed:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, competitionId, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { registration, loading, refresh };
}
