'use client';

import { useState, useEffect } from 'react';
import type { Lang } from '@/lib/i18n';

const STORAGE_KEY = 'cubeLang';

export default function LangToggle() {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Lang) || 'en';
    setLangState(saved);
  }, []);

  function toggle(next: Lang) {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
    // Dispatch event so other components can react
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: next }));
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '7px',
        padding: '2px',
      }}
    >
      {(['en', 'mn'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => toggle(l)}
          style={{
            padding: '0.22rem 0.52rem',
            borderRadius: '5px',
            border: 'none',
            background: lang === l ? 'var(--accent)' : 'transparent',
            color: lang === l ? '#fff' : 'var(--muted)',
            fontSize: '0.75rem',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
