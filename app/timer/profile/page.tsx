'use client';

// Timer-mode profile. Lives inside the /timer portal so the user can
// edit their display name and check their stats without leaving the
// timer's dark theme. The main-site profile at /profile stays the
// canonical place for athlete linking, photo upload, etc. — this page
// reads the same users/{uid} doc and updates the same `displayName`
// field via the shared `updateProfile()` from auth-context.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { showToast } from '@/lib/toast';
import { fmtMs } from '@/lib/timer-engine';
import { WCA_EVENTS, type WcaEvent } from '@/lib/wca-events';
import TimerProfileMenu from '@/components/timer/TimerProfileMenu';

// Same palette the rest of /timer uses. Replicated locally rather than
// imported so the profile page stays self-contained and the timer's
// `C` constant doesn't have to be exported (it isn't, today).
const C = {
  bg:        '#0a0a0a',
  card:      '#141414',
  cardAlt:   '#1a1a1a',
  border:    'rgba(255,255,255,0.06)',
  borderHi:  'rgba(167,139,250,0.4)',
  text:      '#e8e8ed',
  muted:     '#8b8d98',
  mutedDim:  '#5a5d68',
  accent:    '#a78bfa',
  accentDim: 'rgba(167,139,250,0.15)',
  success:   '#34d399',
  danger:    '#ef4444',
} as const;

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';

function initialOf(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  return t.length > 0 ? t[0].toUpperCase() : '?';
}

function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'admin':      return 'ADMIN';
    case 'athlete':    return 'ATHLETE';
    case 'unverified': return 'UNVERIFIED';
    default:           return 'USER';
  }
}

export default function TimerProfilePage() {
  const router = useRouter();
  const { user, loading, updateProfile } = useAuth();

  // Inline name edit
  const [editing, setEditing]       = useState(false);
  const [draft, setDraft]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [editError, setEditError]   = useState('');

  // Extra stats fetched from Firestore on mount
  const [bestAo5, setBestAo5]       = useState<Record<string, number>>({});
  const [mpWins, setMpWins]         = useState<number | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  // Auth gate — redirect unauthenticated visitors back through /login,
  // returning them here once signed in.
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?redirect=/timer/profile');
    }
  }, [loading, user, router]);

  // Pull `bestAo5ByEvent` (lib/points.ts writes this on the user doc)
  // and tally multiplayer wins from the matchHistory collection. Both
  // are one-shot reads — the page doesn't need to live-subscribe.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!cancelled) {
          const data = userSnap.data() ?? {};
          const ao5 = (data.bestAo5ByEvent as Record<string, number> | undefined) ?? {};
          setBestAo5(ao5);
        }
      } catch { /* ignore network errors — UI falls back to "no data" */ }
      try {
        const q = query(
          collection(db, 'matchHistory'),
          where('playerUids', 'array-contains', user.uid),
        );
        const snap = await getDocs(q);
        if (!cancelled) {
          let wins = 0;
          snap.forEach((d) => {
            const data = d.data() as { winner?: { uid?: string } | null };
            if (data?.winner?.uid === user.uid) wins++;
          });
          setMpWins(wins);
        }
      } catch { /* ignore */ }
      if (!cancelled) setStatsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || !user) {
    return (
      <div style={{
        minHeight: '100vh', background: C.bg, color: C.muted,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT_STACK, fontSize: '0.9rem',
      }}>
        Уншиж байна…
      </div>
    );
  }

  const startEdit = () => {
    setDraft(user.displayName ?? '');
    setEditError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditError('');
  };

  const saveEdit = async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      setEditError('Нэр 2-20 тэмдэгт байх ёстой');
      return;
    }
    if (trimmed === (user.displayName ?? '').trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await updateProfile({ displayName: trimmed });
      setEditing(false);
      showToast({ msg: 'Хадгаллаа ✓', tone: 'success' });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Хадгалах үед алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')      { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  // Per-event Ao5 entries, ordered by WCA_EVENTS so 3x3 / 2x2 / 4x4
  // appear in canonical order. Filtered to events the user has data
  // for so empty rows don't pad the card.
  const ao5Entries: { ev: WcaEvent; ms: number }[] = WCA_EVENTS
    .map(ev => ({ ev, ms: bestAo5[ev.id] }))
    .filter((x): x is { ev: WcaEvent; ms: number } =>
      typeof x.ms === 'number' && Number.isFinite(x.ms));

  return (
    <div className="timer-page" style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: FONT_STACK,
    }}>
      {/* Top bar — back to timer + page title + profile menu, mirroring
          the multiplayer page's TimerHeader pattern. */}
      <header style={{
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: '0.6rem 0.85rem',
        display: 'flex', alignItems: 'center', gap: '0.6rem',
      }}>
        <Link
          href="/timer"
          style={{
            background: 'transparent', border: `1px solid ${C.border}`,
            color: C.muted, borderRadius: 8, padding: '0.4rem 0.7rem',
            fontSize: '0.78rem', fontFamily: 'inherit',
            textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            flexShrink: 0,
          }}
        >
          ← Timer-руу буцах
        </Link>
        <div style={{
          fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em',
          flex: '1 1 auto', minWidth: 0, textAlign: 'center',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          Хувийн мэдээлэл
        </div>
        <div style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
          <TimerProfileMenu size={32} redirectAfterLogin="/timer/profile" align="right" />
        </div>
      </header>

      <main style={{
        maxWidth: 600, margin: '0 auto',
        padding: '1.75rem 1rem 2.5rem',
        display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center',
      }}>
        {/* Avatar — gradient lavender→pink fallback with first letter,
            matches /profile's avatar style. */}
        <div style={{
          width: 96, height: 96, borderRadius: '50%',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #a78bfa, #ec4899)',
          color: '#fff', fontSize: '2.4rem', fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {user.photoURL && !avatarBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.photoURL}
              alt={user.displayName ?? 'avatar'}
              referrerPolicy="no-referrer"
              onError={() => setAvatarBroken(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            initialOf(user.displayName)
          )}
        </div>

        {/* Display name (editable) + role badge */}
        <div style={{ width: '100%', textAlign: 'center' }}>
          {!editing ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.4rem', fontWeight: 700, color: C.text }}>
                {user.displayName || 'Player'}
              </span>
              <button
                onClick={startEdit}
                aria-label="Засах"
                title="Засах"
                style={{
                  background: 'transparent', border: `1px solid ${C.border}`,
                  color: C.muted, borderRadius: 8, padding: '0.3rem 0.6rem',
                  fontSize: '0.75rem', fontFamily: 'inherit', cursor: 'pointer',
                  transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = C.accentDim;
                  e.currentTarget.style.color = C.accent;
                  e.currentTarget.style.borderColor = C.borderHi;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = C.muted;
                  e.currentTarget.style.borderColor = C.border;
                }}
              >
                ✎ Засах
              </button>
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
            }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="text"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  autoFocus
                  maxLength={30}
                  aria-label="Display name"
                  style={{
                    background: C.cardAlt, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: '0.45rem 0.7rem', fontSize: '1.05rem', fontWeight: 600,
                    fontFamily: 'inherit', outline: 'none',
                    minWidth: 200, textAlign: 'center',
                  }}
                />
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  aria-label="Хадгалах"
                  title="Хадгалах"
                  style={{
                    background: C.accentDim, color: C.accent,
                    border: `1px solid ${C.borderHi}`, borderRadius: 8,
                    padding: '0.4rem 0.65rem', fontSize: '0.85rem', fontWeight: 700,
                    fontFamily: 'inherit',
                    cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1,
                  }}
                >
                  ✓
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  aria-label="Цуцлах"
                  title="Цуцлах"
                  style={{
                    background: 'transparent', color: C.muted,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: '0.4rem 0.65rem', fontSize: '0.85rem',
                    fontFamily: 'inherit', cursor: saving ? 'wait' : 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
              {editError && (
                <div style={{ color: C.danger, fontSize: '0.78rem' }}>{editError}</div>
              )}
            </div>
          )}
          <div style={{
            marginTop: '0.55rem',
            display: 'inline-flex', alignItems: 'center',
            padding: '0.18rem 0.6rem', borderRadius: 999,
            background: C.accentDim, color: C.accent,
            fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.14em',
          }}>
            {roleLabel(user.role)}
          </div>
        </div>

        {/* Stats */}
        <section style={{
          width: '100%',
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '1rem 1.1rem',
        }}>
          <div style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '0.85rem',
          }}>
            STATS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <StatRow label="Total solves" value={String(user.totalSolves ?? 0)} />
            <StatRow
              label="Multiplayer wins"
              value={mpWins == null && !statsLoaded ? '…' : String(mpWins ?? 0)}
            />
            <StatRow
              label="Points"
              value={`${user.points ?? 0} 💎`}
              valueColor={C.accent}
            />
            {ao5Entries.length > 0 && (
              <>
                <div style={{ height: 1, background: C.border, margin: '0.4rem 0 0.2rem' }} />
                {ao5Entries.map(({ ev, ms }) => (
                  <StatRow
                    key={ev.id}
                    label={`Best Ao5 (${ev.short})`}
                    value={fmtMs(ms, false, 'cs')}
                  />
                ))}
              </>
            )}
            {ao5Entries.length === 0 && statsLoaded && (
              <div style={{
                color: C.mutedDim, fontSize: '0.78rem', paddingTop: '0.3rem',
              }}>
                Ao5 өгөгдөл хараахан байхгүй — хэдэн солв хийгээрэй.
              </div>
            )}
          </div>
        </section>

        {/* Athlete-link CTA — the request flow itself lives on the
            main-site /profile page; this is just a pointer so timer
            users know where to opt in. */}
        {!user.athleteId && (
          <section style={{
            width: '100%',
            background: C.cardAlt,
            border: `1px dashed ${C.border}`,
            borderRadius: 14,
            padding: '0.95rem 1rem',
            display: 'flex', flexDirection: 'column', gap: '0.4rem',
          }}>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text }}>
              Athlete-той холбогдоогүй
            </div>
            <div style={{ fontSize: '0.8rem', color: C.muted, lineHeight: 1.5 }}>
              Тамирчны бүртгэлтэй холбогдвол хувийн рекорд, тэмцээний түүх энд харагдана.
            </div>
            <Link
              href="/profile"
              style={{
                alignSelf: 'flex-start', marginTop: '0.3rem',
                background: C.accentDim, color: C.accent,
                border: `1px solid ${C.borderHi}`, borderRadius: 8,
                padding: '0.4rem 0.8rem', fontSize: '0.78rem', fontWeight: 700,
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              }}
            >
              Холбогдох хүсэлт →
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}

function StatRow({
  label, value, valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: '0.6rem',
    }}>
      <span style={{ fontSize: '0.85rem', color: C.muted }}>{label}</span>
      <span style={{
        fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
        fontSize: '0.95rem', fontWeight: 700,
        color: valueColor ?? C.text,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  );
}
