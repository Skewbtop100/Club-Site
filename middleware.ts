import { NextRequest, NextResponse } from 'next/server';

// comp.mongolshoochid.com serves the online-competition feature at the
// site root (transparent rewrite, URL bar stays clean). Every other host
// (mongolshoochid.com, Vercel preview URLs, plain localhost) is untouched,
// so /online-competition/* keeps working there as the direct/testing path.
// "comp." (not the exact prod hostname) so preview/local Host-header
// testing works the same way.
const COMPETITION_PREFIX = '/online-competition';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';

  if (!hostname.includes('comp.')) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith(COMPETITION_PREFIX)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? COMPETITION_PREFIX : `${COMPETITION_PREFIX}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
