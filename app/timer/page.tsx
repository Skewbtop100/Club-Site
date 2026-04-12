import Link from 'next/link';

export default function TimerPage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      padding: '2rem', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{
          position: 'absolute', top: '20%', left: '30%',
          width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '15%', right: '20%',
          width: 350, height: 350, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(236,72,153,0.14) 0%, transparent 70%)',
        }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 500 }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>&#9201;</div>

        <h1 style={{
          fontSize: '2.2rem', fontWeight: 800, marginBottom: '0.5rem',
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          Speed Timer
        </h1>

        <p style={{
          fontSize: '1.15rem', fontWeight: 600, color: 'var(--text)',
          marginBottom: '0.5rem',
        }}>
          &#1058;&#1091;&#1085; &#1091;&#1076;&#1072;&#1093;&#1075;&#1199;&#1081; / Coming Soon
        </p>

        <p style={{
          fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.7,
          marginBottom: '2.5rem',
        }}>
          A WCA-standard inspection timer for practice sessions.
          Train with stackmat-style timing, track your solves, and watch your times improve.
        </p>

        <Link href="/" style={{
          padding: '0.7rem 1.6rem', borderRadius: 10, fontSize: '0.92rem', fontWeight: 600,
          background: 'transparent', color: 'var(--text)',
          border: '1px solid rgba(255,255,255,0.15)', display: 'inline-block',
          transition: 'border-color 0.2s',
          textDecoration: 'none',
        }}>
          &#8592; Back to Home
        </Link>
      </div>
    </div>
  );
}
