import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ── v2 design system primitives (warm paper / ink / volt) ───────────────
// Used by the admin dashboard. Deliberately separate from StickerChip.tsx
// (the v1 dark-violet system), which app/online-competition/[competitionId]
// /page.tsx still depends on and hasn't been migrated to v2 yet.
//
// Colors/sizes here are an EXACT literal port of the approved Claude
// Design mockup — see the comment block at the top of theme.css for why
// they're hardcoded rather than derived from the --color-* token block.

// ── Badge ────────────────────────────────────────────────────────────────

export interface BadgeSpec {
  borderColor: string;
  background: string;
  color: string;
  /** Renders an 8x8px solid square swatch before the label — the judge
   *  "pending" status badge in the mockup uses this instead of a filled
   *  background. */
  dotColor?: string;
  /** Exact literal padding for this usage — the mockup gives two padding
   *  values (5px 7px / 7px 10px) for different badge contexts. Defaults
   *  to the roomier one. */
  padding?: string;
}

/** Status badge/chip — component pattern 1 of the v2 system. Every color
 *  triple is supplied by the caller (CompetitionsList, ReviewDashboard) as
 *  an exact literal value from the mockup spec — this component only
 *  renders the shared shape/typography, it doesn't own a tone lookup. */
export function Badge({ borderColor, background, color, dotColor, padding = '7px 10px', children }: BadgeSpec & { children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        border: `1px solid ${borderColor}`,
        background,
        color,
        padding,
        borderRadius: 2,
        font: `500 9px var(--oc-font-mono), monospace`,
        letterSpacing: '.1em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {dotColor && (
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            background: dotColor,
            marginRight: 6,
            verticalAlign: 'middle',
          }}
        />
      )}
      {children}
    </span>
  );
}

// ── Button ───────────────────────────────────────────────────────────────

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'primary-dark' | 'outline';
}

const VARIANT_CLASS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'oc-btn-primary',
  'primary-dark': 'oc-btn-primary-dark',
  outline: 'oc-btn-outline',
};

/** Primary (volt) / primary-dark (full-width, login) / outline button —
 *  component pattern 4 of the v2 system. Styled via plain CSS classes
 *  (.oc-btn* in theme.css), not Tailwind utility classes assembled from a
 *  variant ternary — several states need real `:hover`/`:active` CSS
 *  rules that inline styles can't express. */
export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return <button className={`oc-btn ${VARIANT_CLASS[variant]} ${className}`} {...rest} />;
}

// ── Square toggle (checkbox-as-square) ────────────────────────────────────

/** "Хязгааргүй"-style toggle — component pattern 6 of the v2 system. A
 *  button, not a native checkbox, so it can sit inline with a label and
 *  match the square-badge visual language exactly. */
export function SquareToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="oc-square-toggle">
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          flexShrink: 0,
          borderRadius: 2,
          border: checked ? '1px solid #16140F' : '1px solid #A9A392',
          background: checked ? '#DFFF4F' : 'transparent',
        }}
      />
      <span>{label}</span>
    </button>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

/** Cube-motif empty state — component pattern 3 of the v2 system. */
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="oc-empty">
      <div className="oc-empty-icon" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="oc-empty-icon-cell" />
        ))}
      </div>
      <p className="oc-empty-text">{text}</p>
    </div>
  );
}

// ── Field label ──────────────────────────────────────────────────────────

/** 9px mono uppercase label used above every form field. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="oc-field-label">{children}</span>;
}

export const INPUT_CLASS = 'oc-input';
export const MONO_INPUT_CLASS = 'oc-input oc-input-mono';
export const SELECT_CLASS = 'oc-input oc-input-select';
