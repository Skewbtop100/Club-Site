import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { deleteSubmissionAndVideo } from '@/lib/online-competition/submission-cleanup';
import type { OnlineSubmissionStatus } from '@/lib/online-competition/types';

// Scheduled retention sweep — deletes the raw solve video (and its
// Firestore doc) once a submission's 14-day retentionExpiresAt has passed.
// Completes the long-standing TODO in lib/online-competition/cloudinary.ts.
//
// Scheduled by vercel.json's `crons` entry (daily, 03:00 UTC). Vercel
// invokes cron jobs with GET, so that's the only method here.
//
// Vercel does not retry a failed invocation, and cron delivery is
// best-effort in both directions — a run can be missed, or the same run
// can fire twice. This handler is written to be safe under both: it
// re-queries "everything currently expired" each time rather than tracking
// a cursor (a missed night is picked up the next night), and re-deleting an
// already-gone Cloudinary asset lands on the Admin API's "not_found"
// outcome, which submission-cleanup treats as success.
export const dynamic = 'force-dynamic';
// Comfortably above what a sweep of this size needs, and within the Hobby
// plan's 60s function ceiling.
export const maxDuration = 60;

/** Never swept, no matter how old: a pending submission hasn't been judged
 *  yet, so deleting its video would destroy the only evidence the judge
 *  needs. Retention only starts meaning something once a verdict exists. */
const SWEEPABLE: OnlineSubmissionStatus[] = ['approved', 'rejected'];

// Cap per invocation so one run can't blow the function's time limit or
// hammer Cloudinary's Admin API rate limit. A backlog larger than this is
// simply picked up by the following night's run (the query is ordered
// oldest-expired first, so it drains deterministically).
const MAX_PER_RUN = 200;

export async function GET(request: Request) {
  // Vercel's documented pattern: set CRON_SECRET in the project's env vars
  // and Vercel automatically attaches `Authorization: Bearer <CRON_SECRET>`
  // to every cron invocation. No dashboard configuration is needed beyond
  // that env var — the schedule itself comes from vercel.json, applied on
  // the next deploy. Refusing when CRON_SECRET is unset is deliberate: an
  // unset secret must fail closed, never open.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getOnlineCompAdminDb();
  const now = Timestamp.now();

  // Single-field range query, then filter status in memory.
  //
  // The natural query — .where('status','in',SWEEPABLE) plus this range —
  // needs a composite index on (status, retentionExpiresAt) that this
  // project doesn't have, and an undeployed index makes the query throw
  // FAILED_PRECONDITION at runtime, i.e. a cron that silently never works.
  // A range on a single field uses Firestore's automatic index, so this
  // version works the moment it deploys. Docs with no retentionExpiresAt
  // at all (pre-retention legacy submissions) simply don't match, which is
  // the behaviour we want — never sweep something with no retention set.
  //
  // If the collection ever grows enough that scanning expired-but-pending
  // docs wastes a meaningful part of MAX_PER_RUN, switch to the composite
  // query and add this to firestore.indexes.json:
  //   { "collectionGroup": "onlineSubmissions", "queryScope": "COLLECTION",
  //     "fields": [ { "fieldPath": "status", "order": "ASCENDING" },
  //                 { "fieldPath": "retentionExpiresAt", "order": "ASCENDING" } ] }
  const snap = await db
    .collection('onlineSubmissions')
    .where('retentionExpiresAt', '<=', now)
    .orderBy('retentionExpiresAt', 'asc')
    .limit(MAX_PER_RUN)
    .get();

  const expired = snap.docs;
  const sweepable = expired.filter((d) =>
    SWEEPABLE.includes(d.data()?.status as OnlineSubmissionStatus),
  );

  let succeeded = 0;
  let failed = 0;
  const failures: { id: string; publicId: string | null; detail: string }[] = [];

  // Sequential, not Promise.all: Cloudinary's Admin API is rate limited
  // (and this is a nightly background job with no latency budget), so
  // there's nothing to gain from firing 200 deletes at once.
  for (const doc of sweepable) {
    const publicId = doc.data()?.cloudinaryPublicId as string | undefined;
    const result = await deleteSubmissionAndVideo(doc.ref, publicId, 'retention sweep');
    if (result.cloudinaryDeleted || !publicId) {
      succeeded += 1;
    } else {
      // The Firestore doc is gone either way (see submission-cleanup's
      // tradeoff note) — "failed" here means the video may still exist in
      // Cloudinary and needs manual removal. Per-item detail was already
      // logged there with the submission id and public_id.
      failed += 1;
      failures.push({ id: doc.id, publicId: publicId ?? null, detail: result.cloudinaryDetail });
    }
  }

  const summary = {
    expiredScanned: expired.length,
    matched: sweepable.length,
    succeeded,
    failed,
    skippedNotSweepable: expired.length - sweepable.length,
    hitBatchCap: expired.length === MAX_PER_RUN,
  };

  console.log(
    `[online-competition] retention sweep: scanned ${summary.expiredScanned} expired, ` +
      `matched ${summary.matched} (approved/rejected), swept ${summary.succeeded}, failed ${summary.failed}, ` +
      `skipped ${summary.skippedNotSweepable} not-yet-judged` +
      (summary.hitBatchCap ? `, HIT BATCH CAP of ${MAX_PER_RUN} — more remain for the next run` : ''),
  );
  if (failed > 0) {
    console.error(
      `[online-competition] retention sweep: ${failed} Cloudinary deletion(s) failed — ` +
        `assets may still exist: ${JSON.stringify(failures)}`,
    );
  }

  return NextResponse.json({ ok: true, ...summary, failures });
}
