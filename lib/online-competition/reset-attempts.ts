import { getOnlineCompAdminDb } from './firebase-admin';
import { deleteSubmissionAndVideo } from './submission-cleanup';

// ── Resetting one athlete's run, so a round can be tested again ─────────
// Server-only (Admin SDK + the Cloudinary credentials deleteSubmissionAndVideo
// needs). Deletes every onlineSubmissions document for exactly one
// (competition, athlete, event, competition round) and NOTHING else.
//
// What it deliberately does not touch, because none of it is an attempt:
//   - the registration doc (onlineParticipants/{uid}/registrations/{id}) —
//     its status, its events, its approval, and the `results.{eventId}` map
//     recordAo5Result writes. That map is per EVENT, not per round, so
//     clearing it here would also discard the athlete's OTHER round; it is
//     write-only anyway (nothing reads it as a gate), and the next finished
//     run overwrites it. It therefore goes stale until then, on purpose.
//   - the participant doc's stats/PRs and the season points. Those are only
//     ever rewritten by the admin recompute, which is where they belong.
//   - the round's own state (open/done) and the scramble group assignment.
//
// Deleting an attempt an athlete actually solved is the point of the
// operation, not a side effect of it — see the judged-attempt note on
// resetAthleteRoundAttempts.

export interface ResetScope {
  competitionId: string;
  uid: string;
  event: string;
  /** The COMPETITION round (1..N) — not an attempt index. */
  competitionRound: number;
}

/** Is this stored submission inside the scope being reset?
 *
 *  Pure, and separated from the query on purpose: this predicate IS the
 *  blast radius, so it is unit-tested directly rather than only inspected
 *  (tests/competition-fields/reset-attempts.test.cjs).
 *
 *  The competitionRound default of 1 matches the admin GET mapper
 *  (app/api/online-competition/submissions/route.ts) rather than
 *  fetchMyFiledAttempts, which skips a document with no round. That is
 *  deliberate: the grid is what the admin is looking at when they press
 *  the button, and the grid SHOWS a legacy round-less document under
 *  round 1. Scoping it out would leave a cell populated after a reset the
 *  admin was told had emptied the round. */
export function inResetScope(
  data: { competitionId?: unknown; uid?: unknown; event?: unknown; competitionRound?: unknown },
  scope: ResetScope,
): boolean {
  if (data.competitionId !== scope.competitionId) return false;
  if (data.uid !== scope.uid) return false;
  if (data.event !== scope.event) return false;
  const round = typeof data.competitionRound === 'number' ? data.competitionRound : 1;
  return round === scope.competitionRound;
}

export interface ResetAttemptsResult {
  /** Firestore documents deleted. */
  deleted: number;
  /** How many of those a judge had already decided (approved/rejected).
   *  Reported so the response can say what went, not just how much. */
  judged: number;
  /** Cloudinary outcomes, from deleteSubmissionAndVideo. `videosFailed`
   *  counts assets that may still exist — the Firestore doc went anyway,
   *  which is that function's documented tradeoff. */
  videosDeleted: number;
  videosFailed: number;
  submissionIds: string[];
}

/** Deletes one athlete's attempts for one event in one round.
 *
 *  JUDGED ATTEMPTS GO TOO. A reset that spared them would leave a round
 *  holding a mix of old decisions and new solves, with the old ones
 *  unreachable — the solve flow files to a deterministic id
 *  (submission-id.ts) and firestore.rules refuses to re-file over a
 *  decided attempt, so the athlete could never overwrite them and the
 *  round could never be completed. The caller is responsible for telling
 *  the admin how many decided attempts are about to go; that is what the
 *  `judged` count is for.
 *
 *  QUERY SHAPE: `where('uid','==',uid)` and nothing else, with the rest
 *  filtered in memory. Not an aesthetic choice — this project has already
 *  taken a production outage from a query the emulator served happily and
 *  production refused for want of a composite index (see the note on
 *  fetchMyFiledAttempts in data.ts). That single-field shape is the one
 *  already proven here, and one athlete's submissions are a small bounded
 *  set.
 *
 *  Videos go through deleteSubmissionAndVideo — the same Cloudinary-then-
 *  Firestore routine the manual admin delete and the nightly retention
 *  sweep use — so a reset cannot orphan assets in a way those two would
 *  not. Sequential, not Promise.all: five destroys in a row against the
 *  Cloudinary Admin API, matching how the review grid's bulk-approve
 *  loops one call at a time. */
export async function resetAthleteRoundAttempts(scope: ResetScope): Promise<ResetAttemptsResult> {
  const db = getOnlineCompAdminDb();
  const snap = await db.collection('onlineSubmissions').where('uid', '==', scope.uid).get();
  const doomed = snap.docs.filter((d) => inResetScope(d.data(), scope));

  const result: ResetAttemptsResult = {
    deleted: 0,
    judged: 0,
    videosDeleted: 0,
    videosFailed: 0,
    submissionIds: [],
  };

  for (const doc of doomed) {
    const data = doc.data();
    if (data.status === 'approved' || data.status === 'rejected') result.judged += 1;

    const { cloudinaryDeleted } = await deleteSubmissionAndVideo(
      doc.ref,
      data.cloudinaryPublicId as string | undefined,
      `attempt reset (${scope.uid} / ${scope.event} / round ${scope.competitionRound})`,
    );

    if (data.cloudinaryPublicId) {
      if (cloudinaryDeleted) result.videosDeleted += 1;
      else result.videosFailed += 1;
    }
    result.deleted += 1;
    result.submissionIds.push(doc.id);
  }

  return result;
}
