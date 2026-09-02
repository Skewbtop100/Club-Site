'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type CurrentSection = 'competitions' | 'athletes' | 'settings' | 'detail';

// Persistent header across every admin page (competitions list, a
// competition's detail page, settings) — the home link, the "Тохиргоо"
// link, and "Гарах" all live here so they render identically regardless
// of which page is active. Replaces the old AdminTabs, which only ever
// switched between two tabs on a single flat page; now that the admin
// section has real separate routes, tab-switching moved to
// CompetitionDetail (which owns its own two tabs), and this component is
// just the shared chrome.
export default function AdminHeader({ current = 'competitions' }: { current?: CurrentSection }) {
  const router = useRouter();

  const handleLogout = useCallback(async () => {
    await fetch('/api/online-competition/admin-auth', { method: 'DELETE' });
    router.refresh();
  }, [router]);

  return (
    <div className="oc-tabs" style={{ marginBottom: 32 }}>
      {current === 'competitions' ? (
        <span className="oc-tab oc-tab-active">Тэмцээнүүд</span>
      ) : (
        <Link href="/online-competition/admin" className="oc-tab" style={{ textDecoration: 'none' }}>
          {current === 'detail' ? '← Тэмцээнүүд' : 'Тэмцээнүүд'}
        </Link>
      )}
      {current === 'athletes' ? (
        <span className="oc-tab oc-tab-active">Тамирчид</span>
      ) : (
        <Link href="/online-competition/admin/athletes" className="oc-tab" style={{ textDecoration: 'none' }}>
          Тамирчид
        </Link>
      )}
      {current === 'settings' ? (
        <span className="oc-tab oc-tab-active">Тохиргоо</span>
      ) : (
        <Link href="/online-competition/admin/settings" className="oc-tab" style={{ textDecoration: 'none' }}>
          Тохиргоо
        </Link>
      )}
      <button
        onClick={handleLogout}
        className="border border-[var(--color-border)] text-sm text-[var(--color-ink-soft)] transition hover:border-[var(--color-ink)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
        style={{
          borderRadius: 2,
          marginLeft: 'auto',
          alignSelf: 'center',
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        Гарах
      </button>
    </div>
  );
}
