// ── Where a practice run's video is stored ──────────────────────────────
// A SIBLING of r2-video.ts, not an extension of it. Everything about
// signing, the size ceiling and the content type is imported from there and
// unchanged; what this file owns is the KEY, and only because a practice run
// has no competition to put in one.
//
// WHY NOT REUSE buildVideoKey WITH A RESERVED competitionId: the competition
// key is
//     videos/{uid}/{competitionId}/{event}/r{round}/a{attempt}/{nonce}.webm
// and passing `practice` as the competitionId would fit the shape and read
// as a competition called "practice" to every future reader of the bucket —
// including the competition sweep, which walks that prefix. Overloading the
// segment is how a practice clip ends up in a competition's retention pass.
// A separate prefix keeps the two sets of objects separable by their key
// alone.
//
// THE PROPERTIES THAT MATTER ARE THE SAME ONES, and for the same reasons:
//   uid FIRST, from the VERIFIED token, so an athlete can only ever write
//     under their own prefix;
//   A NONCE LAST, fresh per grant, so a second grant cannot overwrite a
//     video an admin has already reviewed;
//   THE KEY IS DERIVED, NEVER ACCEPTED — the same FORBIDDEN_KEY_FIELDS
//     refusal, so a client cannot name its own object.

import {
  FORBIDDEN_KEY_FIELDS,
  MAX_VIDEO_BYTES,
  VIDEO_CONTENT_TYPE,
  VIDEO_UPLOAD_URL_TTL_S,
  newVideoNonce,
} from './r2-video';

/** Its own top-level prefix, so no competition-shaped reader (the sweep
 *  included) can walk into practice objects, and no practice reader can walk
 *  into a competition's. */
export const PRACTICE_VIDEO_KEY_PREFIX = 'practice-videos';

/** Same alphabet r2-video accepts for a key segment. Restated rather than
 *  imported because that one is private there, and widening its visibility
 *  to serve this file would be a change to it. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

export interface PracticeVideoTarget {
  uid: string;
  event: string;
}

/**  practice-videos/{uid}/{event}/{nonce}.webm
 *
 *  No round and no attempt: a practice run is ONE recorded solve, and there
 *  is nothing to number it against. The nonce is what makes two runs of the
 *  same event distinct objects. */
export function buildPracticeVideoKey(target: PracticeVideoTarget, nonce: string): string {
  return [PRACTICE_VIDEO_KEY_PREFIX, target.uid, target.event, `${nonce}.webm`].join('/');
}

export type PracticePresignBodyResult =
  | { ok: true; event: string; size: number }
  | { ok: false; status: number; error: string };

/** Validates the one thing the client may say about a practice upload: which
 *  event it is, and how big the file is. */
export function parsePracticePresignBody(body: unknown): PracticePresignBodyResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'bad-body' };
  }
  const b = body as Record<string, unknown>;

  // THE SAME REFUSAL as the competition path: a client that tries to name
  // the object is refused outright rather than having its field ignored,
  // because a silently ignored key is indistinguishable from an honoured one
  // at the call site.
  for (const field of FORBIDDEN_KEY_FIELDS) {
    if (field in b) return { ok: false, status: 400, error: 'client-key-refused' };
  }
  // A competition target must not be smuggled in either: this path writes
  // under the practice prefix whatever it is handed, and a caller passing a
  // competitionId is a caller using the wrong route.
  if ('competitionId' in b || 'competitionRound' in b || 'attempt' in b) {
    return { ok: false, status: 400, error: 'not-a-competition-upload' };
  }

  const { event, size } = b;
  if (typeof event !== 'string' || !SAFE_SEGMENT.test(event)) {
    return { ok: false, status: 400, error: 'bad-event' };
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    return { ok: false, status: 400, error: 'bad-size' };
  }
  if (size > MAX_VIDEO_BYTES) {
    return { ok: false, status: 413, error: 'too-large' };
  }
  return { ok: true, event, size };
}

export interface PracticePresignDeps {
  /** Resolves the VERIFIED uid, or throws. */
  authorize: () => Promise<string>;
  /** Whether this athlete may practise — a verified profile. REQUIRED, so
   *  no caller can forget it. Throwing (the profile could not be read) is a
   *  refusal, not a pass.
   *
   *  The filing route checks the same thing and is the one that decides;
   *  this one exists so an unverified athlete is not handed an upload URL
   *  and made to spend a recording's worth of bytes on a run that will be
   *  refused at the end. */
  mayPractise: (uid: string) => Promise<boolean>;
  presign: (key: string, size: number) => Promise<string>;
  /** Injected for the test; the real one is newVideoNonce. */
  nonce?: () => string;
}

export interface PracticePresignResponse {
  status: number;
  json:
    | {
        uploadUrl: string;
        videoKey: string;
        /** Signed INTO the url, so the PUT must send exactly this or R2
         *  refuses the signature. Returned rather than assumed by the
         *  client, the same way the competition grant returns it. */
        contentType: string;
        expiresInSeconds: number;
      }
    | { error: string };
}

/** AUTHORISE FIRST, then derive, then sign — the order r2-video's own
 *  handler uses, and the order that matters: nothing about the request is
 *  read as authoritative before there is a verified identity to attribute
 *  it to. */
export async function handlePracticePresign(
  body: unknown,
  deps: PracticePresignDeps,
): Promise<PracticePresignResponse> {
  let uid: string;
  try {
    uid = await deps.authorize();
  } catch {
    return { status: 401, json: { error: 'unauthorized' } };
  }

  // SECOND, before the body is read: the same order as authorise — nothing
  // about the request is looked at for someone who may not make it.
  let allowed: boolean;
  try {
    allowed = await deps.mayPractise(uid);
  } catch {
    // FAIL CLOSED. An unreadable profile grants nothing.
    return { status: 503, json: { error: 'verification-unavailable' } };
  }
  if (!allowed) return { status: 403, json: { error: 'not-verified' } };

  const parsed = parsePracticePresignBody(body);
  if (!parsed.ok) return { status: parsed.status, json: { error: parsed.error } };

  const videoKey = buildPracticeVideoKey({ uid, event: parsed.event }, (deps.nonce ?? newVideoNonce)());
  let uploadUrl: string;
  try {
    uploadUrl = await deps.presign(videoKey, parsed.size);
  } catch {
    return { status: 502, json: { error: 'presign-failed' } };
  }
  return {
    status: 200,
    json: { uploadUrl, videoKey, contentType: VIDEO_CONTENT_TYPE, expiresInSeconds: VIDEO_UPLOAD_URL_TTL_S },
  };
}
