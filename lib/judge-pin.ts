// Judge PIN: generation, hashing, verification and the brute-force lockout
// arithmetic. Server-side only (node:crypto) — used by app/api/judge/*.
// Pure apart from the random source, and imported relatively so
// scripts/test-judge.ts can compile it standalone.

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

export const PIN_LENGTH = 6;

/** A judge session (custom token) is good for this long after PIN login. */
export const JUDGE_SESSION_MS = 24 * 60 * 60 * 1000;

/** Wrong tries one client (IP) gets per competition before it is locked. */
export const CLIENT_MAX_FAILURES = 5;
/** Wrong tries a competition takes from ALL clients together before PIN
 *  login is locked for it — a 6-digit PIN is only 1,000,000 guesses, so a
 *  per-client limit alone can be beaten from many addresses. */
export const COMPETITION_MAX_FAILURES = 30;
/** Failures are counted within, and a lock lasts, this long. */
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

/** Uniformly random 6-digit PIN, leading zeros kept ("004217"). */
export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}

export function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

/** Random id stamped on the stored PIN and on every token issued for it;
 *  regenerating or disabling the PIN changes it, which is what revokes the
 *  sessions already out there (firestore.rules compares the two). */
export function generateVersion(): string {
  return randomBytes(12).toString('hex');
}

export function isPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/**
 * scrypt hash of a PIN. `salt` is stored next to the hash; `pepper` is a
 * server secret (JUDGE_PIN_PEPPER) that is NOT stored in the database — with
 * only a million possible PINs, a leaked hash + salt alone would fall to
 * brute force in seconds, the pepper is what prevents that.
 */
export function hashPin(pin: string, salt: string, pepper: string): string {
  return scryptSync(`${pepper}:${pin}`, salt, 32).toString('hex');
}

/** Constant-time check of a PIN against a stored hash. */
export function verifyPin(pin: string, salt: string, pepper: string, expectedHash: string): boolean {
  if (!isPinFormat(pin) || !salt || !expectedHash) return false;
  const actual = Buffer.from(hashPin(pin, salt, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── lockout ──────────────────────────────────────────────────────────────────

/** Stored per competition+client, and once per competition for all clients. */
export interface LockState {
  /** Times (epoch ms) of recent wrong tries, oldest first. */
  failures: number[];
  /** Locked until this time (epoch ms); absent/0 = not locked. */
  lockedUntil?: number;
}

/** Milliseconds left on a lock, 0 when not locked. */
export function lockRemainingMs(state: LockState | undefined, now: number): number {
  return Math.max(0, (state?.lockedUntil ?? 0) - now);
}

/**
 * Record one wrong try. Failures older than the window are forgotten; on the
 * `maxFailures`-th failure inside the window the state is locked for the
 * window and the counter starts over (so after the lock a client gets a
 * fresh `maxFailures` tries, not a lock on its very next mistake).
 */
export function registerFailure(
  state: LockState | undefined,
  now: number,
  maxFailures: number,
  windowMs: number = LOCK_WINDOW_MS,
): LockState {
  const recent = (state?.failures ?? []).filter(t => now - t < windowMs);
  recent.push(now);
  if (recent.length >= maxFailures) return { failures: [], lockedUntil: now + windowMs };
  return { failures: recent, ...(lockRemainingMs(state, now) > 0 ? { lockedUntil: state!.lockedUntil } : {}) };
}
