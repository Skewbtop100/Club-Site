import { NextResponse } from 'next/server';
import { requireAthlete } from '@/lib/online-competition/athlete-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { readPracticeGate } from '@/lib/online-competition/practice-server';
import { handlePracticePresign } from '@/lib/online-competition/practice-video';
import { presignVideoPut, r2Bucket, r2Client } from '@/lib/online-competition/r2-video';

// firebase-admin (token verification) and node:crypto (the key nonce) both
// need Node. Stated rather than inherited from the default.
export const runtime = 'nodejs';

// Grants ONE signed PUT for ONE practice video.
//
// The SIBLING of r2/presign-video, deliberately not a branch inside it: that
// route's body parser requires a competitionId, a round and an attempt, none
// of which a practice run has. Everything about signing is the same
// function (presignVideoPut) against the same bucket; only the key differs,
// and practice-video.ts owns that.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { status, json } = await handlePracticePresign(body, {
    authorize: () => requireAthlete(req),
    mayPractise: async (uid) => (await readPracticeGate(getOnlineCompAdminDb(), uid)).allowed,
    presign: (key, size) => presignVideoPut(r2Client(), r2Bucket(), key, size),
  });
  // A grant is a short-lived credential; nothing between here and the
  // athlete may keep a copy.
  return NextResponse.json(json, { status, headers: { 'Cache-Control': 'no-store' } });
}
