'use client';

import Link from 'next/link';
import { useCompetitions } from '@/lib/hooks/useCompetitions';
import { useAthletes } from '@/lib/hooks/useAthletes';
import { useLang } from '@/lib/i18n';

export default function HomePage() {
  const { competitions, loading: compsLoading } = useCompetitions();
  const { athletes, loading: athletesLoading } = useAthletes();
  const { t } = useLang();

  const recentComps = competitions
    .slice()
    .sort((a, b) => {
      const da = a.date ? (typeof a.date === 'string' ? new Date(a.date) : a.date.toDate()) : new Date(0);
      const db = b.date ? (typeof b.date === 'string' ? new Date(b.date) : b.date.toDate()) : new Date(0);
      return db.getTime() - da.getTime();
    })
    .slice(0, 3);

  return (
    <>
      {/* Hero Section */}
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
            Mongolia&apos;s Speedcubing Community
          </div>

          <h1 style={{
            fontSize: 'clamp(2.5rem, 7vw, 4.5rem)',
            fontWeight: 900, lineHeight: 1.05, letterSpacing: '-1px',
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text', marginBottom: '0.5rem',
          }}>
            Mongolian Speedcubers
          </h1>

          <p style={{
            fontSize: 'clamp(1rem, 3vw, 1.3rem)',
            color: 'var(--muted)', fontWeight: 400, letterSpacing: '0.1em',
            marginBottom: '2.2rem',
          }}>
            Mongolia&apos;s competitive speedcubing community
          </p>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/competition" style={{
              padding: '0.85rem 2rem', borderRadius: 10, fontSize: '1rem', fontWeight: 600,
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              color: '#fff', border: 'none', display: 'inline-block',
              transition: 'opacity 0.2s, transform 0.2s',
            }}>
              Competition Portal
            </Link>
            <Link href="/timer" style={{
              padding: '0.85rem 2rem', borderRadius: 10, fontSize: '1rem', fontWeight: 600,
              background: 'transparent', color: 'var(--text)',
              border: '1px solid rgba(255,255,255,0.15)', display: 'inline-block',
              transition: 'border-color 0.2s, transform 0.2s',
            }}>
              Start Timer
            </Link>
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
          Explore
        </div>

        <style>{`
          @keyframes scrollBounce {
            0%, 100% { transform: translateX(-50%) translateY(0); }
            50%       { transform: translateX(-50%) translateY(6px); }
          }
        `}</style>
      </section>

      {/* Navigation Cards */}
      <section style={{
        padding: '4rem 2rem', maxWidth: 1100, margin: '0 auto',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.25rem',
        }}>
          <NavCard
            href="/competition"
            icon={<span style={{ fontSize: '1.8rem' }}>&#127942;</span>}
            title="Competition Portal"
            desc="Live results, rankings, records and competition management"
          />
          <NavCard
            href="/timer"
            icon={<span style={{ fontSize: '1.8rem' }}>&#9201;</span>}
            title="Speed Timer"
            desc="Practice with WCA-standard inspection timer"
            comingSoon
          />
          <NavCard
            href="/algorithms"
            icon={<span style={{ fontSize: '1.8rem' }}>&#128218;</span>}
            title="Algorithms"
            desc="Learn OLL, PLL and other speedcubing algorithms"
            comingSoon
          />
          <NavCard
            href="/gallery"
            icon={<span style={{ fontSize: '1.8rem' }}>&#128444;</span>}
            title="Gallery"
            desc="Photos and videos from our events"
            comingSoon
          />
        </div>
      </section>

      {/* About Section */}
      <section style={{
        padding: '4rem 2rem', maxWidth: 900, margin: '0 auto', textAlign: 'center',
      }}>
        <h2 style={{
          fontSize: '2rem', fontWeight: 800, marginBottom: '1rem',
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          About Us
        </h2>
        <p style={{
          fontSize: '1.05rem', color: 'var(--muted)', lineHeight: 1.8,
          maxWidth: 650, margin: '0 auto 2.5rem',
        }}>
          Mongolian Speedcubers is the home of competitive speedcubing in Mongolia.
          We organize WCA-style competitions, track official results, and bring together
          cubers of all skill levels to learn, compete, and grow together.
        </p>

        <div style={{
          display: 'flex', gap: '2.5rem', justifyContent: 'center', flexWrap: 'wrap',
          padding: '1.5rem 2rem',
          background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14, backdropFilter: 'blur(12px)', marginBottom: '2rem',
        }}>
          <StatItem value={athletesLoading ? '...' : athletes.length} label="Members" />
          <StatItem value={compsLoading ? '...' : competitions.length} label="Competitions Held" />
          <StatItem value={17} label="Events Supported" />
        </div>

        <Link href="/login" style={{
          padding: '0.75rem 2rem', borderRadius: 10, fontSize: '0.95rem', fontWeight: 600,
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          color: '#fff', border: 'none', display: 'inline-block',
          transition: 'opacity 0.2s, transform 0.2s',
        }}>
          Join Us
        </Link>
      </section>

      {/* Latest Competitions */}
      {!compsLoading && recentComps.length > 0 && (
        <section style={{
          padding: '4rem 2rem 5rem', maxWidth: 1100, margin: '0 auto',
        }}>
          <h2 style={{
            fontSize: '1.6rem', fontWeight: 800, textAlign: 'center', marginBottom: '2rem',
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Latest Competitions
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.25rem', marginBottom: '2rem',
          }}>
            {recentComps.map((comp) => {
              const date = comp.date
                ? typeof comp.date === 'string' ? new Date(comp.date) : comp.date.toDate()
                : null;
              return (
                <div key={comp.id} style={{
                  background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 14, padding: '1.5rem',
                  transition: 'border-color 0.2s, transform 0.2s',
                }}>
                  <div style={{
                    display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 6,
                    fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                    marginBottom: '0.75rem',
                    background: comp.status === 'live' ? 'rgba(74,222,128,0.15)' : comp.status === 'upcoming' ? 'rgba(124,58,237,0.15)' : 'rgba(100,116,139,0.15)',
                    color: comp.status === 'live' ? '#4ade80' : comp.status === 'upcoming' ? '#a78bfa' : 'var(--muted)',
                  }}>
                    {comp.status}
                  </div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.35rem' }}>
                    {comp.name}
                  </h3>
                  {date && (
                    <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                      {date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ textAlign: 'center' }}>
            <Link href="/competition#competitions" style={{
              padding: '0.7rem 1.8rem', borderRadius: 10, fontSize: '0.92rem', fontWeight: 600,
              background: 'transparent', color: 'var(--text)',
              border: '1px solid rgba(255,255,255,0.15)', display: 'inline-block',
              transition: 'border-color 0.2s',
            }}>
              View All Competitions
            </Link>
          </div>
        </section>
      )}

      {/* Footer */}
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
              fontSize: '1.2rem', fontWeight: 800, letterSpacing: '1px',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', marginBottom: '0.4rem',
            }}>
              Mongolian Speedcubers
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              Mongolia&apos;s competitive speedcubing community
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/competition" style={{ fontSize: '0.85rem', color: 'var(--muted)', transition: 'color 0.2s' }}>Competition</Link>
            <Link href="/timer" style={{ fontSize: '0.85rem', color: 'var(--muted)', transition: 'color 0.2s' }}>Timer</Link>
            <Link href="/algorithms" style={{ fontSize: '0.85rem', color: 'var(--muted)', transition: 'color 0.2s' }}>Algorithms</Link>
            <Link href="/gallery" style={{ fontSize: '0.85rem', color: 'var(--muted)', transition: 'color 0.2s' }}>Gallery</Link>
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
          <span>&copy; 2026 Mongolian Speedcubers. All rights reserved.</span>
          <a href="/admin" style={{ color: 'var(--muted)', transition: 'color 0.2s' }}>Admin Portal</a>
        </div>
      </footer>
    </>
  );
}

function NavCard({ href, icon, title, desc, comingSoon }: { href: string; icon: React.ReactNode; title: string; desc: string; comingSoon?: boolean }) {
  return (
    <Link href={href} style={{
      display: 'block', padding: '1.8rem 1.5rem', position: 'relative',
      background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14, textDecoration: 'none',
      transition: 'border-color 0.2s, transform 0.2s',
    }}>
      {comingSoon && (
        <span style={{
          position: 'absolute', top: '0.75rem', right: '0.75rem',
          padding: '0.18rem 0.55rem', borderRadius: 6,
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.03em',
          background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)',
          color: '#a78bfa',
        }}>
          Coming Soon
        </span>
      )}
      <div style={{ marginBottom: '0.75rem' }}>{icon}</div>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.4rem' }}>{title}</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.5 }}>{desc}</p>
    </Link>
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
