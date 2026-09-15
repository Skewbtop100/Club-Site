import { cookies } from 'next/headers';
import { ADMIN_SESSION_TTL_MS, adminSessionConfig, verifyAdminSession } from './admin-session';

// Server-only helpers for the online-competition referee dashboard's login
// gate. Deliberately NOT the club's Firebase-Auth-based admin system
// (app/admin/, useAdminAuth) — a single shared password, exchanged at
// POST /api/online-competition/admin-auth for a SIGNED, EXPIRING session
// token in an httpOnly cookie (see admin-session.ts for the token).
export const ADMIN_COOKIE_NAME = 'online-comp-admin';
export const ADMIN_COOKIE_MAX_AGE_SECONDS = ADMIN_SESSION_TTL_MS / 1000; // 12 hours

/** Server Components / Route Handlers only. THE one check every admin
 *  route and the admin page gate make.
 *
 *  FAILS CLOSED: with ONLINE_COMP_ADMIN_SESSION_SECRET or
 *  ONLINE_COMP_ADMIN_PASSWORD unset (or the secret too short) nothing is
 *  an admin, whatever cookie arrives. */
export async function isOnlineCompAdmin(): Promise<boolean> {
  const config = adminSessionConfig();
  if (!config) return false;
  const store = await cookies();
  return verifyAdminSession(store.get(ADMIN_COOKIE_NAME)?.value, config, Date.now());
}
