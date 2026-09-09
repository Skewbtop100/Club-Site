import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DEFAULT_COMPETITION_FORMAT } from './types';
import type { OnlineCompetitionEventConfig, OnlineCompetitionStatus, OnlineCompetitionWriteInput } from './types';

// Server-only validation + Firestore-doc-shaping helpers shared by
// app/api/online-competition/admin-competitions/route.ts (list, create)
// and .../admin-competitions/[id]/route.ts (get, update). The admin
// create/edit form does its own client-side validation with Mongolian
// error messages (app/online-competition/admin/_components/
// CompetitionEditor.tsx) — this is a lighter server-side sanity check
// against a malformed/malicious payload, not a duplicate of every UI rule.

// MUST list every member of OnlineCompetitionStatus. A value missing here
// is not rejected — normalizeCompetitionStatus below falls through to
// 'upcoming', so omitting 'draft' would make a draft competition read back
// as a public one. Kept in step with the identical list in data.ts (the
// client half, deliberately duplicated — this file imports firebase-admin)
// and with STATUS_OPTIONS in the admin form.
const VALID_STATUSES: OnlineCompetitionStatus[] = ['draft', 'upcoming', 'live', 'finished'];

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
  // A draft may have no events yet. The Ерөнхий tab of the admin editor
  // saves before the Төрөл tab has been built, let alone filled in, so a
  // competition genuinely exists with events: [] for part of its life —
  // rejecting that would make "Нооргоор хадгалах" impossible on a new
  // competition. Every OTHER status keeps the original guarantee: nothing
  // reaches the public site without at least one event. The publish-time
  // readiness checklist (Хянах tab) is where a draft's completeness gets
  // enforced.
  if (!Array.isArray(b.events)) {
    return { ok: false, error: 'events must be an array' };
  }
  if (b.events.length === 0 && b.status !== 'draft') {
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
      // Same coerce-don't-reject treatment as the dates above: this is a
      // sanity check against a malformed payload, and the form owns the
      // ordering rules (opens < deadline <= start < end) with Mongolian
      // messages. A draft is expected to have most of these unset.
      registrationOpensAt: typeof b.registrationOpensAt === 'number' ? b.registrationOpensAt : null,
      endAt: typeof b.endAt === 'number' ? b.endAt : null,
      format: typeof b.format === 'string' && b.format.trim() ? b.format.trim() : DEFAULT_COMPETITION_FORMAT,
      featured: b.featured === true,
      // The banner three are stored regardless of `featured` — see the
      // field comments in types.ts. Not trimmed to '' and dropped when the
      // flag is off: that would silently discard an admin's copy the
      // moment they unticked the box.
      featuredHeading: typeof b.featuredHeading === 'string' ? b.featuredHeading.trim() : '',
      featuredCtaLabel: typeof b.featuredCtaLabel === 'string' ? b.featuredCtaLabel.trim() : '',
      featuredUntil: typeof b.featuredUntil === 'number' ? b.featuredUntil : null,
      instructions: typeof b.instructions === 'string' ? b.instructions : '',
      paid: b.paid === true,
      // Images: null unless a non-empty string arrives. An empty string is
      // normalised to null so "removed" has exactly one representation in
      // the document rather than two ('' and null) for readers to handle.
      posterUrl: nullableString(b.posterUrl),
      posterPublicId: nullableString(b.posterPublicId),
      bannerUrl: nullableString(b.bannerUrl),
      bannerPublicId: nullableString(b.bannerPublicId),
    },
  };
}

/** '' / non-string / absent -> null; otherwise the trimmed string. */
function nullableString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** Normalizes a raw Firestore `status` value into the current v2 enum
 *  ('draft' | 'upcoming' | 'live' | 'finished'). Competition docs created before the
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
  // Fallback for a genuinely unrecognized value (or a doc with no status
  // field at all). Deliberately NOT 'draft': a legacy doc that currently
  // shows publicly must not silently vanish from the public site because
  // its status string wasn't recognised. The cost of that choice is that
  // 'draft' has to be a RECOGNISED value (it is, via VALID_STATUSES above)
  // — if it is ever dropped from that list, every draft lands here and
  // goes public. That is the failure this comment exists to prevent.
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
    registrationOpensAt:
      input.registrationOpensAt !== null ? Timestamp.fromMillis(input.registrationOpensAt) : null,
    endAt: input.endAt !== null ? Timestamp.fromMillis(input.endAt) : null,
    format: input.format,
    featured: input.featured,
    featuredHeading: input.featuredHeading,
    featuredCtaLabel: input.featuredCtaLabel,
    featuredUntil: input.featuredUntil !== null ? Timestamp.fromMillis(input.featuredUntil) : null,
    instructions: input.instructions,
    paid: input.paid,
    posterUrl: input.posterUrl,
    posterPublicId: input.posterPublicId,
    bannerUrl: input.bannerUrl,
    bannerPublicId: input.bannerPublicId,
  };
}

/** Creates or updates a competition, keeping `featured` exclusive.
 *
 *  At most one competition may be featured, so a save that sets the flag
 *  has to clear it everywhere else. Done in a TRANSACTION rather than a
 *  query-then-batch: the read of "who is featured now" and the writes that
 *  act on it have to be one atomic unit, or two admins saving at once each
 *  read an empty set, each clear nothing, and both end up featured — the
 *  exact invariant this is here to hold. Firestore retries the transaction
 *  on contention, so the loser re-reads and sees the winner's flag.
 *
 *  Firestore requires every read in a transaction to precede every write,
 *  which is why the query runs before any tx.set/tx.update below.
 *
 *  The query needs no composite index — a single-field equality filter
 *  uses the automatic index. Docs written before `featured` existed simply
 *  don't match, which is correct: they aren't featured.
 *
 *  Pass `competitionId: null` to create. The id is allocated up front so
 *  create and update share one path (and so a newly created competition
 *  can be the one being featured).
 *
 *  Returns the competition's id. */
export async function writeCompetitionDoc(
  db: Firestore,
  competitionId: string | null,
  input: OnlineCompetitionWriteInput,
): Promise<string> {
  const col = db.collection('onlineCompetitions');
  const ref = competitionId ? col.doc(competitionId) : col.doc();
  const isCreate = competitionId === null;
  const data = toFirestoreDoc(input);

  await db.runTransaction(async (tx) => {
    // ── every read first ──
    const others = input.featured
      ? (await tx.get(col.where('featured', '==', true))).docs.filter((d) => d.id !== ref.id)
      : [];

    // ── then every write ──
    if (isCreate) {
      tx.set(ref, { ...data, createdAt: FieldValue.serverTimestamp() });
    } else {
      // merge: true, as the update path has always used — it preserves
      // createdAt and any field this form does not own.
      tx.set(ref, data, { merge: true });
    }
    for (const other of others) {
      tx.update(other.ref, { featured: false });
    }
  });

  return ref.id;
}
