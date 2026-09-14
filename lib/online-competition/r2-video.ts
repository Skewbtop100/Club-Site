// ── Submission videos on Cloudflare R2 ─────────────────────────────────
// SERVER-ONLY. Holds R2 credentials; nothing here is useful to, or safe
// in, a client bundle.
//
// WHY R2: Cloudinary bills storage, upload bandwidth and playback against
// one monthly credit allowance, which a handful of competitions a month
// exhausts. R2 charges nothing for egress, and playback is most of the
// bandwidth a judged video ever uses.
//
// WHY PRESIGNED: R2 has no equivalent of Cloudinary's unsigned upload
// preset, and the video must never pass through the Next.js server — a
// multi-megabyte clip per attempt through a serverless function is slow,
// bills function time, and runs into request-body limits. So the server
// signs ONE PUT for ONE object, and the browser sends the bytes straight
// to R2.
//
// Kept free of next/server so the handler below can be exercised directly
// in tests; the route file is a thin wrapper that supplies the real auth.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';

/** How long a signed upload URL stays valid, in SECONDS.
 *
 *  Short because the URL is a bearer credential for one object: anyone
 *  holding it may write that key until it expires. Five minutes is still
 *  generous, because the browser starts the PUT immediately after the
 *  grant arrives — the only thing that runs alongside is a duration probe
 *  bounded at a few seconds. Expiry is checked when the request ARRIVES,
 *  so a slow upload that started in time still completes. */
export const VIDEO_UPLOAD_URL_TTL_S = 300;

/** The largest clip the route will sign a PUT for, in bytes.
 *
 *  A 104-second attempt at 405x720 came in at 3.38MB; ten minutes at the
 *  recorder's bitrate is ~22MB. 64MB leaves ample headroom for a long
 *  attempt on a generous encoder while still refusing to let an
 *  authenticated account turn the bucket into free storage. The size is
 *  SIGNED into the URL (see presignVideoPut), so the PUT must match it. */
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

/** Signed into every upload URL, so the browser must send exactly this. */
export const VIDEO_CONTENT_TYPE = 'video/webm';

export const VIDEO_KEY_PREFIX = 'videos';

/** One path segment: no slashes, no dots, nothing that reads as structure. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/** Body fields that would amount to the client choosing the object key.
 *  REFUSED OUTRIGHT rather than ignored: a caller sending one of these is
 *  either a bug or an attempt, and neither should be silently accepted. */
export const FORBIDDEN_KEY_FIELDS = ['key', 'Key', 'videoKey', 'objectKey', 'path'] as const;

export interface VideoTarget {
  uid: string;
  competitionId: string;
  event: string;
  competitionRound: number;
  attempt: number;
}

/** THE KEY IS DERIVED HERE, NEVER ACCEPTED.
 *
 *    videos/{uid}/{competitionId}/{event}/r{competitionRound}/a{attempt}/{nonce}.webm
 *
 *  uid FIRST, taken from the VERIFIED token: an athlete can only ever
 *  write under their own prefix, so no request can reach another
 *  athlete's video.
 *
 *  The attempt's identity next — the same parts submissionDocId is built
 *  from — so the object is findable from its document, and firestore.rules
 *  can refuse a document that points at any attempt but its own.
 *
 *  A NONCE LAST, fresh per grant. A deterministic key would let an athlete
 *  who can still get a token upload over a video a judge has already
 *  approved, swapping the evidence after the verdict. With a nonce the
 *  filed document — which athletes cannot update — keeps pointing at the
 *  key it was filed with, and any later grant gets a different one. */
export function buildVideoKey(target: VideoTarget, nonce: string): string {
  return [
    VIDEO_KEY_PREFIX,
    target.uid,
    target.competitionId,
    target.event,
    `r${target.competitionRound}`,
    `a${target.attempt}`,
    `${nonce}.webm`,
  ].join('/');
}

export function newVideoNonce(): string {
  return `${Date.now()}-${randomBytes(6).toString('hex')}`;
}

export type PresignBodyResult =
  | { ok: true; target: Omit<VideoTarget, 'uid'>; size: number }
  | { ok: false; status: number; error: string };

export function parsePresignBody(body: unknown): PresignBodyResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'bad-body' };
  }
  const b = body as Record<string, unknown>;

  for (const field of FORBIDDEN_KEY_FIELDS) {
    if (field in b) return { ok: false, status: 400, error: 'client-key-refused' };
  }

  const { competitionId, event, competitionRound, attempt, size } = b;
  if (typeof competitionId !== 'string' || !SAFE_SEGMENT.test(competitionId)) {
    return { ok: false, status: 400, error: 'bad-competition' };
  }
  if (typeof event !== 'string' || !SAFE_SEGMENT.test(event)) {
    return { ok: false, status: 400, error: 'bad-event' };
  }
  if (typeof competitionRound !== 'number' || !Number.isInteger(competitionRound) || competitionRound < 1) {
    return { ok: false, status: 400, error: 'bad-round' };
  }
  // 5 is the most attempts any result format has — the same ceiling
  // firestore.rules puts on `round`.
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1 || attempt > 5) {
    return { ok: false, status: 400, error: 'bad-attempt' };
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    return { ok: false, status: 400, error: 'bad-size' };
  }
  if (size > MAX_VIDEO_BYTES) {
    return { ok: false, status: 413, error: 'too-large' };
  }

  return { ok: true, target: { competitionId, event, competitionRound, attempt }, size };
}

export interface PresignDeps {
  /** Resolves to the verified uid, or throws. An error carrying a numeric
   *  `status` (AthleteAuthError does) is answered with that status; any
   *  other error is a server fault and propagates. */
  authorize: () => Promise<string>;
  presign: (key: string, size: number) => Promise<string>;
  nonce?: () => string;
}

export interface PresignResponse {
  status: number;
  json: Record<string, unknown>;
}

/** The whole route, minus the transport.
 *
 *  AUTHORISED FIRST, before the body is even looked at, so an
 *  unauthenticated caller learns nothing about what a valid request
 *  would contain. */
export async function handlePresignVideo(body: unknown, deps: PresignDeps): Promise<PresignResponse> {
  let uid: string;
  try {
    uid = await deps.authorize();
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    if (typeof status === 'number') {
      const reason = (e as { reason?: unknown })?.reason;
      return { status, json: { error: typeof reason === 'string' ? reason : 'unauthorized' } };
    }
    throw e;
  }
  if (!SAFE_SEGMENT.test(uid)) return { status: 400, json: { error: 'bad-uid' } };

  const parsed = parsePresignBody(body);
  if (!parsed.ok) return { status: parsed.status, json: { error: parsed.error } };

  const videoKey = buildVideoKey({ uid, ...parsed.target }, (deps.nonce ?? newVideoNonce)());

  let uploadUrl: string;
  try {
    uploadUrl = await deps.presign(videoKey, parsed.size);
  } catch (e) {
    // Logged without the URL or credentials. The athlete sees the normal
    // could-not-save state and retries.
    console.error('[r2] presigning a video upload failed:', (e as Error)?.message ?? e);
    return { status: 500, json: { error: 'presign-failed' } };
  }

  return {
    status: 200,
    json: {
      uploadUrl,
      videoKey,
      contentType: VIDEO_CONTENT_TYPE,
      expiresInS: VIDEO_UPLOAD_URL_TTL_S,
    },
  };
}

/** A client for R2's S3-compatible endpoint.
 *
 *  THE CHECKSUM SETTINGS ARE LOAD-BEARING. From @aws-sdk 3.729 the default
 *  is to calculate a checksum "when supported", which adds
 *  x-amz-checksum-* parameters to presigned URLs — computed over an empty
 *  body at signing time, since the real bytes do not exist yet. R2 then
 *  rejects the browser's PUT. WHEN_REQUIRED restores the older behaviour:
 *  no checksum unless an operation demands one, and a presigned PUT does
 *  not. Asserted in tests against a real generated URL. */
export function createR2Client(config: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    // PATH-STYLE (account.r2.cloudflarestorage.com/bucket/key), not the
    // SDK's default virtual-hosted style (bucket.account.r2...). The
    // browser PUTs to this URL directly, and a bucket name containing a
    // dot would not be covered by the wildcard certificate — a TLS failure
    // in the athlete's browser with nothing on our side to show for it.
    // Path-style works for every bucket name R2 allows.
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

let cachedClient: S3Client | null = null;

export function r2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }
  cachedClient = createR2Client({ accountId, accessKeyId, secretAccessKey });
  return cachedClient;
}

export function r2Bucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET is not set');
  return bucket;
}

/** Signs a PUT for exactly one object, at exactly this size and type.
 *
 *  Content-Type and Content-Length are both SIGNED, so the browser's PUT
 *  must carry the same values or R2 refuses it: the type keeps the bucket
 *  holding video, and the length makes MAX_VIDEO_BYTES an enforced limit
 *  rather than a number the client promised to respect. */
export async function presignVideoPut(
  client: S3Client,
  bucket: string,
  key: string,
  size: number,
): Promise<string> {
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: VIDEO_CONTENT_TYPE,
      ContentLength: size,
    }),
    {
      expiresIn: VIDEO_UPLOAD_URL_TTL_S,
      signableHeaders: new Set(['content-type', 'content-length']),
    },
  );
}
