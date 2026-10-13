import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb, verifyBearer, isAdminUid, AdminNotConfiguredError } from '@/lib/server/firebase-admin';
import { generatePin, generateSalt, generateVersion, hashPin } from '@/lib/judge-pin';

export const runtime = 'nodejs';

// Admin-only: generate / regenerate / disable a competition's judge PIN.
// Only a salted, peppered hash is stored (competitions/{id}/private/
// judgeAccess, admin-only in firestore.rules) — the PIN itself is returned
// once, in this response, and can never be read back. Every call changes
// `version`, which is what immediately revokes judge sessions issued for the
// previous PIN (firestore.rules and the staged-sync route compare it).
export async function POST(req: Request) {
  try {
    const caller = await verifyBearer(req);
    if (!caller) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (!(await isAdminUid(caller.uid))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => null) as { competitionId?: unknown; action?: unknown } | null;
    const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
    const action = body?.action;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(competitionId) || (action !== 'generate' && action !== 'disable')) {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }

    const db = adminDb();
    const comp = await db.doc(`competitions/${competitionId}`).get();
    if (!comp.exists || comp.get('isDailyPractice')) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const ref = db.doc(`competitions/${competitionId}/private/judgeAccess`);

    if (action === 'disable') {
      await ref.set({ enabled: false, version: generateVersion(), updatedAt: Timestamp.now(), updatedBy: caller.uid });
      return NextResponse.json({ enabled: false });
    }

    const pepper = process.env.JUDGE_PIN_PEPPER;
    if (!pepper) return NextResponse.json({ error: 'not-configured', detail: 'Server is missing: JUDGE_PIN_PEPPER' }, { status: 503 });
    const pin = generatePin();
    const salt = generateSalt();
    await ref.set({
      enabled: true, pinHash: hashPin(pin, salt, pepper), salt, version: generateVersion(),
      updatedAt: Timestamp.now(), updatedBy: caller.uid,
    });
    // A new PIN starts with a clean slate: drop the competition-wide lock.
    await db.doc(`judgeLoginAttempts/${competitionId}_all`).delete();
    return NextResponse.json({ enabled: true, pin });
  } catch (e) {
    if (e instanceof AdminNotConfiguredError) {
      return NextResponse.json({ error: 'not-configured', detail: e.message }, { status: 503 });
    }
    console.error('[api/judge/pin]', e);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}
