'use client';

import Link from 'next/link';

export default function AdminUsersPage() {
  return (
    <div style={{
      maxWidth: 1380, margin: '0 auto',
      padding: '1.5rem 1rem',
    }}>
      <div style={{ marginBottom: '0.85rem' }}>
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

      <div style={{
        background: 'var(--card)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        padding: '3rem 1.5rem',
        textAlign: 'center',
        color: 'var(--muted)',
        fontSize: '0.95rem',
      }}>
        <div style={{ fontSize: '2.4rem', marginBottom: '0.6rem' }} aria-hidden="true">🧑</div>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.35rem' }}>
          Хэрэглэгчид удирдах хэсэг
        </div>
        <div>удахгүй...</div>
      </div>
    </div>
  );
}
