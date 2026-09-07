import type { OnlineCompetition } from '@/lib/online-competition/types';
import type { RoundAccess } from '@/lib/online-competition/round-access';
import { toMillisOrNull } from '../../_components/hub/format';

export type EventRowState = 'done' | 'live' | 'idle' | 'dns' | 'notqualified';

// TODO: derive "done"/"dns" from actual submission/result data once that
// model exists. The idle-vs-live half of this is still purely
// startAt-based — the schema has no per-event scheduling — but round
// access is now real: see `access` below.
export function deriveEventState(
  competition: OnlineCompetition,
  /** This athlete's round access for the event, from
   *  /api/online-competition/round-access. Undefined while it is still
   *  loading, or null when the lookup failed — both fall back to the
   *  previous startAt-only behaviour rather than guessing. */
  access?: RoundAccess | null,
): EventRowState {
  // Round access, when known, decides this outright — the dashboard must
  // never offer "Эхлүүлэх" for something the solve flow would then refuse.
  //   not-qualified — round 2+ and this athlete missed the cut: say so.
  //   no-live-round — nothing to attempt yet: the existing disabled state,
  //                   not a rejection, since it applies to everyone and is
  //                   usually just "the admin hasn't opened it".
  if (access) {
    if (access.reason === 'not-qualified') return 'notqualified';
    if (access.reason === 'no-live-round') return 'idle';
  }

  const startMs = toMillisOrNull(competition.startAt);
  if (startMs === null) return 'idle';
  return Date.now() >= startMs ? 'live' : 'idle';
}
