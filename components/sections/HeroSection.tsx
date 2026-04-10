'use client';

import Link from 'next/link';
import { useLang } from '@/lib/i18n';
import { useAthletes } from '@/lib/hooks/useAthletes';
import { useCompetitions } from '@/lib/hooks/useCompetitions';

export default function HeroSection() {
  const { t } = useLang();
  const { athletes, loading: athletesLoading } = useAthletes();
  const { competitions, loading: compsLoading } = useCompetitions();

  return (
    <section style={{
      minHeight: '100vh', position: 'relative',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: '6rem 2rem 4rem', overflow: 'hidden',
    }}>
      {/* Background */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{
          position: 'absolute', top: '-10%', left: '20%',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '5%', right: '10%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(236,72,153,0.18) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(124,58,237,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.06) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 780 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)',
          color: '#a78bfa', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.05em',
          padding: '0.35rem 0.9rem', borderRadius: 999, marginBottom: '1.5rem',
        }}>
          <span style={{ color: '#4ade80', fontSize: '0.7rem' }}>&#9679;</span>
          {t('hero.badge')}
        </div>

        <h1 style={{
          fontSize: 'clamp(3rem, 8vw, 5.5rem)',
          fontWeight: 900, lineHeight: 1.05, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text', marginBottom: '0.3rem',
        }}>
          CUBE MN
        </h1>

        <p style={{
          fontSize: 'clamp(1rem, 3vw, 1.4rem)',
          color: 'var(--muted)', fontWeight: 400, letterSpacing: '0.15em',
          textTransform: 'uppercase', marginBottom: '1.4rem',
        }}>
          {t('hero.subtitle')}
        </p>

        <p style={{
          fontSize: '1.05rem', color: 'var(--muted)', lineHeight: 1.7,
          maxWidth: 600, margin: '0 auto 2.2rem',
        }}>
          {t('hero.desc')}
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="#rankings" style={{
            padding: '0.75rem 1.8rem', borderRadius: 10, fontSize: '0.95rem', fontWeight: 600,
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            color: '#fff', border: 'none', display: 'inline-block',
            transition: 'opacity 0.2s, transform 0.2s',
          }}>
            {t('hero.btn-rankings')}
          </Link>
          <Link href="#competitions" style={{
            padding: '0.75rem 1.8rem', borderRadius: 10, fontSize: '0.95rem', fontWeight: 600,
            background: 'transparent', color: 'var(--text)',
            border: '1px solid rgba(255,255,255,0.15)', display: 'inline-block',
            transition: 'border-color 0.2s, transform 0.2s',
          }}>
            {t('hero.btn-competitions')}
          </Link>
        </div>

        {/* Stats bar */}
        <div style={{
          display: 'flex', gap: '2.5rem', justifyContent: 'center', flexWrap: 'wrap',
          marginTop: '3rem', padding: '1.5rem 2rem',
          background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14, backdropFilter: 'blur(12px)',
        }}>
          <StatItem value={athletesLoading ? '...' : athletes.length} label={t('stats.athletes')} />
          <StatItem value={compsLoading ? '...' : competitions.length} label={t('stats.competitions')} />
          <StatItem value={17} label={t('stats.events-supported')} />
        </div>
      </div>

      {/* Scroll indicator */}
      <div style={{
        position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
        color: 'var(--muted)', fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase',
        animation: 'scrollBounce 2s ease-in-out infinite',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        {t('hero.scroll')}
      </div>

      <style>{`
        @keyframes scrollBounce {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50%       { transform: translateX(-50%) translateY(6px); }
        }
      `}</style>
    </section>
  );
}

function StatItem({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: '2rem', fontWeight: 800,
        background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.15rem' }}>
        {label}
      </div>
    </div>
  );
}
