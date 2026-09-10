// ── Registration documents: status, read shape, and what a save writes ──
// onlineParticipants/{uid}/registrations/{competitionId}. Pure — no
// Firestore import, no clock — so it is unit-tested directly
// (tests/competition-fields/registration-shape.test.cjs) and exercised
// against the real rules in tests/firestore-rules/participants.test.mjs.
//
// Registration review: an athlete's first save writes 'pending'; only an
// admin moves it on. An athlete's edit writes only their own fields, so an
// admin's status and note survive it — see buildRegistrationWrite.

import { REGISTRATION_NOTE_MAX } from './types';
import type { OnlineRegistration, OnlineRegistrationStatus } from './types';

// ── status ─────────────────────────────────────────────────────────────

/** MUST list every member of OnlineRegistrationStatus — a value missing
 *  here reads as the fallback below. */
export const REGISTRATION_STATUSES: OnlineRegistrationStatus[] = [
  'pending',
  'waitlisted',
  'approved',
  'cancelled',
  'rejected',
];

/** A raw stored status, as the current enum.
 *
 *  'registered' is the ONLY value ever written before review existed, and
 *  it means approved: those athletes registered under a system that had no
 *  review, and retroactively un-approving them would be wrong. Converted at
 *  READ time, never backfilled — the same pattern as
 *  normalizeCompetitionStatus ('active' -> 'live') and resolveResultFormat
 *  (absent -> 'ao5'). The stored value stays 'registered'; nothing ever
 *  writes the converted one back (that is what buildRegistrationWrite's
 *  update path guarantees — it never writes status).
 *
 *  An ABSENT status is also legacy: the field was never required by the
 *  rules, and a registration document existing at all meant "registered".
 *
 *  An UNRECOGNISED value reads as 'pending' — fail closed. The competition
 *  status fallback goes the other way ('upcoming', so a legacy doc does not
 *  vanish from the public site), but a registration status will gate
 *  things, and a hand-edited junk value must never read as approved. */
export function normalizeRegistrationStatus(raw: unknown): OnlineRegistrationStatus {
  if (raw === 'registered' || raw === undefined || raw === null) return 'approved';
  if (typeof raw === 'string' && REGISTRATION_STATUSES.includes(raw as OnlineRegistrationStatus)) {
    return raw as OnlineRegistrationStatus;
  }
  return 'pending';
}

// ── what a status MEANS (D7) ───────────────────────────────────────────
// Two questions get asked of a registration, and they have different
// answers. Both take the RAW stored value and normalise it first, so the
// legacy 'registered' (and an absent status) counts as approved wherever
// these are used — those athletes registered under a system with no
// review, and must not drop out of a roster or a count.

/** May this athlete COMPETE? Approved only.
 *
 *  The roster the official scrambles and group assignments are built
 *  from, the ТАМИРЧИН count the participant limit is measured against,
 *  round progress, and the dashboard's Эхлүүлэх button all ask this.
 *  Pending is not a competitor: nobody has agreed to let them in yet. */
export function isCompetingRegistration(rawStatus: unknown): boolean {
  return normalizeRegistrationStatus(rawStatus) === 'approved';
}

/** Was this athlete QUOTED A PRICE? Everyone except cancelled and
 *  rejected.
 *
 *  Only the fee-change warning asks this. A pending athlete filled in the
 *  form under a fee they could see and may still be approved at it, so
 *  changing the fee behind their back is exactly the thing the warning is
 *  for. A cancelled or rejected one will never be charged. */
export function isFeeQuotedRegistration(rawStatus: unknown): boolean {
  const status = normalizeRegistrationStatus(rawStatus);
  return status !== 'cancelled' && status !== 'rejected';
}

// ── read shape ─────────────────────────────────────────────────────────

/** A raw registration document as the typed OnlineRegistration.
 *
 *  Built field by field, and SAFELY so: this shape is only ever READ. The
 *  writer never writes it back (buildRegistrationWrite sends only the
 *  athlete's own fields), so a field this reader leaves out — `results`,
 *  or a future admin field — is not lost, just not shown. Before this
 *  changeset the writer replaced the whole document, and the same omission
 *  would have been data loss.
 *
 *  Timestamps pass through as whatever the SDK returned; this module does
 *  not import Firestore to check their type. */
export function normalizeStoredRegistration(raw: unknown, competitionIdFallback: string): OnlineRegistration {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: OnlineRegistration = {
    competitionId: typeof d.competitionId === 'string' && d.competitionId ? d.competitionId : competitionIdFallback,
    events: Array.isArray(d.events) ? d.events.filter((e): e is string => typeof e === 'string' && e.length > 0) : [],
    status: normalizeRegistrationStatus(d.status),
  };
  if (d.registeredAt) out.registeredAt = d.registeredAt as OnlineRegistration['registeredAt'];
  if (d.updatedAt) out.updatedAt = d.updatedAt as OnlineRegistration['updatedAt'];
  // Typed by the athlete, pre-fills a form: a non-string (a hand edit)
  // reads as no note rather than reaching a textarea as "[object Object]".
  if (typeof d.note === 'string' && d.note.trim()) out.note = d.note;
  // The admin's note, shown to the athlete. Same defensive read.
  if (typeof d.statusNote === 'string' && d.statusNote.trim()) out.statusNote = d.statusNote;
  return out;
}

// ── what a save writes ─────────────────────────────────────────────────

export interface RegistrationInput {
  competitionId: string;
  events: string[];
  note: string;
}

/** Firestore's write sentinels, passed in so this module stays free of
 *  the SDK: `now` is serverTimestamp(), `remove` is deleteField(). */
export interface WriteSentinels<T> {
  now: T;
  remove: T;
}

export type RegistrationWrite<T> =
  | { kind: 'create'; data: Record<string, unknown> }
  | { kind: 'update'; data: Record<string, T | string | string[]> };

/** Exactly which fields a save writes.
 *
 *  CREATE — the document does not exist yet:
 *    competitionId, events, status: 'pending', registeredAt, updatedAt,
 *    and `note` only when non-blank. 'pending' is the ONLY status an
 *    athlete may create with (firestore.rules); an admin moves it on.
 *
 *  UPDATE — the document exists (an edit):
 *    events, updatedAt, and `note` — set to the text, or DELETED when the
 *    athlete cleared it.
 *    NOTHING ELSE. Not competitionId (it mirrors the document id and never
 *    changes), not status (an admin will set it — an edit must never
 *    overwrite it), not registeredAt (set once — it is the athlete's place
 *    in any future waitlist order), and not `results` (recordAo5Result's
 *    map, which the old whole-document replace erased on every edit).
 *
 *  The note is trimmed and capped here so a paste one character over the
 *  limit never reaches firestore.rules as a refused write. */
export function buildRegistrationWrite<T>(
  exists: boolean,
  input: RegistrationInput,
  sentinels: WriteSentinels<T>,
): RegistrationWrite<T> {
  const note = input.note.trim().slice(0, REGISTRATION_NOTE_MAX);
  if (!exists) {
    return {
      kind: 'create',
      data: {
        competitionId: input.competitionId,
        events: input.events,
        status: 'pending',
        registeredAt: sentinels.now,
        updatedAt: sentinels.now,
        ...(note ? { note } : {}),
      },
    };
  }
  return {
    kind: 'update',
    data: {
      events: input.events,
      updatedAt: sentinels.now,
      note: note ? note : sentinels.remove,
    },
  };
}
