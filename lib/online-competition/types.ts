import type { Timestamp } from 'firebase/firestore';
import type { ResultFormat } from './ao5';

// ── Firestore doc shapes for the public online-competition feature ─────────
// Fully separate from the club's internal `athletes` / `results` /
// `competitions` collections — nothing here reads or writes those.

/** 'draft' is the created-but-not-yet-public state (see the tabbed admin
 *  form): a competition is born a draft and stays invisible to the public
 *  site until an admin moves it on. It is deliberately the FIRST member —
 *  every list of these values in the codebase must contain it.
 *
 *  Adding a value here is never enough on its own. Three separate lists
 *  enumerate these strings and all three must agree:
 *    - VALID_STATUSES in lib/online-competition/admin-competitions.ts (server)
 *    - VALID_STATUSES in lib/online-competition/data.ts (client — a
 *      deliberate duplicate, since the server file imports firebase-admin)
 *    - STATUS_OPTIONS in app/online-competition/admin/_components/CompetitionEditor
 *  Both VALID_STATUSES lists feed a normalize function whose fallback is
 *  'upcoming'. A status missing from a list therefore does not fail loudly
 *  — it reads back as 'upcoming', which for 'draft' means an unfinished
 *  competition silently goes public. */
export type OnlineCompetitionStatus = 'draft' | 'upcoming' | 'live' | 'finished';

/** How a competition is run. Typed as a plain string, not a union: more
 *  formats are expected (in-person, live-judged) and every consumer
 *  resolves its label through competitionFormatLabel below, which falls
 *  back rather than throwing on an unknown value — so adding one is a
 *  data change, not a code change.
 *
 *  Exists so the admin list's meta line can read "онлайн" from the
 *  document instead of hardcoding it. */
export const DEFAULT_COMPETITION_FORMAT = 'online-video';

export const COMPETITION_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: DEFAULT_COMPETITION_FORMAT, label: 'Онлайн · бичлэгээр' },
];

/** Display label for a stored format value. An unrecognised value renders
 *  as itself rather than blank — a competition saved with a format this
 *  build doesn't know about must not lose its meta line. */
export function competitionFormatLabel(format: string | undefined | null): string {
  if (!format) return COMPETITION_FORMAT_OPTIONS[0].label;
  return COMPETITION_FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? format;
}

/** One configured event within a competition — e.g. { eventId: '333',
 *  label: '3x3x3', rounds: 2 }. `label` is stored redundantly (rather than
 *  derived from `eventId` at render time) so the admin UI's event-name
 *  list can change independently of whatever `eventId` values happen to
 *  exist in already-created competitions. */
export interface OnlineCompetitionEventConfig {
  eventId: string;
  label: string;
  rounds: number;
  /** How this event's rounds are scored: Ao5, Mo3, Bo3, Bo2 or Bo1.
   *
   *  Named resultFormat, NOT `format` — OnlineCompetition.format already
   *  exists and means Хэлбэр ('online-video'), how the competition is
   *  DELIVERED. Two unrelated concepts; keeping the names apart is the
   *  point.
   *
   *  Optional because every event stored before this field existed lacks
   *  it. Readers must go through resolveResultFormat (ao5.ts), which
   *  defaults to 'ao5' — what the platform has always actually run — so
   *  no backfill is needed.
   *
   *  NOT yet honoured by the solve flow or any scorer; see
   *  attemptsForFormat's warning. */
  resultFormat?: ResultFormat;
  /** Per-ATTEMPT maximum, in centiseconds. An attempt whose effective time
   *  (after any judge +2) exceeds it is a DNF — see effectiveAttemptTime,
   *  the one place that is enforced.
   *
   *  THE DEFAULT IS null — NO LIMIT — AND MUST STAY THAT WAY. WCA's own
   *  default is 10:00, and adopting it as this field's default would
   *  retroactively DNF every historical solve slower than ten minutes:
   *  scores already announced, season points already awarded, PRs already
   *  shown. A limit only ever exists because an admin typed one.
   *
   *  Per EVENT, not per round. Real WCA time limits are per round, but
   *  they rarely differ between rounds of the same event, so the
   *  simplification is safe here. It is NOT safe for cutoff, which is
   *  round-specific by nature (a first round thins the field, a final
   *  does not) — that field, when it lands, must be keyed by round.
   *
   *  CUMULATIVE limits are deliberately unsupported. WCA allows a limit
   *  shared across the attempts of a round, or across rounds, and it
   *  exists for blindfolded events and the big cubes — 333bf, 444bf,
   *  555bf, 333mbf, 666, 777. ONLINE_COMP_EVENTS contains none of them
   *  (see the exclusion note there), so a cumulative limit could only ever
   *  apply to an event this platform does not run. */
  timeLimitCs?: number | null;
  /** PER-ROUND cutoffs, one entry per round that has one. Absent or empty
   *  means no cutoff anywhere in this event.
   *
   *  Keyed by round — unlike timeLimitCs, which is per event — because a
   *  cutoff is round-specific by nature: it exists to thin a large first
   *  round, and a final normally has none. A per-event value would apply
   *  one to the final too, which is wrong rather than merely imprecise.
   *  Same shape as `advancement` above, for the same reason.
   *
   *  Semantics: in the cutoff phase (cutoffPhaseFor(resultFormat) — 2 for
   *  Ao5, 1 for Bo3) the athlete must post a result STRICTLY BETTER than
   *  cutoffCs. If they do, they complete the full attempt count. If they
   *  do not, their round ends there and only a single is recorded — they
   *  have no average, rank below everyone who does, and cannot advance.
   *
   *  Only offered for formats cutoffPhaseFor supports; see its comment. */
  cutoffs?: OnlineCompetitionCutoff[];
  /** The PLANNED cut for each round transition of this event, one entry
   *  per transition (a 3-round event has two: from round 1, and from
   *  round 2). Absent on every competition created before the Төрөл tab,
   *  and legitimately absent for a single-round event, which has no
   *  transition.
   *
   *  THIS IS A PLAN, NOT A RECORD. What a round was ACTUALLY cut to is
   *  written to roundState.qualifierMethod/qualifierValue by the qualify
   *  route at commit time, and that is the only value any computation
   *  ever reads. This one exists so the admin can declare the intent up
   *  front and have ШАЛГАРУУЛАХ pre-filled with it — a client-side
   *  prefill and nothing more. The qualify route must never fall back to
   *  it; see the comment at that spot for why. */
  advancement?: OnlineCompetitionAdvancement[];
  /** What entering THIS event costs on top of the competition's
   *  baseFeeMnt, in whole tugrik.
   *
   *  null or absent = INCLUDED IN THE BASE FEE. That is the default and
   *  the common case; a competition where every event is included has this
   *  absent everywhere and a single baseFeeMnt.
   *
   *  A number is always > 0. Zero is REFUSED at save, because "costs
   *  nothing extra" is already spelled `null` — allowing both would give
   *  one fact two representations, and a reader would have to handle a 0
   *  that means the same as an absent field. Same reasoning as the ''
   *  -> null normalisation on the image urls.
   *
   *  Deliberately nested on the event rather than held in a
   *  `surcharges: { [eventId]: number }` map beside the fee: the surcharge
   *  belongs to the event, so deleting the event on the Төрөл tab deletes
   *  its surcharge with it. A parallel map would strand an entry for an
   *  event that no longer exists, and nothing would ever notice. */
  surchargeMnt?: number | null;
}

/** One planned round transition. `fromRound` is the round being cut FROM,
 *  so it is always 1..rounds-1. `method`/`value` mirror
 *  RoundStateDoc.qualifierMethod/qualifierValue exactly, and are validated
 *  with the same validateQualifierInput the qualify route uses. */
/** One round's cutoff. `round` is 1..rounds. */
export interface OnlineCompetitionCutoff {
  round: number;
  cutoffCs: number;
}

export interface OnlineCompetitionAdvancement {
  fromRound: number;
  method: 'count' | 'percent';
  value: number;
}

// ── Custom sections ─────────────────────────────────────────────────────
// Admin-authored content sections, rendered on the public detail page as
// extra tabs after the fixed ones. Unlike every other field on a
// competition, the STRUCTURE is editable: the admin decides how many
// sections there are, what they are called and what each contains.
//
// Тайлбар and Заавар are NOT these. They are fixed fields of the general
// section and stay exactly where they are — a section named "Дүрэм" is an
// addition beside them, never a replacement for them.

export type OnlineCompetitionBlockType = 'text' | 'image' | 'video';

/** One piece of content inside a section.
 *
 *  The payload fields are optional PER TYPE, and exactly the ones for the
 *  block's own type are present — a stored text block has `text` and no
 *  `imageUrl` key at all, not `imageUrl: undefined`. That is enforced by
 *  BLOCK_PAYLOAD_FIELDS in admin-competitions.ts, which is also what makes
 *  a mismatched payload a rejected write rather than a stored oddity.
 *
 *  `id` is generated CLIENT-SIDE (crypto.randomUUID) when the block is
 *  added and never regenerated. Order is array order; the id exists so a
 *  reorder moves an identity rather than renaming positions — a block
 *  keyed by index would swap contents with its neighbour under React on
 *  every move, and a future comment/anchor pointing at a block would
 *  follow the wrong one. */
export interface OnlineCompetitionBlock {
  id: string;
  type: OnlineCompetitionBlockType;
  /** type 'text'. May be '' — an added-but-not-yet-typed block is a legal
   *  intermediate state and renders as nothing. */
  text?: string;
  /** type 'image'. Always a non-empty Cloudinary secure_url when stored:
   *  an image block with no image is refused at save, client and server,
   *  rather than stored as a blank slot. Same upload path as the poster
   *  and banner (uploadImageToCloudinary) — there is no second path. */
  imageUrl?: string;
  /** type 'image'. The Cloudinary public_id, kept beside the url for the
   *  same reason posterPublicId is: a future cleanup needs it. Absent when
   *  Cloudinary did not return one. */
  imagePublicId?: string;
  /** type 'video'. The YouTube or Vimeo URL AS THE ADMIN TYPED IT, not a
   *  normalised embed url and not the bare id. parseVideoUrl (video-url.ts)
   *  derives provider + id from it at render time; storing the raw url
   *  keeps the admin's own link intact and lets the parse rule improve
   *  later without a migration. A url that does not parse is refused at
   *  save, so every stored value is parseable. */
  videoUrl?: string;
}

/** One custom section = one public tab. Order is array order. */
export interface OnlineCompetitionSection {
  id: string;
  /** Non-empty; the tab label. An untitled section would render as a
   *  nameless tab, so it is refused at save. */
  title: string;
  /** May be empty. An empty section is WARNED about in the editor rather
   *  than dropped on save — see the note in CompetitionEditor. */
  blocks: OnlineCompetitionBlock[];
}

/** Hard ceilings, enforced server-side in validateCompetitionInput and
 *  surfaced in the editor as a disabled add button with a reason. They
 *  exist because a competition document has a 1MiB Firestore limit and
 *  because a tab strip stops being navigable long before 20 tabs. */
export const MAX_SECTIONS = 20;
export const MAX_BLOCKS_PER_SECTION = 50;

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
  /** When registration OPENS. Optional for the same legacy-doc reason as
   *  the fields above; absent means "no declared opening", not "open now"
   *  — nothing gates on it yet. */
  registrationOpensAt?: Timestamp;
  /** When the competition ends. Optional, same reason. */
  endAt?: Timestamp;
  /** See COMPETITION_FORMAT_OPTIONS. Absent on every doc written before
   *  this field existed; readers use competitionFormatLabel, which
   *  substitutes the default label for a missing value. */
  format?: string;
  /** Front-page hero slot. AT MOST ONE competition may have this set —
   *  enforced server-side in writeCompetitionDoc (admin-competitions.ts),
   *  which clears it from every other document in the same transaction.
   *  Absent is equivalent to false; nothing reads it yet. */
  featured?: boolean;
  /** Banner copy, e.g. "СЕЗОН 3 · БҮРТГЭЛ НЭЭЛТТЭЙ". Stored whether or not
   *  `featured` is set: the admin form hides these three behind the
   *  checkbox but does not discard them, so unchecking and re-checking
   *  (in one session or across saves) restores what was typed. A reader
   *  must therefore gate on `featured`, never on these being non-empty. */
  featuredHeading?: string;
  /** Banner call-to-action label, e.g. "Бүртгүүлэх". Same storage note. */
  featuredCtaLabel?: string;
  /** When the banner stops showing. null/absent = no expiry. Nothing
   *  enforces it yet — the public banner does not exist. */
  featuredUntil?: Timestamp;
  /** Public competition instructions, rendered in the detail page's Заавар
   *  section. Independent of `featured` — an ordinary competition has
   *  instructions too. That section does not exist yet. */
  instructions?: string;
  /** Whether registration costs money. Absent = false = Төлбөргүй.
   *
   *  THE GATE, not the amount. baseFeeMnt and events[].surchargeMnt hold
   *  the numbers and are stored whether or not this is set — the Төлбөр
   *  tab hides them when it is off but never clears them, exactly like the
   *  featured banner fields. A reader must therefore gate on `paid`, never
   *  on baseFeeMnt being non-null. */
  paid?: boolean;
  /** The fee every registrant pays, in whole tugrik, before any per-event
   *  surcharge. null/absent = not set.
   *
   *  Integer tugrik: there are no decimal subunits in circulation, and a
   *  fractional fee would render as "15 000.5₮". Refused at save.
   *
   *  Only meaningful when `paid` is true — see the note there. */
  baseFeeMnt?: number | null;
  /** Square (1:1) artwork for the detail page's general-info block, and
   *  the wide (16:5) artwork for the hub's featured banner. Cloudinary
   *  secure_url plus the public_id needed to manage the asset later.
   *
   *  Stored EXACTLY as uploaded — nothing crops or resizes, client or
   *  server side, matching the athlete verification photo. The stated
   *  1200x1200 / 1920x600 targets are guidance in the admin UI; render
   *  sites are expected to use object-fit rather than trust the ratio.
   *
   *  null = no image. The publicId is kept alongside the url so a future
   *  cleanup can find the asset — see the orphaning note on
   *  destroyCloudinaryVideo in submission-cleanup.ts; there is no image
   *  equivalent yet, so removing an image here nulls both fields and
   *  leaves the Cloudinary asset in place. */
  posterUrl?: string | null;
  posterPublicId?: string | null;
  bannerUrl?: string | null;
  bannerPublicId?: string | null;
  createdAt?: Timestamp;
  /** Admin-authored extra tabs. Absent or [] = none, which is what every
   *  competition written before this field existed reads as. Nothing
   *  renders these publicly yet — the detail page grows the tabs once the
   *  field is populated; the shape is final and needs no migration for
   *  that. */
  sections?: OnlineCompetitionSection[];
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
  /** Best Ao5 over complete JUDGED attempt sets, centiseconds — a
   *  judge-rejected attempt counts as a DNF in the set, not a gap.
   *
   *  ONLY ever computed from rounds whose resultFormat is 'ao5'. Its
   *  meaning is unchanged from before per-event formats existed, which is
   *  why no migration was needed. */
  ao5: number | null;
  /** Best Mo3, same rule, and ONLY from rounds whose resultFormat is
   *  'mo3'. Absent on every athlete whose stats predate this field, and on
   *  anyone who has never solved an Mo3 round.
   *
   *  Deliberately a SEPARATE field rather than one "best average": a mean
   *  of 3 with no dropped attempt is systematically slower than an Ao5, so
   *  the two are not comparable and must never overwrite one another.
   *
   *  Bo-N rounds produce no average at all and appear in neither field —
   *  they contribute only to `pr`. */
  mo3?: number | null;
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
  /** epoch-ms or null, like every other date here. */
  registrationOpensAt: number | null;
  endAt: number | null;
  /** Never '' — the mappers substitute DEFAULT_COMPETITION_FORMAT for a
   *  doc written before the field existed, so the edit form's select
   *  always has a value to show. */
  format: string;
  featured: boolean;
  /** '' when unset — the admin view always has something to show, same
   *  reasoning as `description`/`season`. */
  featuredHeading: string;
  featuredCtaLabel: string;
  featuredUntil: number | null;
  instructions: string;
  paid: boolean;
  /** null when unset. Present regardless of `paid`, so toggling the
   *  competition back to Төлбөртэй restores what was configured. */
  baseFeeMnt: number | null;
  /** null when unset — unlike the string fields above, which flatten to
   *  '', these stay nullable end to end: '' is not a meaningful image. */
  posterUrl: string | null;
  posterPublicId: string | null;
  bannerUrl: string | null;
  bannerPublicId: string | null;
  createdAt: number | null;
  /** Count of distinct uids with a submission for this competition — a
   *  submissions-based proxy for "participants", since there's no separate
   *  registration collection yet (Phase 1 is schema + CRUD only, no
   *  registration flow). */
  participantCount: number;
  /** How many athletes have REGISTERED for this competition — distinct from
   *  participantCount above, which counts uids that have SUBMITTED. The
   *  admin list's ТАМИРЧИН column pairs this with participantLimit,
   *  so it has to be registrations: an athlete who registered but has not
   *  solved yet still occupies a place. */
  registeredCount: number;
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
  /** Always present, [] when the competition has none. Returned in FULL by
   *  both the list and the single GET — unlike eventsWithoutLiveRound and
   *  lockedEventIds below, this is stored content, not a derived hint, and
   *  a mapper that returned [] for "not computed here" would hand the
   *  editor an empty structure to save back over the real one. */
  sections: OnlineCompetitionSection[];
  /** eventIds whose resultFormat is LOCKED because a judged (approved or
   *  rejected) submission already exists for them — changing the format
   *  now would silently re-derive existing results under a different rule.
   *  The server refuses such a change (writeCompetitionDoc); this is what
   *  lets the editor disable the control and say why, instead of the admin
   *  discovering it as a save error.
   *
   *  Computed only by the single-competition GET, which is what the editor
   *  loads. The LIST endpoint returns [] — it has no format editor, and
   *  the check costs a query per competition. Same "empty means not
   *  computed here" caveat as eventsWithoutLiveRound above. */
  lockedEventIds: string[];
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
  registrationOpensAt: number | null;
  endAt: number | null;
  format: string;
  featured: boolean;
  featuredHeading: string;
  featuredCtaLabel: string;
  featuredUntil: number | null;
  instructions: string;
  paid: boolean;
  baseFeeMnt: number | null;
  posterUrl: string | null;
  posterPublicId: string | null;
  bannerUrl: string | null;
  bannerPublicId: string | null;
  sections: OnlineCompetitionSection[];
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
