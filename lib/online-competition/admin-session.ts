import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ── The judges' admin session ───────────────────────────────────────────
// Pure — Node crypto only, no Next, no Firestore — so every rule that
// decides "is this request an admin" is unit-tested directly
// (tests/competition-fields/admin-session.test.cjs). The cookie plumbing
// lives in admin-auth.ts and the login route; neither decides anything.
//
// WHAT THIS REPLACED: the cookie held the literal string 'true', and the
// check was `value === 'true'`. Anyone could set it in devtools and pass
// every admin route.
//
// ── THE TOKEN ──
//   v1.<expiresAtMs>.<nonce>.<hmac>
// HMAC-SHA256 over "v1.<expiresAtMs>.<nonce>", base64url. Stateless: any
// serverless instance verifies it from environment variables alone, with
// no session store to share between invocations.
//
// THE HMAC KEY IS DERIVED FROM THE SECRET *AND* THE PASSWORD. Rotating
// either invalidates every outstanding session — changing the judges'
// password logs everyone out, which is what someone changing a leaked
// password expects.
//
// WHAT IT CANNOT DO: revoke one session. Logout clears the browser's
// cookie; a copy of the token taken before then stays valid until it
// expires (ADMIN_SESSION_TTL_MS). Rotate the secret to kill them all.

/** The signing secret. Must be set, and at least MIN_SESSION_SECRET_LENGTH
 *  characters — otherwise no session can be issued or accepted. */
export const ADMIN_SESSION_SECRET_ENV = 'ONLINE_COMP_ADMIN_SESSION_SECRET';
/** The judges' shared password (already in use before this module). */
export const ADMIN_PASSWORD_ENV = 'ONLINE_COMP_ADMIN_PASSWORD';

export const MIN_SESSION_SECRET_LENGTH = 32;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Tolerated clock difference between the instance that signed a token
 *  and the one verifying it. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const VERSION = 'v1';
// 13-15 digit ms timestamp, 16 random bytes (22 base64url chars), 32-byte
// HMAC (43 base64url chars). Anything else is not a token this issued.
const TOKEN_RE = /^v1\.(\d{13,15})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

/** The admin cookie's attributes, for setting AND clearing it.
 *  httpOnly: no script can read it. secure: never sent over plain HTTP.
 *  sameSite strict: never sent on a request another site initiates. */
export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
};

export interface AdminSessionConfig {
  /** Derived signing key. Never the secret or the password themselves. */
  readonly key: Buffer;
}

/** The signing configuration, or null when it is not usable.
 *
 *  FAILS CLOSED. A missing or short secret, or a missing password, returns
 *  null — and null means no session is issued (the login route answers
 *  500) and no cookie is accepted (isOnlineCompAdmin answers false). There
 *  is no fallback key. */
export function adminSessionConfig(env: Record<string, string | undefined> = process.env): AdminSessionConfig | null {
  const secret = env[ADMIN_SESSION_SECRET_ENV];
  const password = env[ADMIN_PASSWORD_ENV];
  if (typeof secret !== 'string' || secret.length < MIN_SESSION_SECRET_LENGTH) return null;
  if (typeof password !== 'string' || password.length === 0) return null;
  const key = createHmac('sha256', secret)
    .update(`online-comp-admin-session:${VERSION}:`)
    .update(password, 'utf8')
    .digest();
  return { key };
}

function mac(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** A new session token, valid for `ttlMs` from `nowMs`. */
export function signAdminSession(config: AdminSessionConfig, nowMs: number, ttlMs: number = ADMIN_SESSION_TTL_MS): string {
  const expiresAt = Math.floor(nowMs + ttlMs);
  const nonce = randomBytes(16).toString('base64url');
  const payload = `${VERSION}.${expiresAt}.${nonce}`;
  return `${payload}.${mac(config.key, payload)}`;
}

/** Whether `token` is a genuine, unexpired session.
 *
 *  Rejects, in order: no usable config; anything that is not the token
 *  shape (including the old literal 'true'); a signature that does not
 *  match (compared in constant time); an expiry at or before now; and an
 *  expiry further out than this server ever issues. */
export function verifyAdminSession(token: unknown, config: AdminSessionConfig | null, nowMs: number): boolean {
  if (!config || typeof token !== 'string' || token.length > 128) return false;
  const m = TOKEN_RE.exec(token);
  if (!m) return false;

  const expected = Buffer.from(mac(config.key, `${VERSION}.${m[1]}.${m[2]}`), 'utf8');
  const given = Buffer.from(m[3], 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

  const expiresAt = Number(m[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) return false;
  if (expiresAt - nowMs > ADMIN_SESSION_TTL_MS + CLOCK_SKEW_MS) return false;
  return true;
}

/** Constant-time password check.
 *
 *  Both sides are hashed to 32 bytes first, so timingSafeEqual always
 *  compares equal-length buffers and the comparison time does not depend
 *  on how much of the password was right — or on its length. */
export function passwordMatches(given: unknown, expected: string | undefined): boolean {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  if (given.length > 1024) return false;
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
