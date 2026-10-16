'use client';

// Small monochrome UI kit for /timer/challenge/** — the same tokens as the
// timer's default theme (app/timer/page.tsx THEMES.black). Colour only for
// semantics (success / danger); no chevrons on popup triggers.
import Link from 'next/link';
import { useState } from 'react';

export const T = {
  bg:       '#0B0B0C',
  card:     '#141416',
  cardAlt:  '#1C1C1F',
  border:   '#232326',
  borderHi: '#3A3A3F',
  text:     '#EDEDED',
  muted:    '#8B8B90',
  dim:      '#848489',
  success:  '#34D399',
  danger:   '#E5484D',
} as const;
export const RADIUS = 10;
export const RADIUS_SM = 8;
export const MONO = '"JetBrains Mono", "Fira Code", ui-monospace, monospace';

export function PageShell({ title, back, children }: { title: string; back: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100dvh', background: T.bg, color: T.text, padding: '1rem 1rem 3rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <Link href={back.href} style={{ color: T.muted, fontSize: '0.85rem', textDecoration: 'none', alignSelf: 'flex-start', padding: '0.25rem 0' }}>
          ← {back.label}
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 600 }}>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Card({ title, children, testId }: { title?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS,
      padding: '0.95rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', minWidth: 0,
    }}>
      {title && <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{title}</h2>}
      {children}
    </section>
  );
}

type ButtonKind = 'primary' | 'plain' | 'danger';
export function Button({ kind = 'primary', disabled, onClick, children, type = 'button', ariaLabel }: {
  kind?: ButtonKind; disabled?: boolean; onClick?: () => void; children: React.ReactNode;
  type?: 'button' | 'submit'; ariaLabel?: string;
}) {
  const [hover, setHover] = useState(false);
  const base: React.CSSProperties = {
    border: 'none', borderRadius: RADIUS, padding: '0.5rem 0.95rem',
    fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    whiteSpace: 'nowrap', transition: 'background 0.15s ease',
  };
  const look: React.CSSProperties =
    kind === 'primary' ? { background: hover && !disabled ? T.border : T.cardAlt, color: T.text }
    : kind === 'danger' ? { background: hover && !disabled ? T.cardAlt : 'transparent', color: T.danger }
    : { background: hover && !disabled ? T.cardAlt : 'transparent', color: T.muted };
  return (
    <button
      type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...base, ...look }}
    >{children}</button>
  );
}

export function TextInput({ value, onChange, placeholder, label, mono, maxLength, id }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string;
  mono?: boolean; maxLength?: number; id: string;
}) {
  return (
    <input
      id={id} aria-label={label} value={value} placeholder={placeholder} maxLength={maxLength}
      autoComplete="off" spellCheck={false}
      onChange={e => onChange(e.target.value)}
      style={{
        flex: '1 1 auto', minWidth: 0,
        background: T.bg, color: T.text,
        border: `1px solid ${T.borderHi}`, borderRadius: RADIUS_SM,
        padding: '0.5rem 0.7rem', outline: 'none',
        fontFamily: mono ? MONO : 'inherit', fontSize: mono ? '1rem' : '0.9rem',
        letterSpacing: mono ? '0.18em' : undefined,
      }}
    />
  );
}

export function Avatar({ name, url, size = 32 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (name.trim().codePointAt(0) ? String.fromCodePoint(name.trim().codePointAt(0)!) : '?').toUpperCase();
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: T.cardAlt, color: T.text, fontSize: size * 0.42, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : initial}
    </span>
  );
}

export function StatusChip({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'text' | 'dim' }) {
  return (
    <span style={{
      flexShrink: 0, padding: '0.12rem 0.5rem', borderRadius: RADIUS_SM,
      background: T.cardAlt, color: tone === 'text' ? T.text : tone === 'dim' ? T.dim : T.muted,
      fontSize: '0.72rem', fontWeight: 500, whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

export function Note({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'success' | 'danger' }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} style={{
      fontSize: '0.82rem', lineHeight: 1.45,
      color: tone === 'success' ? T.success : tone === 'danger' ? T.danger : T.muted,
    }}>{text}</div>
  );
}

export function Row({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{
      display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0,
      padding: '0.5rem 0', borderTop: `1px solid ${T.border}`,
    }}>{children}</div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: T.muted, fontSize: '0.8rem' }}>{children}</span>;
}
