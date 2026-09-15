import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

// ── Rate limit on the judges' login ─────────────────────────────────────
// Server-only. The decision (decideLoginAttempt) and the address handling
// are pure and unit-tested (tests/competition-fields/admin-session.test.cjs);
// the Firestore transaction around them is the only stateful part.
//
// WHY FIRESTORE: a counter in module memory lives in one serverless
// instance and dies with it — Vercel runs many instances and recycles them,
// so an in-memory limit would reset between invocations and protect
// nothing. The counter lives in onlineAdminLoginAttempts/{hashed address},
// written only with the Admin SDK (firestore.rules denies every client),
// inside a transaction, so parallel requests cannot all slip under it.
//
// WHAT IT COUNTS: every attempt from one address, successful or not,
// reserved BEFORE the password is compared. A correct password clears the
// counter. Denied attempts do not extend the window, so a lockout ends.
//
// WHAT IT DOES NOT STOP: an attacker spreading guesses over many
// addresses. It is per address (IPv6 per /64) with deliberately NO global
// cap — a global cap would let anyone lock the judges out mid-competition
// by failing five logins. The password's strength is still what stands
// between a distributed attacker and the dashboard.

export const LOGIN_ATTEMPTS_COLLECTION = 'onlineAdminLoginAttempts';
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface AttemptWindow {
  count: number;
  windowStartMs: number;
}

export interface AttemptDecision {
  allowed: boolean;
  /** The window to store (only written when allowed). */
  next: AttemptWindow;
  /** When denied: how long until the window ends. 0 when allowed. */
  retryAfterMs: number;
}

/** Fixed window: up to `max` attempts per `windowMs`, starting at the first
 *  attempt. */
export function decideLoginAttempt(
  prev: AttemptWindow | null,
  nowMs: number,
  max: number = LOGIN_MAX_ATTEMPTS,
  windowMs: number = LOGIN_WINDOW_MS,
): AttemptDecision {
  const usable =
    prev !== null && Number.isFinite(prev.count) && prev.count >= 0 && Number.isFinite(prev.windowStartMs);
  const expired = !usable || nowMs - prev!.windowStartMs >= windowMs;
  const current: AttemptWindow = expired ? { count: 0, windowStartMs: nowMs } : prev!;
  if (current.count >= max) {
    return { allowed: false, next: current, retryAfterMs: Math.max(0, current.windowStartMs + windowMs - nowMs) };
  }
  return { allowed: true, next: { count: current.count + 1, windowStartMs: current.windowStartMs }, retryAfterMs: 0 };
}

/** The requester's address, as the bucket key.
 *
 *  On Vercel, x-real-ip and x-forwarded-for are set by Vercel's own edge
 *  from the connecting client, not passed through from the request. A
 *  request with neither (local dev) lands in one shared 'unknown' bucket. */
export function clientAddress(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return normalizeAddress(real || forwarded || '');
}

/** IPv4 as-is; IPv4-mapped IPv6 as its IPv4; IPv6 reduced to its /64, so
 *  rotating through one customer allocation is one bucket. Anything
 *  unparseable is 'unknown'. */
export function normalizeAddress(raw: string): string {
  const ip = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  const groups = expandIPv6(ip);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : 'unknown';
}

function expandIPv6(ip: string): string[] | null {
  if (!ip.includes(':')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}

/** The document id for an address: hashed, so no raw IP is stored. */
export function attemptDocId(address: string): string {
  return createHash('sha256').update(`online-comp-admin-login:${address}`).digest('hex');
}

/** Reserves one attempt for this address, atomically. Throws if Firestore
 *  cannot be reached — the caller must treat that as a refusal. */
export async function reserveLoginAttempt(db: Firestore, address: string, nowMs: number): Promise<AttemptDecision> {
  const ref = db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(attemptDocId(address));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists
      ? { count: Number(snap.get('count')), windowStartMs: Number(snap.get('windowStartMs')) }
      : null;
    const decision = decideLoginAttempt(prev, nowMs);
    if (decision.allowed) {
      tx.set(ref, {
        count: decision.next.count,
        windowStartMs: decision.next.windowStartMs,
        // For an optional Firestore TTL policy on this field; nothing reads it.
        expiresAt: new Date(decision.next.windowStartMs + LOGIN_WINDOW_MS),
      });
    }
    return decision;
  });
}

/** After a correct password: this address starts from zero again. */
export async function clearLoginAttempts(db: Firestore, address: string): Promise<void> {
  await db.collection(LOGIN_ATTEMPTS_COLLECTION).doc(attemptDocId(address)).delete();
}
