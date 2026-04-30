import type { Metadata, Viewport } from 'next';
import RegisterSW from './RegisterSW';

export const metadata: Metadata = {
  title: 'Precision Velocity Timer',
  description: 'WCA Speedcubing Timer',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PV Timer',
  },
  // `mobile-web-app-capable` is the legacy/Android counterpart of the
  // Apple meta. Next.js doesn't expose a dedicated field, so emit it via
  // the `other` escape hatch.
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#A78BFA',
  width: 'device-width',
  initialScale: 1,
  // viewportFit: cover lets us draw under the iPhone notch / home indicator
  // and respect those areas via env(safe-area-inset-*) in the page CSS.
  viewportFit: 'cover',
};

export default function TimerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RegisterSW />
      {children}
    </>
  );
}
