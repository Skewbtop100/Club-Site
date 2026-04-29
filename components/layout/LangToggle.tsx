'use client';

import { useLang, type Lang } from '@/lib/i18n';

export default function LangToggle() {
  const { lang, setLang } = useLang();

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
          onClick={() => {
            console.log('Language changed to:', l);
            setLang(l);
          }}
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
