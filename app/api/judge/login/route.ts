import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { adminAuth, adminDb, AdminNotConfiguredError } from '@/lib/server/firebase-admin';
import {
  isPinFormat, verifyPin, lockRemainingMs, registerFailure,
  CLIENT_MAX_FAILURES, COMPETITION_MAX_FAILURES, JUDGE_SESSION_MS, type LockState,
} from '@/lib/judge-pin';

export const runtime = 'nodejs';

// Judge PIN login. The PIN is checked HERE, never in the browser: on success
// the judge gets a Firebase custom token whose claims
//   { role: 'judge', competitionId, pinVersion, validUntil }
// are what firestore.rules trust. The token carries no admin role and names
// one competition, so it opens nothing else.
//
// Brute force: a wrong PIN counts against this client (IP) for this
// competition — CLIENT_MAX_FAILURES in 15 minutes locks that client out for
// 15 minutes — and against the competition as a whole, across all clients
// (COMPETITION_MAX_FAILURES). The counters live in judgeLoginAttempts, which
// no client can read or write (no rule matches it).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as { competitionId?: unknown; pin?: unknown } | null;
    const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
    const pin = body?.pin;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(competitionId) || !isPinFormat(pin)) {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }
    const pepper = process.env.JUDGE_PIN_PEPPER;
    if (!pepper) return NextResponse.json({ error: 'not-configured', detail: 'Server is missing: JUDGE_PIN_PEPPER' }, { status: 503 });

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
    const client = createHash('sha256').update(ip).digest('hex').slice(0, 32);

    const db = adminDb();
    const clientRef = db.doc(`judgeLoginAttempts/${competitionId}_c_${client}`);
    const allRef = db.doc(`judgeLoginAttempts/${competitionId}_all`);
    const compRef = db.doc(`competitions/${competitionId}`);
    const accessRef = db.doc(`competitions/${competitionId}/private/judgeAccess`);

    const outcome = await db.runTransaction(async (tx) => {
      const [clientSnap, allSnap, compSnap, accessSnap] = await Promise.all([
        tx.get(clientRef), tx.get(allRef), tx.get(compRef), tx.get(accessRef),
      ]);
      const now = Date.now();
      const clientState = clientSnap.data() as LockState | undefined;
      const allState = allSnap.data() as LockState | undefined;
      const locked = Math.max(lockRemainingMs(clientState, now), lockRemainingMs(allState, now));
      // While locked the PIN isn't even looked at — a correct guess during a
      // lock must not get through, or the lock would only slow guessing down.
      if (locked > 0) return { kind: 'locked' as const, retryAfterMs: locked };

      // One answer for "wrong PIN", "no PIN set", "PIN disabled" and "not a
      // live competition": the response must not reveal which it was.
      const ok = compSnap.exists && compSnap.get('status') === 'live' && !compSnap.get('isDailyPractice')
        && accessSnap.exists && accessSnap.get('enabled') === true
        && verifyPin(pin, accessSnap.get('salt') || '', pepper, accessSnap.get('pinHash') || '');
      if (!ok) {
        const nextClient = registerFailure(clientState, now, CLIENT_MAX_FAILURES);
        const nextAll = registerFailure(allState, now, COMPETITION_MAX_FAILURES);
        tx.set(clientRef, nextClient);
        tx.set(allRef, nextAll);
        return { kind: 'invalid' as const, retryAfterMs: Math.max(lockRemainingMs(nextClient, now), lockRemainingMs(nextAll, now)) };
      }
      tx.delete(clientRef);
      return { kind: 'ok' as const, pinVersion: accessSnap.get('version') as string, now };
    });

    if (outcome.kind === 'locked') {
      return NextResponse.json({ error: 'locked', retryAfterMs: outcome.retryAfterMs }, { status: 429 });
    }
    if (outcome.kind === 'invalid') {
      return NextResponse.json({ error: 'invalid', retryAfterMs: outcome.retryAfterMs }, { status: 401 });
    }

    const validUntil = outcome.now + JUDGE_SESSION_MS;
    const uid = `judge_${competitionId}_${randomBytes(8).toString('hex')}`;
    const token = await adminAuth().createCustomToken(uid, {
      role: 'judge', competitionId, pinVersion: outcome.pinVersion, validUntil,
    });
    return NextResponse.json({ token, validUntil });
  } catch (e) {
    if (e instanceof AdminNotConfiguredError) {
      return NextResponse.json({ error: 'not-configured', detail: e.message }, { status: 503 });
    }
    console.error('[api/judge/login]', e);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}
