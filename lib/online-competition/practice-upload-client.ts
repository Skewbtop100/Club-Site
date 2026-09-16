'use client';

// ── Sending a practice recording to R2, then filing the run ────────────
// The client half of the practice area's storage. Three requests, in this
// order, and the order is the contract:
//
//   1. ask our own route for a signed PUT (it derives the key from the
//      verified token — the client never names the object);
//   2. send the bytes straight to R2 with it, so the video never touches
//      the Next.js server;
//   3. file the run, which is what SPENDS one of the athlete's ten.
//
// THE ALLOWANCE IS SPENT AT STEP 3, DELIBERATELY. A run abandoned before
// then — camera refused, page closed during the scramble — costs nothing,
// because nothing was written. Steps 1 and 2 cost storage that the retention
// sweep will collect whether or not step 3 ever happened.
//
// EVERY FAILURE THROWS. The page turns a throw into a retry button; nothing
// here swallows an error or reports success it did not get.

import { authedFetchWithRetry } from './authed-fetch';
import { putToR2 } from './r2-upload-client';

export const PRACTICE_PRESIGN_ROUTE = '/api/online-competition/practice/presign';
export const PRACTICE_ROUTE = '/api/online-competition/practice';

interface PracticeGrant {
  uploadUrl: string;
  videoKey: string;
  contentType: string;
}

async function requestPracticeGrant(blob: Blob, event: string): Promise<PracticeGrant> {
  // The key is NOT sent. The size IS, because it is signed into the URL and
  // the PUT must match it.
  const res = await authedFetchWithRetry(PRACTICE_PRESIGN_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, size: blob.size }),
  });
  if (!res.ok) throw new Error(`Бичлэг хадгалах хаяг авч чадсангүй (${res.status})`);
  const data = (await res.json().catch(() => null)) as Partial<PracticeGrant> | null;
  if (
    !data ||
    typeof data.uploadUrl !== 'string' ||
    typeof data.videoKey !== 'string' ||
    typeof data.contentType !== 'string'
  ) {
    throw new Error('Бичлэг хадгалах хаяг буруу байна');
  }
  return { uploadUrl: data.uploadUrl, videoKey: data.videoKey, contentType: data.contentType };
}

export interface PracticeFileResult {
  id: string;
  /** How many runs the athlete has left AFTER this one. */
  remaining: number;
}

/** Uploads the recording and files the run. Returns what is left of the ten.
 *
 *  `timeCs` is null when the athlete never typed one — a run recorded and
 *  abandoned at the keypad is still filed, because the video exists and an
 *  admin will still look at it. */
export async function uploadAndFilePracticeRun(
  blob: Blob,
  run: { event: string; scramble: string; timeCs: number | null; isDnf: boolean },
  onProgress: (percent: number) => void,
): Promise<PracticeFileResult> {
  const grant = await requestPracticeGrant(blob, run.event);
  await putToR2(grant.uploadUrl, blob, grant.contentType, onProgress);

  const res = await authedFetchWithRetry(PRACTICE_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...run, videoKey: grant.videoKey }),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; id?: string; remaining?: number; error?: string }
    | null;
  if (!res.ok || !data?.ok || typeof data.id !== 'string') {
    // The cap is a 409 and carries its own sentence; anything else gets the
    // generic one. Either way the video is already in the bucket and the
    // sweep will collect it, so nothing leaks.
    throw new Error(data?.error ?? 'Бичлэгийг хадгалж чадсангүй');
  }
  return { id: data.id, remaining: typeof data.remaining === 'number' ? data.remaining : 0 };
}
