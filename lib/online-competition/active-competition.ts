// ── Where the bottom bar's ОРОЛДЛОГО goes ───────────────────────────────
// Pure — the caller gathers the data (useAttemptsTarget.ts) — so the choice
// is unit-tested in tests/competition-fields/bottom-nav.test.cjs.
//
// ── CANDIDATES ──
// The athlete's REGISTERED AND APPROVED competitions that are public and not
// finished: 'live' or 'upcoming'. Drafts never reach here (fetchCompetition
// returns null for one), and finished ones are left out by the caller.
//
// ── LIT: "ACTIVE" ──
// A live candidate with a round OPEN for an event the athlete registered
// for. "Open" is the answer of the round-access gate — the same one the
// scramble route enforces with — so the lit item cannot promise a round the
// solve flow would then refuse. Several at once (rare): the soonest, below.
//
// ── OTHERWISE: THE SOONEST ──
// Every tap goes to a live view. With nothing open, it is the SOONEST
// candidate:
//   · a live competition before an upcoming one — it is already under way;
//   · then the earliest start time;
//   · a competition with no start time after every one that has one;
//   · then the competition id, so the choice never flickers between loads.
// The live view shows that athlete's next round, with a countdown when the
// programme has a time for it (CurrentRoundPanel NextRoundBox). Not lit.
//
// ── NONE ──
// Approved for nothing live or upcoming (or signed out): the dashboard
// ("Миний тэмцээнүүд"), which lists what the athlete is registered for,
// links to every competition, and asks a signed-out visitor to sign in.

export const DASHBOARD_HREF = '/online-competition/dashboard';
export const liveViewHref = (competitionId: string) => `/online-competition/${competitionId}/live`;

export interface AttemptsCandidate {
  competitionId: string;
  status: 'live' | 'upcoming';
  startAtMs: number | null;
  /** The events the athlete registered for in this competition. */
  events: string[];
  /** eventId -> the round the gate says is open, or null for none. The
   *  whole map is null when the gate could not be read. */
  liveRounds: Record<string, number | null> | null;
}

export type AttemptsTarget =
  | { kind: 'active'; competitionId: string; href: string }
  | { kind: 'next'; competitionId: string; href: string }
  | { kind: 'none'; href: string };

export function pickAttemptsTarget(candidates: readonly AttemptsCandidate[]): AttemptsTarget {
  const ordered = [...candidates].sort(
    (a, b) =>
      (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1) ||
      // Two missing start times give NaN, which falls through to the id.
      (a.startAtMs ?? Number.POSITIVE_INFINITY) - (b.startAtMs ?? Number.POSITIVE_INFINITY) ||
      (a.competitionId < b.competitionId ? -1 : a.competitionId > b.competitionId ? 1 : 0),
  );
  const active = ordered.find(
    (c) => c.status === 'live' && c.liveRounds !== null && c.events.some((e) => typeof c.liveRounds?.[e] === 'number'),
  );
  if (active) {
    return { kind: 'active', competitionId: active.competitionId, href: liveViewHref(active.competitionId) };
  }
  const soonest = ordered[0];
  if (soonest) {
    return { kind: 'next', competitionId: soonest.competitionId, href: liveViewHref(soonest.competitionId) };
  }
  return { kind: 'none', href: DASHBOARD_HREF };
}
