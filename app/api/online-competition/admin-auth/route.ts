import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_MAX_AGE_SECONDS, ADMIN_COOKIE_NAME } from '@/lib/online-competition/admin-auth';

// Simple single-password gate for the online-competition referee dashboard
// — deliberately not the club's Firebase-Auth admin system. The password
// itself lives only in the server-only ONLINE_COMP_ADMIN_PASSWORD env var
// (never NEXT_PUBLIC_*), so it's never shipped to the client bundle.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  const expected = process.env.ONLINE_COMP_ADMIN_PASSWORD;

  if (!expected) {
    return NextResponse.json({ error: 'Сервер тохиргоо дутуу байна' }, { status: 500 });
  }
  if (typeof body?.password !== 'string' || body.password !== expected) {
    return NextResponse.json({ error: 'Нууц үг буруу байна' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, 'true', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  return res;
}

// Logout — clears the admin cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, '', { maxAge: 0, path: '/' });
  return res;
}
