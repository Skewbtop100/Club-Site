import type { DocumentReference } from 'firebase-admin/firestore';

// ── Shared submission deletion ────────────────────────────────────────────
// Server-only (Cloudinary Admin API credentials + firebase-admin). Used by
// BOTH the manual admin delete (DELETE /api/online-competition/submissions/
// [id]) and the scheduled retention sweep (GET /api/online-competition/cron/
// sweep-videos), so the two can't drift apart — the ordering and
// failure-handling rules below are the whole point of this module.

/** Removes a submission's video from Cloudinary via the Admin API.
 *
 *  Done with a plain authenticated REST call rather than the `cloudinary`
 *  npm package: that package isn't a dependency of this project, and
 *  pulling it in (plus its transitive deps) for a single destroy call
 *  isn't worth it — the Admin API's delete-resources endpoint is one
 *  authenticated DELETE. Credentials are the server-only
 *  CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET pair (HTTP Basic), never the
 *  NEXT_PUBLIC_* values the browser uses for its unsigned upload.
 *
 *  Returns a short status string for logging rather than throwing — every
 *  caller proceeds to the Firestore delete regardless.
 */
export async function destroyCloudinaryVideo(publicId: string): Promise<{ ok: boolean; detail: string }> {
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

  if (!apiKey || !apiSecret || !cloudName) {
    return { ok: false, detail: 'missing-credentials' };
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const url =
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/video/upload` +
    `?public_ids[]=${encodeURIComponent(publicId)}`;

  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    return { ok: false, detail: `http-${res.status} ${(await res.text()).slice(0, 200)}` };
  }

  // A 200 does NOT mean the asset went away: this endpoint reports
  // per-id outcomes in `deleted`, using "not_found" for an id that was
  // never there (or was already removed). Treating a bare res.ok as
  // success would silently mask a wrong/stale public_id.
  const body = (await res.json()) as { deleted?: Record<string, string> };
  const outcome = body.deleted?.[publicId];
  if (outcome === 'deleted') return { ok: true, detail: 'deleted' };
  // Already gone is a fine end state for a cleanup operation — the asset
  // is not there, which is what we wanted. (This is also what makes the
  // sweep safe to re-run: Vercel cron delivery can duplicate an
  // invocation, and a second pass over the same asset lands here.)
  if (outcome === 'not_found') return { ok: true, detail: 'not-found (already gone)' };
  return { ok: false, detail: `unexpected-outcome ${outcome ?? JSON.stringify(body).slice(0, 200)}` };
}

export interface SubmissionDeleteResult {
  cloudinaryDeleted: boolean;
  cloudinaryDetail: string;
}

/** Deletes a submission's Cloudinary video and then its Firestore doc.
 *
 *  Cloudinary FIRST, Firestore second — deliberately this order. The
 *  Firestore doc is the only record of which public_id belongs to this
 *  submission, so deleting it first and then failing on Cloudinary would
 *  strand the video with nothing left pointing at it. Doing Cloudinary
 *  first means a failure is still recoverable: the doc (and its public_id)
 *  is about to be gone too, but the error log below carries both so it can
 *  be cleaned up by hand.
 *
 *  The tradeoff: a Cloudinary failure does NOT abort the Firestore delete.
 *  An orphaned video costs storage and can be swept later; an undeleted
 *  submission stays in the judge's pending queue and blocks the admin's
 *  actual task, which is worse. So the failure mode we choose is "asset
 *  may linger", not "delete silently didn't happen".
 *
 *  `context` is prefixed to failure logs so a line in the runtime logs
 *  says which caller produced it (manual admin delete vs. nightly sweep).
 */
export async function deleteSubmissionAndVideo(
  ref: DocumentReference,
  cloudinaryPublicId: string | undefined,
  context: string,
): Promise<SubmissionDeleteResult> {
  let cloudinaryDeleted = false;
  let cloudinaryDetail = 'no-public-id';

  if (cloudinaryPublicId) {
    try {
      const result = await destroyCloudinaryVideo(cloudinaryPublicId);
      cloudinaryDeleted = result.ok;
      cloudinaryDetail = result.detail;
      if (!result.ok) {
        console.error(
          `[online-competition] ${context}: Cloudinary delete FAILED for submission ${ref.id} ` +
            `(public_id "${cloudinaryPublicId}"): ${result.detail}. ` +
            'Firestore doc is still being deleted — the asset must be removed manually.',
        );
      }
    } catch (err) {
      cloudinaryDetail = `threw ${(err as Error)?.message ?? 'unknown'}`;
      console.error(
        `[online-competition] ${context}: Cloudinary delete THREW for submission ${ref.id} ` +
          `(public_id "${cloudinaryPublicId}"): ${cloudinaryDetail}. ` +
          'Firestore doc is still being deleted — the asset must be removed manually.',
      );
    }
  }

  await ref.delete();

  return { cloudinaryDeleted, cloudinaryDetail };
}
