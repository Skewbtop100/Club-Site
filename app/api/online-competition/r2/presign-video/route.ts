import { NextResponse } from 'next/server';
import { requireAthlete } from '@/lib/online-competition/athlete-auth';
import {
  handlePresignVideo,
  presignVideoPut,
  r2Bucket,
  r2Client,
} from '@/lib/online-competition/r2-video';

// firebase-admin (token verification) and node:crypto (the key nonce)
// both need Node. Stated rather than inherited from the default.
export const runtime = 'nodejs';

// Grants ONE signed PUT for ONE submission video. Everything that matters
// — authorisation first, a server-derived key, refusal of any key the
// client tries to supply — lives in handlePresignVideo, where it is
// tested. This file only supplies the real verified identity and the real
// R2 client.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { status, json } = await handlePresignVideo(body, {
    authorize: () => requireAthlete(req),
    presign: (key, size) => presignVideoPut(r2Client(), r2Bucket(), key, size),
  });
  // A grant is a short-lived credential; nothing between here and the
  // athlete may keep a copy.
  return NextResponse.json(json, { status, headers: { 'Cache-Control': 'no-store' } });
}
