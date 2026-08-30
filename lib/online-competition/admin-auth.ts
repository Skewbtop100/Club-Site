import { cookies } from 'next/headers';

// Server-only helpers for the online-competition referee dashboard's login
// gate. Deliberately NOT the club's Firebase-Auth-based admin system
// (app/admin/, useAdminAuth) — this is a single shared password behind an
// httpOnly cookie, good enough for a small pool of competition judges
// without wiring this public feature into club accounts.
export const ADMIN_COOKIE_NAME = 'online-comp-admin';
export const ADMIN_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

/** Server Components / Route Handlers only — reads the httpOnly cookie set
 *  by POST /api/online-competition/admin-auth. */
export async function isOnlineCompAdmin(): Promise<boolean> {
  const store = await cookies();
  return store.get(ADMIN_COOKIE_NAME)?.value === 'true';
}
