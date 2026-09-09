import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DEFAULT_COMPETITION_FORMAT } from './types';
import { validateQualifierInput } from './rounds';
import { RESULT_FORMATS, type ResultFormat } from './ao5';
import type { OnlineCompetitionAdvancement } from './types';
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

/** Validates one event's planned advancement rows.
 *
 *  The method/value rules are NOT restated here — validateQualifierInput
 *  (rounds.ts) is the same function the qualify route validates a real cut
 *  with, so a plan that would be rejected at qualify time is rejected at
 *  save time, in the same words. Only the two things it cannot know are
 *  checked locally: that the method is one of the two, and that fromRound
 *  is a transition this event actually has.
 *
 *  Absent/empty is valid — a single-round event has no transitions, and a
 *  competition created before this field existed has none stored. */
function parseAdvancement(
  raw: unknown,
  rounds: number,
): { ok: true; value: OnlineCompetitionAdvancement[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'advancement must be an array' };

  const out: OnlineCompetitionAdvancement[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'invalid advancement entry' };
    const a = entry as Record<string, unknown>;

    if (a.method !== 'count' && a.method !== 'percent') {
      return { ok: false, error: 'invalid advancement method' };
    }
    if (typeof a.value !== 'number') {
      return { ok: false, error: 'advancement value must be a number' };
    }
    // The qualify route's own rules: > 0, integer for a count, <= 100 for
    // a percent. Its Mongolian message is passed straight through.
    const invalid = validateQualifierInput(a.method, a.value);
    if (invalid) return { ok: false, error: invalid };

    // A transition cuts FROM round N INTO round N+1, so the last round an
    // event has cannot be a `fromRound` — there is nothing after it.
    if (typeof a.fromRound !== 'number' || !Number.isInteger(a.fromRound)) {
      return { ok: false, error: 'advancement fromRound must be an integer' };
    }
    if (a.fromRound < 1 || a.fromRound > rounds - 1) {
      return { ok: false, error: `advancement fromRound ${a.fromRound} is out of range for ${rounds} round(s)` };
    }
    if (seen.has(a.fromRound)) {
      return { ok: false, error: `duplicate advancement for round ${a.fromRound}` };
    }
    seen.add(a.fromRound);

    out.push({ fromRound: a.fromRound, method: a.method, value: a.value });
  }

  out.sort((x, y) => x.fromRound - y.fromRound);
  return { ok: true, value: out };
}

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

  // NOTE: this loop REBUILDS each event object field by field rather than
  // passing it through, so any property not named here is silently
  // dropped. That is the trap `advancement` has to be added to — a new
  // per-event field that is not listed below saves as undefined with no
  // error anywhere.
  const events: OnlineCompetitionEventConfig[] = [];
  for (const raw of b.events) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid event config' };
    const e = raw as Record<string, unknown>;
    if (typeof e.eventId !== 'string' || typeof e.label !== 'string' || typeof e.rounds !== 'number' || e.rounds < 1) {
      return { ok: false, error: 'invalid event config' };
    }
    const advancement = parseAdvancement(e.advancement, e.rounds);
    if (!advancement.ok) return { ok: false, error: `${e.eventId}: ${advancement.error}` };
    // Absent is legal (every event stored before this field existed) and
    // means 'ao5'; a PRESENT but unrecognised value is a malformed payload
    // and is refused rather than quietly defaulted — silently rewriting an
    // admin's choice is worse than telling them it was invalid.
    // null counts as ABSENT, not as invalid — JSON has no `undefined`, so a
    // client that spells an unset optional field as null must mean the same
    // thing as omitting it. Same rule parseAdvancement above applies.
    if (
      e.resultFormat !== undefined &&
      e.resultFormat !== null &&
      !RESULT_FORMATS.includes(e.resultFormat as ResultFormat)
    ) {
      return { ok: false, error: `${e.eventId}: invalid resultFormat` };
    }
    const resultFormat: ResultFormat = (e.resultFormat as ResultFormat | null) ?? 'ao5';
    events.push({
      eventId: e.eventId,
      label: e.label,
      rounds: e.rounds,
      resultFormat,
      advancement: advancement.value,
    });
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
/** Thrown when a write is refused for a reason only the stored document
 *  can reveal. Both routes turn it into a 400 with this message. */
export class CompetitionWriteError extends Error {}

/** eventIds of `events` whose resultFormat differs from what is stored. */
function eventsChangingFormat(
  stored: unknown,
  incoming: OnlineCompetitionWriteInput['events'],
): string[] {
  if (!Array.isArray(stored)) return [];
  const before = new Map<string, string>();
  for (const e of stored as Record<string, unknown>[]) {
    if (typeof e?.eventId === 'string') {
      // Absent reads as 'ao5' (resolveResultFormat's rule) — so adding the
      // field to a legacy event by SELECTING Ao5 is not a change, while
      // selecting anything else is.
      before.set(e.eventId, RESULT_FORMATS.includes(e.resultFormat as ResultFormat) ? (e.resultFormat as string) : 'ao5');
    }
  }
  return incoming
    .filter((e) => before.has(e.eventId) && before.get(e.eventId) !== (e.resultFormat ?? 'ao5'))
    .map((e) => e.eventId);
}

/** eventIds of this competition that already have a JUDGED submission.
 *  Judged = approved or rejected, matching the completeness rule every
 *  scorer now uses: a rejected attempt is a DNF that counts, so it is just
 *  as much a result as an approved one and just as much at risk from a
 *  format change. Pending work does not lock anything — nothing has been
 *  derived from it yet. */
export async function lockedFormatEventIds(db: Firestore, competitionId: string): Promise<string[]> {
  const snap = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .where('status', 'in', ['approved', 'rejected'])
    .select('event')
    .get();
  const ids = new Set<string>();
  for (const d of snap.docs) {
    const event = d.get('event');
    if (typeof event === 'string') ids.add(event);
  }
  return [...ids];
}

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

    // ── the resultFormat lock ──
    // Changing an event's format once results exist would silently
    // re-derive that history under a different rule: an Ao5 recomputed as
    // an Mo3 is a different number from the same attempts, and stored
    // season points and athlete stats would shift with no record of why.
    //
    // Enforced HERE, not in validateCompetitionInput, for the simple
    // reason that validateCompetitionInput is a pure function of the
    // request body — it cannot see the stored document and so cannot know
    // what the format was before, or whether anything has been judged.
    // This is also the only place that sees BOTH, and it sees them inside
    // the transaction that performs the write, so a submission judged
    // between the check and the save cannot slip through.
    //
    // A create can never trip this: there is no stored document and no
    // submission can reference an id that did not exist.
    if (!isCreate) {
      const snap = await tx.get(ref);
      const storedEvents = snap.exists ? snap.get('events') : [];
      const changing = snap.exists ? eventsChangingFormat(storedEvents, input.events) : [];
      // REMOVING a locked event is refused too, and that is not belt-and-
      // braces — without it the format lock has a trivial two-save bypass:
      // save once dropping the event (nothing flags it, because the check
      // only looked at events present in BOTH), then save again re-adding
      // it with a different format (nothing flags it either, because it is
      // no longer in the stored document to compare against).
      //
      // Removal is also independently destructive: athleteStats resolves a
      // submission's format by looking the event up on its competition, so
      // an event deleted out from under judged results silently re-derives
      // all of them as Ao5 — the default for "event not found".
      const storedIds = new Set(
        (Array.isArray(storedEvents) ? (storedEvents as Record<string, unknown>[]) : [])
          .map((e) => e?.eventId)
          .filter((id): id is string => typeof id === 'string'),
      );
      const incomingIds = new Set(input.events.map((e) => e.eventId));
      const removed = [...storedIds].filter((id) => !incomingIds.has(id));

      if (changing.length > 0 || removed.length > 0) {
        const locked = new Set(await lockedFormatEventIds(db, ref.id));
        const refusedChange = changing.filter((id) => locked.has(id));
        const refusedRemoval = removed.filter((id) => locked.has(id));
        if (refusedChange.length > 0) {
          throw new CompetitionWriteError(
            `Үзүүлэлт орсон тул формат солих боломжгүй: ${refusedChange.join(', ')}`,
          );
        }
        if (refusedRemoval.length > 0) {
          throw new CompetitionWriteError(
            `Үзүүлэлт орсон тул төрлийг устгах боломжгүй: ${refusedRemoval.join(', ')}`,
          );
        }
      }
    }

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
