import type { Metadata } from 'next';
import './globals.css';
import { LangProvider } from '@/lib/i18n';
import { AuthProvider } from '@/lib/auth-context';
import ConditionalNavbar from '@/components/layout/ConditionalNavbar';
import ThemeProvider from '@/components/layout/ThemeProvider';

export const metadata: Metadata = {
  title: 'Mongolian Speedcubers',
  description:
    "Mongolia's competitive speedcubing community — competitions, live results, rankings, timer, algorithms, and more.",
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
          </LangProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
