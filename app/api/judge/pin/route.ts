import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb, verifyBearer, isAdminUid, AdminNotConfiguredError } from '@/lib/server/firebase-admin';
import {
  generatePin, generateSalt, generateVersion, hashPin,
  parseEncKey, encryptPin, decryptPin, pinContext,
} from '@/lib/judge-pin';

export const runtime = 'nodejs';

// Admin-only: generate / regenerate / disable a competition's judge PIN, and
// reveal the active one again.
//
// Stored in competitions/{id}/private/judgeAccess (admin-only in
// firestore.rules), never in plaintext:
//   pinHash + salt  scrypt, peppered — what PIN login verifies against;
//   pinEnc          the PIN under AES-256-GCM with the server-only key
//                   JUDGE_PIN_ENC_KEY — what `reveal` decrypts. Absent when
//                   that key isn't configured (pinEncKeyMissing: true) and on
//                   PINs generated before this existed.
// Every generate/disable changes `version`, which is what immediately
// revokes judge sessions issued for the previous PIN (firestore.rules and
// the staged-sync route compare it).
//
// Every action requires the caller's ID token to belong to an admin
// (users/{uid}.role == 'admin'); a judge token is not one.
export async function POST(req: Request) {
  try {
    const caller = await verifyBearer(req);
    if (!caller) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (!(await isAdminUid(caller.uid))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => null) as { competitionId?: unknown; action?: unknown } | null;
    const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
    const action = body?.action;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(competitionId) || (action !== 'generate' && action !== 'disable' && action !== 'reveal')) {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }

    const db = adminDb();
    const comp = await db.doc(`competitions/${competitionId}`).get();
    if (!comp.exists || comp.get('isDailyPractice')) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const ref = db.doc(`competitions/${competitionId}/private/judgeAccess`);
    const encKey = parseEncKey(process.env.JUDGE_PIN_ENC_KEY);

    if (action === 'reveal') {
      const access = await ref.get();
      // `reason` tells the admin UI which message to show; none of them
      // says anything about the PIN itself.
      if (!access.exists || access.get('enabled') !== true) return NextResponse.json({ error: 'no-pin', reason: 'disabled' }, { status: 409 });
      if (!access.get('pinEnc')) {
        return NextResponse.json({ error: 'no-pin', reason: access.get('pinEncKeyMissing') === true ? 'no-key' : 'legacy' }, { status: 409 });
      }
      if (!encKey) return NextResponse.json({ error: 'no-pin', reason: 'no-key' }, { status: 409 });
      const pin = decryptPin(access.get('pinEnc'), encKey, pinContext(competitionId, access.get('version') || ''));
      // Encrypted under a different key than the server has now.
      if (!pin) return NextResponse.json({ error: 'no-pin', reason: 'undecryptable' }, { status: 409 });
      return NextResponse.json({ pin });
    }

    if (action === 'disable') {
      await ref.set({ enabled: false, version: generateVersion(), updatedAt: Timestamp.now(), updatedBy: caller.uid });
      return NextResponse.json({ enabled: false });
    }

    const pepper = process.env.JUDGE_PIN_PEPPER;
    if (!pepper) return NextResponse.json({ error: 'not-configured', detail: 'Server is missing: JUDGE_PIN_PEPPER' }, { status: 503 });
    const pin = generatePin();
    const salt = generateSalt();
    const version = generateVersion();
    const updatedAt = Timestamp.now();
    await ref.set({
      enabled: true, pinHash: hashPin(pin, salt, pepper), salt, version,
      // Without the encryption key the PIN still works — it just can't be
      // shown again later, and the document says why.
      ...(encKey ? { pinEnc: encryptPin(pin, encKey, pinContext(competitionId, version)) } : { pinEncKeyMissing: true }),
      updatedAt, updatedBy: caller.uid,
    });
    // A new PIN starts with a clean slate: drop the competition-wide lock.
    await db.doc(`judgeLoginAttempts/${competitionId}_all`).delete();
    // updatedAt lets the admin UI tie this PIN to the exact stored record.
    return NextResponse.json({ enabled: true, pin, canReveal: !!encKey, updatedAt: updatedAt.toMillis() });
  } catch (e) {
    if (e instanceof AdminNotConfiguredError) {
      return NextResponse.json({ error: 'not-configured', detail: e.message }, { status: 503 });
    }
    console.error('[api/judge/pin]', e);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}
