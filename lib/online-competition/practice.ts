// ── The practice area's rules ────────────────────────────────────────────
// PURE. Numbers and decisions in, numbers and decisions out — no Firestore,
// no clock of its own — so every rule below is unit-tested directly
// (tests/competition-fields/practice.test.cjs) and the same functions serve
// the athlete's route, the admin's route and the retention sweep.
//
// WHAT A PRACTICE RUN IS: one recorded solve through the same stages as a
// competition attempt, with no competition attached. It is scored by nobody.
// A review here answers ONE question — did this athlete scramble and solve
// correctly — and never a question about time.
//
// WHAT IT IS NOT: a submission. Practice runs live in their own collection
// (`practiceRuns`) precisely so nothing that reads onlineSubmissions — the
// review queue, the standings, the qualifier, the athlete stats rollup —
// can ever see one. A practice run has no competitionId, no round, and no
// place in any ranking.

import type { SolveMarks } from './types';
import { rejectionSummary, resolveVerification } from './verification';

/** How many runs an athlete may record, EVER — not per day.
 *
 *  Ten because the point is learning the sequence, and an athlete who needs
 *  more than ten recorded attempts to learn it needs a person rather than
 *  more tape. It is also the storage bound: ten clips per athlete is what
 *  the bucket is sized for. */
export const PRACTICE_RUN_LIMIT = 10;

/** Deleted this long after an admin has reviewed it. The review is the
 *  point; once it has happened the video has done its job. */
export const PRACTICE_REVIEWED_RETENTION_DAYS = 7;

/** Deleted this long after it was RECORDED, reviewed or not.
 *
 *  THE BACKSTOP, and it exists because the competition rule has none: there,
 *  a pending submission is kept forever on the reasoning that it is evidence
 *  a judge has not looked at yet. That is right for a result somebody's
 *  placing depends on and wrong here, where nothing depends on it. 30 days
 *  is comfortably longer than any real review backlog, so it only ever fires
 *  on runs nobody was going to look at. */
export const PRACTICE_MAX_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
export const PRACTICE_REVIEWED_RETENTION_MS = PRACTICE_REVIEWED_RETENTION_DAYS * DAY_MS;
export const PRACTICE_MAX_RETENTION_MS = PRACTICE_MAX_RETENTION_DAYS * DAY_MS;

/** Where a run stands.
 *
 *    pending    — recorded, waiting for an admin
 *    correct    — the athlete scrambled and solved correctly
 *    incorrect  — something was wrong; `reason` says what
 *    redo       — the admin wants another run, and this one is NOT charged
 *                 to the athlete's ten (see spendsAllowance) */
export type PracticeRunStatus = 'pending' | 'correct' | 'incorrect' | 'redo';

const STATUSES: readonly string[] = ['pending', 'correct', 'incorrect', 'redo'];

/** Reads a stored status defensively, as every other reader in this project
 *  reads one. An unrecognised value is 'pending': it lands in the queue
 *  where a human looks at it, rather than being counted as decided. */
export function normalizePracticeStatus(raw: unknown): PracticeRunStatus {
  return STATUSES.includes(raw as string) ? (raw as PracticeRunStatus) : 'pending';
}

/** What an admin may decide. Deliberately NOT the submission review's
 *  vocabulary: there is no approve/+2/DNF here, because none of those is a
 *  statement about whether the sequence was followed. */
export type PracticeDecision = 'correct' | 'incorrect' | 'redo';

/** The refusal reasons offered as buttons, so the common ones are one tap
 *  and consistent between admins. Free text is always allowed instead —
 *  these are a shortcut, not the vocabulary. */
export const PRACTICE_REFUSAL_REASONS = [
  'Холилтыг харуулснаар хийгээгүй',
  'Коверын дор кубыг зөв харуулаагүй',
  'Гар, куб камерт харагдахгүй',
  'Бичлэг хэрэглэх боломжгүй',
] as const;

/** Longest refusal reason an admin may store — the same ceiling the
 *  verification refusal uses, for the same reason: it is a sentence to the
 *  athlete, not a report. */
export const PRACTICE_REASON_MAX = 300;

/** A REASON IS REQUIRED to refuse, and that is the whole point of the
 *  feature: an athlete practising needs to know what to fix. 'correct' and
 *  'redo' need none — one has nothing to say and the other says it in the
 *  word itself. */
export function practiceReasonRequired(decision: PracticeDecision): boolean {
  return decision === 'incorrect';
}

/** Whether a decision plus reason is a legal review. Shared by the admin
 *  route (which refuses) and the admin screen (which disables the button),
 *  so the two cannot disagree about what is submittable. */
export function practiceReviewValid(decision: PracticeDecision, reason: string | null): boolean {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length > PRACTICE_REASON_MAX) return false;
  return practiceReasonRequired(decision) ? text.length > 0 : true;
}

/** Does this run count against the athlete's ten?
 *
 *  Everything except `redo`. An admin asking for another run is not the
 *  athlete spending one of theirs — that would make "try again" a
 *  punishment, which is the opposite of what it is for. A pending run DOES
 *  count: it is recorded, it is stored, and an athlete cannot be allowed to
 *  record eleven by staying ahead of the queue. */
export function spendsAllowance(status: PracticeRunStatus): boolean {
  return status !== 'redo';
}

export interface PracticeAllowance {
  used: number;
  remaining: number;
  atLimit: boolean;
}

/** How many runs an athlete has left.
 *
 *  COUNTED FROM THE DOCUMENTS, never from a stored counter. A counter would
 *  have to live somewhere the athlete can write — firestore.rules validates
 *  named fields on onlineParticipants but has no keys().hasOnly(), so an
 *  athlete can add any field to their own profile — and a forgeable
 *  allowance is not an allowance. Counting is also what makes an abandoned
 *  run free: nothing was filed, so there is nothing to count. */
export function practiceAllowance(statuses: readonly PracticeRunStatus[]): PracticeAllowance {
  const used = statuses.filter(spendsAllowance).length;
  const remaining = Math.max(0, PRACTICE_RUN_LIMIT - used);
  return { used, remaining, atLimit: remaining === 0 };
}

/** The stage marks a run may carry, read defensively.
 *
 *  WHY THIS IS NEEDED AT ALL: a practice run is filed through a server
 *  route, so the marks arrive as whatever the client sent. The competition
 *  path has firestore.rules validating the shape of a submission's marks;
 *  this collection is closed to clients entirely, so the route is the only
 *  place the check can live and this is it.
 *
 *  EVERY KEY IS OPTIONAL and a bad one is DROPPED, not refused. Marks are a
 *  convenience for review and never evidence in their own right — the same
 *  reasoning types them `Partial<SolveMarks>` on a submission. A run whose
 *  marks are half-filled must still file, because the alternative is
 *  throwing away the video they describe; a jump button with nothing to aim
 *  at simply disables itself (see solve-jumps `needsMarks`).
 *
 *  Only finite numbers survive, which is the guard that keeps a malformed
 *  mark from becoming a NaN seek in the review panel.
 *
 *  THE KEYS ARE SolveMarks' OWN, asserted by the `satisfies` below rather
 *  than trusted to stay in step by hand. The review panel's jump table
 *  (solve-jumps) reads a competition attempt's marks and a practice run's
 *  through the same functions, so a key that drifted apart here would be a
 *  jump button that silently stopped finding its moment on one screen. The
 *  import is type-only and erases. */
export const PRACTICE_MARK_KEYS = [
  'scrambleShown',
  'coverStart',
  'solveStart',
  'solveEnd',
  'cubeShown',
  'recordingEnd',
] as const satisfies readonly (keyof SolveMarks)[];

export type PracticeMarkKey = (typeof PRACTICE_MARK_KEYS)[number];

export function readPracticeMarks(raw: unknown): Partial<Record<PracticeMarkKey, number>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<PracticeMarkKey, number>> = {};
  for (const key of PRACTICE_MARK_KEYS) {
    const v = src[key];
    // Finite only. A negative offset is not a point in a clip either.
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

/** Whether this athlete may practise at all.
 *
 *  VERIFIED ONLY — details and photo both approved — which is exactly what
 *  registration requires (firestore.rules athleteVerified, the client's
 *  resolveVerification). The reasoning is the admin's time: a practice run
 *  lands in a review queue, and reviewing one for an athlete who cannot
 *  enter a competition anyway is review spent on nothing.
 *
 *  THE SAME READER registration uses. resolveVerification is the one reader
 *  of the stored verification fields, legacy single-status records included,
 *  so an athlete verified for registering is verified here and the two gates
 *  cannot disagree about anyone.
 *
 *  FAILS CLOSED. No participant document is 'incomplete' — never submitted —
 *  not "nothing known, let them through". A read that FAILS never reaches
 *  this function: callers let the throw propagate, and a thrown read files
 *  nothing (see practice-server).
 *
 *  `reason` is rejectionSummary's "Мэдээлэл: …; Зураг: …", the same string
 *  the registration notice shows, and only ever set while rejected. */
export type PracticeGate =
  | { allowed: true }
  | { allowed: false; status: 'incomplete' | 'pending' | 'rejected'; reason: string | null };

export function practiceGate(participant: object | null | undefined): PracticeGate {
  if (participant === null || participant === undefined) {
    return { allowed: false, status: 'incomplete', reason: null };
  }
  const v = resolveVerification(participant);
  if (v.verified) return { allowed: true };
  // 'approved' without `verified` cannot happen — the two are derived
  // together — but if it ever did, it is refused rather than let through.
  const status = v.status === 'approved' ? 'pending' : v.status;
  return { allowed: false, status, reason: status === 'rejected' ? rejectionSummary(v) : null };
}

/** The refusal's sentence, for a client that has no gate to render — an old
 *  tab, or a direct request. The page itself renders verificationNoticeCopy
 *  from the gate, the same copy the registration notice uses. */
export const PRACTICE_UNVERIFIED_MESSAGE = 'Профайл баталгаажаагүй тул туршилт хийх боломжгүй.';

export interface PracticeSweepCandidate {
  status: unknown;
  /** Server-pinned creation time, or null when the document has none. */
  createdAtMs: number | null;
  /** Server-pinned review time, or null when it has not been reviewed. */
  reviewedAtMs: number | null;
}

/** Whether the sweep may delete this run's video now.
 *
 *  TWO CLOCKS, whichever comes first:
 *    · 7 days after the review — the video has done its job;
 *    · 30 days after recording, reviewed or not — the backstop.
 *
 *  BOTH DATED OFF SERVER-PINNED FIELDS, and that is not a detail. The
 *  competition sweep learned this the hard way: it trusted a client-written
 *  retention date, and a document filed with yesterday's date was swept the
 *  next night, taking its assets with it. Practice runs are written by a
 *  server route, so createdAt and reviewedAt are the server's own — but the
 *  rule is stated here rather than assumed, so a future client-written
 *  variant cannot quietly inherit the trust.
 *
 *  A run with no createdAt cannot be dated and is never swept. */
export function isPracticeSweepable(candidate: PracticeSweepCandidate, nowMs: number): boolean {
  if (candidate.createdAtMs === null) return false;
  if (candidate.createdAtMs + PRACTICE_MAX_RETENTION_MS <= nowMs) return true;
  const status = normalizePracticeStatus(candidate.status);
  if (status === 'pending') return false;
  if (candidate.reviewedAtMs === null) return false;
  return candidate.reviewedAtMs + PRACTICE_REVIEWED_RETENTION_MS <= nowMs;
}

/** When this run's video is due to go, for telling the athlete. null when
 *  it cannot be dated. */
export function practiceExpiryMs(candidate: PracticeSweepCandidate): number | null {
  if (candidate.createdAtMs === null) return null;
  const backstop = candidate.createdAtMs + PRACTICE_MAX_RETENTION_MS;
  const status = normalizePracticeStatus(candidate.status);
  if (status === 'pending' || candidate.reviewedAtMs === null) return backstop;
  return Math.min(backstop, candidate.reviewedAtMs + PRACTICE_REVIEWED_RETENTION_MS);
}
