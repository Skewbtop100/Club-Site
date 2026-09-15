// ── One athlete, as the admin sees them ─────────────────────────────────
// Pure — no Firestore — so the exact shape the admin athletes route sends is
// unit-tested in tests/competition-fields/athlete-admin-view.test.cjs.
//
// ADMIN ONLY. The only caller is GET /api/online-competition/admin-athletes,
// which checks the admin session before it reads anything. The record it maps
// is readable by nobody else (firestore.rules: the athlete and an admin), and
// nothing public is built from this view — the public roster has its own
// whitelist in roster-view.ts.
//
// It carries everything verification needs and nothing it does not: no
// stats, no Cloudinary public id, no Google avatar, no merge markers.

import type {
  OnlineParticipantAdminView,
  OnlineParticipantGender,
  OnlineParticipantProfileStatus,
} from './types';

const GENDERS: readonly string[] = ['male', 'female', 'other'];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A Firestore Timestamp as epoch ms; anything else as null. */
function millis(value: unknown): number | null {
  const t = value as { toMillis?: () => number } | null | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}

export function toParticipantAdminView(
  uid: string,
  data: Record<string, unknown>,
  status: OnlineParticipantProfileStatus,
): OnlineParticipantAdminView {
  return {
    uid,
    displayName: text(data.displayName),
    email: textOrNull(data.email),
    lastName: text(data.lastName),
    firstName: text(data.firstName),
    dateOfBirth: text(data.dateOfBirth),
    gender: GENDERS.includes(data.gender as string) ? (data.gender as OnlineParticipantGender) : null,
    citizenship: text(data.citizenship),
    wcaId: text(data.wcaId),
    photoUrl: textOrNull(data.photoUrl),
    profileStatus: status,
    approvedPhotoUrl: textOrNull(data.approvedPhotoUrl),
    approvedLastName: textOrNull(data.approvedLastName),
    approvedFirstName: textOrNull(data.approvedFirstName),
    approvedDateOfBirth: textOrNull(data.approvedDateOfBirth),
    approvedGender: textOrNull(data.approvedGender),
    approvedCitizenship: textOrNull(data.approvedCitizenship),
    createdAt: millis(data.createdAt),
    submittedAt: millis(data.submittedAt),
    reviewedAt: millis(data.reviewedAt),
    rejectionReason: textOrNull(data.rejectionReason),
  };
}
