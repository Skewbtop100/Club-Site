import type { DocumentReference } from 'firebase-admin/firestore';
import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
// The R2 client is CONSTRUCTED IN ONE PLACE — r2Client() in r2-video.ts,
// the same instance and credentials the presign route signs uploads with.
// Nothing here builds a second one.
import { VIDEO_KEY_PREFIX, r2Bucket, r2Client } from './r2-video';

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
//
// ── AND WHETHER IT REALLY DOES ──
// A document names its assets, but the athlete's client wrote that document.
// Before firestore.rules was tightened, a submission could name ANY public id
// — a competition poster, another athlete's profile photo — with a retention
// date of yesterday, and the nightly sweep would delete it. The rules now
// refuse that for new submissions; this module refuses it at deletion time
// too, independently, because documents filed before the rules changed (and
// anything the Admin SDK writes) are not covered by them:
//   · R2 — EXACT. A key must be the one buildVideoKey makes for this
//     document's own uid, competition, event, round and attempt.
//   · Cloudinary (legacy only) — BEST AVAILABLE. Unsigned uploads record no
//     owner, and the account is shared with the club site, so an id proves
//     nothing. What does: the asset's upload time. A submission's video and
//     stills were uploaded in the minutes before it was filed (createdAt is
//     pinned to the server clock); a poster or a photo was not. An asset
//     whose upload time cannot be read is not deleted.

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

// ── Ownership, checked at deletion time ─────────────────────────────────

/** The identity fields a submission document carries — `unknown` until
 *  checked, since the document may predate any rule about them. */
export interface SubmissionIdentityFields {
  uid?: unknown;
  competitionId?: unknown;
  event?: unknown;
  competitionRound?: unknown;
  /** The ATTEMPT index, under its stored name. */
  round?: unknown;
  createdAt?: unknown;
}

const KEY_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const KEY_FILE = /^[A-Za-z0-9-]+\.webm$/;

/** Is this R2 key the submission's OWN object?
 *
 *  The same parts buildVideoKey (r2-video.ts) derives a key from, taken from
 *  the document itself: videos/{uid}/{competitionId}/{event}/r{round}/a{attempt}/
 *  then a nonce file. Anything else — another athlete's uid, another attempt,
 *  a path that climbs out of its folder — is refused. Every segment must be a
 *  plain segment, the same rule the presign route applies when it builds one. */
export function videoKeyBelongsTo(key: string, doc: SubmissionIdentityFields | undefined): boolean {
  const { uid, competitionId, event, competitionRound, round } = doc ?? {};
  if (typeof uid !== 'string' || !KEY_SEGMENT.test(uid)) return false;
  if (typeof competitionId !== 'string' || !KEY_SEGMENT.test(competitionId)) return false;
  if (typeof event !== 'string' || !KEY_SEGMENT.test(event)) return false;
  if (typeof competitionRound !== 'number' || !Number.isInteger(competitionRound) || competitionRound < 1) return false;
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 1) return false;
  const prefix = `${VIDEO_KEY_PREFIX}/${uid}/${competitionId}/${event}/r${competitionRound}/a${round}/`;
  return key.startsWith(prefix) && KEY_FILE.test(key.slice(prefix.length));
}

/** How long before a submission was filed its legacy assets may have been
 *  uploaded. The solve page uploaded the video and stills and filed the
 *  document straight after; a retry re-uploaded. Half an hour covers a slow
 *  upload many times over. */
export const LEGACY_UPLOAD_MAX_LEAD_MS = 30 * 60 * 1000;
/** Clock difference tolerated between Cloudinary and Firestore. */
export const LEGACY_UPLOAD_MAX_LAG_MS = 5 * 60 * 1000;

/** Was this asset uploaded with this submission? */
export function uploadedWithSubmission(assetUploadedAtMs: number, submissionCreatedAtMs: number): boolean {
  return (
    assetUploadedAtMs >= submissionCreatedAtMs - LEGACY_UPLOAD_MAX_LEAD_MS &&
    assetUploadedAtMs <= submissionCreatedAtMs + LEGACY_UPLOAD_MAX_LAG_MS
  );
}

/** A Firestore Timestamp, Date or epoch-ms number, as ms — or null. */
export function timestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const t = value as { toMillis?: () => number } | null | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}

export interface RefusedAsset {
  kind: 'r2' | 'cloudinary-video' | 'cloudinary-image';
  id: string;
  reason: string;
}

function cloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET &&
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  );
}

/** public_id -> upload time (ms), for the ids Cloudinary still holds, via the
 *  Admin API's list-by-ids. An id that no longer exists is simply absent.
 *  THROWS when the lookup cannot be made or read — the caller refuses. */
async function lookupUploadTimes(resourceType: 'video' | 'image', publicIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const auth = Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString('base64');
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  for (let i = 0; i < publicIds.length; i += DELETE_BATCH_MAX) {
    const chunk = publicIds.slice(i, i + DELETE_BATCH_MAX);
    const query = `${chunk.map((id) => `public_ids[]=${encodeURIComponent(id)}`).join('&')}&max_results=${chunk.length}`;
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType}/upload?${query}`, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`lookup http-${res.status}`);
    const body = (await res.json()) as { resources?: { public_id?: unknown; created_at?: unknown }[] };
    if (!Array.isArray(body.resources)) throw new Error('lookup returned no resources list');
    for (const r of body.resources) {
      if (typeof r?.public_id !== 'string' || typeof r?.created_at !== 'string') continue;
      const ms = Date.parse(r.created_at);
      if (Number.isFinite(ms)) out.set(r.public_id, ms);
    }
  }
  return out;
}

/** Splits a legacy submission's Cloudinary ids into those it may delete and
 *  those it may not. Never throws: a lookup that fails refuses everything. */
async function screenLegacyAssets(
  resourceType: 'video' | 'image',
  publicIds: string[],
  submissionCreatedAtMs: number | null,
): Promise<{ allowed: string[]; refused: { id: string; reason: string }[] }> {
  if (publicIds.length === 0) return { allowed: [], refused: [] };
  if (submissionCreatedAtMs === null) {
    return {
      allowed: [],
      refused: publicIds.map((id) => ({ id, reason: 'the submission has no createdAt to check the upload against' })),
    };
  }
  let uploadedAt: Map<string, number>;
  try {
    uploadedAt = await lookupUploadTimes(resourceType, publicIds);
  } catch (err) {
    const why = (err as Error)?.message ?? 'unknown';
    return { allowed: [], refused: publicIds.map((id) => ({ id, reason: `upload time could not be verified (${why})` })) };
  }
  const allowed: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const id of publicIds) {
    const t = uploadedAt.get(id);
    // Not there any more: nothing to protect, and deleting it is a no-op
    // that keeps a re-run sweep clean.
    if (t === undefined || uploadedWithSubmission(t, submissionCreatedAtMs)) allowed.push(id);
    else {
      refused.push({
        id,
        reason: `uploaded ${new Date(t).toISOString()}, not with this submission (filed ${new Date(submissionCreatedAtMs).toISOString()})`,
      });
    }
  }
  return { allowed, refused };
}

/** Test seam for the R2 half. Production passes nothing and gets the
 *  shared client and bucket; a test passes a client whose requests never
 *  leave the process. */
export interface R2CleanupDeps {
  client?: S3Client;
  bucket?: string;
}

export interface SubmissionCleanupDeps {
  r2?: R2CleanupDeps;
}

/** Removes a submission's video from R2.
 *
 *  A MISSING OBJECT IS SUCCESS. S3's DeleteObject answers 204 whether or
 *  not the key existed, so an already-deleted video usually looks exactly
 *  like a deleted one — which is the right answer for a cleanup, and what
 *  makes the sweep safe to re-run. A NoSuchKey/404 from a stricter
 *  implementation is folded into the same outcome.
 *
 *  Returns 'missing-credentials' WITHOUT making any request when R2 is not
 *  configured, exactly like destroyCloudinaryVideo — which is what keeps
 *  the emulator-backed suites from ever issuing a live delete against the
 *  production bucket. Never throws. */
export async function destroyR2Video(key: string, deps: R2CleanupDeps = {}): Promise<DestroyOutcome> {
  let client: S3Client;
  let bucket: string;
  try {
    client = deps.client ?? r2Client();
    bucket = deps.bucket ?? r2Bucket();
  } catch {
    return { ok: false, detail: 'missing-credentials' };
  }
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return { ok: true, detail: 'deleted' };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      return { ok: true, detail: 'not-found (already gone)' };
    }
    return { ok: false, detail: `${e?.name ?? 'error'} ${e?.$metadata?.httpStatusCode ?? ''}`.trim() };
  }
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
  /** Stills the document named that were NOT deleted, because they were not
   *  provably this submission's own. Not failures: they belong elsewhere. */
  stillsRefused: number;
  /** Every asset refused, with why — for the sweep's report and the logs. */
  refused: RefusedAsset[];
  /** The R2 video's outcome, for everything filed since videos moved
   *  there. r2Detail is 'no-video-key' when the submission has none —
   *  every legacy submission — mirroring cloudinaryDetail's
   *  'no-public-id'. A caller that only read cloudinaryDeleted would count
   *  every R2 submission as having no video at all. */
  r2Deleted: boolean;
  r2Detail: string;
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
export interface SubmissionAssetFields extends SubmissionIdentityFields {
  cloudinaryPublicId?: unknown;
  videoKey?: unknown;
  timerShotIds?: unknown;
  cubeShotIds?: unknown;
}

/** Deletes a submission's video, its stills, and then its Firestore doc.
 *
 *  THE VIDEO LIVES IN ONE OF TWO PLACES: R2 (videoKey) for everything
 *  filed since videos moved there, Cloudinary (cloudinaryPublicId) for
 *  everything before — and legacy submissions are still inside their
 *  retention window, so both are handled. Each is attempted independently
 *  and neither can prevent the other, the stills, or the document delete.
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
  deps: SubmissionCleanupDeps = {},
): Promise<SubmissionDeleteResult> {
  const cloudinaryPublicId =
    typeof data?.cloudinaryPublicId === 'string' && data.cloudinaryPublicId.length > 0
      ? data.cloudinaryPublicId
      : undefined;
  const videoKey =
    typeof data?.videoKey === 'string' && data.videoKey.length > 0 ? data.videoKey : undefined;
  // Both holds' stills, as one list: they are the same kind of asset, go
  // to the same endpoint, and no caller distinguishes them.
  const shotIds = [...readShotIds(data?.timerShotIds), ...readShotIds(data?.cubeShotIds)];
  const submissionCreatedAtMs = timestampMs(data?.createdAt);
  const refused: RefusedAsset[] = [];
  const logRefused = (kind: RefusedAsset['kind'], items: { id: string; reason: string }[]) => {
    for (const item of items) refused.push({ kind, ...item });
    if (items.length === 0) return;
    console.error(
      `[online-competition] ${context}: submission ${ref.id} names ${kind} asset(s) that are NOT deleted — ` +
        'not provably this submission’s own, so they may belong to someone else: ' +
        items.map((x) => `"${x.id}" (${x.reason})`).join('; '),
    );
  };

  let cloudinaryDeleted = false;
  let cloudinaryDetail = 'no-public-id';

  // Unconfigured Cloudinary makes no request of any kind — the lookup
  // included — which is what keeps the emulator suites inert.
  let videoMayBeDeleted = true;
  if (cloudinaryPublicId && cloudinaryConfigured()) {
    const screen = await screenLegacyAssets('video', [cloudinaryPublicId], submissionCreatedAtMs);
    if (screen.refused.length > 0) {
      videoMayBeDeleted = false;
      cloudinaryDetail = `refused: ${screen.refused[0].reason}`;
      logRefused('cloudinary-video', screen.refused);
    }
  }

  if (cloudinaryPublicId && videoMayBeDeleted) {
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

  // ── The R2 video ──
  // An INDEPENDENT branch, not an else of the Cloudinary one above.
  // firestore.rules keeps client-written documents to exactly one video
  // shape, but this module also runs over documents the Admin SDK wrote,
  // which no rule constrains — and a document that somehow carries both
  // should lose both, not whichever branch happened to come first.
  //
  // Before the doc for the same reason as everything else: the document is
  // the only record of which key belongs to this submission. Wrapped so a
  // failure is logged with the KEY NAMED and never reaches ref.delete().
  let r2Deleted = false;
  let r2Detail = 'no-video-key';
  if (videoKey && !videoKeyBelongsTo(videoKey, data)) {
    r2Detail = 'refused: the key is not this submission’s own object';
    logRefused('r2', [{ id: videoKey, reason: 'the key does not match the submission’s own uid, competition, event, round and attempt' }]);
  } else if (videoKey) {
    try {
      const result = await destroyR2Video(videoKey, deps.r2);
      r2Deleted = result.ok;
      r2Detail = result.detail;
      if (!result.ok) {
        console.error(
          `[online-competition] ${context}: R2 delete FAILED for submission ${ref.id} ` +
            `(key "${videoKey}"): ${result.detail}. ` +
            'Firestore doc is still being deleted — the object must be removed manually.',
        );
      }
    } catch (err) {
      // destroyR2Video is written not to throw; belt-and-braces.
      r2Detail = `threw ${(err as Error)?.message ?? 'unknown'}`;
      console.error(
        `[online-competition] ${context}: R2 delete THREW for submission ${ref.id} ` +
          `(key "${videoKey}"): ${r2Detail}. ` +
          'Firestore doc is still being deleted — the object must be removed manually.',
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
  let stillsRefused = 0;
  let stillsToDelete = shotIds;
  if (shotIds.length > 0 && cloudinaryConfigured()) {
    const screen = await screenLegacyAssets('image', shotIds, submissionCreatedAtMs);
    stillsToDelete = screen.allowed;
    stillsRefused = screen.refused.length;
    logRefused('cloudinary-image', screen.refused);
  }
  if (stillsToDelete.length > 0) {
    try {
      const stills = await destroyCloudinaryImages(stillsToDelete);
      stillsDeleted = stills.deleted;
      stillsFailed = stills.failed;
      if (stills.failed > 0) {
        console.error(
          `[online-competition] ${context}: Cloudinary STILL delete FAILED for submission ` +
            `${ref.id} — ${stills.failed} of ${stillsToDelete.length} image(s): ` +
            stills.failures.map((f) => `"${f.publicId}" (${f.detail})`).join('; ') +
            '. Firestore doc is still being deleted — those images must be removed manually.',
        );
      }
    } catch (err) {
      // destroyCloudinaryImages is written not to throw; this is the
      // belt-and-braces for the day that stops being true.
      stillsFailed = stillsToDelete.length;
      console.error(
        `[online-competition] ${context}: Cloudinary STILL delete THREW for submission ` +
          `${ref.id} (${stillsToDelete.length} image(s)): ${(err as Error)?.message ?? 'unknown'}. ` +
          'Firestore doc is still being deleted — those images must be removed manually.',
      );
    }
  }

  await ref.delete();

  return {
    cloudinaryDeleted,
    cloudinaryDetail,
    stillsDeleted,
    stillsFailed,
    stillsRefused,
    refused,
    r2Deleted,
    r2Detail,
  };
}
