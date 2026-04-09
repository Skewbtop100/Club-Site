export type Theme = 'dark' | 'soft-light' | 'purple-light';

export const THEMES: Theme[] = ['dark', 'soft-light', 'purple-light'];

export const THEME_LABELS: Record<Theme, string> = {
  dark: '🌑 Dark',
  'soft-light': '☀ Light',
  'purple-light': '💜 Purple',
};

export const STORAGE_KEY = 'cubeTheme';
export const DEFAULT_THEME: Theme = 'dark';
