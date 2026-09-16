import { NextResponse } from 'next/server';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { r2Bucket, r2Client } from '@/lib/online-competition/r2-video';
import { isPracticeSweepable } from '@/lib/online-competition/practice';
import { PRACTICE_COLLECTION } from '@/lib/online-competition/practice-server';
import { PRACTICE_VIDEO_KEY_PREFIX } from '@/lib/online-competition/practice-video';

// ── Practice retention sweep ────────────────────────────────────────────
// Deletes a practice run's video and its document once its retention has
// passed. Scheduled by vercel.json (daily, 03:20 UTC — twenty minutes after
// the submission sweep, so the two never contend for the same function slot).
//
// SEPARATE FROM sweep-videos, and not a branch inside it. That sweep's rule
// is "judged only, 14 days, and never an unjudged one" — the reasoning being
// that an unjudged submission is evidence a judge has not seen. This one has
// a BACKSTOP precisely because that reasoning does not hold for practice:
// nothing depends on a practice run, so an unreviewed one is not evidence
// worth keeping forever. Two different policies in one handler would be two
// sets of conditions to read before trusting either.
//
// Both clocks are dated off SERVER-PINNED fields (createdAt, reviewedAt),
// written by the practice route with FieldValue.serverTimestamp. The
// competition sweep learned why that matters: it once trusted a
// client-written retention date and swept fresh documents.
//
// Safe under a missed run and a double run: it re-queries everything
// currently due rather than tracking a cursor, and deleting an object that
// is already gone is not an error.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

const MAX_PER_RUN = 200;

export async function GET(request: Request) {
  // Vercel attaches `Authorization: Bearer <CRON_SECRET>` to every cron
  // invocation. An unset secret fails closed, never open — the same posture
  // as sweep-videos.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getOnlineCompAdminDb();
  const nowMs = Date.now();
  const snap = await db.collection(PRACTICE_COLLECTION).get();

  let scanned = 0;
  let deleted = 0;
  let refused = 0;
  const failures: string[] = [];
  const client = r2Client();
  const bucket = r2Bucket();

  for (const doc of snap.docs) {
    if (deleted >= MAX_PER_RUN) break;
    scanned += 1;
    const ms = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;
    if (!isPracticeSweepable(
      { status: doc.get('status'), createdAtMs: ms(doc.get('createdAt')), reviewedAtMs: ms(doc.get('reviewedAt')) },
      nowMs,
    )) {
      continue;
    }

    const key = doc.get('videoKey');
    // REFUSE ANY KEY THAT IS NOT PROVABLY THIS RUN'S OWN. The same rule
    // deleteSubmissionAndVideo applies for competition videos: a document
    // naming somebody else's object must not be the thing that deletes it.
    // Practice keys are derived server-side as
    // practice-videos/{uid}/{event}/{nonce}.webm, so the uid segment is
    // checkable against the document's own owner.
    const uid = doc.get('uid');
    const expectedPrefix =
      typeof uid === 'string' && uid ? `${PRACTICE_VIDEO_KEY_PREFIX}/${uid}/` : null;
    if (typeof key === 'string' && key && expectedPrefix && key.startsWith(expectedPrefix)) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        // The document stays, so the next run retries it. Losing the object
        // silently while dropping its record is the one outcome to avoid.
        failures.push(`${doc.id}: ${String((err as Error)?.message ?? err).slice(0, 80)}`);
        continue;
      }
    } else if (typeof key === 'string' && key) {
      // A key that does not belong to this run: the object stays, and so
      // does the document, so a human can look at it.
      refused += 1;
      continue;
    }

    await doc.ref.delete();
    deleted += 1;
  }

  return NextResponse.json({ scanned, deleted, refused, failures });
}
