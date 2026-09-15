// ── An approved registration's added events: the admin's decision ────────
// Pure — no Firestore — unit-tested in tests/competition-fields/event-requests.test.cjs
// and run against the emulator, with the real scramble gate, in
// tests/firestore-rules/event-requests.test.mjs. The stored lists and the
// athlete's side are in registration-shape.ts.
//
// ONE DECISION PER EVENT. An athlete who asks to add 2x2x2 and 4x4x4 has
// made two requests, and they can have different answers — 4x4x4 may have
// no room in its groups while 2x2x2 does. Approving one never approves the
// other, and a declined event is named, so the athlete knows which.
//
// What each decision writes — the registration's own status never changes:
//   approve — the event joins `events` (from that moment the scramble gate,
//             the rosters and the round checks count it) and leaves
//             `requestedEvents`, `declinedEvents` and `withdrawnEvents`;
//   decline — the event leaves `requestedEvents` and is recorded in
//             `declinedEvents`. The approved events are untouched either way.

import { registrationEvents, storedEventList } from './registration-shape';

export type EventDecision = 'approve' | 'decline';

/** How the review table words each event in an athlete's row:
 *  "3x3x3 · БАТЛАГДСАН   2x2x2 · ХҮСЭЛТ". */
export const EVENT_STATE_WORD = {
  approved: 'БАТЛАГДСАН',
  requested: 'ХҮСЭЛТ',
  withdrawn: 'ХАССАН',
  declined: 'ТАТГАЛЗСАН',
} as const;

/** `{ eventId, decision: 'approve' | 'decline' }`, validated. */
export function parseEventDecision(
  body: unknown,
): { ok: true; eventId: string; decision: EventDecision } | { ok: false; error: string } {
  const b = body as { eventId?: unknown; decision?: unknown } | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'Invalid body' };
  const eventId = typeof b.eventId === 'string' ? b.eventId.trim() : '';
  if (!eventId) return { ok: false, error: 'eventId is required' };
  if (b.decision !== 'approve' && b.decision !== 'decline') {
    return { ok: false, error: 'decision must be "approve" or "decline"' };
  }
  return { ok: true, eventId, decision: b.decision };
}

export type EventDecisionPlan =
  | { ok: true; update: Record<string, string[]> }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** The fields one decision writes onto a stored registration, or why it
 *  cannot be made. 409 means the registration moved on since the admin
 *  loaded it — the table reloads. */
export function planEventDecision(
  stored: Record<string, unknown> | null | undefined,
  eventId: string,
  decision: EventDecision,
  configuredEventIds: readonly string[],
): EventDecisionPlan {
  if (!stored) return { ok: false, status: 404, error: 'Энэ тамирчны бүртгэл олдсонгүй.' };
  const current = registrationEvents(stored);
  if (!current.competing) {
    return { ok: false, status: 409, error: 'Бүртгэл өөрөө баталгаажаагүй байна — эхлээд бүртгэлийг шийдвэрлэнэ үү.' };
  }
  if (!current.requested.includes(eventId)) {
    return {
      ok: false,
      status: 409,
      error: 'Энэ төрлийн хүсэлт одоо байхгүй байна — тамирчин өөрчилсөн байж магадгүй. Жагсаалтыг дахин ачааллаа.',
    };
  }
  const requestedEvents = current.requested.filter((e) => e !== eventId);
  const without = (field: unknown) => storedEventList(field).filter((e) => e !== eventId);

  if (decision === 'approve') {
    if (!configuredEventIds.includes(eventId)) {
      return { ok: false, status: 400, error: 'Энэ төрөл тэмцээнд тохируулагдаагүй байна.' };
    }
    return {
      ok: true,
      update: {
        events: [...current.approved, eventId],
        requestedEvents,
        declinedEvents: without(stored.declinedEvents),
        withdrawnEvents: without(stored.withdrawnEvents),
      },
    };
  }
  return { ok: true, update: { requestedEvents, declinedEvents: [...without(stored.declinedEvents), eventId] } };
}

/** Outstanding added-event requests across registrations. */
export function countEventRequests(regs: readonly { requestedEvents?: readonly string[] }[]): number {
  return regs.reduce((n, r) => n + (r.requestedEvents?.length ?? 0), 0);
}
