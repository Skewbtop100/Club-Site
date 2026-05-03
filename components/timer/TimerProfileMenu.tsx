'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// Shared dark-theme palette — matches the timer page's local C constant
// without coupling this component to that file. Kept inline so this
// component is self-contained and drop-in across all timer routes.
const C = {
  card:    '#141414',
  cardAlt: '#1a1a1a',
  border:  'rgba(255,255,255,0.08)',
  borderHi:'rgba(167,139,250,0.45)',
  text:    '#e8e8ed',
  muted:   '#8b8d98',
  accent:  '#a78bfa',
  accent2: '#ec4899',
  danger:  '#ef4444',
} as const;

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const cp = trimmed.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : '?';
}

// Optional extra menu item slot. The mobile timer header uses this to
// inject Multiplayer + "Шинэ session" entries at the top of the dropdown
// (those buttons used to live in the header itself but were too crowded).
// Renders above the standard Профайл / Нүүр хуудас / Гарах items, with a
// divider in between. Label text owns its own emoji/glyph since emojis
// don't recolor through the icon-tint prop.
export interface TimerProfileMenuExtra {
  label: string;
  onClick: () => void;
}

export interface TimerProfileMenuProps {
  /**
   * Avatar size in px. Default 30 — picks a size that visually matches
   * the surrounding settings/Bluetooth/leave icons on each timer page.
   */
  size?: number;
  /**
   * Path the user is on right now — appended as `?redirect=` when an
   * unauthenticated user clicks Login so they bounce back here after.
   * Defaults to '/timer'; pass '/timer/multiplayer' from that page.
   */
  redirectAfterLogin?: string;
  /**
   * Which edge to anchor the dropdown to. The menu still flips upward
   * when there isn't room below (see autoFlip effect).
   */
  align?: 'left' | 'right';
  /**
   * Extra menu items inserted as the FIRST group in the dropdown. The
   * dropdown auto-closes after the callback fires.
   */
  extras?: TimerProfileMenuExtra[];
}

export default function TimerProfileMenu({
  size = 30,
  redirectAfterLogin = '/timer',
  align = 'right',
  extras,
}: TimerProfileMenuProps) {
  const router = useRouter();
  const { user, signOut, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reset broken-avatar fallback when the photo changes (sign-in/out).
  useEffect(() => { setAvatarBroken(false); }, [user?.photoURL]);

  // Close on outside click + ESC. Uses capture-phase mousedown so we
  // close before the click lands on whatever's behind, which matters
  // when the menu sits over the timer touch area.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Decide which way to flip the dropdown. Opening near the bottom edge
  // would clip the menu, so we measure once on open + on resize.
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const ESTIMATED_MENU_HEIGHT = 240;
      setFlipUp(spaceBelow < ESTIMATED_MENU_HEIGHT && rect.top > spaceBelow);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open]);

  // ── Guest fallback ────────────────────────────────────────────────────
  // While auth is still resolving we render a placeholder of the same
  // size so the surrounding layout doesn't reflow when the avatar
  // arrives. Show 'Login' once we know there's no session.
  if (loading) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: size, height: size, borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${C.border}`,
        }}
      />
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/login?redirect=${encodeURIComponent(redirectAfterLogin)}`)}
        style={{
          height: size,
          padding: '0 0.7rem',
          background: 'transparent',
          color: C.muted,
          border: `1px solid ${C.border}`,
          borderRadius: 999,
          fontSize: '0.78rem', fontWeight: 700,
          fontFamily: 'inherit', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.borderHi; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border; }}
      >
        Login
      </button>
    );
  }

  // ── Signed-in: avatar + dropdown ──────────────────────────────────────
  const handleNav = (path: string) => {
    setOpen(false);
    router.push(path);
  };
  const handleSignOut = async () => {
    setOpen(false);
    try { await signOut(); } catch (err) { console.error('[timer-profile] signOut', err); }
    router.push('/');
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.displayName}
        title={user.displayName}
        className="timer-profile-avatar"
        style={{
          width: size, height: size, borderRadius: '50%',
          padding: 0,
          background: 'transparent',
          border: `1px solid ${open ? C.borderHi : C.border}`,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: open ? `0 0 0 2px ${C.borderHi}` : 'none',
        }}
      >
        <span style={{
          width: '100%', height: '100%', borderRadius: '50%',
          background: `linear-gradient(135deg, ${C.accent}, ${C.accent2})`,
          color: '#fff', fontSize: size * 0.42, fontWeight: 800, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
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
          ) : initialOf(user.displayName)}
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute',
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
            ...(flipUp
              ? { bottom: 'calc(100% + 8px)' }
              : { top: 'calc(100% + 8px)' }),
            minWidth: 240,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 5,
            boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
            display: 'flex', flexDirection: 'column', gap: 2,
            zIndex: 1500,
            animation: 'timer-profile-fade 0.14s ease-out',
            color: C.text,
          }}
        >
          {/* Header — name + email + points-on-its-own-line */}
          <div style={{
            padding: '0.55rem 0.65rem 0.6rem',
            display: 'flex', flexDirection: 'column', gap: '0.18rem',
            minWidth: 0,
          }}>
            <div style={{
              fontSize: '0.85rem', fontWeight: 700, color: C.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{user.displayName}</div>
            <div style={{
              fontSize: '0.7rem', color: C.muted,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{user.email}</div>
            <div title="Point" style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              fontSize: '0.74rem', fontWeight: 700,
              color: C.accent,
              marginTop: '0.1rem',
            }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', fontWeight: 800 }}>
                💎 {user.points ?? 0}
              </span>
              <span style={{ color: C.muted, fontWeight: 600 }}>point</span>
            </div>
          </div>

          <Divider />

          {extras && extras.length > 0 && (
            <>
              {extras.map((item, i) => (
                <MenuItem
                  key={`extra-${i}`}
                  onClick={() => { setOpen(false); item.onClick(); }}
                >
                  {item.label}
                </MenuItem>
              ))}
              <Divider />
            </>
          )}

          <MenuItem onClick={() => handleNav('/profile')} icon={<UserIcon />}>Профайл</MenuItem>
          <MenuItem onClick={() => handleNav('/')}        icon={<HomeIcon />}>Нүүр хуудас</MenuItem>
          {user.role === 'admin' && (
            <MenuItem onClick={() => handleNav('/admin/dashboard')} icon={<DashboardIcon />}>Админ хэсэг</MenuItem>
          )}

          <Divider />

          <MenuItem onClick={handleSignOut} icon={<SignOutIcon />} danger>Гарах</MenuItem>
        </div>
      )}

      <style>{`
        @keyframes timer-profile-fade {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .timer-profile-avatar:hover {
          border-color: ${C.borderHi} !important;
          box-shadow: 0 0 0 2px ${C.borderHi} !important;
        }
      `}</style>
    </span>
  );
}

function MenuItem({
  children, onClick, icon, danger,
}: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.55rem',
        padding: '0.55rem 0.65rem', borderRadius: 8,
        background: 'none', border: 'none',
        color: danger ? C.danger : C.text,
        fontSize: '0.85rem', fontWeight: 600,
        fontFamily: 'inherit', textAlign: 'left', width: '100%',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.1)' : 'rgba(167,139,250,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {icon && <span style={{ display: 'inline-flex', flexShrink: 0, color: 'currentColor', opacity: 0.85 }}>{icon}</span>}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </button>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '3px 6px' }} />;
}

// ── Inline icons (kept tiny so this file has no extra deps) ──────────────
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function DashboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
