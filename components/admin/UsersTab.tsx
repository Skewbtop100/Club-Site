'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, type UserRole } from '@/lib/auth-context';
import { getAthletes } from '@/lib/firebase/services/athletes';
import type { Athlete } from '@/lib/types';

// ── Types ──────────────────────────────────────────────────────────────────
//
// `users/{uid}` rows are written by the Google-auth provider. Legacy
// username/password rows (created by the older admin UI) live in the same
// collection but have no `email` field — we filter those out so this tab
// only shows true authenticated users.
interface UserRow {
  id: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  role: UserRole;
  points: number;
  athleteId: string | null;
  unlockedTools: string[];
  createdAt: number | null;
  lastLoginAt: number | null;
}

const ROLE_BADGE: Record<UserRole, { label: string; fg: string; bg: string; border: string }> = {
  member:  { label: 'Гишүүн',   fg: '#a78bfa', bg: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.45)' },
  athlete: { label: 'Тамирчин', fg: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.45)' },
  admin:   { label: 'Админ',    fg: '#ef4444', bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.45)'  },
};
const ALL_ROLES: UserRole[] = ['member', 'athlete', 'admin'];
type RoleFilter = 'all' | UserRole;

// ── Helpers ────────────────────────────────────────────────────────────────
function tsToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return null;
}
function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}
function formatDate(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// ── Tab ────────────────────────────────────────────────────────────────────
export default function UsersTab() {
  const { user: currentUser } = useAuth();

  // Allow Firebase admins, OR the legacy localStorage admin (which is what
  // gates /admin/dashboard today). Falls back to "denied" only when neither
  // is true — keeps the legacy admin/password flow working unchanged.
  const isAdmin = useMemo(() => {
    if (currentUser?.role === 'admin') return true;
    if (typeof window !== 'undefined' && window.localStorage.getItem('isAdmin') === 'true') return true;
    return false;
  }, [currentUser]);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Modal state — exactly one open at a time.
  type ModalKind = null | { kind: 'role' | 'points-add' | 'points-sub' | 'link'; user: UserRow } | { kind: 'unlink'; user: UserRow };
  const [modal, setModal] = useState<ModalKind>(null);

  const showToast = (msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  // ── Fetch + subscribe ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    getAthletes().then(setAthletes).catch(err => console.error('[users-tab] athletes', err));

    // We order server-side by createdAt desc — Firestore ignores documents
    // missing the field, so legacy rows surface separately and get filtered
    // below by the `email` check.
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: UserRow[] = [];
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          // Skip legacy username/password rows — this tab is the
          // Google-auth user manager. Legacy rows have no `email`.
          if (typeof data.email !== 'string' || !data.email) continue;
          rows.push({
            id: d.id,
            displayName: typeof data.displayName === 'string' ? data.displayName : (data.email as string),
            email: data.email,
            photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
            role: (['member', 'athlete', 'admin'].includes(data.role as string) ? data.role : 'member') as UserRole,
            points: typeof data.points === 'number' ? data.points : 0,
            athleteId: typeof data.athleteId === 'string' ? data.athleteId : null,
            unlockedTools: Array.isArray(data.unlockedTools) ? data.unlockedTools.filter((t): t is string => typeof t === 'string') : [],
            createdAt: tsToMs(data.createdAt),
            lastLoginAt: tsToMs(data.lastLoginAt),
          });
        }
        setUsers(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[users-tab] snapshot', err);
        setLoading(false);
        showToast('Жагсаалт ачаалахад алдаа гарлаа.', 'err');
      },
    );
    return () => unsub();
  }, [isAdmin]);

  const athleteById = useMemo(() => {
    const m = new Map<string, Athlete>();
    for (const a of athletes) m.set(a.id, a);
    return m;
  }, [athletes]);

  // ── Derived: filtered + stats ─────────────────────────────────────────
  // Role chip narrows the list first; search runs over what's left. Stats
  // count the unfiltered list so the totals don't bounce while the admin
  // is exploring filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter]);

  const stats = useMemo(() => {
    const counts = { total: users.length, member: 0, athlete: 0, admin: 0 };
    for (const u of users) counts[u.role] += 1;
    return counts;
  }, [users]);

  // ── Action handlers ───────────────────────────────────────────────────
  const onChangeRole = async (uid: string, newRole: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', uid), { role: newRole });
      showToast('Role амжилттай шинэчлэгдлээ');
      setModal(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const onAdjustPoints = async (uid: string, delta: number, _reason: string) => {
    if (!Number.isFinite(delta) || delta === 0) {
      showToast('Тоо буруу байна.', 'err');
      return;
    }
    try {
      // Atomic increment so two admins editing concurrently don't clobber.
      // The reason is logged for the audit-log step (later); we don't write
      // it to Firestore yet because the audit collection doesn't exist.
      await updateDoc(doc(db, 'users', uid), { points: increment(delta) });
      showToast(delta > 0 ? `Point олголоо: +${delta}` : `Point хаслаа: ${delta}`);
      setModal(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const onLinkAthlete = async (uid: string, newAthleteId: string, prevAthleteId: string | null) => {
    if (!newAthleteId) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', uid), { athleteId: newAthleteId, role: 'athlete' });
      batch.update(doc(db, 'athletes', newAthleteId), { ownerId: uid });
      // If the user was previously linked to a different athlete, clear the
      // old athlete's ownerId so we don't leave a stale back-reference.
      if (prevAthleteId && prevAthleteId !== newAthleteId) {
        batch.update(doc(db, 'athletes', prevAthleteId), { ownerId: null });
      }
      await batch.commit();
      showToast('Тамирчинтай холбогдлоо');
      setModal(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const onUnlinkAthlete = async (uid: string, athleteId: string) => {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', uid), { athleteId: null });
      batch.update(doc(db, 'athletes', athleteId), { ownerId: null });
      await batch.commit();
      showToast('Холбоо тасарлаа');
      setModal(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="card">
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)' }}>
          Энэ хэсэгт хандах эрхгүй байна.
        </div>
      </div>
    );
  }

  // Single dispatcher used by both the table row and the mobile card so the
  // action wiring lives in one place.
  const handleAction = (u: UserRow, action: 'role' | 'add' | 'sub' | 'link' | 'unlink' | 'view') => {
    setOpenMenuId(null);
    if (action === 'role')        setModal({ kind: 'role', user: u });
    else if (action === 'add')    setModal({ kind: 'points-add', user: u });
    else if (action === 'sub')    setModal({ kind: 'points-sub', user: u });
    else if (action === 'link')   setModal({ kind: 'link', user: u });
    else if (action === 'unlink') setModal({ kind: 'unlink', user: u });
    else if (action === 'view')   window.open(`/profile?uid=${encodeURIComponent(u.id)}`, '_blank', 'noopener');
  };

  return (
    <div
      onClick={() => openMenuId && setOpenMenuId(null)}
      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
    >
      {/* Stats — standalone grid above everything else (4-col / 2-col mobile) */}
      <div className="users-stats">
        <StatCard label="Нийт хэрэглэгч" value={stats.total} fg="var(--text)" />
        <StatCard label="Гишүүн"          value={stats.member}  fg={ROLE_BADGE.member.fg} />
        <StatCard label="Тамирчин"        value={stats.athlete} fg={ROLE_BADGE.athlete.fg} />
        <StatCard label="Админ"           value={stats.admin}   fg={ROLE_BADGE.admin.fg} />
      </div>

      {/* Search + role chips */}
      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div style={{ position: 'relative' }}>
            <SearchIcon />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Нэр, email хайх..."
              aria-label="Хайх"
              style={{
                width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.1rem',
                background: 'var(--input-bg)', color: 'var(--text)',
                border: '1px solid var(--input-border)', borderRadius: 9,
                fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div role="tablist" aria-label="Эрхээр шүүх" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            <FilterChip label="Бүгд"     active={roleFilter === 'all'}     onClick={() => setRoleFilter('all')} />
            <FilterChip label="Гишүүн"   active={roleFilter === 'member'}  onClick={() => setRoleFilter('member')} />
            <FilterChip label="Тамирчин" active={roleFilter === 'athlete'} onClick={() => setRoleFilter('athlete')} />
            <FilterChip label="Админ"    active={roleFilter === 'admin'}   onClick={() => setRoleFilter('admin')} />
          </div>
        </div>
      </div>

      {/* List — table on desktop, cards on mobile (CSS-driven so no hydration flash) */}
      <div className="card">
        <div className="card-title"><span className="title-accent" />Бүх хэрэглэгч</div>

        {loading ? (
          <div className="spinner-row">Уншиж байна…<span className="spinner-ring" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            {users.length === 0 ? 'Хэрэглэгч байхгүй байна.' : 'Хайлтад тохирох хэрэглэгч олдсонгүй.'}
          </div>
        ) : (
          <>
            <div className="users-table-wrap table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Нэр / Email</th>
                    <th>Эрх</th>
                    <th style={{ textAlign: 'right' }}>Point</th>
                    <th>Тамирчин</th>
                    <th>Бүртгүүлсэн</th>
                    <th style={{ textAlign: 'right' }}>Үйлдэл</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <UserRowView
                      key={u.id}
                      u={u}
                      athleteName={u.athleteId ? athleteNameOf(athleteById.get(u.athleteId)) : null}
                      menuOpen={openMenuId === u.id}
                      onToggleMenu={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(prev => (prev === u.id ? null : u.id));
                      }}
                      onAction={(action) => handleAction(u, action)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="users-card-list" style={{ display: 'none', flexDirection: 'column', gap: '0.6rem' }}>
              {filtered.map(u => (
                <UserCardView
                  key={u.id}
                  u={u}
                  athleteName={u.athleteId ? athleteNameOf(athleteById.get(u.athleteId)) : null}
                  menuOpen={openMenuId === u.id}
                  onToggleMenu={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(prev => (prev === u.id ? null : u.id));
                  }}
                  onAction={(action) => handleAction(u, action)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {modal?.kind === 'role' && (
        <RoleModal
          user={modal.user}
          onCancel={() => setModal(null)}
          onConfirm={(role) => onChangeRole(modal.user.id, role)}
        />
      )}
      {modal?.kind === 'points-add' && (
        <PointsModal
          user={modal.user}
          mode="add"
          onCancel={() => setModal(null)}
          onConfirm={(amount, reason) => onAdjustPoints(modal.user.id, amount, reason)}
        />
      )}
      {modal?.kind === 'points-sub' && (
        <PointsModal
          user={modal.user}
          mode="sub"
          onCancel={() => setModal(null)}
          onConfirm={(amount, reason) => onAdjustPoints(modal.user.id, -amount, reason)}
        />
      )}
      {modal?.kind === 'link' && (
        <AthleteLinkModal
          user={modal.user}
          athletes={athletes}
          onCancel={() => setModal(null)}
          onConfirm={(athleteId) => onLinkAthlete(modal.user.id, athleteId, modal.user.athleteId)}
        />
      )}
      {modal?.kind === 'unlink' && modal.user.athleteId && (
        <ConfirmModal
          title="Холбоо тасалах"
          body="Холбоог таслах уу?"
          confirmLabel="Тасалах"
          danger
          onCancel={() => setModal(null)}
          onConfirm={() => onUnlinkAthlete(modal.user.id, modal.user.athleteId!)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            left: '50%', transform: 'translateX(-50%)',
            zIndex: 2000,
            background: toast.tone === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
            border: `1px solid ${toast.tone === 'ok' ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)'}`,
            color: toast.tone === 'ok' ? '#34d399' : '#f87171',
            padding: '0.55rem 1rem', borderRadius: 999,
            fontSize: '0.85rem', fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            animation: 'users-tab-toast-in 0.2s ease-out',
            maxWidth: 'calc(100vw - 2rem)',
          }}
        >
          {toast.msg}
        </div>
      )}

      <style>{`
        .users-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.6rem;
        }
        @media (max-width: 640px) {
          .users-stats { grid-template-columns: repeat(2, 1fr); }
          /* Swap table → card list at this breakpoint. The table doesn't
             collapse gracefully (8 columns), so we render both markups and
             toggle visibility — works without a JS isMobile check. */
          .users-table-wrap { display: none !important; }
          .users-card-list  { display: flex !important; }
        }
        @keyframes users-tab-toast-in {
          from { opacity: 0; transform: translate(-50%, -6px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        .users-row-actions:hover { color: var(--text) !important; background: rgba(255,255,255,0.06) !important; }
      `}</style>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────
function athleteNameOf(a: Athlete | undefined): string | null {
  if (!a) return null;
  return `${a.name}${a.lastName ? ' ' + a.lastName : ''}`;
}

function UserRowView({
  u, athleteName, menuOpen, onToggleMenu, onAction,
}: {
  u: UserRow;
  athleteName: string | null;
  menuOpen: boolean;
  onToggleMenu: (e: React.MouseEvent) => void;
  onAction: (action: 'role' | 'add' | 'sub' | 'link' | 'unlink' | 'view') => void;
}) {
  const badge = ROLE_BADGE[u.role];
  return (
    <tr>
      <td><Avatar name={u.displayName} url={u.photoURL} size={32} /></td>
      <td>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{u.displayName}</div>
        <div className="td-muted" style={{ fontFamily: 'monospace', fontSize: '0.78rem', marginTop: '0.1rem' }}>
          {u.email}
        </div>
      </td>
      <td>
        <span style={{
          display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: 999,
          fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em',
          background: badge.bg, color: badge.fg, border: `1px solid ${badge.border}`,
        }}>{badge.label}</span>
      </td>
      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{u.points}</td>
      <td className="td-muted">{athleteName ?? '—'}</td>
      <td className="td-muted" style={{ fontSize: '0.82rem' }}>{formatDate(u.createdAt)}</td>
      <td style={{ textAlign: 'right', position: 'relative' }}>
        <button
          onClick={onToggleMenu}
          aria-label="Үйлдэл"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="users-row-actions"
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: menuOpen ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--muted)', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <DotsIcon />
        </button>
        {menuOpen && (
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0,
              minWidth: 220, zIndex: 100,
              background: 'var(--card)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12, padding: 5,
              boxShadow: '0 18px 44px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 2,
              textAlign: 'left',
            }}
          >
            <MenuItem onClick={() => onAction('role')}>Role өөрчлөх</MenuItem>
            <MenuItem onClick={() => onAction('add')}>Point олгох</MenuItem>
            <MenuItem onClick={() => onAction('sub')}>Point хасах</MenuItem>
            <MenuItem onClick={() => onAction('link')}>Тамирчинтай холбох</MenuItem>
            {u.athleteId && <MenuItem onClick={() => onAction('unlink')} danger>Холбоо тасалах</MenuItem>}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '3px 6px' }} />
            <MenuItem onClick={() => onAction('view')}>Профайл харах</MenuItem>
          </div>
        )}
      </td>
    </tr>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '0.35rem 0.85rem',
        borderRadius: 999,
        background: active ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(167,139,250,0.55)' : 'rgba(255,255,255,0.08)'}`,
        color: active ? '#a78bfa' : 'var(--muted)',
        fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.02em',
        fontFamily: 'inherit', cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
    >
      {label}
    </button>
  );
}

// Mobile card variant of UserRowView. Same data, same menu, vertical layout.
function UserCardView({
  u, athleteName, menuOpen, onToggleMenu, onAction,
}: {
  u: UserRow;
  athleteName: string | null;
  menuOpen: boolean;
  onToggleMenu: (e: React.MouseEvent) => void;
  onAction: (action: 'role' | 'add' | 'sub' | 'link' | 'unlink' | 'view') => void;
}) {
  const badge = ROLE_BADGE[u.role];
  return (
    <div style={{
      position: 'relative',
      padding: '0.85rem',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column', gap: '0.65rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem' }}>
        <Avatar name={u.displayName} url={u.photoURL} size={40} />
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.displayName}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.email}
          </div>
        </div>
        <button
          onClick={onToggleMenu}
          aria-label="Үйлдэл"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="users-row-actions"
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: menuOpen ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--muted)', cursor: 'pointer', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <DotsIcon />
        </button>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
        gap: '0.45rem 0.85rem',
        fontSize: '0.78rem',
      }}>
        <CardField label="Эрх">
          <span style={{
            display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 999,
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
            background: badge.bg, color: badge.fg, border: `1px solid ${badge.border}`,
          }}>{badge.label}</span>
        </CardField>
        <CardField label="Point">
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{u.points}</span>
        </CardField>
        <CardField label="Тамирчин">
          <span style={{ color: athleteName ? 'var(--text)' : 'var(--muted)' }}>
            {athleteName ?? 'Холбогдоогүй'}
          </span>
        </CardField>
        <CardField label="Бүртгүүлсэн">
          <span style={{ color: 'var(--muted)' }}>{formatDate(u.createdAt)}</span>
        </CardField>
      </div>

      {menuOpen && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 50, right: 12,
            minWidth: 220, zIndex: 100,
            background: 'var(--card)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12, padding: 5,
            boxShadow: '0 18px 44px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: 2,
            textAlign: 'left',
          }}
        >
          <MenuItem onClick={() => onAction('role')}>Role өөрчлөх</MenuItem>
          <MenuItem onClick={() => onAction('add')}>Point олгох</MenuItem>
          <MenuItem onClick={() => onAction('sub')}>Point хасах</MenuItem>
          <MenuItem onClick={() => onAction('link')}>Тамирчинтай холбох</MenuItem>
          {u.athleteId && <MenuItem onClick={() => onAction('unlink')} danger>Холбоо тасалах</MenuItem>}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '3px 6px' }} />
          <MenuItem onClick={() => onAction('view')}>Профайл харах</MenuItem>
        </div>
      )}
    </div>
  );
}

function CardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.15rem' }}>
        {label}
      </div>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</div>
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '0.55rem 0.65rem', borderRadius: 8,
        fontSize: '0.85rem', fontWeight: 600,
        color: danger ? '#f87171' : 'var(--text)',
        fontFamily: 'inherit', textAlign: 'left', width: '100%',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(248,113,113,0.08)' : 'rgba(124,58,237,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div style={{
      padding: '0.7rem 0.85rem', borderRadius: 12,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: '0.2rem',
    }}>
      <div style={{ fontSize: '0.66rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: fg, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
      color: '#fff', fontSize: size * 0.42, fontWeight: 800, lineHeight: 1,
      flexShrink: 0,
    }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : initialOf(name)}
    </span>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────
function ModalShell({
  title, onClose, children, maxWidth = 440,
}: { title: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth,
          background: 'var(--card)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 2rem)',
          overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="Хаах"
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--muted)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </header>
        <div style={{ padding: '1rem', overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function ModalActions({
  cancelLabel = 'Болих', confirmLabel = 'Хадгалах', confirmDanger,
  confirmDisabled, onCancel, onConfirm,
}: {
  cancelLabel?: string;
  confirmLabel?: string;
  confirmDanger?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', marginTop: '1rem' }}>
      <button
        onClick={onCancel}
        style={{
          padding: '0.7rem 0.85rem', borderRadius: 9,
          background: 'transparent', color: 'var(--text)',
          border: '1px solid rgba(255,255,255,0.12)',
          fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >{cancelLabel}</button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        style={{
          padding: '0.7rem 0.85rem', borderRadius: 9,
          background: confirmDanger ? '#ef4444' : 'var(--accent)',
          color: '#fff', border: 'none',
          fontSize: '0.9rem', fontWeight: 800, fontFamily: 'inherit',
          cursor: confirmDisabled ? 'not-allowed' : 'pointer',
          opacity: confirmDisabled ? 0.55 : 1,
        }}
      >{confirmLabel}</button>
    </div>
  );
}

function RoleModal({
  user, onCancel, onConfirm,
}: { user: UserRow; onCancel: () => void; onConfirm: (role: UserRole) => void }) {
  const [role, setRole] = useState<UserRole>(user.role);
  return (
    <ModalShell title="Role өөрчлөх" onClose={onCancel}>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.6rem' }}>
        {user.displayName} · одоогийн эрх:{' '}
        <span style={{ color: ROLE_BADGE[user.role].fg, fontWeight: 700 }}>{ROLE_BADGE[user.role].label}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {ALL_ROLES.map(r => {
          const b = ROLE_BADGE[r];
          const selected = role === r;
          return (
            <label
              key={r}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.6rem 0.75rem',
                background: selected ? b.bg : 'rgba(255,255,255,0.03)',
                border: `1px solid ${selected ? b.border : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 10, cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="role"
                checked={selected}
                onChange={() => setRole(r)}
                style={{ accentColor: b.fg }}
              />
              <span style={{ fontWeight: 700, color: b.fg }}>{b.label}</span>
            </label>
          );
        })}
      </div>
      {role === 'admin' && user.role !== 'admin' && (
        <div style={{
          marginTop: '0.85rem', padding: '0.65rem 0.8rem',
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.45)',
          borderRadius: 9, color: '#ef4444',
          fontSize: '0.82rem', lineHeight: 1.5, fontWeight: 600,
        }}>
          Анхаар! Админ эрх олгосноор тэр хүн бүх системд хандах болно.
        </div>
      )}
      <ModalActions
        confirmDisabled={role === user.role}
        onCancel={onCancel}
        onConfirm={() => onConfirm(role)}
      />
    </ModalShell>
  );
}

function PointsModal({
  user, mode, onCancel, onConfirm,
}: {
  user: UserRow;
  mode: 'add' | 'sub';
  onCancel: () => void;
  onConfirm: (amount: number, reason: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const parsed = Number(amount);
  const ok = Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed);
  // Soft-block subtracting more than the user actually has — reduces accidental
  // negative balances. Not a hard guard (admins might still need negative).
  const wouldUnderflow = mode === 'sub' && ok && parsed > user.points;
  return (
    <ModalShell title={mode === 'add' ? 'Point олгох' : 'Point хасах'} onClose={onCancel}>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.7rem' }}>
        {user.displayName} · одоо:{' '}
        <span style={{ color: 'var(--text)', fontWeight: 700, fontFamily: 'monospace' }}>{user.points}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, marginBottom: '0.3rem' }}>
            Тоо хэмжээ
          </label>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            autoFocus
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="20"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, marginBottom: '0.3rem' }}>
            Шалтгаан (заавал биш)
          </label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Жишээ: тэмцээний шагнал"
            maxLength={120}
            style={inputStyle}
          />
        </div>
        {wouldUnderflow && (
          <div style={{ fontSize: '0.78rem', color: '#fbbf24' }}>
            Анхааруулга: {user.displayName}-д {user.points} point л байна.
          </div>
        )}
      </div>
      <ModalActions
        confirmLabel={mode === 'add' ? 'Олгох' : 'Хасах'}
        confirmDanger={mode === 'sub'}
        confirmDisabled={!ok}
        onCancel={onCancel}
        onConfirm={() => ok && onConfirm(parsed, reason.trim())}
      />
    </ModalShell>
  );
}

function AthleteLinkModal({
  user, athletes, onCancel, onConfirm,
}: {
  user: UserRow;
  athletes: Athlete[];
  onCancel: () => void;
  onConfirm: (athleteId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(user.athleteId);

  // Filter all athletes, then cap to 10 results so the dropdown stays
  // scannable. The full list is still searchable — admins narrow with the
  // input rather than scrolling.
  const RESULT_LIMIT = 10;
  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = athletes
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(a => {
        if (!q) return true;
        const name = `${a.name} ${a.lastName ?? ''}`.toLowerCase();
        return name.includes(q) || (a.wcaId ?? '').toLowerCase().includes(q);
      });
    return { list: list.slice(0, RESULT_LIMIT), totalMatched: list.length };
  }, [athletes, search]);

  return (
    <ModalShell title="Тамирчинтай холбох" onClose={onCancel} maxWidth={480}>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.7rem' }}>
        {user.displayName}
      </div>
      <input
        autoFocus
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Тамирчны нэр / WCA ID хайх..."
        style={inputStyle}
      />
      <div style={{
        marginTop: '0.6rem',
        maxHeight: 360, overflow: 'auto',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
      }}>
        {matched.list.length === 0 ? (
          <div style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.86rem' }}>
            Тамирчин олдсонгүй.
          </div>
        ) : (
          matched.list.map(a => {
            const isSelected = selected === a.id;
            const fullName = `${a.name}${a.lastName ? ' ' + a.lastName : ''}`;
            return (
              <button
                key={a.id}
                onClick={() => setSelected(a.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.55rem 0.75rem',
                  background: isSelected ? 'rgba(124,58,237,0.15)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <AthleteThumb name={a.name} url={a.imageUrl ?? null} size={32} />
                <span style={{ flex: '1 1 auto', fontWeight: 600 }}>{fullName}</span>
                {a.wcaId && (
                  <span style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: 'var(--muted)' }}>
                    {a.wcaId}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {matched.totalMatched > RESULT_LIMIT && (
        <div style={{ marginTop: '0.45rem', fontSize: '0.74rem', color: 'var(--muted)' }}>
          {matched.list.length} / {matched.totalMatched} харуулж байна — нэрээ оруулж нарийсгана уу.
        </div>
      )}
      <ModalActions
        confirmLabel="Хадгалах"
        confirmDisabled={!selected || selected === user.athleteId}
        onCancel={onCancel}
        onConfirm={() => selected && onConfirm(selected)}
      />
    </ModalShell>
  );
}

// Athlete-list thumbnail. Uses the same broken-image fallback as Avatar but
// keyed off the URL so swapping athletes resets the broken flag cleanly.
function AthleteThumb({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
      color: '#fff', fontSize: size * 0.42, fontWeight: 800, lineHeight: 1,
      flexShrink: 0,
    }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : initialOf(name)}
    </span>
  );
}

function ConfirmModal({
  title, body, confirmLabel, danger, onCancel, onConfirm,
}: {
  title: string; body: string; confirmLabel: string;
  danger?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onCancel} maxWidth={380}>
      <div style={{ fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.55 }}>{body}</div>
      <ModalActions
        confirmLabel={confirmLabel}
        confirmDanger={danger}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </ModalShell>
  );
}

// ── Inline icons + styles ─────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.8rem',
  background: 'var(--input-bg)', color: 'var(--text)',
  border: '1px solid var(--input-border)', borderRadius: 9,
  fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};

function SearchIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
