import { Timestamp } from 'firebase-admin/firestore';
import type { OnlineCompetitionEventConfig, OnlineCompetitionStatus, OnlineCompetitionWriteInput } from './types';

// Server-only validation + Firestore-doc-shaping helpers shared by
// app/api/online-competition/admin-competitions/route.ts (list, create)
// and .../admin-competitions/[id]/route.ts (get, update). The admin
// create/edit form does its own client-side validation with Mongolian
// error messages (app/online-competition/admin/_components/CompetitionForm
// .tsx) — this is a lighter server-side sanity check against a
// malformed/malicious payload, not a duplicate of every UI rule.

const VALID_STATUSES: OnlineCompetitionStatus[] = ['upcoming', 'live', 'finished'];

export type ValidationResult =
  | { ok: true; data: OnlineCompetitionWriteInput }
  | { ok: false; error: string };

export function validateCompetitionInput(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' };
  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || !b.name.trim()) {
    return { ok: false, error: 'name is required' };
  }
  if (typeof b.status !== 'string' || !VALID_STATUSES.includes(b.status as OnlineCompetitionStatus)) {
    return { ok: false, error: 'invalid status' };
  }
  if (!Array.isArray(b.events) || b.events.length === 0) {
    return { ok: false, error: 'at least one event is required' };
  }

  const events: OnlineCompetitionEventConfig[] = [];
  for (const raw of b.events) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid event config' };
    const e = raw as Record<string, unknown>;
    if (typeof e.eventId !== 'string' || typeof e.label !== 'string' || typeof e.rounds !== 'number' || e.rounds < 1) {
      return { ok: false, error: 'invalid event config' };
    }
    events.push({ eventId: e.eventId, label: e.label, rounds: e.rounds });
  }

  return {
    ok: true,
    data: {
      name: b.name.trim(),
      description: typeof b.description === 'string' ? b.description : '',
      startAt: typeof b.startAt === 'number' ? b.startAt : null,
      registrationDeadline: typeof b.registrationDeadline === 'number' ? b.registrationDeadline : null,
      participantLimit: typeof b.participantLimit === 'number' ? b.participantLimit : null,
      events,
      status: b.status as OnlineCompetitionStatus,
      season: typeof b.season === 'string' ? b.season.trim() : '',
    },
  };
}

/** Normalizes a raw Firestore `status` value into the current v2 enum
 *  ('upcoming' | 'live' | 'finished'). Competition docs created before the
 *  Phase 1 schema migration — namely the original test-comp-1 seed — may
 *  still carry the old 'upcoming' | 'active' | 'closed' shape. Reading
 *  that raw string straight through (typed as OnlineCompetitionStatus but
 *  not runtime-validated) would hand an unrecognized value to any UI
 *  lookup keyed strictly on the new enum, e.g. the admin dashboard's
 *  status Badge — map the old values onto their closest new-shape
 *  equivalent instead. */
export function normalizeCompetitionStatus(raw: unknown): OnlineCompetitionStatus {
  if (typeof raw === 'string' && VALID_STATUSES.includes(raw as OnlineCompetitionStatus)) {
    return raw as OnlineCompetitionStatus;
  }
  if (raw === 'active') return 'live';
  if (raw === 'closed') return 'finished';
  return 'upcoming';
}

/** Converts a validated write input into the plain object stored in
 *  Firestore (epoch-ms -> Timestamp). Does not set `createdAt` — callers
 *  add that themselves (serverTimestamp on create, left untouched on
 *  update). */
export function toFirestoreDoc(input: OnlineCompetitionWriteInput) {
  return {
    name: input.name,
    description: input.description,
    startAt: input.startAt !== null ? Timestamp.fromMillis(input.startAt) : null,
    registrationDeadline:
      input.registrationDeadline !== null ? Timestamp.fromMillis(input.registrationDeadline) : null,
    participantLimit: input.participantLimit,
    events: input.events,
    status: input.status,
    season: input.season,
  };
}
