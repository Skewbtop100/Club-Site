// ── A stored submission, read for the admin's round views ───────────────
// One mapper, shared by the round list and the round detail, so the numbers
// in a row and the table behind it are read from the same fields in the
// same way.
//
// WHY IT IS NOT toJudged (the public live route's own mapper): that one
// drops PENDING submissions, because the public standings must never show
// an unjudged time. The admin needs them — an unjudged attempt is the whole
// point of the "awaiting review" column — so this keeps all three statuses
// and lets roundRosterProgress decide what to do with each.
//
// Deliberately defensive field by field. These documents are written by the
// solve flow and edited by the review route, and a malformed one must
// degrade to "ignored" rather than to a fabricated attempt.

import type { JudgedSubmission } from './live-view';

/** Maps one `onlineSubmissions` document to the shape the rankers and
 *  roundRosterProgress read. Returns null for a document that cannot be
 *  placed in a round — no event, no competition round, or no uid — which is
 *  not a submission this view can say anything about.
 *
 *  `status` falls back to 'pending' for anything unrecognised, and that
 *  direction is deliberate: an unreadable status must land in the judge's
 *  queue, where a human looks at it, rather than being counted as approved. */
export function toAdminJudged(data: Record<string, unknown>): JudgedSubmission | null {
  const event = typeof data.event === 'string' ? data.event : null;
  const competitionRound = typeof data.competitionRound === 'number' ? data.competitionRound : null;
  const uid = typeof data.uid === 'string' ? data.uid : null;
  if (!event || competitionRound === null || !uid) return null;
  return {
    uid,
    event,
    competitionRound,
    // The stored `round` is the ATTEMPT INDEX within one run; the
    // competition round is `competitionRound`. The two are named apart
    // everywhere for this reason — reading one as the other is the bug
    // round-progress.ts was extracted to fix.
    attempt: typeof data.round === 'number' ? data.round : 0,
    status: data.status === 'approved' || data.status === 'rejected' ? data.status : 'pending',
    reportedTime: typeof data.reportedTime === 'number' ? data.reportedTime : 0,
    isDnf: data.isDnf === true,
    penalty: data.penalty === '+2' || data.penalty === 'DNF' ? data.penalty : null,
    createdAt: (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0,
  };
}
