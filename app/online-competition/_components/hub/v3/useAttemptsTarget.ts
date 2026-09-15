'use client';

import { useEffect, useState } from 'react';
import { fetchCompetition, fetchMyRegistrations } from '@/lib/online-competition/data';
import { authedFetchWithRetry } from '@/lib/online-competition/authed-fetch';
import { isCompetingRegistration } from '@/lib/online-competition/registration-shape';
import {
  DASHBOARD_HREF,
  pickAttemptsTarget,
  type AttemptsCandidate,
  type AttemptsTarget,
} from '@/lib/online-competition/active-competition';
import { toMillisOrNull } from '../format';

// ── The data behind ОРОЛДЛОГО ────────────────────────────────────────────
// What the athlete is approved for, which of those are live or upcoming, and
// what the round-access gate says is open in the live ones — then
// pickAttemptsTarget decides.
//
// Cost: one registrations read, one competition read per registration, and
// one round-access call per LIVE approved competition (normally none or
// one). An upcoming competition needs no call: opening a round announces the
// competition (round-open.ts), so an upcoming one has none open. Cached per
// athlete for a minute and shared by every page, so moving between the hub,
// the list and the live view does not repeat it; a round opening shows up
// within that minute or on a reload.
//
// A failure routes to the dashboard (or the live view, if the competitions
// were read but the gate was not) and never lights the item up — both
// destinations show their own state, including their own errors.

const TTL_MS = 60_000;
const NONE: AttemptsTarget = { kind: 'none', href: DASHBOARD_HREF };

let cache: { uid: string; at: number; promise: Promise<AttemptsTarget> } | null = null;

async function resolveTarget(uid: string): Promise<AttemptsTarget> {
  const registrations = (await fetchMyRegistrations(uid)).filter((r) => isCompetingRegistration(r.status));
  const joined = await Promise.all(
    registrations.map(async (registration) => ({
      registration,
      competition: await fetchCompetition(registration.competitionId).catch(() => null),
    })),
  );
  // Not finished, and public: live or upcoming.
  const current = joined.flatMap((j) =>
    j.competition && (j.competition.status === 'live' || j.competition.status === 'upcoming')
      ? [{ registration: j.registration, competition: j.competition, status: j.competition.status }]
      : [],
  );

  const candidates: AttemptsCandidate[] = await Promise.all(
    current.map(async ({ registration, competition, status }) => {
      // Upcoming: nothing can be open, so no gate call.
      let liveRounds: Record<string, number | null> | null = status === 'upcoming' ? {} : null;
      if (status === 'live') {
        try {
          const res = await authedFetchWithRetry(
            `/api/online-competition/round-access?competitionId=${encodeURIComponent(registration.competitionId)}`,
          );
          if (res.ok) {
            const body = (await res.json()) as { events?: Record<string, { liveRound?: number | null }> };
            liveRounds = Object.fromEntries(
              Object.entries(body.events ?? {}).map(([eventId, a]) => [eventId, a?.liveRound ?? null]),
            );
          }
        } catch {
          // liveRounds stays null: routed to the live view, not lit up.
        }
      }
      return {
        competitionId: registration.competitionId,
        status,
        startAtMs: toMillisOrNull(competition.startAt),
        events: registration.events,
        liveRounds,
      };
    }),
  );
  return pickAttemptsTarget(candidates);
}

export function useAttemptsTarget(uid: string | null): AttemptsTarget {
  const [target, setTarget] = useState<AttemptsTarget>(NONE);

  useEffect(() => {
    if (!uid) {
      setTarget(NONE);
      return;
    }
    let cancelled = false;
    if (!cache || cache.uid !== uid || Date.now() - cache.at > TTL_MS) {
      cache = { uid, at: Date.now(), promise: resolveTarget(uid) };
    }
    const mine = cache;
    mine.promise.then(
      (t) => {
        if (!cancelled) setTarget(t);
      },
      (err) => {
        console.error('BottomNav: resolving the active competition failed:', err);
        // Do not keep a failure for a minute.
        if (cache === mine) cache = null;
        if (!cancelled) setTarget(NONE);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return target;
}
