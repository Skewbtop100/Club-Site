// ── How long a judged submission's video is kept ─────────────────────────
// Pure — no Firestore, no clock of its own — shared by the client that files
// a submission (data.ts writes retentionExpiresAt from it) and the nightly
// sweep that deletes (cron/sweep-videos), and unit-tested in
// tests/competition-fields/submission-cleanup.test.cjs.
//
// ── WHY THE SWEEP DOES NOT TRUST retentionExpiresAt ALONE ──
// The athlete's own client writes retentionExpiresAt, and the sweep used to
// delete anything whose stored date had passed. A document filed with a date
// of yesterday was therefore swept the very next night — and cleanup deletes
// whatever assets the document names. That was the route to deleting other
// people's files.
//
// createdAt is different: firestore.rules pins it to request.time, the
// server's own clock, so the athlete cannot choose it. The sweep now requires
// BOTH that the fixed retention period has passed since creation AND that the
// stored date has passed. The stored date can only ever DELAY a deletion
// (a legacy document written with a longer window keeps it); it can never
// bring one forward.

export const SUBMISSION_RETENTION_DAYS = 14;
export const SUBMISSION_RETENTION_MS = SUBMISSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface SweepCandidate {
  status: unknown;
  /** The server-pinned creation time, or null when the document has none. */
  createdAtMs: number | null;
  /** The stored retentionExpiresAt, or null when the document has none. */
  retentionExpiresAtMs: number | null;
}

/** Whether the nightly sweep may delete this submission now.
 *
 *    · judged only — a pending submission's video is the evidence a judge
 *      has not looked at yet, however old it is;
 *    · a document with no retentionExpiresAt is never swept (pre-retention
 *      submissions), exactly as before;
 *    · a document with no createdAt cannot be dated, so is never swept;
 *    · otherwise both the fixed period since creation and the stored date
 *      must have passed. */
export function isSweepable(candidate: SweepCandidate, nowMs: number): boolean {
  if (candidate.status !== 'approved' && candidate.status !== 'rejected') return false;
  if (candidate.createdAtMs === null || candidate.retentionExpiresAtMs === null) return false;
  return candidate.createdAtMs + SUBMISSION_RETENTION_MS <= nowMs && candidate.retentionExpiresAtMs <= nowMs;
}
