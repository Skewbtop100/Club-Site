import { NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { verifyBearer, AdminNotConfiguredError } from './firebase-admin';
import { RoomError } from './rooms';

/**
 * Shared wrapper for app/api/rooms/* — the same shape as the judge and
 * staged-sync routes: a verified `Authorization: Bearer <ID token>` caller
 * (401 otherwise), never a judge session (403 — a judge is not a club
 * account), JSON body, RoomError → its status, missing Admin env → 503.
 */
export function roomsRoute(
  name: string,
  handler: (caller: DecodedIdToken, body: Record<string, unknown>) => Promise<object>,
) {
  return async function POST(req: Request) {
    try {
      const caller = await verifyBearer(req);
      if (!caller) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
      if (caller.role === 'judge') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'bad-request' }, { status: 400 });
      }
      return NextResponse.json(await handler(caller, body as Record<string, unknown>));
    } catch (e) {
      if (e instanceof RoomError) return NextResponse.json({ error: e.code }, { status: e.status });
      if (e instanceof AdminNotConfiguredError) {
        return NextResponse.json({ error: 'not-configured', detail: e.message }, { status: 503 });
      }
      console.error(`[api/rooms/${name}]`, e);
      return NextResponse.json({ error: 'server-error' }, { status: 500 });
    }
  };
}
