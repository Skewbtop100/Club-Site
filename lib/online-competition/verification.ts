// ── Athlete verification: two parts, each with its own decision ──────────
// Pure — no Firestore — so every rule here is unit-tested in
// tests/competition-fields/verification.test.cjs and run against the real
// firestore.rules in tests/firestore-rules/verification.test.mjs.
//
// An athlete's verification has two parts:
//   details — surname, given name, date of birth, gender, country;
//   photo   — the verification photo.
// Each is stored as its own status (`detailsStatus`, `photoStatus`:
// 'pending' | 'approved' | 'rejected') with its own rejection reason
// (`detailsRejectionReason`, `photoRejectionReason`). An athlete is VERIFIED
// only when both are approved.
//
// `profileStatus` is still stored, DERIVED from the two parts, and kept in
// step by every writer (firestore.rules refuses an athlete write where it
// disagrees). The admin lists query it, and it is what the old single
// approval wrote — see "Old records" below.
//
// ── Old records ─────────────────────────────────────────────────────────
// Athletes decided under the single approval have `profileStatus` and no
// part fields. They are read, not rewritten: a record with no part fields
// maps both parts to its profileStatus, so an athlete approved before this
// change resolves as details approved + photo approved = verified. Nothing
// in the database changes, and firestore.rules applies the same mapping
// (legacyPart there), so the two can never disagree about an old record.
//
// ── WCA ID ──────────────────────────────────────────────────────────────
// Not part of either: it is public and checkable, and never reviewed.

import type { OnlineParticipantProfileStatus } from './types';

export type VerificationPart = 'details' | 'photo';

/** What a part may be STORED as. 'incomplete' is only ever resolved —
 *  nothing has been submitted — never written. */
export type StoredPartStatus = 'pending' | 'approved' | 'rejected';
export type PartStatus = StoredPartStatus | 'incomplete';

const STORED: readonly string[] = ['pending', 'approved', 'rejected'];

/** The reviewed details, and the approved snapshot each is copied to. */
export const DETAIL_SNAPSHOT = {
  lastName: 'approvedLastName',
  firstName: 'approvedFirstName',
  dateOfBirth: 'approvedDateOfBirth',
  gender: 'approvedGender',
  citizenship: 'approvedCitizenship',
} as const;
export type DetailKey = keyof typeof DETAIL_SNAPSHOT;
export const DETAIL_KEYS = Object.keys(DETAIL_SNAPSHOT) as DetailKey[];

export const PART_LABEL: Record<VerificationPart, string> = { details: 'Мэдээлэл', photo: 'Зураг' };

/** Longest rejection reason an admin may store. */
export const REASON_MAX = 300;

export interface PartState {
  status: PartStatus;
  /** The admin's reason — only while the part is rejected. */
  reason: string | null;
}

export interface Verification {
  details: PartState;
  photo: PartState;
  /** Derived from the two parts. */
  status: OnlineParticipantProfileStatus;
  verified: boolean;
  /** True for a record decided under the single approval (no part fields). */
  legacy: boolean;
}

/** A stored participant record — the Firestore data, an OnlineParticipant,
 *  or the admin view. Read field by field; never trusted for its type. */
type Data = object | null | undefined;
type Rec = Record<string, unknown>;
const rec = (data: Data): Rec => (data ?? {}) as Rec;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Does this record carry the per-part statuses? Both must be present and
 *  valid; anything else is read the old way. */
export function hasPartFields(data: Data): boolean {
  const r = rec(data);
  return STORED.includes(r.detailsStatus as string) && STORED.includes(r.photoStatus as string);
}

/** The old single status, as a part status. */
function legacyPart(data: Data): PartStatus {
  const s = rec(data).profileStatus;
  return STORED.includes(s as string) ? (s as StoredPartStatus) : 'incomplete';
}

/** The overall status two parts add up to. */
export function deriveProfileStatus(details: PartStatus, photo: PartStatus): OnlineParticipantProfileStatus {
  if (details === 'approved' && photo === 'approved') return 'approved';
  if (details === 'incomplete' || photo === 'incomplete') return 'incomplete';
  if (details === 'pending' || photo === 'pending') return 'pending';
  return 'rejected';
}

/** An old combined reason, split back into its parts where the two-part
 *  review screen wrote it as "Мэдээлэл: …; Зураг: …". A reason in no such
 *  form belongs to both. */
function splitLegacyReason(reason: string | null): Record<VerificationPart, string | null> {
  if (!reason) return { details: null, photo: null };
  const clauses = reason.split(/;\s*/);
  const details = clauses.map((c) => /^Мэдээлэл:\s*(.+)$/.exec(c)?.[1]).find(Boolean) ?? null;
  const photo = clauses.map((c) => /^Зураг:\s*(.+)$/.exec(c)?.[1]).find(Boolean) ?? null;
  return details || photo ? { details, photo } : { details: reason, photo: reason };
}

/** Where an athlete's verification stands. The ONE reader of the stored
 *  fields: the registration gate, the profile page, the admin views and
 *  the public roster all go through it. */
export function resolveVerification(data: Data): Verification {
  const r = rec(data);
  if (hasPartFields(r)) {
    const d = r.detailsStatus as StoredPartStatus;
    const p = r.photoStatus as StoredPartStatus;
    const status = deriveProfileStatus(d, p);
    return {
      details: { status: d, reason: d === 'rejected' ? text(r.detailsRejectionReason) : null },
      photo: { status: p, reason: p === 'rejected' ? text(r.photoRejectionReason) : null },
      status,
      verified: status === 'approved',
      legacy: false,
    };
  }
  const s = legacyPart(r);
  const reasons = s === 'rejected' ? splitLegacyReason(text(r.rejectionReason)) : { details: null, photo: null };
  return {
    details: { status: s, reason: reasons.details },
    photo: { status: s, reason: reasons.photo },
    status: deriveProfileStatus(s, s),
    verified: s === 'approved',
    legacy: true,
  };
}

/** "Мэдээлэл: …; Зураг: …" for the rejected parts, or null. Also stored as
 *  `rejectionReason`, for anything still reading the single field. */
export function rejectionSummary(v: Pick<Verification, 'details' | 'photo'>): string | null {
  const parts = (['details', 'photo'] as const)
    .filter((part) => v[part].status === 'rejected' && v[part].reason)
    .map((part) => `${PART_LABEL[part]}: ${v[part].reason}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

// ── Resubmission (the athlete) ──────────────────────────────────────────

export interface SubmittedIdentity {
  lastName: string;
  firstName: string;
  dateOfBirth: string;
  gender: string;
  citizenship: string;
  photoUrl: string;
}

export interface ResubmissionStatuses {
  detailsStatus: StoredPartStatus;
  photoStatus: StoredPartStatus;
  profileStatus: OnlineParticipantProfileStatus;
  /** Something now awaits the admin — the submission time is recorded. */
  anyPending: boolean;
}

/** What a profile save leaves each part as.
 *
 *  An APPROVED part stays approved when the save leaves its values as they
 *  were, or sets them to exactly the values an admin approved (the
 *  snapshot). Any other change sends it back to pending: an approval is of
 *  particular values, and one that silently covered different values would
 *  not be an approval. Every part that is not approved — rejected, pending,
 *  never submitted — becomes pending.
 *
 *  firestore.rules checks the same two conditions (partTransitionAllowed),
 *  so a client that computed "approved" any other way is refused. */
export function resubmissionStatuses(prior: Data, next: SubmittedIdentity): ResubmissionStatuses {
  const v = resolveVerification(prior);
  const p = rec(prior);
  const unchanged = (key: string, value: string) => key in p && p[key] === value;
  const snapshot = (key: string) => (typeof p[key] === 'string' ? p[key] : null);

  const detailsKept =
    v.details.status === 'approved' &&
    (DETAIL_KEYS.every((k) => unchanged(k, next[k])) || DETAIL_KEYS.every((k) => snapshot(DETAIL_SNAPSHOT[k]) === next[k]));
  const photoKept =
    v.photo.status === 'approved' && (unchanged('photoUrl', next.photoUrl) || snapshot('approvedPhotoUrl') === next.photoUrl);

  const detailsStatus: StoredPartStatus = detailsKept ? 'approved' : 'pending';
  const photoStatus: StoredPartStatus = photoKept ? 'approved' : 'pending';
  return {
    detailsStatus,
    photoStatus,
    profileStatus: deriveProfileStatus(detailsStatus, photoStatus),
    anyPending: !detailsKept || !photoKept,
  };
}

// ── The admin's decision ────────────────────────────────────────────────

export type PartDecision = { decision: 'approve' } | { decision: 'reject'; reason: string };

export interface DecisionInput {
  details?: PartDecision;
  photo?: PartDecision;
  /** The submission time the admin was looking at (epoch ms, null when the
   *  record had none). A different stored value means the athlete sent
   *  something new since, and the decision is refused rather than applied to
   *  what the admin never saw. */
  submittedAt: number | null;
}

type Fail = { ok: false; status: 400 | 404 | 409; error: string };

function parsePart(value: unknown, part: VerificationPart): PartDecision | undefined | Fail {
  if (value === undefined || value === null) return undefined;
  const v = value as { decision?: unknown; reason?: unknown };
  if (v.decision === 'approve') return { decision: 'approve' };
  if (v.decision === 'reject') {
    const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
    if (!reason) return { ok: false, status: 400, error: `${PART_LABEL[part]}: татгалзсан шалтгаанаа бичнэ үү.` };
    if (reason.length > REASON_MAX) {
      return { ok: false, status: 400, error: `${PART_LABEL[part]}: шалтгаан ${REASON_MAX} тэмдэгтээс хэтэрсэн.` };
    }
    return { decision: 'reject', reason };
  }
  return { ok: false, status: 400, error: `${PART_LABEL[part]}: шийдвэр буруу байна.` };
}

/** The request body, validated. */
export function parseDecisionBody(body: unknown): { ok: true; input: DecisionInput } | Fail {
  const b = body as { details?: unknown; photo?: unknown; submittedAt?: unknown } | null;
  if (!b || typeof b !== 'object') return { ok: false, status: 400, error: 'Хүсэлт буруу байна.' };
  if (!(b.submittedAt === null || typeof b.submittedAt === 'number')) {
    return { ok: false, status: 400, error: 'submittedAt шаардлагатай.' };
  }
  const details = parsePart(b.details, 'details');
  if (details && 'ok' in details) return details;
  const photo = parsePart(b.photo, 'photo');
  if (photo && 'ok' in photo) return photo;
  if (!details && !photo) return { ok: false, status: 400, error: 'Шийдвэр алга.' };
  return { ok: true, input: { details, photo, submittedAt: b.submittedAt } };
}

export interface DecisionPlan {
  ok: true;
  /** Fields to write. The route adds reviewedAt (a server timestamp). */
  update: Record<string, unknown>;
  before: Verification;
  after: Verification;
  /** What THIS decision did to each part it covered. */
  decided: Partial<Record<VerificationPart, 'approved' | 'rejected'>>;
  /** The athlete's notification text. */
  notice: string;
}

const STALE = 'Тамирчин хүсэлтээ өөрчилсөн эсвэл өөр админ шийдвэрлэсэн байна. Жагсаалтыг дахин ачаална уу.';

/** Applies one admin decision to a stored record.
 *
 *  Only PENDING parts are decided, and every pending part must be — so after
 *  a decision nothing is left half-reviewed, and an athlete is never waiting
 *  on a part the admin skipped. A part already approved is left exactly as
 *  it is: that is the whole point of storing the two separately. */
export function planDecision(stored: Data, storedSubmittedAt: number | null, input: DecisionInput): DecisionPlan | Fail {
  if (!stored) return { ok: false, status: 404, error: 'Тамирчин олдсонгүй.' };
  const data = rec(stored);
  const before = resolveVerification(data);
  if (before.status !== 'pending' || storedSubmittedAt !== input.submittedAt) {
    return { ok: false, status: 409, error: STALE };
  }

  const update: Record<string, unknown> = {};
  const decided: DecisionPlan['decided'] = {};
  const next: Record<VerificationPart, StoredPartStatus> = {
    details: before.details.status as StoredPartStatus,
    photo: before.photo.status as StoredPartStatus,
  };

  for (const part of ['details', 'photo'] as const) {
    const decision = input[part];
    if (before[part].status !== 'pending') {
      if (decision) {
        return { ok: false, status: 400, error: `${PART_LABEL[part]} аль хэдийн шийдвэрлэгдсэн байна.` };
      }
      continue;
    }
    if (!decision) return { ok: false, status: 400, error: `${PART_LABEL[part]}: шийдвэр гаргана уу.` };

    const reasonField = part === 'details' ? 'detailsRejectionReason' : 'photoRejectionReason';
    if (decision.decision === 'approve') {
      next[part] = 'approved';
      decided[part] = 'approved';
      update[reasonField] = null;
      // The snapshot of what was approved. A later edit moves the live
      // fields; these keep what the admin actually saw.
      if (part === 'details') {
        for (const k of DETAIL_KEYS) update[DETAIL_SNAPSHOT[k]] = typeof data[k] === 'string' ? data[k] : null;
      } else {
        update.approvedPhotoUrl = typeof data.photoUrl === 'string' ? data.photoUrl : null;
      }
    } else {
      next[part] = 'rejected';
      decided[part] = 'rejected';
      update[reasonField] = decision.reason;
    }
  }

  // Both statuses always written, so an old record gains its part fields
  // on its first decision under this model.
  update.detailsStatus = next.details;
  update.photoStatus = next.photo;
  if (!('detailsRejectionReason' in update)) update.detailsRejectionReason = before.details.reason;
  if (!('photoRejectionReason' in update)) update.photoRejectionReason = before.photo.reason;
  update.profileStatus = deriveProfileStatus(next.details, next.photo);

  const after = resolveVerification({ ...data, ...update });
  update.rejectionReason = rejectionSummary(after);
  return { ok: true, update, before, after, decided, notice: verificationNotice(decided, after) };
}

// ── Telling the athlete ─────────────────────────────────────────────────

export const VERIFICATION_NOTICE_LABEL = 'ПРОФАЙЛ';
export const PROFILE_HREF = '/online-competition/profile';

const sentence = (s: string) => `${s.trim().replace(/[.!?]+$/, '')}.`;

/** One notification per decision: each part decided, approved or rejected
 *  with its reason, then what the athlete can do next.
 *
 *    Мэдээлэл болон зураг баталгаажлаа. Тэмцээнд бүртгүүлэх боломжтой.
 *    Мэдээлэл баталгаажлаа. Зураг татгалзагдлаа: Царай харагдахгүй. Зургаа солиод дахин илгээнэ үү.
 *    Зураг баталгаажлаа. Профайл бүрэн баталгаажлаа — тэмцээнд бүртгүүлэх боломжтой.
 */
export function verificationNotice(decided: DecisionPlan['decided'], after: Verification): string {
  const lines: string[] = [];
  if (decided.details === 'approved' && decided.photo === 'approved') {
    lines.push('Мэдээлэл болон зураг баталгаажлаа.');
  } else {
    for (const part of ['details', 'photo'] as const) {
      if (decided[part] === 'approved') lines.push(`${PART_LABEL[part]} баталгаажлаа.`);
    }
  }
  for (const part of ['details', 'photo'] as const) {
    if (decided[part] === 'rejected') {
      const reason = after[part].reason;
      lines.push(reason ? `${PART_LABEL[part]} татгалзагдлаа: ${sentence(reason)}` : `${PART_LABEL[part]} татгалзагдлаа.`);
    }
  }

  if (after.verified) {
    const both = decided.details === 'approved' && decided.photo === 'approved';
    lines.push(both ? 'Тэмцээнд бүртгүүлэх боломжтой.' : 'Профайл бүрэн баталгаажлаа — тэмцээнд бүртгүүлэх боломжтой.');
  } else if (after.details.status === 'rejected' && after.photo.status === 'rejected') {
    lines.push('Мэдээлэл, зургаа засаад дахин илгээнэ үү.');
  } else if (after.details.status === 'rejected') {
    lines.push('Мэдээллээ засаад дахин илгээнэ үү.');
  } else if (after.photo.status === 'rejected') {
    lines.push('Зургаа солиод дахин илгээнэ үү.');
  }
  return lines.join(' ');
}

// ── Public visibility ───────────────────────────────────────────────────

/** May this athlete appear by name on a public screen?
 *
 *  Yes once an admin has verified them: now (both parts approved), or
 *  earlier — an approved name AND an approved photo on record — while an
 *  update is being re-reviewed. Public screens then show only the approved
 *  name (rosterName prefers the snapshot), so nothing an admin has not
 *  approved is published, and fixing a typo does not make an athlete vanish
 *  from a competition in progress.
 *
 *  Never verified — not submitted, waiting for a first review, or rejected
 *  on it, including details approved with the photo still rejected — no. */
export function isPubliclyVerified(data: Data): boolean {
  const r = rec(data);
  if (resolveVerification(r).verified) return true;
  const approvedName = text(r.approvedLastName) ?? text(r.approvedFirstName);
  return approvedName !== null && text(r.approvedPhotoUrl) !== null;
}
