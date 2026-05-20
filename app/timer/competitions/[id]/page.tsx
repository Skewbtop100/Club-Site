'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCompetition,
  getRounds,
  getParticipant,
  registerForCompetition,
  unregisterFromCompetition,
  subscribeParticipants,
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualCompetition,
  VirtualRound,
  VirtualParticipant,
} from '@/lib/firebase/services/virtual-competitions';
import { getEvent } from '@/lib/wca-events';
import { useAuth } from '@/lib/auth-context';

// ─── Theme ───────────────────────────────────────────────────────────────────

const C = {
  bg:        '#0a0a0a',
  card:      '#141414',
  cardAlt:   '#1a1a1a',
  border:    'rgba(255,255,255,0.06)',
  borderHi:  'rgba(167,139,250,0.4)',
  text:      '#e8e8ed',
  muted:     '#8b8d98',
  accent:    '#a78bfa',
  accentDim: 'rgba(167,139,250,0.15)',
  success:   '#34d399',
  danger:    '#ef4444',
} as const;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", "Fira Code", monospace';

// ─── Small components ─────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const pub = status === 'published';
  return (
    <span style={{
      display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 999,
      fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.07em',
      background: pub ? 'rgba(52,211,153,0.15)' : 'rgba(100,116,139,0.2)',
      color: pub ? C.success : C.muted,
    }}>
      {pub ? 'НЭЭЛТТЭЙ' : 'ХААГДСАН'}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: C.muted, marginBottom: '0.65rem',
    }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: C.border, margin: '1.1rem 1rem' }} />;
}

function CoverPlaceholder({ name }: { name: string }) {
  const letter = name.trim()[0]?.toUpperCase() ?? '?';
  return (
    <div style={{
      width: '100%', aspectRatio: '16/9',
      background: 'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(167,139,250,0.12) 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: '4.5rem', fontWeight: 800, color: 'rgba(167,139,250,0.35)', userSelect: 'none', fontFamily: FONT }}>
        {letter}
      </span>
    </div>
  );
}

function Avatar({ name, photoURL, size = 28 }: { name: string; photoURL?: string | null; size?: number }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  const letter = name.trim()[0]?.toUpperCase() ?? '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'rgba(167,139,250,0.22)', border: '1px solid rgba(167,139,250,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.43), fontWeight: 700, color: '#c4b5fd',
      fontFamily: FONT,
    }}>
      {letter}
    </div>
  );
}

function LoadingShell() {
  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ height: 14, width: 120, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />
      </div>
      <div style={{ aspectRatio: '16/9', background: 'rgba(255,255,255,0.03)' }} />
      <div style={{ padding: '1rem' }}>
        {[65, 40, 28].map((w, i) => (
          <div key={i} style={{
            height: i === 0 ? 22 : 13, width: `${w}%`,
            marginBottom: i < 2 ? '0.5rem' : 0,
            borderRadius: 4, background: 'rgba(255,255,255,0.05)',
          }} />
        ))}
      </div>
    </div>
  );
}

function NotFoundShell() {
  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '2rem', gap: '1rem', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Тэмцээн олдсонгүй</div>
      <Link href="/timer/competitions"
        style={{ fontSize: '0.85rem', color: C.muted, textDecoration: 'none' }}>
        ← Жагсаалт руу буцах
      </Link>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompetitionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [comp, setComp] = useState<VirtualCompetition | null>(null);
  const [rounds, setRounds] = useState<VirtualRound[]>([]);
  const [participants, setParticipants] = useState<VirtualParticipant[]>([]);
  const [initialParticipant, setInitialParticipant] = useState<VirtualParticipant | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmUnregister, setConfirmUnregister] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push(`/login?redirect=/timer/competitions/${id}`);
    } else if (!user.displayName?.trim()) {
      router.push('/timer/profile');
    }
  }, [authLoading, user, id, router]);

  // Fetch competition, rounds, and initial participant state
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      try {
        const [compData, roundsData, participantData] = await Promise.all([
          getCompetition(id),
          getRounds(id),
          getParticipant(id, user!.uid),
        ]);
        if (cancelled) return;
        if (!compData) {
          setNotFound(true);
          setPageLoading(false);
          return;
        }
        setComp(compData);
        setRounds(roundsData);
        setInitialParticipant(participantData);
        setSelectedEvents(participantData?.registeredEvents ?? []);
        setPageLoading(false);
      } catch {
        if (!cancelled) setPageLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [user, id]);

  // Live participant list
  useEffect(() => {
    if (!id) return;
    return subscribeParticipants(id, setParticipants);
  }, [id]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const roundsByEvent = rounds.reduce<Record<string, VirtualRound[]>>((acc, r) => {
    (acc[r.eventId] ??= []).push(r);
    return acc;
  }, {});

  const registered = initialParticipant !== null;
  const isClosed = comp?.status === 'closed';
  const savedEventsStr = [...(initialParticipant?.registeredEvents ?? [])].sort().join(',');
  const selectedEventsStr = [...selectedEvents].sort().join(',');
  const isSameEvents = registered && savedEventsStr === selectedEventsStr;

  // ── Button state ───────────────────────────────────────────────────────────

  let btnLabel: string;
  let btnDisabled: boolean;
  let btnGreen = false;

  if (isClosed) {
    btnLabel = 'Хаагдсан'; btnDisabled = true;
  } else if (isSameEvents) {
    btnLabel = 'Хадгалагдсан ✓'; btnDisabled = true; btnGreen = true;
  } else if (selectedEvents.length === 0) {
    btnLabel = 'Төрөл сонгоно уу'; btnDisabled = true;
  } else if (!registered) {
    btnLabel = `Бүртгүүлэх (${selectedEvents.length} төрөл)`; btnDisabled = false;
  } else {
    btnLabel = 'Шинэчлэх'; btnDisabled = false;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleEvent(eventId: string) {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId],
    );
  }

  async function handleRegister() {
    if (!user || !comp || saving || btnDisabled) return;
    const u = user;
    const c = comp;
    const wasRegistered = registered;
    setSaving(true);
    try {
      await registerForCompetition(
        c.id,
        { uid: u.uid, displayName: u.displayName, photoURL: u.photoURL },
        selectedEvents,
      );
      // Re-fetch to get the persisted record (includes Timestamp)
      const updated = await getParticipant(c.id, u.uid);
      setInitialParticipant(updated);
      setToast(wasRegistered ? 'Шинэчлэгдлээ ✓' : 'Бүртгүүллээ ✓');
    } catch {
      setToast('Алдаа гарлаа, дахин оролдоно уу');
    } finally {
      setSaving(false);
    }
  }

  async function handleUnregister() {
    if (!user || !comp || saving) return;
    const u = user;
    const c = comp;
    setSaving(true);
    try {
      await unregisterFromCompetition(c.id, u.uid);
      setInitialParticipant(null);
      setSelectedEvents([]);
      setConfirmUnregister(false);
      setToast('Бүртгэл цуцлагдлаа');
    } catch {
      setToast('Алдаа гарлаа, дахин оролдоно уу');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || (pageLoading && !notFound)) return <LoadingShell />;
  if (notFound) return <NotFoundShell />;
  if (!comp) return null;

  const meta = [comp.date, comp.location].filter(Boolean).join(' · ');

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg,
      fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Sticky header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: C.bg, borderBottom: `1px solid ${C.border}`,
        padding: '0.75rem 1rem', flexShrink: 0,
      }}>
        <Link href="/timer/competitions" style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.82rem', fontWeight: 600, color: C.muted, textDecoration: 'none',
          transition: 'color 0.15s',
        }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = C.text)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = C.muted)}
        >
          ← Жагсаалт руу буцах
        </Link>
      </div>

      {/* Scrollable body — padded bottom so content clears the sticky CTA */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '7rem' }}>

        {/* Cover */}
        {comp.imageUrl ? (
          <img src={comp.imageUrl} alt={comp.name}
            style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
        ) : (
          <CoverPlaceholder name={comp.name} />
        )}

        {/* Hero info */}
        <div style={{ padding: '1rem 1rem 0' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.35rem', color: C.text }}>
            {comp.name}
          </h1>
          {meta && (
            <div style={{ fontSize: '0.85rem', color: C.muted, fontFamily: MONO, marginBottom: '0.55rem' }}>
              {meta}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill status={comp.status} />
            <span style={{ fontSize: '0.75rem', color: C.muted, fontFamily: MONO }}>
              {participants.length} оролцогч
            </span>
          </div>
          {comp.description && (
            <p style={{ margin: '0.85rem 0 0', fontSize: '0.88rem', color: C.muted, lineHeight: 1.65 }}>
              {comp.description}
            </p>
          )}
        </div>

        <Divider />

        {/* Events grid */}
        <div style={{ padding: '0 1rem' }}>
          <SectionLabel>Төрлүүд</SectionLabel>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.5rem',
          }}>
            {comp.events.map((eventId) => {
              const ev = getEvent(eventId);
              const roundCount = roundsByEvent[eventId]?.length ?? 0;
              const selected = selectedEvents.includes(eventId);
              return (
                <button
                  key={eventId}
                  type="button"
                  onClick={() => !isClosed && toggleEvent(eventId)}
                  disabled={isClosed}
                  style={{
                    padding: '0.65rem 0.4rem',
                    borderRadius: 10,
                    border: `1px solid ${selected ? 'rgba(167,139,250,0.5)' : C.border}`,
                    background: selected ? 'rgba(167,139,250,0.1)' : C.card,
                    cursor: isClosed ? 'default' : 'pointer',
                    textAlign: 'center',
                    fontFamily: FONT,
                    transition: 'border-color 0.12s, background 0.12s',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: '0.18rem',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{ fontSize: '0.72rem', color: selected ? '#c4b5fd' : C.muted, lineHeight: 1 }}>
                    {selected ? '◉' : '○'}
                  </span>
                  <span style={{
                    fontSize: '0.82rem', fontWeight: 700,
                    color: selected ? '#e2d9ff' : C.text,
                  }}>
                    {ev?.short ?? eventId}
                  </span>
                  {roundCount > 0 && (
                    <span style={{ fontSize: '0.62rem', color: C.muted, fontFamily: MONO }}>
                      {roundCount} раунд
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <Divider />

        {/* Participants */}
        <div style={{ padding: '0 1rem 1rem' }}>
          <SectionLabel>Оролцогчид ({participants.length})</SectionLabel>
          {participants.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: C.muted, fontStyle: 'italic' }}>
              Эхнийх нь болоорой
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '0.3rem',
              maxHeight: 260, overflowY: 'auto',
            }}>
              {participants.map((p) => {
                const isMe = p.uid === user?.uid;
                return (
                  <div key={p.uid} style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.42rem 0.6rem', borderRadius: 9,
                    background: isMe ? 'rgba(167,139,250,0.1)' : C.cardAlt,
                    border: `1px solid ${isMe ? 'rgba(167,139,250,0.25)' : C.border}`,
                  }}>
                    <Avatar name={p.displayName} photoURL={p.photoURL} />
                    <span style={{
                      flex: 1, fontSize: '0.85rem',
                      color: C.text, fontWeight: isMe ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {p.displayName}{isMe && ' (та)'}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: C.muted, fontFamily: MONO, flexShrink: 0 }}>
                      {p.registeredEvents.length} төрөл
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom CTA */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        background: 'rgba(14,14,14,0.95)',
        backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`,
        padding: '0.85rem 1rem',
        paddingBottom: 'max(0.85rem, env(safe-area-inset-bottom))',
      }}>
        {confirmUnregister ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ flex: 1, fontSize: '0.82rem', color: C.muted }}>
              Бүртгэлээ цуцлах уу?
            </span>
            <button
              type="button"
              onClick={() => setConfirmUnregister(false)}
              style={{
                padding: '0.48rem 0.85rem', borderRadius: 8,
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                background: 'rgba(255,255,255,0.07)', border: `1px solid ${C.border}`, color: C.text,
              }}
            >
              Болих
            </button>
            <button
              type="button"
              onClick={() => void handleUnregister()}
              disabled={saving}
              style={{
                padding: '0.48rem 0.85rem', borderRadius: 8,
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.7)',
                border: '1px solid rgba(239,68,68,0.8)', color: '#fff',
              }}
            >
              {saving ? '...' : 'Цуцлах'}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleRegister()}
              disabled={btnDisabled || saving}
              style={{
                width: '100%', padding: '0.78rem 1rem', borderRadius: 10,
                fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
                background: btnDisabled
                  ? (btnGreen ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.05)')
                  : 'rgba(167,139,250,0.75)',
                border: `1px solid ${
                  btnDisabled
                    ? (btnGreen ? 'rgba(52,211,153,0.3)' : C.border)
                    : 'rgba(167,139,250,0.9)'
                }`,
                color: btnDisabled ? (btnGreen ? C.success : C.muted) : '#fff',
                cursor: btnDisabled ? 'default' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {saving ? 'Хадгалж байна...' : btnLabel}
            </button>
            {registered && !isClosed && (
              <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setConfirmUnregister(true)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '0.77rem', color: C.danger,
                    fontFamily: FONT, textDecoration: 'underline',
                  }}
                >
                  Бүртгэлээ цуцлах
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '3.5rem', left: '50%',
          transform: 'translateX(-50%)',
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 9, padding: '0.55rem 1.1rem',
          fontSize: '0.85rem', fontWeight: 600, color: C.text,
          zIndex: 50, whiteSpace: 'nowrap',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
