// ── Where the bottom bar's ОРОЛДЛОГО goes ───────────────────────────────
// Pure — the caller gathers the data (useAttemptsTarget.ts) — so the choice
// is unit-tested in tests/competition-fields/bottom-nav.test.cjs.
//
// ── "ACTIVE" ──
// A competition the athlete is REGISTERED AND APPROVED for, that is live,
// with a round OPEN for an event they registered for. "Open" is the answer
// of the round-access gate — the same one the scramble route enforces with
// — so the item cannot promise a round the solve flow would then refuse.
// Several at once (rare): the one that started first.
//
// ── NONE ACTIVE: ROUTED, NOT DISABLED ──
// On competition day a greyed-out button explains nothing. So:
//   · approved for a live competition but no round open (or the gate could
//     not be read) → that competition's live view, which shows the
//     schedule and says the round is not open yet;
//   · otherwise → the dashboard ("Миний тэмцээнүүд"), which lists what the
//     athlete is registered for, links to every competition, and asks a
//     signed-out visitor to sign in.
// Only the first case lights the item up; the other two route quietly.

export const DASHBOARD_HREF = '/online-competition/dashboard';
export const liveViewHref = (competitionId: string) => `/online-competition/${competitionId}/live`;

export interface AttemptsCandidate {
  competitionId: string;
  startAtMs: number | null;
  /** The events the athlete registered for in this competition. */
  events: string[];
  /** eventId -> the round the gate says is open, or null for none. The
   *  whole map is null when the gate could not be read. */
  liveRounds: Record<string, number | null> | null;
}

export type AttemptsTarget =
  | { kind: 'active'; competitionId: string; href: string }
  | { kind: 'live-no-round'; competitionId: string; href: string }
  | { kind: 'none'; href: string };

/** Candidates are the athlete's APPROVED registrations for LIVE
 *  competitions; anything else never reaches here. */
export function pickAttemptsTarget(candidates: readonly AttemptsCandidate[]): AttemptsTarget {
  const byStart = [...candidates].sort(
    (a, b) => (a.startAtMs ?? Number.POSITIVE_INFINITY) - (b.startAtMs ?? Number.POSITIVE_INFINITY),
  );
  const active = byStart.find(
    (c) => c.liveRounds !== null && c.events.some((e) => typeof c.liveRounds?.[e] === 'number'),
  );
  if (active) {
    return { kind: 'active', competitionId: active.competitionId, href: liveViewHref(active.competitionId) };
  }
  const live = byStart[0];
  if (live) {
    return { kind: 'live-no-round', competitionId: live.competitionId, href: liveViewHref(live.competitionId) };
  }
  return { kind: 'none', href: DASHBOARD_HREF };
}
