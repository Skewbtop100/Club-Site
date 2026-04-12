import Link from 'next/link';

export default function Footer() {
  return (
    <footer style={{
      background: 'var(--surface)',
      borderTop: '1px solid rgba(124,58,237,0.2)',
      padding: '3rem 2rem 0',
    }}>
      <div style={{
        maxWidth: 1100, margin: '0 auto',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: '2rem', paddingBottom: '2rem',
      }}>
        <div>
          <div style={{
            fontSize: '1.2rem', fontWeight: 800, letterSpacing: '2px',
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text', marginBottom: '0.4rem',
          }}>
            CUBE MN
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
            WCA-Style Club Competition Platform
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {['#rankings', '#records', '#competitions', '#athletes'].map((href) => (
            <Link key={href} href={`/competition${href}`} style={{ fontSize: '0.85rem', color: 'var(--muted)', transition: 'color 0.2s' }}>
              {href.slice(1).charAt(0).toUpperCase() + href.slice(2)}
            </Link>
          ))}
        </div>
      </div>
      <div style={{
        maxWidth: 1100, margin: '0 auto',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '1rem 0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: '0.5rem',
        fontSize: '0.78rem', color: 'var(--muted)',
      }}>
        <span>© 2026 Cube MN. All rights reserved.</span>
        <a href="/admin" style={{ color: 'var(--muted)', transition: 'color 0.2s' }}>Admin Portal</a>
      </div>
    </footer>
  );
}
