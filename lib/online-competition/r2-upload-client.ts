'use client';

// ── Sending a finished recording to R2 ─────────────────────────────────
// The client half of r2-video.ts. Two requests: ask our own route for a
// signed PUT, then send the bytes straight to R2 with it. The video never
// touches the Next.js server.
//
// EVERY FAILURE THROWS, and that is the contract the filing queue relies
// on. The solve page's pump already turns a throw into its automatic
// retries and then the "could not save the recording" state with a retry
// button — exactly what a Cloudinary failure did. Nothing here swallows an
// error or reports success it did not get.

import { authedFetchWithRetry } from './authed-fetch';
import { probeVideoDurationMs } from './video-duration';

export const PRESIGN_VIDEO_ROUTE = '/api/online-competition/r2/presign-video';

export interface VideoUploadTarget {
  competitionId: string;
  event: string;
  competitionRound: number;
  attempt: number;
}

export interface R2VideoUploadResult {
  /** The object key, exactly as the server derived it. Stored on the
   *  submission; the playback URL is built from it at read time. */
  videoKey: string;
  /** Read from the file itself; undefined if the probe could not tell. */
  durationMs?: number;
}

interface UploadGrant {
  uploadUrl: string;
  videoKey: string;
  contentType: string;
}

export async function uploadVideoToR2(
  blob: Blob,
  target: VideoUploadTarget,
  onProgress: (percent: number) => void,
): Promise<R2VideoUploadResult> {
  // In parallel: the probe is bounded and never rejects, so it can only
  // ever cost the few seconds it is allowed, and the grant does not wait
  // on it.
  const [durationMs, grant] = await Promise.all([
    probeVideoDurationMs(blob),
    requestUploadGrant(blob, target),
  ]);
  await putToR2(grant.uploadUrl, blob, grant.contentType, onProgress);
  return { videoKey: grant.videoKey, durationMs };
}

async function requestUploadGrant(blob: Blob, target: VideoUploadTarget): Promise<UploadGrant> {
  // The key is NOT sent — the server derives it from the verified token
  // and refuses any request that tries to supply one. The size IS sent,
  // because it is signed into the URL and the PUT must match it.
  const res = await authedFetchWithRetry(PRESIGN_VIDEO_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, size: blob.size }),
  });
  if (!res.ok) throw new Error(`Could not get a video upload URL (${res.status})`);
  const data = (await res.json().catch(() => null)) as Partial<UploadGrant> | null;
  if (
    !data ||
    typeof data.uploadUrl !== 'string' ||
    typeof data.videoKey !== 'string' ||
    typeof data.contentType !== 'string'
  ) {
    throw new Error('Malformed video upload grant');
  }
  return { uploadUrl: data.uploadUrl, videoKey: data.videoKey, contentType: data.contentType };
}

/** XMLHttpRequest, not fetch: fetch has no upload-progress event, and the
 *  athlete is shown a progress bar exactly as before. */
function putToR2(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Must equal the signed value exactly, or R2 refuses the signature.
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Сүлжээний алдаа гарлаа'));
    xhr.onabort = () => reject(new Error('Video upload aborted'));
    xhr.send(blob);
  });
}
