import { NextResponse } from 'next/server';
import { verifyBearer, isAdminUid, isJudgeOf, AdminNotConfiguredError } from '@/lib/server/firebase-admin';
import { runStagedSync } from '@/lib/server/staged-sync';

export const runtime = 'nodejs';

// Staged-import reveal, run on the server for an admin or for a judge of
// that competition. The caller only says WHICH event to look at; what gets
// revealed is computed here from the stored data (lib/staged-reveal.ts), so
// a judge can neither read the unrevealed rows nor influence which come out.
// `forceRounds` ("reveal all now") is honoured for admins only.
export async function POST(req: Request) {
  try {
    const caller = await verifyBearer(req);
    if (!caller) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const body = await req.json().catch(() => null) as { competitionId?: unknown; eventId?: unknown; forceRounds?: unknown } | null;
    const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
    const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(competitionId) || !/^[a-z0-9]{2,10}$/.test(eventId)) {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }

    const admin = await isAdminUid(caller.uid);
    if (!admin && !(await isJudgeOf(caller, competitionId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const forceRounds = admin && Array.isArray(body?.forceRounds)
      ? body.forceRounds.filter((r): r is number => Number.isInteger(r) && r >= 1 && r <= 10)
      : [];

    const result = await runStagedSync(competitionId, eventId, forceRounds);
    // A judge learns nothing about the import beyond "done".
    return NextResponse.json(admin ? { staged: result !== null, revealed: result?.revealed ?? 0 } : { ok: true });
  } catch (e) {
    if (e instanceof AdminNotConfiguredError) {
      return NextResponse.json({ error: 'not-configured', detail: e.message }, { status: 503 });
    }
    console.error('[api/staged/sync]', e);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}
