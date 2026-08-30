import type { Metadata } from 'next';
import { Geologica, JetBrains_Mono } from 'next/font/google';
import { OnlineAuthProvider } from '@/lib/online-competition/useOnlineAuth';
import './theme.css';

// Deliberately distinct visual identity from the rest of the club site —
// this is a standalone public product, not a club sub-section. Fonts are
// self-hosted by Next at build time (next/font), so there's no runtime
// dependency on an external font CDN.
//
// Geologica (variable, weights 400–700 used) is the v2 design system's
// font for both headings (500–700, via font-medium/font-semibold/
// font-bold) and body copy (regular/400) — it replaced Manrope under the
// same `--oc-font-heading` CSS variable, so [competitionId]/page.tsx
// (not migrated to v2 yet) picks up the new heading font for free without
// any code change there. JetBrains Mono is unchanged — every numeric/
// timer/scramble/mono-label display, old and new, uses it.
const heading = Geologica({ subsets: ['latin'], weight: 'variable', variable: '--oc-font-heading' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--oc-font-mono' });

export const metadata: Metadata = {
  title: 'Онлайн тэмцээн',
  description: 'Нээлттэй онлайн шооны тэмцээн — камераар бичиж илгээнэ.',
};

export default function OnlineCompetitionLayout({ children }: { children: React.ReactNode }) {
  return (
    // No background/text color here on purpose — this wrapper is shared by
    // both the v2 admin dashboard (paper/ink tokens) and the not-yet-
    // migrated v1 [competitionId]/page.tsx (oc-bg/oc-text-primary tokens),
    // and previously hardcoded the v1 colors here, leaking a legacy-token
    // dependency into every v2 page's render tree even when it painted no
    // visible pixels (each page's own full-bleed wrapper already covers
    // it). Each route now sets its own bg/text explicitly instead.
    <div
      className={`oc-theme ${heading.variable} ${mono.variable} min-h-screen`}
      style={{ fontFamily: 'var(--oc-font-heading), system-ui, -apple-system, sans-serif', fontWeight: 400 }}
    >
      {/* Wraps admin routes too — harmless (nothing there calls
          useOnlineAuth()), and keeps this the one place that needs to
          know about the provider at all. */}
      <OnlineAuthProvider>{children}</OnlineAuthProvider>
    </div>
  );
}
