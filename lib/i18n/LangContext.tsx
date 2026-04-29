'use client';

import {
  createContext, useContext, useState, useEffect, useCallback, type ReactNode,
} from 'react';
import en, { type TranslationKey } from './en';
import mn from './mn';

export type Lang = 'en' | 'mn';

const STORAGE_KEY = 'cubeLang';
const dicts: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, mn };

export function tFor(lang: Lang, key: TranslationKey): string {
  return dicts[lang]?.[key] ?? en[key] ?? key;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LangContext = createContext<LangCtx>({
  lang: 'en',
  setLang: () => {},
  t: (key) => en[key] ?? key,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Lang) || 'en';
    setLangState(saved);
  }, []);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  const t = useCallback((key: TranslationKey) => tFor(lang, key), [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  console.log('Current language:', ctx.lang);
  return ctx;
}
