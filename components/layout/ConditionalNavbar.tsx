'use client';

import { usePathname } from 'next/navigation';
import Navbar from './Navbar';

const PORTAL_PATHS = ['/login', '/dashboard', '/admin'];

export default function ConditionalNavbar() {
  const pathname = usePathname();
  const isPortal = PORTAL_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  if (isPortal) return null;

  return (
    <>
      <Navbar />
      <div style={{ height: '60px' }} />
    </>
  );
}
