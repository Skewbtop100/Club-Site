import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

// The one signature visual motif of the online-competition feature: a
// rounded-square "cube sticker" tile with a subtle glossy top-light
// gradient and soft shadow. Used for status indicators, event/round tags,
// and (as StickerButton) the judge review actions — deliberately not used
// for every button in the app, so it stays a distinctive accent rather
// than the default button style.
export type StickerTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const TONE_COLOR: Record<StickerTone, string> = {
  neutral: 'var(--oc-surface-raised)',
  success: 'var(--oc-success)',
  warning: 'var(--oc-warning)',
  danger: 'var(--oc-danger)',
  accent: 'var(--oc-accent)',
};

const TONE_TEXT: Record<StickerTone, string> = {
  neutral: 'var(--oc-text-muted)',
  success: 'var(--oc-bg)',
  warning: 'var(--oc-bg)',
  danger: 'var(--oc-bg)',
  accent: 'var(--oc-bg)',
};

function stickerStyle(tone: StickerTone) {
  return {
    color: TONE_TEXT[tone],
    background: `linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 55%), ${TONE_COLOR[tone]}`,
    boxShadow: '0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
  };
}

// Padding as inline style, not Tailwind `px-*`/`py-*` classes — those are
// silently zeroed by app/globals.css's unlayered `*, *::before, *::after
// { margin: 0; padding: 0; }` reset, which always wins over Tailwind's
// layered utility classes regardless of specificity (CSS Cascade Layers:
// an unlayered rule beats any layered one). Inline styles always win
// regardless of layers, so that's what's used for spacing everywhere in
// this file.
const BASE_CLASSES = 'inline-flex items-center justify-center gap-1 rounded-xl font-semibold leading-none';
const SIZE_CLASSES = { sm: 'text-xs', md: 'text-sm' } as const;
const SIZE_PADDING = {
  sm: { paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6 }, // px-2.5 py-1.5
  md: { paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }, // px-4 py-3
} as const;

interface StickerTagProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StickerTone;
  size?: 'sm' | 'md';
  children: ReactNode;
}

/** Static sticker chip — status badges, event/round tags. Not interactive
 *  (renders a <span>, not a <button>), so it doesn't clutter tab order. */
export function StickerTag({ tone, size = 'sm', className = '', children, style, ...rest }: StickerTagProps) {
  return (
    <span
      className={`${BASE_CLASSES} ${SIZE_CLASSES[size]} ${className}`}
      style={{ ...stickerStyle(tone), ...SIZE_PADDING[size], ...style }}
      {...rest}
    >
      {children}
    </span>
  );
}

interface StickerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone: StickerTone;
  size?: 'sm' | 'md';
  children: ReactNode;
}

/** Interactive sticker chip — the judge review actions. Same visual
 *  language as StickerTag, but a real, focusable, disable-able <button>. */
export function StickerButton({ tone, size = 'md', className = '', children, style, ...rest }: StickerButtonProps) {
  return (
    <button
      type="button"
      className={`${BASE_CLASSES} ${SIZE_CLASSES[size]} transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--oc-text-primary)] ${className}`}
      style={{ ...stickerStyle(tone), ...SIZE_PADDING[size], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
