'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { subscribePendingRequests } from '@/lib/firebase/services/athleteRequests';

// Lazy — keeps the section page bundle small and matches how /admin/competitions
// and /admin/club mount their tab bodies.
const UsersTab            = dynamic(() => import('@/components/admin/UsersTab'),            { ssr: false });
const AthleteRequestsTab  = dynamic(() => import('@/components/admin/AthleteRequestsTab'),  { ssr: false });

type InnerTab = 'users' | 'requests';

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<InnerTab>('users');

  // Live pending count drives the badge on the Хүсэлтүүд tab. Subscribe at
  // the page level so the badge updates immediately when an admin in another
  // tab/window approves or rejects.
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    const unsub = subscribePendingRequests(
      (rows) => setPendingCount(rows.length),
      (err) => console.error('[admin-users] pending subscribe', err),
    );
    return () => unsub();
  }, []);

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

      <div className="tab-nav" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
        <button
          className={`tab-btn${activeTab === 'users' ? ' active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Хэрэглэгчид
        </button>
        <button
          className={`tab-btn${activeTab === 'requests' ? ' active' : ''}`}
          onClick={() => setActiveTab('requests')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <span>Хүсэлтүүд</span>
          {pendingCount > 0 && (
            <span
              aria-label={`${pendingCount} хүлээгдэж буй хүсэлт`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 20, height: 20, padding: '0 6px',
                background: '#ef4444', color: '#fff',
                borderRadius: 999,
                fontSize: '0.68rem', fontWeight: 800, fontFamily: 'monospace',
                lineHeight: 1,
              }}
            >{pendingCount}</span>
          )}
        </button>
      </div>

      {activeTab === 'users'    ? <UsersTab /> : null}
      {activeTab === 'requests' ? <AthleteRequestsTab /> : null}

      <style>{`
        @media (max-width: 700px) {
          .tab-nav { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          .tab-nav::-webkit-scrollbar { display: none; }
          .tab-btn { flex-shrink: 0; font-size: 0.75rem; padding: 0.38rem 0.7rem; }
        }
      `}</style>
    </div>
  );
}
