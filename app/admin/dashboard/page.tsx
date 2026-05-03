'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getCountFromServer, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAthleteCount } from '@/lib/firebase/services/athletes';
import { getCompetitions, getCompetitionCount } from '@/lib/firebase/services/competitions';
import { useAuth } from '@/lib/auth-context';

interface Stats {
  totalCompetitions: number | null;
  activeCompetitions: number | null;
  totalAthletes: number | null;
  totalRecords: number | null;
  totalUsers: number | null;
}

const INITIAL: Stats = {
  totalCompetitions: null,
  activeCompetitions: null,
  totalAthletes: null,
  totalRecords: null,
  totalUsers: null,
};

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>(INITIAL);

  // One-shot stats fetch on mount. Each query is independent so we update
  // setStats incrementally — slow queries (e.g. records) don't block the
  // ones that resolved fast.
  useEffect(() => {
    let cancelled = false;
    const set = (patch: Partial<Stats>) => {
      if (!cancelled) setStats(prev => ({ ...prev, ...patch }));
    };

    getCompetitionCount().then(n => set({ totalCompetitions: n })).catch(() => {});
    getCompetitions().then(comps => {
      const active = comps.filter(c => c.status === 'live' || c.status === 'upcoming').length;
      set({ activeCompetitions: active });
    }).catch(() => {});
    getAthleteCount().then(n => set({ totalAthletes: n })).catch(() => {});

    // Records are stored one doc per event in `wcaRecords`; counting docs
    // gives "events with records on file" which is the headline number we
    // want to surface here.
    getCountFromServer(collection(db, 'wcaRecords'))
      .then(snap => set({ totalRecords: snap.data().count }))
      .catch(() => {});

    // Filter `users` to rows that have an email field — those are the new
    // Google-auth users (UsersTab uses the same filter). Legacy username/
    // password rows don't represent "real" account holders for this tile.
    getDocs(collection(db, 'users'))
      .then(snap => {
        let n = 0;
        for (const d of snap.docs) if (typeof d.data().email === 'string' && d.data().email) n += 1;
        set({ totalUsers: n });
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const adminName = user?.displayName?.trim() || 'Админ';

  return (
    <div style={{
      maxWidth: 1380, margin: '0 auto',
      padding: '2rem 1rem',
      display: 'flex', flexDirection: 'column', gap: '1.5rem',
    }}>
      {/* Welcome */}
      <div>
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Тавтай морил
        </div>
        <h1 style={{
          fontSize: '1.65rem', fontWeight: 800, marginTop: '0.2rem',
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          Сайн уу, {adminName}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.3rem' }}>
          Cube MN тэмцээний удирдлага
        </p>
      </div>

      {/* Section cards */}
      <div className="admin-overview-grid">
        <SectionCard
          icon="🏆"
          title="Тэмцээн"
          subtitle="Тэмцээн зохиох, үр дүн оруулах"
          href="/admin/competitions"
          stats={[
            { label: 'Идэвхтэй', value: stats.activeCompetitions },
            { label: 'Нийт',     value: stats.totalCompetitions },
          ]}
        />
        <SectionCard
          icon="👥"
          title="Клуб"
          subtitle="Тамирчид, рекорд, gallery"
          href="/admin/club"
          stats={[
            { label: 'Тамирчин', value: stats.totalAthletes },
            { label: 'Рекорд',   value: stats.totalRecords },
          ]}
        />
        <SectionCard
          icon="🧑"
          title="Хэрэглэгчид"
          subtitle="Хэрэглэгчид удирдах"
          href="/admin/users"
          stats={[
            { label: 'Нийт', value: stats.totalUsers },
          ]}
        />
      </div>

      {/* Recent activity placeholder — real feed lands in a later step */}
      <div style={{
        background: 'var(--card)', border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16, padding: '1.25rem 1.4rem',
      }}>
        <div style={{
          fontSize: '0.7rem', color: 'var(--muted)',
          fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
          marginBottom: '0.6rem',
        }}>
          Сүүлийн үйл ажиллагаа
        </div>
        <div style={{ color: 'var(--muted)', fontSize: '0.88rem', lineHeight: 1.55 }}>
          Удахгүй — admin үйлдлүүдийн түүх энд харагдана.
        </div>
      </div>

      <style>{`
        .admin-overview-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1rem;
        }
        @media (max-width: 880px) {
          .admin-overview-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function SectionCard({
  icon, title, subtitle, href, stats,
}: {
  icon: string;
  title: string;
  subtitle: string;
  href: string;
  stats: { label: string; value: number | null }[];
}) {
  return (
    <Link
      href={href}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        gap: '1rem',
        padding: '1.4rem 1.4rem 1.2rem',
        background: 'var(--card)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        textDecoration: 'none', color: 'inherit',
        boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
        transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'rgba(124,58,237,0.45)';
        e.currentTarget.style.boxShadow = '0 14px 40px rgba(0,0,0,0.32), 0 0 0 1px rgba(124,58,237,0.12)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.25)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(124,58,237,0.12)',
          border: '1px solid rgba(124,58,237,0.3)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.5rem', flexShrink: 0,
        }} aria-hidden="true">{icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.01em' }}>
            {title}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.1rem' }}>
            {subtitle}
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))`,
        gap: '0.6rem',
      }}>
        {stats.map(s => (
          <div key={s.label} style={{
            padding: '0.55rem 0.7rem', borderRadius: 10,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
              {s.label}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', marginTop: '0.1rem' }}>
              {s.value ?? '—'}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        marginTop: 'auto',
        color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 700,
        letterSpacing: '0.04em',
      }}>
        Орох <span aria-hidden="true">→</span>
      </div>
    </Link>
  );
}
