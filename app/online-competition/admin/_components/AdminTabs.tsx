'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import ReviewDashboard from './ReviewDashboard';
import CompetitionsTab from './CompetitionsTab';

type Tab = 'review' | 'competitions';

// Persistent header: the tab switcher AND the logout button both live here,
// rendered once regardless of which tab is active — previously "Гарах" was
// rendered inside ReviewDashboard itself, so switching to the
// "Тэмцээнүүд" tab (which mounts CompetitionsTab instead) lost it entirely.
export default function AdminTabs() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('review');

  const handleLogout = useCallback(async () => {
    await fetch('/api/online-competition/admin-auth', { method: 'DELETE' });
    router.refresh();
  }, [router]);

  return (
    <div>
      {/* mb-8 and the logout button's px-4/py-2 were Tailwind classes that
          app/globals.css's unlayered `* { margin: 0; padding: 0; }` reset
          silently zeroed (unlayered always beats Tailwind's layered
          utilities) — moved to inline style, which always wins regardless
          of layers. */}
      <div className="oc-tabs" style={{ marginBottom: 32 }}>
        <TabButton active={tab === 'review'} onClick={() => setTab('review')}>
          Шүүгчийн самбар
        </TabButton>
        <TabButton active={tab === 'competitions'} onClick={() => setTab('competitions')}>
          Тэмцээнүүд
        </TabButton>
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
      {tab === 'review' ? <ReviewDashboard /> : <CompetitionsTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`oc-tab${active ? ' oc-tab-active' : ''}`}>
      {children}
    </button>
  );
}
