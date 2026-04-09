'use client';

import { useState, useEffect } from 'react';
import { THEMES, THEME_LABELS, STORAGE_KEY, DEFAULT_THEME, type Theme } from '@/lib/theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme) || DEFAULT_THEME;
    setTheme(saved);
  }, []);

  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }

  return (
    <button
      onClick={cycleTheme}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--muted)',
        fontSize: '0.77rem',
        fontWeight: 500,
        fontFamily: 'inherit',
        padding: '0.2rem 0.3rem',
        borderRadius: '6px',
        transition: 'color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {THEME_LABELS[theme]}
    </button>
  );
}
