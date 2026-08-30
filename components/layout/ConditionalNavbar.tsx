'use client';

import { usePathname } from 'next/navigation';
import Navbar from './Navbar';

const PORTAL_PATHS = ['/login', '/dashboard', '/admin', '/timer', '/dev', '/online-competition'];

export default function ConditionalNavbar({ forceHidden = false }: { forceHidden?: boolean }) {
  const pathname = usePathname();
  const isPortal = PORTAL_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  // forceHidden covers the comp.mongolshoochid.com subdomain: middleware.ts
  // rewrites the path server-side, but usePathname() still reports the
  // pre-rewrite URL (the browser bar never changes), so the pathname check
  // above can't see it — app/layout.tsx derives forceHidden from a request
  // header set only in that rewrite branch instead.
  if (isPortal || forceHidden) return null;

  return (
    <>
      <Navbar />
      <div style={{ height: '60px' }} />
    </>
  );
}
