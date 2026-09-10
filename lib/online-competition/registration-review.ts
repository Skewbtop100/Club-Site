// ── Registration review: shared rules for the admin table and its API ──
// Pure — no Firestore, no React. The admin review table, the admin write
// routes and the tests all use these, so the table cannot offer an action
// the API refuses, and the summary line cannot count differently from the
// sections below it. Tested in tests/competition-fields/registration-review.test.cjs.

import { REGISTRATION_STATUS_NOTE_MAX } from './types';
import type { OnlineRegistrationStatus } from './types';
import { REGISTRATION_STATUSES } from './registration-shape';

/** Section order in the review table: the work first, the finished last. */
export const REVIEW_ORDER: OnlineRegistrationStatus[] = ['pending', 'waitlisted', 'approved', 'cancelled', 'rejected'];

export const REVIEW_SECTION_LABEL: Record<OnlineRegistrationStatus, string> = {
  pending: 'Хүлээгдэж буй',
  waitlisted: 'Хүлээлгийн жагсаалт',
  approved: 'Баталгаажсан',
  cancelled: 'Цуцлагдсан',
  rejected: 'Татгалзсан',
};

/** The bulk bar's actions, in the mockup's order. There is no bulk
 *  "back to pending" — un-reviewing a batch is not a thing an admin
 *  should do by accident, and a single row can still be set to pending. */
export const BULK_ACTIONS: { status: OnlineRegistrationStatus; label: string }[] = [
  { status: 'approved', label: 'БАТЛАХ' },
  { status: 'waitlisted', label: 'ХҮЛЭЭЛГЭНД' },
  { status: 'cancelled', label: 'ЦУЦЛАХ' },
  { status: 'rejected', label: 'ТАТГАЛЗАХ' },
];

/** At most this many registrations in one bulk call. A Firestore
 *  transaction allows 500 writes; the reads count toward its limits too,
 *  and a competition never needs more in one click. */
export const BULK_MAX = 200;

// ── the write payload ──────────────────────────────────────────────────

/** A validated change to apply. `statusNote: null` CLEARS the note;
 *  `undefined` leaves it alone. */
export interface StatusPatch {
  status?: OnlineRegistrationStatus;
  statusNote?: string | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates `{ status?, statusNote? }`.
 *
 *  An UNKNOWN status is refused, not defaulted — silently turning a typo
 *  into 'pending' would un-review someone. 'registered' is refused too:
 *  it is a legacy stored spelling, never a value anyone may write. A blank
 *  or null statusNote means "clear it". At least one of the two must be
 *  present; an empty patch is a client bug worth hearing about. */
export function parseStatusPatch(body: unknown): Parsed<StatusPatch> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid body' };
  const b = body as Record<string, unknown>;
  const patch: StatusPatch = {};

  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !REGISTRATION_STATUSES.includes(b.status as OnlineRegistrationStatus)) {
      return { ok: false, error: `unknown status ${JSON.stringify(b.status)}` };
    }
    patch.status = b.status as OnlineRegistrationStatus;
  }

  if (b.statusNote !== undefined) {
    if (b.statusNote === null) {
      patch.statusNote = null;
    } else if (typeof b.statusNote !== 'string') {
      return { ok: false, error: 'statusNote must be a string or null' };
    } else {
      const trimmed = b.statusNote.trim();
      if (trimmed.length > REGISTRATION_STATUS_NOTE_MAX) {
        return { ok: false, error: `statusNote is longer than ${REGISTRATION_STATUS_NOTE_MAX} characters` };
      }
      patch.statusNote = trimmed ? trimmed : null;
    }
  }

  if (patch.status === undefined && patch.statusNote === undefined) {
    return { ok: false, error: 'nothing to change: send status and/or statusNote' };
  }
  return { ok: true, value: patch };
}

/** Validates the bulk body: `{ uids: string[], status?, statusNote? }`. */
export function parseBulkPatch(body: unknown): Parsed<{ uids: string[]; patch: StatusPatch }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid body' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.uids) || b.uids.length === 0) return { ok: false, error: 'uids must be a non-empty array' };
  if (!b.uids.every((u) => typeof u === 'string' && u.trim())) return { ok: false, error: 'every uid must be a string' };
  const uids = [...new Set((b.uids as string[]).map((u) => u.trim()))];
  if (uids.length > BULK_MAX) return { ok: false, error: `at most ${BULK_MAX} registrations per request` };
  const patch = parseStatusPatch({ status: b.status, statusNote: b.statusNote });
  if (!patch.ok) return patch;
  return { ok: true, value: { uids, patch: patch.value } };
}

// ── the table's derived lines ──────────────────────────────────────────

export function countByStatus(regs: { status: OnlineRegistrationStatus }[]): Record<OnlineRegistrationStatus, number> {
  const out = { pending: 0, waitlisted: 0, approved: 0, cancelled: 0, rejected: 0 };
  for (const r of regs) out[r.status] += 1;
  return out;
}

/** "БҮРТГЭЛ · 12 ХҮЛЭЭГДЭЖ · 40/64 БАТАЛГААЖСАН · 3 ЦУЦЛАГДСАН".
 *
 *  The limit is shown AGAINST the approved count because approved is who
 *  takes a place. It is not enforced yet (PR-4) — the figure can read
 *  "70/64", and that overrun is exactly what an admin needs to see. */
export function reviewSummary(regs: { status: OnlineRegistrationStatus }[], limit: number | null): string {
  const c = countByStatus(regs);
  return `БҮРТГЭЛ · ${c.pending} ХҮЛЭЭГДЭЖ · ${c.approved}/${limit ?? '∞'} БАТАЛГААЖСАН · ${c.cancelled} ЦУЦЛАГДСАН`;
}

/** "{N} тамирчин · {N} шинэ". */
export function sectionFooter(regs: { isNew: boolean }[]): string {
  return `${regs.length} тамирчин · ${regs.filter((r) => r.isNew).length} шинэ`;
}
