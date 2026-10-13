import { onSnapshot, doc } from 'firebase/firestore';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';

// Client side of the per-competition judge PIN. Everything that matters
// happens on the server (app/api/judge/*): the PIN is generated, hashed and
// verified there; this file only calls those routes and signs in with the
// custom token a correct PIN earns.

/** What the admin's PIN section shows. The stored document also holds the
 *  hash, salt and encrypted PIN (admin-readable only) — never surfaced; the
 *  PIN itself only ever comes back from the server (revealJudgePin). */
export interface JudgeAccessStatus {
  enabled: boolean;
  /** When the active PIN was generated (or access disabled). */
  updatedAt: Date | null;
  /** Whether the active PIN can be shown again:
   *  'yes'    — an encrypted copy is stored;
   *  'no-key' — it was generated while the server had no JUDGE_PIN_ENC_KEY;
   *  'legacy' — it predates the encrypted copy. */
  revealable: 'yes' | 'no-key' | 'legacy';
}

/** Live status of a competition's judge PIN. Admin only (firestore.rules). */
export function subscribeJudgeAccess(
  competitionId: string,
  onData: (status: JudgeAccessStatus) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, COL.COMPETITIONS, competitionId, 'private', 'judgeAccess'),
    (snap) => {
      const updatedAt = snap.data()?.updatedAt as { toDate?: () => Date } | undefined;
      onData({
        enabled: snap.data()?.enabled === true,
        updatedAt: updatedAt?.toDate?.() ?? null,
        revealable: snap.data()?.pinEnc ? 'yes' : snap.data()?.pinEncKeyMissing === true ? 'no-key' : 'legacy',
      });
    },
    (err) => onError?.(err),
  );
}

async function post(path: string, body: unknown, idToken?: string) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/**
 * Admin: generate a new PIN (returned in the response) or disable judge
 * access. Either way every judge session issued for the previous PIN stops
 * working immediately.
 */
export async function setJudgePin(
  competitionId: string, action: 'generate' | 'disable',
): Promise<{ enabled: boolean; pin?: string; updatedAt?: number }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const { ok, data } = await post('/api/judge/pin', { competitionId, action }, await user.getIdToken());
  if (!ok) throw new Error(String(data.detail || data.error || 'request failed'));
  return {
    enabled: data.enabled === true,
    pin: typeof data.pin === 'string' ? data.pin : undefined,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
  };
}

/** Why the active PIN can't be shown. */
export type PinRevealFailure = 'disabled' | 'legacy' | 'no-key' | 'undecryptable' | 'error';

/**
 * Admin: fetch the active PIN, decrypted on the server from its encrypted
 * copy. The server checks the caller is an admin; the browser never holds
 * the key.
 */
export async function revealJudgePin(
  competitionId: string,
): Promise<{ pin: string } | { pin: null; reason: PinRevealFailure }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const { ok, data } = await post('/api/judge/pin', { competitionId, action: 'reveal' }, await user.getIdToken());
  if (ok && typeof data.pin === 'string') return { pin: data.pin };
  const reason = data.reason;
  return {
    pin: null,
    reason: reason === 'disabled' || reason === 'legacy' || reason === 'no-key' || reason === 'undecryptable' ? reason : 'error',
  };
}

export type JudgeLoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'locked' | 'server'; retryAfterMs: number };

/** Judge: check the PIN on the server and, if right, sign in as a judge of
 *  that competition. Replaces whatever session this browser had. */
export async function judgeLogin(competitionId: string, pin: string): Promise<JudgeLoginResult> {
  const { ok, data } = await post('/api/judge/login', { competitionId, pin });
  if (!ok || typeof data.token !== 'string') {
    const reason = data.error === 'locked' ? 'locked' : data.error === 'invalid' || data.error === 'bad-request' ? 'invalid' : 'server';
    return { ok: false, reason, retryAfterMs: typeof data.retryAfterMs === 'number' ? data.retryAfterMs : 0 };
  }
  await signInWithCustomToken(auth, data.token);
  return { ok: true };
}

/** The current browser session as a judge, or null if it isn't one (signed
 *  out, a Google account, or a judge token past its 24 hours). */
export async function currentJudgeSession(): Promise<{ competitionId: string; validUntil: number } | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const { claims } = await user.getIdTokenResult();
  if (claims.role !== 'judge' || typeof claims.competitionId !== 'string') return null;
  const validUntil = typeof claims.validUntil === 'number' ? claims.validUntil : 0;
  return Date.now() < validUntil ? { competitionId: claims.competitionId, validUntil } : null;
}

export function judgeSignOut(): Promise<void> {
  return signOut(auth);
}
