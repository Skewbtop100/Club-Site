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
  // Disable the OS-level "smart" auto-linking pass that turns numbers,
  // dates and addresses into tappable links. On the timer page this
  // surfaced as Android's text-selection / Circle-to-Search popup
  // appearing when users long-pressed during a solve. Scoped to the
  // timer subtree via this layout so /community, /admin etc. still get
  // normal autolinking.
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
    url: false,
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
  // Pinch-zoom is hostile to a stopwatch UI: an accidental two-finger
  // touch during a solve scales the page and breaks the tap-to-arm
  // gesture. Lock all three scaling fields — Safari iOS in particular
  // ignores `userScalable: false` unless `minimumScale` is also set, so
  // we set both bounds to 1.
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  // viewportFit: cover lets us draw under the iPhone notch / home indicator
  // and respect those areas via env(safe-area-inset-*) in the page CSS.
  viewportFit: 'cover',
};

export default function TimerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RegisterSW />
      {/* Page-scoped lockdown for selection / long-press behaviours that
          interrupt solving on Android (Circle to Search, the text-
          selection magnifier, the share/copy callout) and on iOS (the
          long-press magnifier). Lives in the timer layout so the rules
          only apply under /timer/* — /community, /admin, /competition
          all need normal selection. The !important is necessary because
          the inline userSelect: 'none' guards we already had on the
          timer / scramble / action surfaces were being overridden by
          stubborn Android browser defaults.

          The .pv-scramble-text exception re-enables selection on the
          move sequence so users can still copy the scramble. Inputs,
          textareas and contenteditable nodes (the comment editor, the
          manual-time input) likewise opt back in. */}
      <style>{`
        /* Belt-and-suspenders pinch-zoom kill: the viewport meta export
           above already says no, but Android Chrome occasionally still
           honours pinch on elements that opt into touch-action: auto.
           Setting touch-action: manipulation on html/body and on the
           timer-page wrapper guarantees only tap + scroll gestures are
           recognised; double-tap-to-zoom and pinch are dropped. */
        html, body {
          touch-action: manipulation;
          -ms-touch-action: manipulation;
        }
        .timer-page {
          touch-action: manipulation;
          -ms-touch-action: manipulation;
          /* Stop the URL-bar bounce / chained scroll from leaving the
             timer wrapper and refreshing the page on iOS / Chrome. */
          overscroll-behavior: contain;
        }
        .timer-page,
        .timer-page * {
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
          -ms-user-select: none !important;
          user-select: none !important;
          -webkit-touch-callout: none !important;
          -webkit-tap-highlight-color: transparent !important;
        }
        .timer-page input,
        .timer-page textarea,
        .timer-page [contenteditable="true"],
        .timer-page .pv-scramble-text {
          -webkit-user-select: text !important;
          -moz-user-select: text !important;
          -ms-user-select: text !important;
          user-select: text !important;
          -webkit-touch-callout: default !important;
        }
      `}</style>
      {children}
    </>
  );
}
