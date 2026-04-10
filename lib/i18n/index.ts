// Single source of truth lives in LangContext.
// All existing imports from '@/lib/i18n' continue to work.
export type { Lang } from './LangContext';
export { useLang, LangProvider, tFor } from './LangContext';
export type { TranslationKey } from './en';
