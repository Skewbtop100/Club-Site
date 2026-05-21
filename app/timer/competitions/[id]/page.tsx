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
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualCompetition,
  VirtualRound,
  VirtualParticipant,
} from '@/lib/firebase/services/virtual-competitions';
import { getEvent } from '@/lib/wca-events';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import { useAuth } from '@/lib/auth-context';

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  bg:        '#0a0a0a',
  card:      '#141414',
  border:    'rgba(255,255,255,0.06)',
  text:      '#e8e8ed',
  muted:     '#8b8d98',
  accent:    '#a78bfa',
  accentDim: 'rgba(167,139,250,0.12)',
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

function CoverPlaceholder({ name }: { name: string }) {
  const letter = name.trim()[0]?.toUpperCase() ?? '?';
  return (
    <div style={{
      width: '100%', aspectRatio: '16/9',
      background: 'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(167,139,250,0.12) 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <span style={{ fontSize: '4.5rem', fontWeight: 800, color: 'rgba(167,139,250,0.35)',
        userSelect: 'none', fontFamily: FONT }}>
        {letter}
      </span>
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

// ─── Advancement chain for a sorted event round list ─────────────────────────

function buildAdvancementChain(sortedRounds: VirtualRound[]): string {
  return sortedRounds
    .map((r) => {
      if (r.advancementType === 'final') return 'Финал';
      if (r.advancementType === 'fixed' && r.advancementValue != null) return String(r.advancementValue);
      if (r.advancementType === 'percentage' && r.advancementValue != null) return `${r.advancementValue}%`;
      return '';
    })
    .filter(Boolean)
    .join(' → ');
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompetitionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [comp, setComp] = useState<VirtualCompetition | null>(null);
  const [rounds, setRounds] = useState<VirtualRound[]>([]);
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

  // Fetch competition, rounds, participant
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
        if (!compData) { setNotFound(true); setPageLoading(false); return; }
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

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const roundsByEvent = rounds.reduce<Record<string, VirtualRound[]>>((acc, r) => {
    (acc[r.eventId] ??= []).push(r);
    return acc;
  }, {});
  for (const ev of Object.keys(roundsByEvent)) {
    roundsByEvent[ev].sort((a, b) => a.roundNumber - b.roundNumber);
  }

  const registered = initialParticipant !== null;
  const isClosed = comp?.status === 'closed';
  const savedEventsStr = [...(initialParticipant?.registeredEvents ?? [])].sort().join(',');
  const selectedEventsStr = [...selectedEvents].sort().join(',');
  const isSameEvents = registered && savedEventsStr === selectedEventsStr;

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function toggleEvent(eventId: string) {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId],
    );
  }

  async function handleRegister() {
    if (!user || !comp || saving) return;
    if (selectedEvents.length === 0) return;
    setSaving(true);
    try {
      const wasRegistered = registered;
      await registerForCompetition(
        comp.id,
        { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL },
        selectedEvents,
      );
      const updated = await getParticipant(comp.id, user.uid);
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
    setSaving(true);
    try {
      await unregisterFromCompetition(comp.id, user.uid);
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

  // ── Render ────────────────────────────────────────────────────────────────────

  if (authLoading || (pageLoading && !notFound)) return <LoadingShell />;
  if (notFound) return <NotFoundShell />;
  if (!comp) return null;

  const meta = [comp.date, comp.location].filter(Boolean).join(' · ');
  const participantCount = comp.participantCount ?? 0;

  // CTA bottom height varies: registered → taller (two rows)
  const ctaHeight = registered && !isClosed ? '7.5rem' : '6rem';

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
        }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = C.text)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = C.muted)}
        >
          ← Жагсаалт руу буцах
        </Link>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: ctaHeight }}>

        {/* Cover */}
        {comp.imageUrl ? (
          <img src={comp.imageUrl} alt={comp.name}
            style={{ width: '100%', height: 'auto', objectFit: 'contain', display: 'block', background: 'var(--card, #111)', borderRadius: '0 0 12px 12px' }} />
        ) : (
          <CoverPlaceholder name={comp.name} />
        )}

        {/* Hero */}
        <div style={{ padding: '1rem 1rem 0' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.35rem' }}>
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
              {participantCount} оролцогч
            </span>
          </div>
          {comp.description && (
            <p style={{ margin: '0.85rem 0 0', fontSize: '0.88rem', color: C.muted, lineHeight: 1.65 }}>
              {comp.description}
            </p>
          )}
        </div>

        <div style={{ height: 1, background: C.border, margin: '1.1rem 1rem' }} />

        {/* ── ТӨРЛҮҮД БА РАУНД — info table ── */}
        <div style={{ padding: '0 1rem 1rem' }}>
          <div style={{
            fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '0.65rem',
          }}>
            Төрлүүд ба раунд
          </div>
          <div style={{
            border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden',
          }}>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '36px 80px 1fr',
              padding: '0.35rem 0.75rem',
              background: 'rgba(255,255,255,0.03)',
              borderBottom: `1px solid ${C.border}`,
              gap: '0.5rem', alignItems: 'center',
            }}>
              {['Төрөл', 'Раунд', 'Шилжилт'].map((h) => (
                <span key={h} style={{
                  fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: C.muted,
                }}>{h}</span>
              ))}
            </div>
            {/* Table rows */}
            {comp.events.map((eventId, idx) => {
              const evRounds = roundsByEvent[eventId] ?? [];
              const chain = buildAdvancementChain(evRounds);
              const isLast = idx === comp.events.length - 1;
              return (
                <div key={eventId} style={{
                  display: 'grid', gridTemplateColumns: '36px 80px 1fr',
                  padding: '0.5rem 0.75rem', gap: '0.5rem', alignItems: 'center',
                  borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
                    <WcaEventIcon eventId={eventId} size={18} />
                  </span>
                  <span style={{ fontSize: '0.82rem', color: C.text }}>
                    {evRounds.length > 0 ? `${evRounds.length} раунд` : '—'}
                  </span>
                  <span style={{
                    fontSize: '0.78rem', color: C.muted, fontFamily: MONO,
                    wordBreak: 'break-word', lineHeight: 1.4,
                  }}>
                    {chain || '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ height: 1, background: C.border, margin: '0 1rem' }} />

        {/* ── БҮРТГЭЛ — icon tile registration grid ── */}
        <div style={{ padding: '1rem 1rem 1rem' }}>
          <div style={{
            fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '0.25rem',
          }}>
            Бүртгэл
          </div>
          {!isClosed && (
            <div style={{ fontSize: '0.78rem', color: C.muted, marginBottom: '0.85rem' }}>
              Оролцох төрлөө сонгоно уу
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
            gap: '0.5rem',
          }}>
            {comp.events.map((eventId) => {
              const selected = selectedEvents.includes(eventId);
              return (
                <button
                  key={eventId}
                  type="button"
                  title={getEvent(eventId)?.name ?? eventId}
                  onClick={() => !isClosed && toggleEvent(eventId)}
                  style={{
                    position: 'relative',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    height: 76, borderRadius: 12,
                    background: selected ? 'rgba(167,139,250,0.15)' : C.card,
                    border: `1.5px solid ${selected ? 'rgba(167,139,250,0.55)' : C.border}`,
                    cursor: isClosed ? 'default' : 'pointer',
                    transition: 'border-color 0.12s, background 0.12s',
                    WebkitTapHighlightColor: 'transparent',
                    gap: '0.3rem', padding: 0,
                    fontFamily: FONT,
                  }}
                >
                  <span style={{ color: selected ? C.accent : C.muted, display: 'flex' }}>
                    <WcaEventIcon eventId={eventId} size={26} />
                  </span>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em',
                    color: selected ? C.accent : C.muted, lineHeight: 1,
                  }}>
                    {getEvent(eventId)?.short ?? eventId}
                  </span>
                  {/* Selection badge */}
                  {selected && (
                    <span style={{
                      position: 'absolute', top: 5, right: 6,
                      fontSize: '0.6rem', fontWeight: 900, color: C.accent,
                      lineHeight: 1,
                    }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sticky bottom CTA */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        background: 'rgba(14,14,14,0.96)',
        backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`,
        padding: '0.85rem 1rem',
        paddingBottom: 'max(0.85rem, env(safe-area-inset-bottom))',
      }}>
        {confirmUnregister ? (
          /* ── Confirm unregister ── */
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ flex: 1, fontSize: '0.82rem', color: C.muted }}>Бүртгэлээ цуцлах уу?</span>
            <button type="button" onClick={() => setConfirmUnregister(false)}
              style={{
                padding: '0.48rem 0.85rem', borderRadius: 8,
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                background: 'rgba(255,255,255,0.07)', border: `1px solid ${C.border}`, color: C.text,
              }}>
              Болих
            </button>
            <button type="button" onClick={() => void handleUnregister()} disabled={saving}
              style={{
                padding: '0.48rem 0.85rem', borderRadius: 8,
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.7)',
                border: '1px solid rgba(239,68,68,0.8)', color: '#fff',
              }}>
              {saving ? '...' : 'Цуцлах'}
            </button>
          </div>
        ) : isClosed ? (
          /* ── Closed ── */
          <button type="button" disabled style={{
            width: '100%', padding: '0.78rem', borderRadius: 10,
            fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
            color: C.muted, cursor: 'default',
          }}>
            Хаагдсан
          </button>
        ) : registered ? (
          /* ── Registered: two buttons ── */
          <>
            <div style={{ display: 'flex', gap: '0.55rem', marginBottom: '0.5rem' }}>
              {/* Update button */}
              <button
                type="button"
                onClick={() => void handleRegister()}
                disabled={isSameEvents || saving || selectedEvents.length === 0}
                style={{
                  flex: 1, padding: '0.78rem 0.5rem', borderRadius: 10,
                  fontFamily: FONT, fontSize: '0.9rem', fontWeight: 700,
                  background: (isSameEvents || selectedEvents.length === 0)
                    ? 'rgba(255,255,255,0.04)' : 'rgba(167,139,250,0.2)',
                  border: `1px solid ${
                    (isSameEvents || selectedEvents.length === 0)
                      ? C.border : 'rgba(167,139,250,0.5)'
                  }`,
                  color: (isSameEvents || selectedEvents.length === 0) ? C.muted : C.accent,
                  cursor: (isSameEvents || saving || selectedEvents.length === 0) ? 'default' : 'pointer',
                }}
              >
                {saving ? '...' : 'Шинэчлэх'}
              </button>
              {/* Compete button */}
              <Link
                href={`/timer/competitions/${id}/compete`}
                style={{
                  flex: 2, padding: '0.78rem 0.5rem', borderRadius: 10,
                  fontFamily: FONT, fontSize: '0.9rem', fontWeight: 700, textAlign: 'center',
                  background: 'rgba(167,139,250,0.75)',
                  border: '1px solid rgba(167,139,250,0.9)',
                  color: '#fff', textDecoration: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                Тэмцээнээ эхлүүлэх →
              </Link>
            </div>
            <div style={{ textAlign: 'center' }}>
              <button type="button" onClick={() => setConfirmUnregister(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.77rem', color: C.danger,
                  fontFamily: FONT, textDecoration: 'underline',
                }}>
                Бүртгэлээ цуцлах
              </button>
            </div>
          </>
        ) : (
          /* ── Not registered ── */
          <button
            type="button"
            onClick={() => void handleRegister()}
            disabled={selectedEvents.length === 0 || saving}
            style={{
              width: '100%', padding: '0.78rem', borderRadius: 10,
              fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
              background: selectedEvents.length === 0
                ? 'rgba(255,255,255,0.05)' : 'rgba(167,139,250,0.75)',
              border: `1px solid ${
                selectedEvents.length === 0 ? C.border : 'rgba(167,139,250,0.9)'
              }`,
              color: selectedEvents.length === 0 ? C.muted : '#fff',
              cursor: (selectedEvents.length === 0 || saving) ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Хадгалж байна...'
              : selectedEvents.length === 0 ? 'Төрөл сонгоно уу'
              : `Бүртгүүлэх (${selectedEvents.length} төрөл)`}
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '3.5rem', left: '50%', transform: 'translateX(-50%)',
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 9, padding: '0.55rem 1.1rem',
          fontSize: '0.85rem', fontWeight: 600, color: C.text,
          zIndex: 50, whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
