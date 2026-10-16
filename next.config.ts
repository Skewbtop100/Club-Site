import type { NextConfig } from 'next';

// ХОРОМ (the online competition) moved to its own site. Old links to
// /online-competition and anything under it go there permanently, keeping
// the rest of the path and the query string.
const KHOROM = 'https://comp.mongolshoochid.com';

const nextConfig: NextConfig = {
  // Normally .next. tests/e2e/emulator-guard.mjs builds into a separate
  // directory so its deliberately-flagged production build never replaces
  // the real one.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async redirects() {
    return [
      { source: '/online-competition', destination: `${KHOROM}/`, permanent: true },
      { source: '/online-competition/:path*', destination: `${KHOROM}/:path*`, permanent: true },
    ];
  },
};

export default nextConfig;
