// ── May this athlete start THIS event, right now? ───────────────────────
// Pure — no Firestore, no React — so it is unit-tested directly
// (tests/competition-fields/event-state.test.cjs). Moved out of the
// dashboard's _components when the detail page needed the same answer:
// two copies of "can I start" is how the dashboard and the solve flow
// would come to disagree.

import type { RoundAccess } from './round-access';

export type EventRowState = 'done' | 'live' | 'idle' | 'dns' | 'notqualified';

/**
 *  ROUND ACCESS DECIDES IT. When the gate has answered, its answer is the
 *  whole answer:
 *    ok            — a round is open and this athlete may attempt it.
 *    not-qualified — round 2+ and they missed the cut: say so.
 *    no-live-round — nothing to attempt yet; the disabled state, not a
 *                    rejection, since it applies to everyone and usually
 *                    just means the admin has not opened it.
 *
 *  `ok` USED TO FALL THROUGH to a startAt comparison, and that was a bug:
 *  a competition with rounds open since September and a December start
 *  rendered a disabled button for everyone, because the schedule said the
 *  competition had not begun while the gate said the round was open. The
 *  gate is the thing the solve flow actually enforces with, so it is the
 *  thing the button follows.
 *
 *  startAt survives only where access is UNKNOWN — the request is still in
 *  flight, or it failed. There it is the best guess available, and it is
 *  the behaviour this had before round access existed. A false "live"
 *  there costs nothing: the solve page re-asks the same gate and refuses
 *  with an explanation.
 */
export function deriveEventState(
  competition: { startAt?: { toMillis?: () => number } | null },
  /** This athlete's round access for the event, from
   *  /api/online-competition/round-access. Undefined while it is still
   *  loading; null when the lookup failed. */
  access: RoundAccess | null | undefined,
  now: number,
): EventRowState {
  if (access) {
    if (access.reason === 'not-qualified') return 'notqualified';
    if (access.reason === 'no-live-round') return 'idle';
    if (access.reason === 'ok') return 'live';
  }

  const startMs = competition.startAt?.toMillis?.() ?? null;
  if (startMs === null) return 'idle';
  return now >= startMs ? 'live' : 'idle';
}
