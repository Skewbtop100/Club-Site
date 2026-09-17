import type { Metadata, Viewport } from 'next';
import './globals.css';
import '@cubing/icons/css';
import { LangProvider } from '@/lib/i18n';
import { AuthProvider } from '@/lib/auth-context';
import { ToastHost } from '@/lib/toast';
import ConditionalNavbar from '@/components/layout/ConditionalNavbar';
import ThemeProvider from '@/components/layout/ThemeProvider';

export const metadata: Metadata = {
  title: 'Mongolian Speedcubers',
  description:
    "Mongolia's competitive speedcubing community — competitions, live results, rankings, timer, algorithms, and more.",
  // Site-wide install manifest — distinct from /timer's own scoped manifest
  // (app/timer/layout.tsx sets its own `manifest`, which overrides this for
  // that subtree). Favicon + apple-touch-icon come from the app/icon.png and
  // app/apple-icon.png file conventions instead of being declared here.
  manifest: '/site-manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#080810',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Inline script prevents flash of wrong theme before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('cubeTheme')||'dark';document.documentElement.setAttribute('data-theme',t);})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider />
        <AuthProvider>
          <LangProvider>
            <ConditionalNavbar />
            <main>{children}</main>
            <ToastHost />
          </LangProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
