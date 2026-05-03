'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLang, type TranslationKey } from '@/lib/i18n';

export interface SectionTab {
  id: string;
  labelKey: TranslationKey;
  render: () => React.ReactNode;
}

export default function SectionTabs({
  tabs,
  initialTabId,
}: {
  tabs: SectionTab[];
  initialTabId?: string;
}) {
  const { t } = useLang();
  const [activeId, setActiveId] = useState<string>(
    initialTabId && tabs.some(tab => tab.id === initialTabId) ? initialTabId : tabs[0].id,
  );
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0];

  return (
    <div style={{
      maxWidth: 1380, margin: '0 auto',
      padding: '1.5rem 1rem',
    }}>
      <div style={{ marginBottom: '0.85rem' }}>
        <Link
          href="/admin/dashboard"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            fontSize: '0.78rem', color: 'var(--muted)',
            textDecoration: 'none', fontWeight: 600,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
        >
          ← Хяналтын самбар руу буцах
        </Link>
      </div>

      <div className="tab-nav" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn${activeId === tab.id ? ' active' : ''}`}
            onClick={() => setActiveId(tab.id)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {active.render()}

      <style>{`
        @media (max-width: 700px) {
          .tab-nav { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          .tab-nav::-webkit-scrollbar { display: none; }
          .tab-btn { flex-shrink: 0; font-size: 0.75rem; padding: 0.38rem 0.7rem; }
        }
      `}</style>
    </div>
  );
}
