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

  // usePathname() on the client still reports the pre-rewrite URL (the
  // browser bar never changes), so anything deciding UI based on "are we
  // in the online-competition feature" from a client component can't rely
  // on pathname alone here — this header lets server components detect the
  // subdomain directly. See ConditionalNavbar/app/layout.tsx.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-online-competition-host', '1');

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? COMPETITION_PREFIX : `${COMPETITION_PREFIX}${pathname}`;
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
