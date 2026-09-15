// ── Running one review action over several attempts ─────────────────────
// Pure (the action is passed in), so it is unit-tested in
// tests/competition-fields/failure-surfacing.test.cjs.
//
// THE BUG: ReviewGrid's bulk approve looped with `await` inside a
// try/finally and no catch. The first failed approval threw out of the
// loop — the rest never ran — and the judge saw nothing at all. They
// believed the athlete fully approved while the leftover pending attempts
// kept that athlete out of the standings and the qualifier preview.
//
// Now every attempt is tried, one after another as before (the same POST
// the detail panel makes), and the caller gets back exactly which went
// through and which did not, to show.

export interface BulkReviewOutcome<T> {
  succeeded: T[];
  failed: { item: T; error: string }[];
}

export async function runBulkReview<T>(
  items: readonly T[],
  reviewOne: (item: T) => Promise<void>,
): Promise<BulkReviewOutcome<T>> {
  const succeeded: T[] = [];
  const failed: { item: T; error: string }[] = [];
  for (const item of items) {
    try {
      await reviewOne(item);
      succeeded.push(item);
    } catch (e) {
      failed.push({ item, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { succeeded, failed };
}
