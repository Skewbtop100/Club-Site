'use client';

import { useEffect } from 'react';
import { STORAGE_KEY, DEFAULT_THEME, type Theme } from '@/lib/theme';

/** Reads the saved theme from localStorage and applies it to <html data-theme>. */
export default function ThemeProvider() {
  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme) || DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  return null;
}
