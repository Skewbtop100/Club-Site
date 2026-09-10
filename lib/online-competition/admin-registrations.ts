import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { normalizeRegistrationStatus } from './registration-shape';
import type { StatusPatch } from './registration-review';
import type { OnlineRegistrationStatus } from './types';

// ── Admin reads and writes of registrations ─────────────────────────────
// Server-only (firebase-admin). The Admin SDK bypasses firestore.rules, so
// THIS is the only code that may set a registration's status or statusNote;
// the rules refuse both to athletes.
//
// Kept out of the route files so the listing and the write are testable
// against the emulator (roundtrip.test.cjs) without Next's request plumbing.

/** One registration as the admin review table sees it. */
export interface RegistrationAdminView {
  uid: string;
  /** The Google display name — the field the round-progress and judging
   *  views have always used. */
  displayName: string;
  /** The best name to review by: the admin-APPROVED identity if the
   *  profile has been verified, else the submitted one, else displayName. */
  name: string;
  events: string[];
  /** The ATHLETE's note to the organiser, or null. */
  note: string | null;
  /** Always a current value — the legacy 'registered' is converted. */
  status: OnlineRegistrationStatus;
  /** The ADMIN's note, which the athlete also sees. null when none. */
  statusNote: string | null;
  /** epoch-ms; first registration, then last save. */
  registeredAt: number | null;
  updatedAt: number | null;
  wcaId: string | null;
  /** Country code (e.g. 'mn'), approved value preferred. */
  citizenship: string | null;
  /** YYYY-MM-DD, approved value preferred. */
  dateOfBirth: string | null;
  email: string | null;
  /** True when this is the athlete's FIRST competition here: they have no
   *  registration for any other competition in the database. Computed from
   *  the same collection-group read the listing already makes, so it costs
   *  no extra reads. */
  isNew: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const ms = (v: unknown): number | null =>
  v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis(): number }).toMillis() : null;

/** Every registration for one competition, joined to the athletes'
 *  profiles, in REGISTRATION ORDER (registeredAt ascending — the order a
 *  waitlist will use).
 *
 *  Reads the WHOLE `registrations` collection group and filters in memory:
 *  a filtered collection-group query needs an index this project
 *  deliberately does not have (see countRegistrationsFor in
 *  admin-competitions.ts for the incident that taught that). The same
 *  unfiltered read is also what makes isNew free — every athlete's other
 *  registrations are already in hand. */
export async function listCompetitionRegistrations(db: Firestore, competitionId: string): Promise<RegistrationAdminView[]> {
  const snap = await db.collectionGroup('registrations').get();
  // Only documents nested under onlineParticipants — this database has an
  // unrelated top-level `registrations` collection the group read also
  // returns.
  const ours = snap.docs.filter((d) => d.ref.parent.parent?.parent.id === 'onlineParticipants');

  const registrationsPerUid = new Map<string, number>();
  for (const d of ours) {
    const uid = d.ref.parent.parent!.id;
    registrationsPerUid.set(uid, (registrationsPerUid.get(uid) ?? 0) + 1);
  }

  const matches = ours.filter((d) => d.data().competitionId === competitionId);
  const uids = [...new Set(matches.map((d) => d.ref.parent.parent!.id))];
  const profiles = uids.length > 0 ? await db.getAll(...uids.map((uid) => db.collection('onlineParticipants').doc(uid))) : [];
  const profileByUid = new Map(profiles.map((p) => [p.id, (p.data() ?? {}) as Record<string, unknown>]));

  const rows = matches.map((d): RegistrationAdminView => {
    const uid = d.ref.parent.parent!.id;
    const data = d.data();
    const p = profileByUid.get(uid) ?? {};
    const displayName = str(p.displayName) ?? uid;
    const last = str(p.approvedLastName) ?? str(p.lastName);
    const first = str(p.approvedFirstName) ?? str(p.firstName);
    return {
      uid,
      displayName,
      name: last && first ? `${last} ${first}` : first ?? last ?? displayName,
      events: Array.isArray(data.events) ? data.events.filter((e: unknown): e is string => typeof e === 'string') : [],
      note: str(data.note),
      status: normalizeRegistrationStatus(data.status),
      statusNote: str(data.statusNote),
      registeredAt: ms(data.registeredAt),
      updatedAt: ms(data.updatedAt),
      wcaId: str(p.wcaId),
      citizenship: str(p.approvedCitizenship) ?? str(p.citizenship),
      dateOfBirth: str(p.approvedDateOfBirth) ?? str(p.dateOfBirth),
      email: str(p.email),
      isNew: (registrationsPerUid.get(uid) ?? 0) <= 1,
    };
  });

  return rows.sort(
    (a, b) => (a.registeredAt ?? Number.MAX_SAFE_INTEGER) - (b.registeredAt ?? Number.MAX_SAFE_INTEGER) || (a.uid < b.uid ? -1 : 1),
  );
}

/** Thrown when a patch cannot be applied; the routes turn it into this
 *  HTTP status with this message. */
export class RegistrationPatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly missing: string[] = [],
  ) {
    super(message);
  }
}

/** Applies one status/statusNote change to every listed registration —
 *  ALL OR NOTHING.
 *
 *  A transaction, not a best-effort loop, and deliberately: the admin
 *  ticked N rows and pressed one button. A partial result is a table in a
 *  state nobody chose — some rows moved, some not — and the only way to
 *  find out which is to read the whole table again. All-or-nothing means a
 *  failure changes nothing and the same click can simply be repeated. It
 *  is also what PR-4 needs anyway: enforcing the participant limit means
 *  counting approved registrations and approving more in ONE atomic step.
 *
 *  Every document is read first; if any uid has no registration for this
 *  competition, nothing is written and the error names the missing uids.
 *
 *  THE PARTICIPANT LIMIT IS NOT ENFORCED HERE (PR-4). Approving past it is
 *  currently possible; the review table's summary shows "70/64" when it
 *  happens.
 *
 *  Returns how many registrations were written. */
export async function applyRegistrationPatch(
  db: Firestore,
  competitionId: string,
  uids: string[],
  patch: StatusPatch,
): Promise<number> {
  const refs = uids.map((uid) =>
    db.collection('onlineParticipants').doc(uid).collection('registrations').doc(competitionId),
  );
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.statusNote !== undefined) update.statusNote = patch.statusNote === null ? FieldValue.delete() : patch.statusNote;

  await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    const missing = snaps.filter((s) => !s.exists).map((s) => s.ref.parent.parent!.id);
    if (missing.length > 0) {
      throw new RegistrationPatchError(
        `No registration for this competition: ${missing.join(', ')}. Nothing was changed.`,
        404,
        missing,
      );
    }
    for (const ref of refs) tx.update(ref, update);
  });
  return refs.length;
}
