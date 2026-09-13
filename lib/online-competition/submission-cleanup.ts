import type { DocumentReference } from 'firebase-admin/firestore';

// ── Shared submission deletion ────────────────────────────────────────────
// Server-only (Cloudinary Admin API credentials + firebase-admin). EVERY
// path that deletes a submission goes through deleteSubmissionAndVideo:
// the manual admin delete (DELETE /api/online-competition/submissions/
// [id]), the scheduled retention sweep (GET /api/online-competition/cron/
// sweep-videos) and the attempt reset (reset-attempts.ts). Nothing else
// removes an onlineSubmissions document — that is deliberate, and it is
// what makes the ordering and failure-handling rules below the whole
// point of this module rather than one of three opinions about them.
//
// A SUBMISSION IS MORE THAN ITS VIDEO. It also owns the full-resolution
// stills grabbed during the two closing holds (timerShotIds/cubeShotIds
// in types.ts), which are Cloudinary IMAGE resources with their own
// public ids — a different endpoint from the video, so they were
// untouched by the original video-only delete and would have outlived the
// clip they came from indefinitely. They are frames of an athlete's face,
// the club's athletes include minors, and the retention window is a
// promise about all of it and not just the .webm. Hence: the function
// takes the DOCUMENT, and decides here what belongs to a submission.

export interface DestroyOutcome {
  ok: boolean;
  detail: string;
}

/** Cloudinary's delete-resources endpoint takes many ids per call. The
 *  documented ceiling is 100; a submission brings at most six stills, so
 *  in practice every call here is a single batch. */
const DELETE_BATCH_MAX = 100;

/** Removes assets of ONE resource type from Cloudinary via the Admin API,
 *  in a single batched DELETE, and reports what happened to each id.
 *
 *  Done with a plain authenticated REST call rather than the `cloudinary`
 *  npm package: that package isn't a dependency of this project, and
 *  pulling it in (plus its transitive deps) for a destroy call isn't
 *  worth it — the Admin API's delete-resources endpoint is one
 *  authenticated DELETE and it already accepts a list. Credentials are
 *  the server-only CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET pair (HTTP
 *  Basic), never the NEXT_PUBLIC_* values the browser uses for its
 *  unsigned upload.
 *
 *  RESOURCE TYPE IS PART OF THE ROUTE, which is the whole reason this is
 *  parameterised. A video and an image with the same public_id are
 *  different assets to Cloudinary, and asking the video endpoint to
 *  delete an image gets a cheerful "not_found" — the exact shape of the
 *  bug this module is being extended to fix.
 *
 *  Returns per-id status for logging rather than throwing; every caller
 *  proceeds to the Firestore delete regardless.
 */
async function destroyResources(
  resourceType: 'video' | 'image',
  publicIds: string[],
): Promise<Map<string, DestroyOutcome>> {
  const out = new Map<string, DestroyOutcome>();
  if (publicIds.length === 0) return out;

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

  if (!apiKey || !apiSecret || !cloudName) {
    for (const id of publicIds) out.set(id, { ok: false, detail: 'missing-credentials' });
    return out;
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const query = publicIds.map((id) => `public_ids[]=${encodeURIComponent(id)}`).join('&');
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType}/upload?${query}`;

  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    const detail = `http-${res.status} ${(await res.text()).slice(0, 200)}`;
    for (const id of publicIds) out.set(id, { ok: false, detail });
    return out;
  }

  // A 200 does NOT mean the assets went away: this endpoint reports
  // per-id outcomes in `deleted`, using "not_found" for an id that was
  // never there (or was already removed). Treating a bare res.ok as
  // success would silently mask a wrong/stale public_id.
  const body = (await res.json()) as { deleted?: Record<string, string> };
  for (const id of publicIds) {
    const outcome = body.deleted?.[id];
    if (outcome === 'deleted') {
      out.set(id, { ok: true, detail: 'deleted' });
    } else if (outcome === 'not_found') {
      // Already gone is a fine end state for a cleanup operation — the
      // asset is not there, which is what we wanted. (This is also what
      // makes the sweep safe to re-run: Vercel cron delivery can
      // duplicate an invocation, and a second pass lands here.)
      out.set(id, { ok: true, detail: 'not-found (already gone)' });
    } else {
      out.set(id, {
        ok: false,
        detail: `unexpected-outcome ${outcome ?? JSON.stringify(body).slice(0, 200)}`,
      });
    }
  }
  return out;
}

/** The submission's video. Unchanged in behaviour — including returning
 *  'missing-credentials' without making any network call at all, which is
 *  what lets the emulator-backed suites run this module for real. */
export async function destroyCloudinaryVideo(publicId: string): Promise<DestroyOutcome> {
  const outcomes = await destroyResources('video', [publicId]);
  return outcomes.get(publicId) ?? { ok: false, detail: 'no-outcome' };
}

export interface ImageDestroyResult {
  deleted: number;
  failed: number;
  failures: { publicId: string; detail: string }[];
}

/** The submission's stills — the full-resolution frames grabbed during
 *  the two closing holds (timerShotIds / cubeShotIds in types.ts).
 *
 *  ONE FAILURE MUST NOT TAKE THE REST WITH IT. The ids are chunked to the
 *  endpoint's ceiling and the chunks run under allSettled, so a chunk
 *  that throws outright — DNS, a socket reset mid-flight — is recorded
 *  against its own ids and nothing else. This function does not throw.
 */
export async function destroyCloudinaryImages(publicIds: string[]): Promise<ImageDestroyResult> {
  const result: ImageDestroyResult = { deleted: 0, failed: 0, failures: [] };
  if (publicIds.length === 0) return result;

  const chunks: string[][] = [];
  for (let i = 0; i < publicIds.length; i += DELETE_BATCH_MAX) {
    chunks.push(publicIds.slice(i, i + DELETE_BATCH_MAX));
  }

  const settled = await Promise.allSettled(chunks.map((c) => destroyResources('image', c)));
  settled.forEach((chunkResult, i) => {
    if (chunkResult.status === 'rejected') {
      // The request itself never completed, so nothing is known about any
      // id in it. Every one is a failure, each named individually.
      const detail = `threw ${(chunkResult.reason as Error)?.message ?? 'unknown'}`;
      for (const publicId of chunks[i]) {
        result.failed += 1;
        result.failures.push({ publicId, detail });
      }
      return;
    }
    for (const [publicId, outcome] of chunkResult.value) {
      if (outcome.ok) result.deleted += 1;
      else {
        result.failed += 1;
        result.failures.push({ publicId, detail: outcome.detail });
      }
    }
  });

  return result;
}

/** The still ids as stored, defended against every shape Firestore might
 *  actually hand back.
 *
 *  ABSENT, EMPTY AND MALFORMED ALL MEAN "NOTHING TO DELETE". Every
 *  submission filed before these fields existed has neither, which is the
 *  common case and must be a silent no-op rather than anything that
 *  interrupts a sweep. Non-string entries are dropped rather than passed
 *  to the URL builder: firestore.rules refuses them on create, but this
 *  module also runs over documents written by the Admin SDK, which
 *  bypasses those rules entirely. */
function readShotIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export interface SubmissionDeleteResult {
  /** The VIDEO's outcome. Named from before there was anything else to
   *  delete, and left alone: three callers read it, and the video is
   *  still the asset whose survival matters most. */
  cloudinaryDeleted: boolean;
  cloudinaryDetail: string;
  /** The stills' outcome, counted rather than named — a submission has at
   *  most six and they are interchangeable to every caller. Both zero
   *  when the submission had none, which is every submission filed before
   *  stills existed. */
  stillsDeleted: number;
  stillsFailed: number;
}

/** The fields this module deletes assets for — the submission document as
 *  Firestore hands it back, which is to say `unknown` until checked.
 *
 *  THE WHOLE DOCUMENT, NOT A LIST OF IDS, and that is the point. This
 *  function used to take `cloudinaryPublicId` alone, so when stills were
 *  added every call site silently kept deleting only the video and the
 *  images were orphaned. Passing the document means the answer to "which
 *  assets belong to a submission" is written here, once, and a field
 *  added later is one edit in one file rather than a thing three callers
 *  have to remember. */
export interface SubmissionAssetFields {
  cloudinaryPublicId?: unknown;
  timerShotIds?: unknown;
  cubeShotIds?: unknown;
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
  data: SubmissionAssetFields | undefined,
  context: string,
): Promise<SubmissionDeleteResult> {
  const cloudinaryPublicId =
    typeof data?.cloudinaryPublicId === 'string' && data.cloudinaryPublicId.length > 0
      ? data.cloudinaryPublicId
      : undefined;
  // Both holds' stills, as one list: they are the same kind of asset, go
  // to the same endpoint, and no caller distinguishes them.
  const shotIds = [...readShotIds(data?.timerShotIds), ...readShotIds(data?.cubeShotIds)];

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

  // ── The stills, after the video and before the doc ──
  // AFTER the video because the video is the evidence and the thing worth
  // spending the first (and, if only one succeeds, the only) request on.
  // BEFORE the doc for the same reason the video is: this document is the
  // only record of which image ids belong to this submission, so deleting
  // it first and then failing here would strand the frames with nothing
  // left pointing at them — and these are the athlete's face at full
  // resolution, which is precisely what must not be left lying around.
  //
  // Wrapped so that nothing here can reach `ref.delete()`. The module's
  // standing tradeoff applies unchanged: an orphaned asset costs storage
  // and is recoverable from the log line below; a submission that would
  // not delete blocks a judge.
  let stillsDeleted = 0;
  let stillsFailed = 0;
  if (shotIds.length > 0) {
    try {
      const stills = await destroyCloudinaryImages(shotIds);
      stillsDeleted = stills.deleted;
      stillsFailed = stills.failed;
      if (stills.failed > 0) {
        console.error(
          `[online-competition] ${context}: Cloudinary STILL delete FAILED for submission ` +
            `${ref.id} — ${stills.failed} of ${shotIds.length} image(s): ` +
            stills.failures.map((f) => `"${f.publicId}" (${f.detail})`).join('; ') +
            '. Firestore doc is still being deleted — those images must be removed manually.',
        );
      }
    } catch (err) {
      // destroyCloudinaryImages is written not to throw; this is the
      // belt-and-braces for the day that stops being true.
      stillsFailed = shotIds.length;
      console.error(
        `[online-competition] ${context}: Cloudinary STILL delete THREW for submission ` +
          `${ref.id} (${shotIds.length} image(s)): ${(err as Error)?.message ?? 'unknown'}. ` +
          'Firestore doc is still being deleted — those images must be removed manually.',
      );
    }
  }

  await ref.delete();

  return { cloudinaryDeleted, cloudinaryDetail, stillsDeleted, stillsFailed };
}
