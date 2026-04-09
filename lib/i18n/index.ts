'use client';

import { useState, useEffect, useCallback } from 'react';
import en, { type TranslationKey } from './en';
import mn from './mn';

const STORAGE_KEY = 'cubeLang';
export type Lang = 'en' | 'mn';

const dicts: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, mn };

/** Translate a key for the given language, falling back to English. */
export function tFor(lang: Lang, key: TranslationKey): string {
  return dicts[lang]?.[key] ?? en[key] ?? key;
}

/** Hook: current lang + setter + t() bound to current lang. */
export function useLang() {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Lang) || 'en';
    setLangState(saved);
  }, []);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey) => tFor(lang, key),
    [lang],
  );

  return { lang, setLang, t };
}
