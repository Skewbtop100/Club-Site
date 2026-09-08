import type { Timestamp } from 'firebase/firestore';

// ── Firestore doc shapes for the public online-competition feature ─────────
// Fully separate from the club's internal `athletes` / `results` /
// `competitions` collections — nothing here reads or writes those.

export type OnlineCompetitionStatus = 'upcoming' | 'live' | 'finished';

/** One configured event within a competition — e.g. { eventId: '333',
 *  label: '3x3x3', rounds: 2 }. `label` is stored redundantly (rather than
 *  derived from `eventId` at render time) so the admin UI's event-name
 *  list can change independently of whatever `eventId` values happen to
 *  exist in already-created competitions. */
export interface OnlineCompetitionEventConfig {
  eventId: string;
  label: string;
  rounds: number;
}

/** onlineCompetitions/{competitionId}
 *
 * `description`, `startAt`, `registrationDeadline`, and `participantLimit`
 * were added in the Phase 1 admin-CRUD schema update (2026) and are typed
 * optional here so this interface still matches older docs read from
 * Firestore — namely the original `test-comp-1` seed doc, created before
 * this schema existed, which has none of them. The admin create/edit form
 * (app/online-competition/admin) is what actually enforces these as
 * required, via client-side validation, for every competition created or
 * edited going forward — this type only needs to describe what a doc
 * *read* from Firestore might legally look like. */
export interface OnlineCompetition {
  id: string;
  name: string;
  description?: string;
  startAt?: Timestamp;
  registrationDeadline?: Timestamp;
  /** null = unlimited. Optional (vs. required-but-nullable) for the same
   *  legacy-doc reason as the fields above — an old doc simply lacks the
   *  field rather than explicitly storing null. */
  participantLimit?: number | null;
  events: OnlineCompetitionEventConfig[];
  status: OnlineCompetitionStatus;
  createdAt?: Timestamp;
  /** e.g. "2026-spring" — groups competitions into onlineSeasonPoints
   *  leaderboards. Optional for the same legacy-doc reason as the fields
   *  above; a competition without one simply doesn't contribute to any
   *  season leaderboard when points are recomputed. */
  season?: string;
}

/** onlineCompetitions/{competitionId}/scrambles/{event}_r{round} */
export interface OnlineCompetitionScramble {
  event: string;
  round: number;
  scramble: string;
  createdAt?: Timestamp;
}

export type OnlineParticipantGender = 'male' | 'female' | 'other';

/** Athlete identity-verification status, gating competition registration
 *  (see RegistrationPanel.tsx). A doc with no `profileStatus` field at all
 *  (every participant created before this feature existed, or created by
 *  upsertGoogleParticipant on first Google sign-in, which never sets it)
 *  is treated as 'incomplete' by every reader — see resolveProfileStatus
 *  in data.ts — rather than writing 'incomplete' onto every doc up front. */
export type OnlineParticipantProfileStatus = 'incomplete' | 'pending' | 'approved' | 'rejected';

/** onlineParticipants/{uid} — public participant profile, deliberately NOT
 *  linked to the club's `athletes` collection. `photoURL`/`email` are
 *  populated from the Google profile on Google sign-in (see
 *  useOnlineAuth.tsx); the anonymous-auth nickname flow on the solve page
 *  only ever sets `displayName`, so both are optional.
 *
 *  The fields below `email` are the athlete-verification profile (added
 *  alongside the registration gate) — filled in by the athlete via
 *  app/online-competition/profile, reviewed by an admin via
 *  app/online-competition/admin/athletes. `photoUrl`/`photoPublicId` are
 *  the athlete's latest *submitted* photo (pending review);
 *  `approvedPhotoUrl` is only ever set once an admin approves, and is the
 *  one other UI (e.g. a future public roster) should treat as "official". */
/** Per-event rollup written by the admin recompute (see
 *  lib/online-competition/athleteStats.ts). Absent until a recompute has
 *  run for a competition the athlete had approved submissions in. */
export interface OnlineParticipantEventStats {
  /** Best single, centiseconds. */
  pr: number | null;
  /** Best Ao5 over complete approved rounds-1-5 sets, centiseconds. */
  ao5: number | null;
  /** Approved submissions for this event. */
  solveCount: number;
}

export interface OnlineParticipant {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  email?: string | null;
  createdAt?: Timestamp;
  lastName?: string;
  firstName?: string;
  /** ISO date, e.g. "2000-05-14" — stored as a plain string (not a
   *  Timestamp) since it's entered via a plain <input type="date"> and
   *  never needs time-of-day or timezone handling. */
  dateOfBirth?: string;
  gender?: OnlineParticipantGender;
  citizenship?: string;
  /** WCA competitor id, e.g. "2016BAYA01". Optional — most athletes have
   *  none. Deliberately NOT part of the reviewed identity: a WCA id is
   *  public and independently checkable on worldcubeassociation.org, so a
   *  false one is self-defeating and it needs no approval machinery. It has
   *  no approved* snapshot, and changing it does not send an approved
   *  athlete back into the review queue. */
  wcaId?: string;
  photoUrl?: string | null;
  photoPublicId?: string | null;
  profileStatus?: OnlineParticipantProfileStatus;
  /** Snapshot of the identity an admin actually reviewed, written only by
   *  the Admin SDK at approval time and locked against client writes by
   *  firestore.rules. The live fields above may move on when an athlete
   *  edits and resubmits; these do not, so what a judge approved stays
   *  recoverable. */
  approvedPhotoUrl?: string | null;
  approvedLastName?: string | null;
  approvedFirstName?: string | null;
  approvedDateOfBirth?: string | null;
  approvedGender?: string | null;
  approvedCitizenship?: string | null;
  submittedAt?: Timestamp | null;
  reviewedAt?: Timestamp | null;
  rejectionReason?: string | null;
  /** eventId -> rollup. Written only by the Admin SDK recompute. */
  stats?: Record<string, OnlineParticipantEventStats>;
  /** Set when this account's data was moved to another uid (the athlete
   *  lost access to this Gmail — see scripts/merge-athlete-uid.mjs). The
   *  document is stripped to its Google identity at the same time, so its
   *  presence means "this is an empty forwarding stub, not a profile". */
  mergedInto?: string;
  mergedAt?: Timestamp | null;
}

/** Payload for submitParticipantProfile (data.ts) — what the profile form
 *  sends. */
export interface OnlineParticipantProfileInput {
  lastName: string;
  firstName: string;
  dateOfBirth: string;
  gender: OnlineParticipantGender;
  citizenship: string;
  /** '' when the athlete has none. Uppercased by the form before it gets
   *  here; format is validated there, not in the rules. */
  wcaId: string;
  photoUrl: string;
  photoPublicId: string;
}

/** Shape returned by GET /api/online-competition/admin-athletes — same
 *  fields as OnlineParticipant but with `uid` required, Timestamps
 *  converted to epoch-ms, and profileStatus always resolved (never
 *  undefined), same reasoning as OnlineSubmissionAdminView/
 *  OnlineCompetitionAdminView above. */
export interface OnlineParticipantAdminView {
  uid: string;
  displayName: string;
  email: string | null;
  lastName: string;
  firstName: string;
  dateOfBirth: string;
  gender: OnlineParticipantGender | null;
  citizenship: string;
  wcaId?: string;
  photoUrl: string | null;
  profileStatus: OnlineParticipantProfileStatus;
  approvedPhotoUrl: string | null;
  submittedAt: number | null;
  reviewedAt: number | null;
  rejectionReason: string | null;
}

export type OnlineRegistrationStatus = 'registered';

/** onlineParticipants/{uid}/registrations/{competitionId} — one doc per
 *  competition a participant has registered for. `status` is a single
 *  value for now ("registered"); more (e.g. "withdrawn") may come later
 *  once there's a reason to track it. */
export interface OnlineRegistration {
  competitionId: string;
  /** eventIds the athlete selected, e.g. ["333", "222"]. */
  events: string[];
  registeredAt?: Timestamp;
  status: OnlineRegistrationStatus;
}

export type OnlineSubmissionStatus = 'pending' | 'approved' | 'rejected';

/** onlineSubmissions/{submissionId} */
export interface OnlineSubmission {
  id?: string;
  competitionId: string;
  uid: string;
  event: string;
  /** ATTEMPT INDEX 1-5 within one run — NOT a competition round. The solve
   *  flow writes `round: i + 1` per attempt, and every Ao5 consumer
   *  (seasonPoints, athleteStats, round-results, ReviewGrid) reads it that
   *  way. The competition round lives in `competitionRound` below; the two
   *  are deliberately separate fields, and this one must not be renamed or
   *  repurposed. */
  round: number;
  /** The competition round (1..N, as configured by events[].rounds) this
   *  attempt belongs to — the round that was live for this event when the
   *  run started, resolved ONCE per run from the same round-access gate
   *  that let the athlete in (see round-access.ts / the scramble route).
   *
   *  Required. It was briefly optional to accommodate documents written
   *  before the field existed; none remain, and rankRoundResults now
   *  matches on it directly rather than inferring a round from createdAt. */
  competitionRound: number;
  /** Cloudinary secure_url for the uploaded solve video. */
  videoUrl: string;
  /** Cloudinary public_id — needed to delete/manage the asset later
   *  (retention cleanup, moderation). */
  cloudinaryPublicId: string;
  /** Centiseconds, as reported by the in-browser stopwatch. */
  reportedTime: number;
  /** True when the athlete self-reported this attempt as a DNF at time-
   *  entry (Phase 5's manual keypad entry), as opposed to a judge later
   *  assigning the DNF penalty below. Optional/absent on every submission
   *  from before Phase 5 — `reportedTime` stays a plain number (0) rather
   *  than null for those, so existing consumers (fmtCentiseconds, the
   *  admin dashboard) that don't know about this field keep working
   *  unchanged; they just won't show "DNF" for a self-reported one yet. */
  isDnf?: boolean;
  /** Judge-assigned penalty sentinel. Null until reviewed; '+2' for a
   *  two-second penalty (still counts as approved), 'DNF' for a rejected
   *  solve. */
  penalty: OnlineSubmissionPenalty;
  status: OnlineSubmissionStatus;
  createdAt?: Timestamp;
  /** 14 days from submission — drives scheduled deletion of the raw video. */
  retentionExpiresAt?: Timestamp;
}

export type OnlineSubmissionPenalty = '+2' | 'DNF' | null;

export interface NextEventRound {
  event: string;
  round: number;
}

// ── Notifications (onlineNotifications/{notificationId}) ───────────────
// Per-athlete notification feed for the hub's nav bell. Docs are only ever
// created server-side with the Admin SDK (see lib/online-competition/
// notifications-server.ts); the client may read its own and flip nothing
// but `read`. `title` is composed at WRITE time into final Mongolian
// display text rather than being templated at render time — the wording
// of an old notification then never changes under the athlete when the
// copy is edited later.

/** Collection name, kept here (an SDK-free module) so the client half
 *  and the Admin-SDK half can share it without either importing the
 *  other's Firebase client. */
export const ONLINE_NOTIFICATIONS = 'onlineNotifications';

/** 'round_result'   — your round is finalised, here is your placement.
 *  'round_advanced' — same, plus you made the cut into the next round.
 *  An athlete gets exactly ONE of these per round, never both. (The
 *  earlier per-judge-decision kinds are gone: they fired five times for
 *  one round.) */
export type OnlineNotificationType = 'round_result' | 'round_advanced';

export interface OnlineNotification {
  id?: string;
  /** Recipient's Firebase Auth uid. */
  uid: string;
  type: OnlineNotificationType;
  /** Final Mongolian display text, composed at write time. */
  title: string;
  /** Short uppercase label shown in the meta line, e.g. 'ТЭСТ ТЭМЦЭЭН'. */
  contextLabel: string;
  /** Where clicking the row navigates; '' for a non-clickable notice. */
  href: string;
  read: boolean;
  /** serverTimestamp() — null in the local snapshot until the write round-
   *  trips, so every consumer must tolerate null (see formatNotifMeta). */
  createdAt?: Timestamp | null;
}

// ── Referee review dashboard (app/online-competition/admin) ────────────────
// Shape returned by GET /api/online-competition/submissions — same as
// OnlineSubmission but with `id` required and Firestore Timestamps
// converted to epoch-ms (Admin SDK Timestamps don't serialize cleanly
// through NextResponse.json otherwise).
export interface OnlineSubmissionAdminView {
  id: string;
  competitionId: string;
  uid: string;
  event: string;
  round: number;
  videoUrl: string;
  cloudinaryPublicId: string;
  reportedTime: number;
  isDnf?: boolean;
  penalty: OnlineSubmissionPenalty;
  status: OnlineSubmissionStatus;
  createdAt: number | null;
}

// ── Competition management (app/online-competition/admin) ──────────────────
// Shape returned by GET /api/online-competition/admin-competitions (list)
// and GET .../admin-competitions/{id} (single) — same as OnlineCompetition
// but with Timestamps converted to epoch-ms and the "new" fields always
// present (never undefined), since the admin view always has *something*
// to show for them even on a legacy doc.
export interface OnlineCompetitionAdminView {
  id: string;
  name: string;
  description: string;
  startAt: number | null;
  registrationDeadline: number | null;
  participantLimit: number | null;
  events: OnlineCompetitionEventConfig[];
  status: OnlineCompetitionStatus;
  createdAt: number | null;
  /** Count of distinct uids with a submission for this competition — a
   *  submissions-based proxy for "participants", since there's no separate
   *  registration collection yet (Phase 1 is schema + CRUD only, no
   *  registration flow). */
  participantCount: number;
  /** '' when unset — the admin view always has *something* to show, same
   *  reasoning as every other field here. */
  season: string;
  /** Configured events that currently have NO live round — i.e. every
   *  solve attempt for them is refused with 'no-live-round'. Computed
   *  server-side with resolveEventLiveRounds (round-access.ts), the same
   *  rule the solve gate enforces with. Empty array means every event has
   *  an open round; the list endpoint only computes it for live
   *  competitions, where it is the state the admin needs warning about. */
  eventsWithoutLiveRound: { eventId: string; label: string }[];
}

/** Payload for POST/PUT admin-competitions — what the create/edit form
 *  sends. Timestamps travel as epoch-ms (or null), converted to Firestore
 *  Timestamps server-side. */
export interface OnlineCompetitionWriteInput {
  name: string;
  description: string;
  startAt: number | null;
  registrationDeadline: number | null;
  participantLimit: number | null;
  events: OnlineCompetitionEventConfig[];
  status: OnlineCompetitionStatus;
  season: string;
}

// ── Season points / leaderboard ─────────────────────────────────────────
// onlineSeasonPoints/{season}/athletes/{uid} — recomputed by an admin
// action (see app/api/online-competition/admin-recompute-points), not
// live-aggregated on every hub page load.

export interface OnlineSeasonPointsBreakdownEntry {
  competitionId: string;
  eventId: string;
  points: number;
  placement: number;
}

export interface OnlineSeasonAthletePoints {
  uid: string;
  displayName: string;
  photoURL: string | null;
  totalPoints: number;
  breakdown: OnlineSeasonPointsBreakdownEntry[];
}
