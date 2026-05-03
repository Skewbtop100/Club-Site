'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';

// Lazy — keeps the section page bundle small and matches how /admin/competitions
// and /admin/club mount their tab bodies.
const UsersTab = dynamic(() => import('@/components/admin/UsersTab'), { ssr: false });

export default function AdminUsersPage() {
  return (
    <div style={{
      maxWidth: 1380, margin: '0 auto',
      padding: '1.5rem 1rem',
      display: 'flex', flexDirection: 'column', gap: '1rem',
    }}>
      <div>
        <Link
          href="/admin/dashboard"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            fontSize: '0.78rem', color: 'var(--muted)',
            textDecoration: 'none', fontWeight: 600,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
        >
          ← Хяналтын самбар руу буцах
        </Link>
      </div>

      <h1 style={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '0.01em', margin: 0 }}>
        Хэрэглэгчид удирдах
      </h1>

      <UsersTab />
    </div>
  );
}
