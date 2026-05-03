'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@/lib/auth-context';
import { getAthlete } from '@/lib/firebase/services/athletes';

const ROLE_BADGE: Record<UserRole, { label: string; fg: string; bg: string; border: string }> = {
  member:  { label: 'Гишүүн',   fg: '#a78bfa', bg: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.45)' },
  athlete: { label: 'Тамирчин', fg: '#34d399', bg: 'rgba(52,211,153,0.15)',  border: 'rgba(52,211,153,0.45)' },
  admin:   { label: 'Админ',    fg: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.45)' },
};

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}

function formatJoinedDate(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, signOut, updateProfile } = useAuth();

  // ── Guards ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // ── Linked athlete lookup ───────────────────────────────────────────────
  // Only fires when there's actually an athleteId to resolve. The athletes
  // collection is read-only here — linking lives in a later step.
  const [athleteName, setAthleteName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!user?.athleteId) {
      setAthleteName(null);
      return;
    }
    getAthlete(user.athleteId)
      .then(a => {
        if (cancelled) return;
        setAthleteName(a ? `${a.name}${a.lastName ? ' ' + a.lastName : ''}` : null);
      })
      .catch(err => console.error('[profile] getAthlete', err));
    return () => { cancelled = true; };
  }, [user?.athleteId]);

  // ── Inline display-name edit ────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [toast, setToast] = useState<string>('');
  const toastTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  };

  const startEdit = () => {
    setDraft(user?.displayName ?? '');
    setEditError('');
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setEditError('');
  };
  const saveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) { setEditError('Нэр хоосон байж болохгүй.'); return; }
    if (trimmed === user?.displayName) { setEditing(false); return; }
    setSaving(true);
    setEditError('');
    try {
      await updateProfile({ displayName: trimmed });
      setEditing(false);
      showToast('Профайл шинэчлэгдлээ');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try { await signOut(); } catch (err) { console.error('[profile] signOut', err); }
    router.push('/');
  };

  const badge = useMemo(() => (user ? ROLE_BADGE[user.role] : null), [user]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading || !user) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 60px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <Spinner />
      </div>
    );
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: '1.4rem',
    boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
  };

  return (
    <div className="profile-page" style={{
      minHeight: 'calc(100vh - 60px)',
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '1.5rem 1rem',
    }}>
      <div style={{
        maxWidth: 600, margin: '0 auto',
        display: 'flex', flexDirection: 'column', gap: '1rem',
      }}>

        <h1 style={{
          fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.02em',
          margin: '0 0 0.25rem',
        }}>Профайл</h1>

        {/* ── Header card ───────────────────────────────────────────────── */}
        <div style={{
          ...cardStyle,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '0.85rem', textAlign: 'center',
        }}>
          <div className="profile-avatar" style={{
            position: 'relative',
            width: 80, height: 80, borderRadius: '50%',
            padding: 3,
            background: 'linear-gradient(135deg, transparent, transparent)',
            transition: 'background 0.22s',
          }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: '50%',
              overflow: 'hidden',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              color: '#fff', fontSize: '2rem', fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}>
              {user.photoURL && !avatarBroken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarBroken(true)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                initialOf(user.displayName)
              )}
            </div>
          </div>

          {/* Display name — view + inline edit */}
          {editing ? (
            <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch' }}>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !saving) saveEdit();
                    else if (e.key === 'Escape') cancelEdit();
                  }}
                  maxLength={40}
                  style={{
                    flex: '1 1 auto', minWidth: 0,
                    padding: '0.55rem 0.75rem',
                    background: 'var(--input-bg)', color: 'var(--text)',
                    border: '1px solid var(--input-border)', borderRadius: 9,
                    fontSize: '1rem', fontFamily: 'inherit', outline: 'none',
                    textAlign: 'center', fontWeight: 700,
                  }}
                />
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  aria-label="Хадгалах"
                  title="Хадгалах"
                  style={iconBtn('#34d399', 'rgba(52,211,153,0.45)', saving)}
                >
                  <CheckIcon />
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  aria-label="Болих"
                  title="Болих"
                  style={iconBtn('var(--muted)', 'rgba(255,255,255,0.12)', saving)}
                >
                  <XIcon />
                </button>
              </div>
              {editError && (
                <div style={{ fontSize: '0.78rem', color: '#f87171' }}>{editError}</div>
              )}
            </div>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '0.01em' }}>
                {user.displayName}
              </div>
              <button
                onClick={startEdit}
                aria-label="Өөрчлөх"
                title="Өөрчлөх"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--muted)', cursor: 'pointer',
                  padding: 4, borderRadius: 6, display: 'inline-flex',
                  transition: 'color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent'; }}
              >
                <PencilIcon />
              </button>
            </div>
          )}

          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {user.email || '—'}
          </div>

          {badge && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '0.25rem 0.75rem', borderRadius: 999,
              background: badge.bg, color: badge.fg,
              border: `1px solid ${badge.border}`,
              fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em',
            }}>{badge.label}</span>
          )}
        </div>

        {/* ── Stats card ────────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <div className="profile-stats">
            <Stat icon="💎" label="Point" value={String(user.points)} />
            <Stat
              icon="🏆"
              label="Тамирчин"
              value={user.athleteId ? (athleteName ?? '…') : 'Холбогдоогүй'}
              dim={!user.athleteId}
            />
            <Stat icon="📅" label="Гишүүн с" value={formatJoinedDate(user.createdAt)} />
          </div>
        </div>

        {/* ── Unlocked tools ───────────────────────────────────────────── */}
        <div style={cardStyle}>
          <div style={{
            fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)',
            letterSpacing: '0.12em', textTransform: 'uppercase',
            marginBottom: '0.7rem',
          }}>
            Нээгдсэн tool
          </div>
          {user.unlockedTools.length === 0 ? (
            <div style={{
              fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55,
              padding: '0.6rem 0',
            }}>
              Tool сонгогдоогүй байна. Point цуглуулж нээх боломжтой!
            </div>
          ) : (
            <ul style={{
              listStyle: 'none', margin: 0, padding: 0,
              display: 'flex', flexDirection: 'column', gap: '0.4rem',
            }}>
              {user.unlockedTools.map(t => (
                <li key={t} style={{
                  display: 'flex', alignItems: 'center', gap: '0.55rem',
                  padding: '0.6rem 0.75rem',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 10, fontSize: '0.92rem', fontWeight: 600,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: 'var(--accent)', flexShrink: 0,
                  }} />
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginTop: '0.25rem' }}>
          {user.role === 'admin' && (
            <Link
              href="/admin/dashboard"
              style={{
                width: '100%', padding: '0.8rem 1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                color: '#fff', textDecoration: 'none',
                border: 'none', borderRadius: 10,
                fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.02em',
                fontFamily: 'inherit', cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              <DashboardIcon /> Админ хэсэг
            </Link>
          )}
          <button
            onClick={handleSignOut}
            style={{
              width: '100%', padding: '0.8rem 1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              background: 'transparent', color: '#f87171',
              border: '1px solid rgba(248,113,113,0.4)', borderRadius: 10,
              fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.02em',
              fontFamily: 'inherit', cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.08)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.7)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.4)'; }}
          >
            <SignOutIcon /> Гарах
          </button>
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 'calc(60px + env(safe-area-inset-top, 0px) + 0.75rem)',
            left: '50%', transform: 'translateX(-50%)',
            zIndex: 1200,
            background: 'rgba(52,211,153,0.15)',
            border: '1px solid rgba(52,211,153,0.45)',
            color: '#34d399',
            padding: '0.55rem 1rem', borderRadius: 999,
            fontSize: '0.85rem', fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            animation: 'profile-toast-in 0.22s ease-out',
            maxWidth: 'calc(100vw - 2rem)',
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        .profile-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.7rem;
        }
        @media (max-width: 560px) {
          .profile-stats { grid-template-columns: 1fr; }
        }
        @media (min-width: 720px) {
          .profile-page { padding: 2.5rem 1.5rem; }
        }
        .profile-avatar:hover {
          background: linear-gradient(135deg, var(--accent), var(--accent2)) !important;
        }
        @keyframes profile-toast-in {
          from { opacity: 0; transform: translate(-50%, -6px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function Stat({ icon, label, value, dim }: {
  icon: string; label: string; value: string; dim?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.3rem',
      padding: '0.7rem 0.75rem',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: '0.65rem', color: 'var(--muted)',
        letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
        display: 'flex', alignItems: 'center', gap: '0.35rem',
      }}>
        <span aria-hidden="true">{icon}</span> {label}
      </div>
      <div style={{
        fontSize: '1rem', fontWeight: 700,
        color: dim ? 'var(--muted)' : 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={value}>
        {value}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        width: 36, height: 36, borderRadius: '50%',
        border: '3px solid rgba(255,255,255,0.12)',
        borderTopColor: 'var(--accent)',
        animation: 'profile-spin 0.85s linear infinite',
      }}
    >
      <style>{`@keyframes profile-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function iconBtn(fg: string, border: string, disabled: boolean): React.CSSProperties {
  return {
    width: 38, flexShrink: 0,
    background: 'transparent', color: fg,
    border: `1px solid ${border}`, borderRadius: 9,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit',
  };
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function DashboardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
