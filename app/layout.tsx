import type { Metadata } from 'next';
import './globals.css';
import ConditionalNavbar from '@/components/layout/ConditionalNavbar';
import ThemeProvider from '@/components/layout/ThemeProvider';

export const metadata: Metadata = {
  title: 'CUBE MN',
  description:
    "Official results, live standings, athlete rankings, and competition management for Mongolia's competitive speedcubing community.",
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
        <ConditionalNavbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
