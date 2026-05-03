'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@/lib/auth-context';
import { getAthletes, getAthlete } from '@/lib/firebase/services/athletes';
import {
  cancelAthleteRequest,
  submitAthleteRequest,
  subscribeUserRequests,
  tsToMs,
} from '@/lib/firebase/services/athleteRequests';
import {
  subscribeUserMatches,
  tsToMs as matchTsToMs,
} from '@/lib/firebase/services/matchHistory';
import type {
  Athlete,
  AthleteRequest,
  MatchHistory,
  MatchPlayerSummary,
  MatchPenalty,
  MatchSolve,
} from '@/lib/types';

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

        {/* ── Athlete-link card (3-state: linked / pending / claim CTA) ── */}
        <AthleteLinkSection
          uid={user.uid}
          userDisplayName={user.displayName}
          userEmail={user.email}
          userPhotoURL={user.photoURL}
          linkedAthleteId={user.athleteId}
          linkedAthleteName={user.athleteId ? athleteName : null}
          onToast={showToast}
        />

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

        {/* ── Multiplayer stats + history ──────────────────────────────── */}
        <MultiplayerHistorySection uid={user.uid} />

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

// ── Athlete-link section ─────────────────────────────────────────────────
//
// Renders one of four states based on the user's link + request history:
//   1. Linked       — green card pointing to /competition?athlete=…
//   2. Pending      — yellow card with cancel button
//   3. Recently     — red banner showing the rejection reason (above CTA),
//      rejected     — followed by the CTA card so the user can try again
//   4. None         — purple CTA "Тамирчин болохыг хүсэх"
//
// Subscribes to the user's own request docs (single `where uid == X`,
// no composite index needed).
function AthleteLinkSection({
  uid, userDisplayName, userEmail, userPhotoURL,
  linkedAthleteId, linkedAthleteName, onToast,
}: {
  uid: string;
  userDisplayName: string;
  userEmail: string;
  userPhotoURL: string | null;
  linkedAthleteId: string | null;
  linkedAthleteName: string | null;
  onToast: (msg: string) => void;
}) {
  const [requests, setRequests] = useState<AthleteRequest[]>([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeUserRequests(
      uid,
      (rows) => { setRequests(rows); setRequestsLoaded(true); },
      (err) => { console.error('[profile] subscribeUserRequests', err); setRequestsLoaded(true); },
    );
    return () => unsub();
  }, [uid]);

  const pending = useMemo(() => requests.find(r => r.status === 'pending') ?? null, [requests]);
  const latestRejected = useMemo(() => {
    const rejected = requests
      .filter(r => r.status === 'rejected')
      .sort((a, b) => (tsToMs(b.resolvedAt) ?? 0) - (tsToMs(a.resolvedAt) ?? 0));
    return rejected[0] ?? null;
  }, [requests]);

  const cardStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: '1.4rem',
    boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
  };

  // Don't render anything until we know the request state — avoids a flash
  // of the CTA before the pending card appears.
  if (!requestsLoaded) return null;

  // 1. Linked → green confirmation
  if (linkedAthleteId) {
    return (
      <div style={{
        ...cardStyle,
        borderColor: 'rgba(52,211,153,0.45)',
        background: 'linear-gradient(180deg, rgba(52,211,153,0.08), var(--card))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <div style={{ fontSize: '1.4rem' }} aria-hidden="true">✅</div>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#34d399' }}>
              Баталгаажсан тамирчин
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text)', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {linkedAthleteName ?? '…'}
            </div>
          </div>
          {linkedAthleteName && (
            <Link
              href={`/competition?athlete=${encodeURIComponent(linkedAthleteId)}`}
              style={{
                flexShrink: 0,
                padding: '0.5rem 0.85rem', borderRadius: 9,
                background: 'rgba(52,211,153,0.12)', color: '#34d399',
                border: '1px solid rgba(52,211,153,0.45)',
                fontSize: '0.82rem', fontWeight: 700, textDecoration: 'none',
              }}
            >
              Профайл харах
            </Link>
          )}
        </div>
      </div>
    );
  }

  // 2. Pending → yellow waiting card
  if (pending) {
    const handleCancel = async () => {
      if (cancelling) return;
      setCancelling(true);
      try {
        await cancelAthleteRequest(pending.id);
        onToast('Хүсэлт цуцлагдлаа');
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err));
      } finally {
        setCancelling(false);
      }
    };
    return (
      <div style={{
        ...cardStyle,
        borderColor: 'rgba(251,191,36,0.45)',
        background: 'linear-gradient(180deg, rgba(251,191,36,0.08), var(--card))',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem' }}>
          <div style={{ fontSize: '1.4rem' }} aria-hidden="true">⏳</div>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fbbf24' }}>
              Хүсэлт хүлээгдэж байна
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text)', marginTop: '0.2rem' }}>
              {pending.athleteName}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
              Админ зөвшөөрөхийг хүлээнэ үү.
            </div>
          </div>
        </div>
        <button
          onClick={handleCancel}
          disabled={cancelling}
          style={{
            marginTop: '0.85rem', width: '100%',
            padding: '0.6rem 0.85rem', borderRadius: 9,
            background: 'transparent', color: '#fbbf24',
            border: '1px solid rgba(251,191,36,0.4)',
            fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
            cursor: cancelling ? 'not-allowed' : 'pointer',
            opacity: cancelling ? 0.6 : 1,
          }}
        >
          Хүсэлт цуцлах
        </button>
      </div>
    );
  }

  // 3. Recently rejected → red banner above CTA, plus CTA below
  // 4. None → just the CTA
  return (
    <>
      {latestRejected && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.45)',
          borderRadius: 12, padding: '0.85rem 1rem',
          color: '#fca5a5', fontSize: '0.86rem', lineHeight: 1.55,
        }}>
          <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.2rem' }}>
            ❌ Хүсэлт татгалзагдсан
          </div>
          {latestRejected.athleteName} —{' '}
          <span style={{ color: 'var(--text)' }}>
            {latestRejected.rejectReason || 'Шалтгаан тэмдэглэгдээгүй.'}
          </span>
        </div>
      )}

      <div style={{
        ...cardStyle,
        borderColor: 'rgba(167,139,250,0.35)',
        background: 'linear-gradient(180deg, rgba(167,139,250,0.06), var(--card))',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '1.6rem', marginBottom: '0.35rem' }} aria-hidden="true">🏆</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)' }}>
          Та клубын тамирчин уу?
        </div>
        <div style={{ fontSize: '0.86rem', color: 'var(--muted)', marginTop: '0.35rem', lineHeight: 1.5 }}>
          Профайлаа баталгаажуулж нэмэлт боломжуудыг ашиглаарай
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            marginTop: '1rem',
            padding: '0.75rem 1.4rem', borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            color: '#fff', border: 'none',
            fontSize: '0.92rem', fontWeight: 800, letterSpacing: '0.02em',
            fontFamily: 'inherit', cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          Тамирчин болохыг хүсэх
        </button>
      </div>

      {modalOpen && (
        <AthleteSelectionModal
          uid={uid}
          userDisplayName={userDisplayName}
          userEmail={userEmail}
          userPhotoURL={userPhotoURL}
          onClose={() => setModalOpen(false)}
          onSubmitted={() => { setModalOpen(false); onToast('Хүсэлт илгээгдлээ. Админ зөвшөөрөхийг хүлээнэ үү.'); }}
        />
      )}
    </>
  );
}

// ── Athlete selection modal ──────────────────────────────────────────────
function AthleteSelectionModal({
  uid, userDisplayName, userEmail, userPhotoURL,
  onClose, onSubmitted,
}: {
  uid: string;
  userDisplayName: string;
  userEmail: string;
  userPhotoURL: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Athlete | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAthletes()
      .then(list => { if (!cancelled) { setAthletes(list); setLoading(false); } })
      .catch(err => {
        if (cancelled) return;
        console.error('[profile] getAthletes', err);
        setError('Тамирчдын жагсаалт ачаалж чадсангүй.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Available = not yet linked to anyone. ownerId may be missing on legacy
  // docs (those are also available — falsy ownerId means free).
  const RESULT_LIMIT = 10;
  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = athletes
      .filter(a => !a.ownerId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(a => {
        if (!q) return true;
        const name = `${a.name} ${a.lastName ?? ''}`.toLowerCase();
        return name.includes(q) || (a.wcaId ?? '').toLowerCase().includes(q);
      });
    return { list: list.slice(0, RESULT_LIMIT), totalMatched: list.length };
  }, [athletes, search]);

  const handleSubmit = useCallback(async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await submitAthleteRequest({
        uid,
        userDisplayName,
        userEmail,
        userPhotoURL,
        athleteId: selected.id,
        athleteName: `${selected.name}${selected.lastName ? ' ' + selected.lastName : ''}`,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [selected, submitting, uid, userDisplayName, userEmail, userPhotoURL, onSubmitted]);

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
          width: '100%', maxWidth: 480,
          background: 'var(--card)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 2rem)', overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>Тамирчингаа сонгох</div>
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

        <div style={{ padding: '1rem', overflow: 'auto' }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Тамирчны нэр / WCA ID хайх..."
            style={{
              width: '100%', padding: '0.6rem 0.8rem',
              background: 'var(--input-bg)', color: 'var(--text)',
              border: '1px solid var(--input-border)', borderRadius: 9,
              fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          <div style={{
            marginTop: '0.6rem',
            maxHeight: 360, overflow: 'auto',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
          }}>
            {loading ? (
              <div style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.86rem' }}>
                Уншиж байна…
              </div>
            ) : matched.list.length === 0 ? (
              <div style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.86rem' }}>
                Боломжтой тамирчин олдсонгүй.
              </div>
            ) : (
              matched.list.map(a => {
                const isSelected = selected?.id === a.id;
                const fullName = `${a.name}${a.lastName ? ' ' + a.lastName : ''}`;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: '0.6rem',
                      padding: '0.55rem 0.75rem',
                      background: isSelected ? 'rgba(124,58,237,0.18)' : 'transparent',
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

          {error && (
            <div style={{
              marginTop: '0.75rem', padding: '0.55rem 0.75rem',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 8, color: '#fca5a5', fontSize: '0.82rem',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', marginTop: '1rem' }}>
            <button
              onClick={onClose}
              style={{
                padding: '0.7rem 0.85rem', borderRadius: 9,
                background: 'transparent', color: 'var(--text)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >Болих</button>
            <button
              onClick={handleSubmit}
              disabled={!selected || submitting}
              style={{
                padding: '0.7rem 0.85rem', borderRadius: 9,
                background: !selected || submitting ? 'var(--input-bg)' : 'linear-gradient(135deg, var(--accent), var(--accent2))',
                color: '#fff', border: 'none',
                fontSize: '0.9rem', fontWeight: 800, fontFamily: 'inherit',
                cursor: !selected || submitting ? 'not-allowed' : 'pointer',
                opacity: !selected ? 0.55 : 1,
              }}
            >{submitting ? 'Илгээж байна…' : 'Хүсэлт илгээх'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

// ── Multiplayer history + stats ──────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  '333': '3x3', '222': '2x2', '444': '4x4', '555': '5x5', '666': '6x6', '777': '7x7',
  pyram: 'Pyraminx', skewb: 'Skewb', sq1: 'Square-1', clock: 'Clock', minx: 'Megaminx',
};

function eventLabel(id: string): string {
  return EVENT_LABEL[id] ?? id.toUpperCase();
}

function rankIcon(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

function fmtMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'DNF';
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  return `${s}.${String(cs).padStart(2, '0')}`;
}

function formatMatchDate(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function fmtSolveCell(s: MatchSolve): { text: string; isDNF: boolean; isPlus2: boolean } {
  if (s.penalty === 'dnf') return { text: 'DNF', isDNF: true, isPlus2: false };
  if (s.penalty === '+2') return { text: `${fmtMs(s.ms + 2000)}+`, isDNF: false, isPlus2: true };
  return { text: fmtMs(s.ms), isDNF: false, isPlus2: false };
}

interface DerivedStats {
  total: number;
  wins: number;
  winRate: number;
  bestAo5: number | null;
}

function deriveStats(matches: MatchHistory[], uid: string): DerivedStats {
  let wins = 0;
  let bestAo5: number | null = null;
  for (const m of matches) {
    const me = m.players.find(p => p.uid === uid);
    if (!me) continue;
    if (me.finalRank === 1) wins += 1;
    for (const ao5 of me.ao5s) {
      if (ao5 == null) continue;
      if (bestAo5 === null || ao5 < bestAo5) bestAo5 = ao5;
    }
  }
  const total = matches.length;
  return {
    total,
    wins,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    bestAo5,
  };
}

function MultiplayerHistorySection({ uid }: { uid: string }) {
  const [matches, setMatches] = useState<MatchHistory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openMatch, setOpenMatch] = useState<MatchHistory | null>(null);

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeUserMatches(uid, (rows) => {
      setMatches(rows);
      setLoaded(true);
    }, {
      limit: 20,
      onError: (err) => {
        console.error('[profile] subscribeUserMatches', err);
        setLoaded(true);
      },
    });
    return () => unsub();
  }, [uid]);

  const stats = useMemo(() => deriveStats(matches, uid), [matches, uid]);

  const cardStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: '1.4rem',
    boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
  };

  return (
    <>
      {/* Stats card — always renders so the structure is stable while
          matches load. Numbers fall back to 0 / — until data arrives. */}
      <div style={cardStyle}>
        <div style={{
          fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginBottom: '0.75rem',
        }}>
          Multiplayer статистик
        </div>
        <div className="mp-stats-grid">
          <MpStat label="Нийт тоглолт"   value={loaded ? String(stats.total) : '—'} />
          <MpStat label="Хожсон"          value={loaded ? String(stats.wins)  : '—'} accent="#34d399" />
          <MpStat label="Хожих хувь"      value={loaded ? `${stats.winRate}%` : '—'} accent="#a78bfa" />
          <MpStat label="Хамгийн сайн"    value={stats.bestAo5 != null ? fmtMs(stats.bestAo5) : '—'} mono accent="#fbbf24" />
        </div>
      </div>

      {/* History list */}
      <div style={cardStyle}>
        <div style={{
          fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginBottom: '0.75rem',
        }}>
          Multiplayer түүх
        </div>

        {!loaded ? (
          <div style={{ padding: '0.6rem 0', color: 'var(--muted)', fontSize: '0.86rem' }}>Уншиж байна…</div>
        ) : matches.length === 0 ? (
          <div style={{ padding: '0.6rem 0', color: 'var(--muted)', fontSize: '0.88rem' }}>Тоглолт байхгүй байна</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            {matches.map(m => (
              <MatchCard key={m.id} match={m} uid={uid} onOpen={() => setOpenMatch(m)} />
            ))}
          </div>
        )}
      </div>

      {openMatch && (
        <MatchDetailModal
          match={openMatch}
          uid={uid}
          onClose={() => setOpenMatch(null)}
        />
      )}

      <style>{`
        .mp-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.55rem;
        }
        @media (max-width: 560px) {
          .mp-stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </>
  );
}

function MpStat({ label, value, accent, mono }: { label: string; value: string; accent?: string; mono?: boolean }) {
  return (
    <div style={{
      padding: '0.65rem 0.75rem', borderRadius: 11,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: '0.18rem',
      minWidth: 0,
    }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.2rem', fontWeight: 800,
        color: accent ?? 'var(--text)',
        fontFamily: mono ? 'JetBrains Mono, monospace' : undefined,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </div>
  );
}

function MatchCard({ match, uid, onOpen }: { match: MatchHistory; uid: string; onOpen: () => void }) {
  const me = match.players.find(p => p.uid === uid);
  const myBestAo5 = useMemo(() => {
    if (!me) return null;
    let best: number | null = null;
    for (const a of me.ao5s) {
      if (a == null) continue;
      if (best === null || a < best) best = a;
    }
    return best;
  }, [me]);
  const opponents = Math.max(0, match.players.length - 1);
  const playedAt = matchTsToMs(match.playedAt);
  const rank = me?.finalRank ?? null;

  return (
    <button
      onClick={onOpen}
      style={{
        width: '100%', textAlign: 'left',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12, padding: '0.85rem',
        color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: '0.55rem',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,0.45)'; e.currentTarget.style.background = 'rgba(124,58,237,0.06)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>
          {formatMatchDate(playedAt)}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>
          {opponents === 0 ? 'Дан тоглолт' : `${opponents} өрсөлдөгч`}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 38, height: 38, borderRadius: 10,
          background: 'rgba(124,58,237,0.12)',
          border: '1px solid rgba(124,58,237,0.35)',
          fontSize: '0.85rem', fontWeight: 800, color: '#c4b5fd',
        }}>
          {eventLabel(match.event)}
        </span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div style={{ fontSize: '0.92rem', fontWeight: 700 }}>
            {match.totalRounds} раунд · {match.players.length} тоглогч
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
            Хамгийн сайн Ao5:{' '}
            <span style={{ color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace' }}>
              {myBestAo5 != null ? fmtMs(myBestAo5) : '—'}
            </span>
          </div>
        </div>
        {rank !== null && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.35rem 0.7rem', borderRadius: 999,
            background: rank === 1 ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${rank === 1 ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.1)'}`,
            color: rank === 1 ? '#34d399' : 'var(--text)',
            fontSize: '0.78rem', fontWeight: 800, whiteSpace: 'nowrap',
          }}>
            {rankIcon(rank)} {rank}-р байр
          </div>
        )}
      </div>
    </button>
  );
}

function MatchDetailModal({
  match, uid, onClose,
}: { match: MatchHistory; uid: string; onClose: () => void }) {
  // Lock body scroll while modal is open so iOS Safari doesn't leak the
  // touch-scroll into the page underneath.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const playedAt = matchTsToMs(match.playedAt);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640,
          background: 'var(--card)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 2rem)', overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.95rem 1rem',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          gap: '0.6rem',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '1rem', fontWeight: 800 }}>
              {eventLabel(match.event)} · {match.totalRounds} раунд
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
              {formatMatchDate(playedAt)}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Хаах"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--muted)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >×</button>
        </header>

        <div style={{ padding: '1rem', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Final standings */}
          <section>
            <SectionHeading>Эцсийн байр</SectionHeading>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {match.players.map(p => (
                <PlayerRow key={p.uid} player={p} isMe={p.uid === uid} />
              ))}
            </div>
          </section>

          {/* Per-round breakdown */}
          {match.rounds.map(round => (
            <section key={round.roundNumber}>
              <SectionHeading>{round.roundName}</SectionHeading>
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', borderCollapse: 'collapse',
                  fontSize: '0.82rem',
                }}>
                  <thead>
                    <tr style={{ color: 'var(--muted)', fontSize: '0.7rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                      <th style={cellStyle}>#</th>
                      <th style={{ ...cellStyle, textAlign: 'left' }}>Нэр</th>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <th key={i} style={cellStyle}>{i + 1}</th>
                      ))}
                      <th style={cellStyle}>Ao5</th>
                    </tr>
                  </thead>
                  <tbody>
                    {round.results.map(r => {
                      const isMe = r.uid === uid;
                      return (
                        <tr key={r.uid} style={{
                          background: isMe ? 'rgba(124,58,237,0.1)' : undefined,
                          borderTop: '1px solid rgba(255,255,255,0.05)',
                        }}>
                          <td style={{ ...cellStyle, fontWeight: 700, color: r.rank === 1 ? '#34d399' : 'var(--text)' }}>
                            {r.rank}
                          </td>
                          <td style={{ ...cellStyle, textAlign: 'left', fontWeight: isMe ? 700 : 600, color: isMe ? '#c4b5fd' : 'var(--text)' }}>
                            {r.name}
                          </td>
                          {Array.from({ length: 5 }).map((_, i) => {
                            const s = r.solves[i];
                            const cell = s ? fmtSolveCell(s) : { text: '—', isDNF: false, isPlus2: false };
                            return (
                              <td
                                key={i}
                                style={{
                                  ...cellStyle,
                                  fontFamily: 'JetBrains Mono, monospace',
                                  color: cell.isDNF ? '#ef4444' : cell.isPlus2 ? '#fbbf24' : 'var(--text)',
                                }}
                              >
                                {cell.text}
                              </td>
                            );
                          })}
                          <td style={{
                            ...cellStyle,
                            fontFamily: 'JetBrains Mono, monospace', fontWeight: 800,
                            color: r.ao5 == null ? '#ef4444' : 'var(--text)',
                          }}>
                            {r.ao5 == null ? 'DNF' : fmtMs(r.ao5)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '0.45rem 0.5rem',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.66rem', fontWeight: 700, color: 'var(--muted)',
      letterSpacing: '0.12em', textTransform: 'uppercase',
      marginBottom: '0.55rem',
    }}>
      {children}
    </div>
  );
}

function PlayerRow({ player, isMe }: { player: MatchPlayerSummary; isMe: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0.7rem',
      background: isMe ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isMe ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 10,
    }}>
      <span style={{
        width: 26, height: 26, borderRadius: '50%',
        background: player.finalRank === 1 ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${player.finalRank === 1 ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.1)'}`,
        color: player.finalRank === 1 ? '#34d399' : 'var(--text)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.78rem', fontWeight: 800, flexShrink: 0,
      }}>{player.finalRank}</span>
      <AthleteThumb name={player.name} url={player.photoURL} size={28} />
      <span style={{ flex: '1 1 auto', minWidth: 0, fontWeight: isMe ? 800 : 600, color: isMe ? '#c4b5fd' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {player.name}{rankIcon(player.finalRank) && ` ${rankIcon(player.finalRank)}`}
      </span>
      <span style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{player.totalPoints}</span>{' '}оноо
      </span>
    </div>
  );
}
