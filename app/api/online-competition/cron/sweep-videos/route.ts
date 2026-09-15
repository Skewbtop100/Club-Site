import { NextResponse } from 'next/server';
import { Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { deleteSubmissionAndVideo, timestampMs } from '@/lib/online-competition/submission-cleanup';
import { SUBMISSION_RETENTION_MS, isSweepable } from '@/lib/online-competition/submission-retention';

// Scheduled retention sweep — deletes a judged submission's video (and its
// Firestore doc) once its retention period has passed.
//
// Scheduled by vercel.json's `crons` entry (daily, 03:00 UTC). Vercel
// invokes cron jobs with GET, so that's the only method here.
//
// Vercel does not retry a failed invocation, and cron delivery is
// best-effort in both directions — a run can be missed, or the same run
// can fire twice. This handler is written to be safe under both: it
// re-queries "everything currently due" each time rather than tracking a
// cursor (a missed night is picked up the next night), and re-deleting an
// already-gone asset is treated as success by submission-cleanup.
//
// ── WHAT DECIDES "DUE" ──
// NOT the stored retentionExpiresAt on its own: the athlete's client writes
// that, and a date of yesterday used to get a freshly filed document swept
// the next night. The query runs on createdAt, which firestore.rules pins to
// the server's clock, and isSweepable (submission-retention.ts) requires the
// fixed period since creation AND the stored date to have passed.
//
// ── WHAT A SWEEP WILL NOT DELETE ──
// deleteSubmissionAndVideo refuses any asset that is not provably the
// submission's own — see its header. A refusal is reported, not counted as
// a failure: the asset belongs to someone else and must stay.
export const dynamic = 'force-dynamic';
// Comfortably above what a sweep of this size needs, and within the Hobby
// plan's 60s function ceiling.
export const maxDuration = 60;

// Cap per invocation so one run can't blow the function's time limit or
// hammer Cloudinary's Admin API rate limit. A backlog larger than this is
// simply picked up by the following night's run.
const MAX_PER_RUN = 200;
// Documents are read a page at a time, oldest first. Old PENDING documents
// match the date range but are never swept, so they are skipped rather than
// allowed to fill a single page and starve everything behind them.
const PAGE_SIZE = 200;
const MAX_SCANNED = 2000;

export async function GET(request: Request) {
  // Vercel's documented pattern: set CRON_SECRET in the project's env vars
  // and Vercel automatically attaches `Authorization: Bearer <CRON_SECRET>`
  // to every cron invocation. Refusing when CRON_SECRET is unset is
  // deliberate: an unset secret must fail closed, never open.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getOnlineCompAdminDb();
  const nowMs = Date.now();
  // Nothing created after this can be due, whatever it stores. A range on a
  // single field, ordered by that field, uses Firestore's automatic index.
  const createdBefore = Timestamp.fromMillis(nowMs - SUBMISSION_RETENTION_MS);

  const sweepable: QueryDocumentSnapshot[] = [];
  let scanned = 0;
  let last: QueryDocumentSnapshot | undefined;
  while (sweepable.length < MAX_PER_RUN && scanned < MAX_SCANNED) {
    let query = db
      .collection('onlineSubmissions')
      .where('createdAt', '<=', createdBefore)
      .orderBy('createdAt', 'asc')
      .limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) break;
    scanned += page.size;
    last = page.docs[page.docs.length - 1];
    for (const doc of page.docs) {
      if (sweepable.length >= MAX_PER_RUN) break;
      const data = doc.data();
      const due = isSweepable(
        {
          status: data?.status,
          createdAtMs: timestampMs(data?.createdAt),
          retentionExpiresAtMs: timestampMs(data?.retentionExpiresAt),
        },
        nowMs,
      );
      if (due) sweepable.push(doc);
    }
    if (page.size < PAGE_SIZE) break;
  }

  let succeeded = 0;
  let failed = 0;
  let refusedSubmissions = 0;
  const failures: { id: string; publicId: string | null; videoKey: string | null; detail: string }[] = [];
  const refusals: { id: string; refused: { kind: string; id: string; reason: string }[] }[] = [];

  // Sequential, not Promise.all: Cloudinary's Admin API is rate limited
  // (and this is a nightly background job with no latency budget).
  let stillsDeleted = 0;
  let stillsFailed = 0;
  let stillsRefused = 0;
  let r2Deleted = 0;
  let r2Failed = 0;

  for (const doc of sweepable) {
    const data = doc.data();
    const publicId = data?.cloudinaryPublicId as string | undefined;
    const videoKey = data?.videoKey as string | undefined;
    // The document itself — see deleteSubmissionAndVideo: which assets
    // belong to a submission, and whether they are really its own, are its
    // decisions, not this route's.
    const result = await deleteSubmissionAndVideo(doc.ref, data, 'retention sweep');
    stillsDeleted += result.stillsDeleted;
    stillsFailed += result.stillsFailed;
    stillsRefused += result.stillsRefused;
    if (result.refused.length > 0) {
      refusedSubmissions += 1;
      refusals.push({ id: doc.id, refused: result.refused });
    }
    const refusedKinds = new Set(result.refused.map((r) => r.kind));
    if (videoKey && !refusedKinds.has('r2')) {
      if (result.r2Deleted) r2Deleted += 1;
      else r2Failed += 1;
    }
    // SUCCESS MEANS EVERY VIDEO THIS SUBMISSION OWNED IS GONE. A video that
    // was refused was never this submission's to delete, so it is not a
    // failure here — it is listed under `refusals` instead.
    const cloudinaryOk = !publicId || result.cloudinaryDeleted || refusedKinds.has('cloudinary-video');
    const r2Ok = !videoKey || result.r2Deleted;
    if (cloudinaryOk && (r2Ok || refusedKinds.has('r2'))) {
      succeeded += 1;
    } else {
      // The Firestore doc is gone either way (see submission-cleanup's
      // tradeoff note) — "failed" here means a video may still exist in
      // Cloudinary or R2 and needs manual removal. Per-item detail was
      // already logged there with the submission id and the id or key.
      failed += 1;
      failures.push({
        id: doc.id,
        publicId: publicId ?? null,
        videoKey: videoKey ?? null,
        detail: [
          cloudinaryOk ? null : `cloudinary: ${result.cloudinaryDetail}`,
          r2Ok ? null : `r2: ${result.r2Detail}`,
        ]
          .filter(Boolean)
          .join('; '),
      });
    }
  }

  const summary = {
    scanned,
    matched: sweepable.length,
    succeeded,
    failed,
    // Counted separately from `succeeded`/`failed`, which are about the
    // VIDEO. A run that leaves stillsFailed above zero has images still
    // sitting in Cloudinary with the document that named them gone — the
    // per-item log lines carry the public ids for manual removal.
    stillsDeleted,
    stillsFailed,
    // R2 videos, counted like the stills. `succeeded`/`failed` already
    // fold these in; these say how much of that was R2 specifically, so a
    // run where R2 deletes are failing is visible without reading logs.
    r2Deleted,
    r2Failed,
    // Assets a document named that were NOT deleted because they were not
    // provably its own. Anything above zero deserves a look: it is either a
    // forged submission or a legacy document whose ownership could not be
    // verified.
    stillsRefused,
    refusedSubmissions,
    skippedNotSweepable: scanned - sweepable.length,
    hitBatchCap: sweepable.length === MAX_PER_RUN,
    hitScanCap: scanned >= MAX_SCANNED,
  };

  console.log(
    `[online-competition] retention sweep: scanned ${summary.scanned} created before the retention cutoff, ` +
      `matched ${summary.matched}, swept ${summary.succeeded}, failed ${summary.failed}, ` +
      `refused assets on ${summary.refusedSubmissions}, skipped ${summary.skippedNotSweepable} not due` +
      (summary.hitBatchCap ? `, HIT BATCH CAP of ${MAX_PER_RUN} — more remain for the next run` : ''),
  );
  if (failed > 0) {
    console.error(
      `[online-competition] retention sweep: ${failed} video deletion(s) failed (Cloudinary or R2) — ` +
        `assets may still exist: ${JSON.stringify(failures)}`,
    );
  }
  if (refusals.length > 0) {
    console.error(
      `[online-competition] retention sweep: REFUSED to delete assets not provably owned by their ` +
        `submission — investigate: ${JSON.stringify(refusals)}`,
    );
  }

  return NextResponse.json({ ok: true, ...summary, failures, refusals });
}
