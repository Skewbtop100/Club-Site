import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_MAX_AGE_SECONDS, ADMIN_COOKIE_NAME } from '@/lib/online-competition/admin-auth';
import {
  ADMIN_COOKIE_OPTIONS,
  ADMIN_PASSWORD_ENV,
  ADMIN_SESSION_SECRET_ENV,
  MIN_SESSION_SECRET_LENGTH,
  adminSessionConfig,
  passwordMatches,
  signAdminSession,
} from '@/lib/online-competition/admin-session';
import { clearLoginAttempts, clientAddress, reserveLoginAttempt } from '@/lib/online-competition/admin-login-limit';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';

// node:crypto and firebase-admin do not run on edge.
export const runtime = 'nodejs';

// The judges' login: the shared password (ONLINE_COMP_ADMIN_PASSWORD,
// server-only) in, a signed session token out — see admin-session.ts.
//
// ORDER MATTERS, and every step fails closed:
//   1. no usable signing config  -> 500, nothing issued
//   2. reserve a rate-limit slot -> 429 when used up, 503 if Firestore
//                                   cannot be reached (never "let it through")
//   3. compare the password in constant time -> 401 on mismatch
//   4. issue the token, clear this address's counter
export async function POST(req: Request) {
  const config = adminSessionConfig();
  if (!config) {
    console.error(
      `admin-auth: refusing login — ${ADMIN_SESSION_SECRET_ENV} must be set (at least ` +
        `${MIN_SESSION_SECRET_LENGTH} characters) and ${ADMIN_PASSWORD_ENV} must be set.`,
    );
    return NextResponse.json({ error: 'Сервер тохиргоо дутуу байна' }, { status: 500 });
  }

  const db = getOnlineCompAdminDb();
  const address = clientAddress(req.headers);
  let decision;
  try {
    decision = await reserveLoginAttempt(db, address, Date.now());
  } catch (e) {
    console.error('admin-auth: rate-limit check failed, refusing login:', e);
    return NextResponse.json(
      { error: 'Нэвтрэх боломжгүй байна. Түр хүлээгээд дахин оролдоно уу.' },
      { status: 503 },
    );
  }
  if (!decision.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    return NextResponse.json(
      { error: `Хэт олон оролдлого. ${Math.ceil(retryAfterSeconds / 60)} минутын дараа дахин оролдоно уу.` },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  if (!passwordMatches(body?.password, process.env[ADMIN_PASSWORD_ENV])) {
    return NextResponse.json({ error: 'Нууц үг буруу байна' }, { status: 401 });
  }

  try {
    await clearLoginAttempts(db, address);
  } catch (e) {
    // The login itself is valid; a stale counter only costs this address
    // attempts until its window ends.
    console.error('admin-auth: clearing the login counter failed:', e);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, signAdminSession(config, Date.now()), {
    ...ADMIN_COOKIE_OPTIONS,
    maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

// Logout — clears the admin cookie, with the same attributes it was set
// with. This cannot revoke a token copied before logout; it expires on its
// own, or immediately for everyone when the secret or password is rotated.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, '', { ...ADMIN_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
