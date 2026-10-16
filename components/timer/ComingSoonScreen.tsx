import Link from 'next/link';

// Monochrome tokens from the timer restyle (see app/timer/page.tsx THEMES.black).
const T = {
  bg:       '#0B0B0C',
  card:     '#141416',
  cardAlt:  '#1C1C1F',
  border:   '#232326',
  text:     '#EDEDED',
  muted:    '#8B8B90',
} as const;

/** Full-screen "Удахгүй" placeholder for timer sections closed via
 *  lib/timer-features.ts. Server component with no data access — it is
 *  rendered by the section's route layout in place of the real page, so
 *  visiting the URL does no Firebase reads and never redirects. */
export default function ComingSoonScreen({ title }: { title: string }) {
  return (
    <main style={{
      minHeight: '100dvh', width: '100%',
      background: T.bg, color: T.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
      fontFamily: 'inherit',
    }}>
      <div style={{
        width: '100%', maxWidth: 360,
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 10, padding: '1.75rem 1.5rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '0.6rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: '0.8rem', color: T.muted, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>Удахгүй</div>
        <div style={{ fontSize: '0.85rem', color: T.muted, lineHeight: 1.5 }}>
          Энэ хэсэг удахгүй нээгдэнэ.
        </div>
        <Link
          href="/timer"
          style={{
            marginTop: '0.6rem',
            padding: '0.55rem 1rem', borderRadius: 10,
            background: T.cardAlt, color: T.text,
            fontSize: '0.85rem', fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Timer руу буцах
        </Link>
      </div>
    </main>
  );
}
