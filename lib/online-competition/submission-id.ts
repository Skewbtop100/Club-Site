// ── The document id one attempt of one run owns ─────────────────────────
// Pure — no Firestore import — so it is unit-tested directly
// (tests/competition-fields/submission-id.test.cjs). Used by
// createSubmission in data.ts, which is the only writer of
// onlineSubmissions from the client.

/** Deterministic id for (athlete, competition, event, competition round,
 *  attempt).
 *
 *  WHY DETERMINISM: the solve page uploads and files a run's attempts one
 *  at a time. With a random id (addDoc), a failure on attempt 3 left
 *  attempts 1-2 filed, and the retry — which restarts the loop from the
 *  top — filed them AGAIN as new documents. A judge saw seven submissions
 *  for a five-attempt run with no way to tell which four counted. Here a
 *  second file of the same attempt lands on the same document and
 *  replaces it.
 *
 *  It was chosen over the page tracking which attempts it had already
 *  filed, because the guarantee has to survive what page state does not:
 *  a reload between the partial submit and the retry, a redo of the same
 *  round, a second device. The page keeps such a set anyway, purely to
 *  avoid re-uploading a video it has already uploaded — if that set is
 *  ever wrong, the write still lands on this id.
 *
 *  A re-file is an UPDATE to firestore.rules, whose onlineSubmissions
 *  update rule requires status and penalty to be unchanged — so an
 *  attempt a judge has already ruled on is refused rather than silently
 *  replaced.
 *
 *  The segments are joined with '__' and every one of them is already
 *  constrained to safe characters: a Firebase uid and a Firestore
 *  auto-id are alphanumeric, an eventId is a WCA code, and the round and
 *  attempt are integers. A Firestore document id may not contain '/' and
 *  may not be '.' or '..'; none of these can produce either. */
export function submissionDocId(input: {
  uid: string;
  competitionId: string;
  event: string;
  /** The competition round the run belongs to (1 = first round). */
  competitionRound: number;
  /** Attempt index within the run, 1-based. */
  attempt: number;
}): string {
  return [
    input.uid,
    input.competitionId,
    input.event,
    `r${input.competitionRound}`,
    `a${input.attempt}`,
  ].join('__');
}
