'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getAllMyAttempts,
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualCompetition,
  CompetitionAttempt,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: { toMillis: () => number } | undefined): string {
  if (!ts) return '—';
  return new Date(ts.toMillis()).toLocaleDateString('mn-MN', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function ordinal(n: number): string {
  return `${n}-р`;
}

// ─── Attempt card ─────────────────────────────────────────────────────────────

function AttemptCard({
  comp,
  attempt,
}: {
  comp: VirtualCompetition;
  attempt: CompetitionAttempt;
}) {
  const isInProgress = attempt.status === 'in_progress';
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${isInProgress ? 'rgba(167,139,250,0.3)' : C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Attempt header */}
      <div style={{
        padding: '0.85rem 1rem',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: isInProgress ? C.accent : C.text, marginBottom: '0.1rem' }}>
            {ordinal(attempt.attemptNumber)} оролдлого
          </div>
          <div style={{ fontSize: '0.72rem', color: C.muted, fontFamily: MONO }}>
            {isInProgress
              ? 'Үргэлжилж байна'
              : fmtDate(attempt.finishedAt ?? attempt.startedAt)} · {attempt.registeredEvents.length} төрөл
          </div>
        </div>
        {isInProgress ? (
          <span style={{
            fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.07em',
            padding: '0.18rem 0.55rem', borderRadius: 999,
            background: 'rgba(167,139,250,0.15)', color: C.accent,
            border: '1px solid rgba(167,139,250,0.3)',
          }}>
            ЯВАГДАЖ БАЙНА
          </span>
        ) : (
          <span style={{
            fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.07em',
            padding: '0.18rem 0.55rem', borderRadius: 999,
            background: 'rgba(52,211,153,0.12)', color: C.success,
            border: '1px solid rgba(52,211,153,0.25)',
          }}>
            ДУУССАН
          </span>
        )}
      </div>

      {/* Events summary */}
      <div style={{ padding: '0.65rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {attempt.registeredEvents.map((eid) => {
          const ev = getEvent(eid);
          return (
            <div key={eid} style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '0.2rem 0.5rem',
            }}>
              <WcaEventIcon eventId={eid} size={13} />
              <span style={{ fontSize: '0.7rem', color: C.muted }}>{ev?.name ?? eid}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding: '0.6rem 1rem',
        borderTop: `1px solid ${C.border}`,
        display: 'flex', justifyContent: 'flex-end',
      }}>
        {isInProgress ? (
          <Link
            href={`/timer/competitions/${comp.id}/compete`}
            style={{
              fontSize: '0.78rem', fontWeight: 700, color: C.accent,
              textDecoration: 'none', padding: '0.3rem 0.75rem',
              background: 'rgba(167,139,250,0.12)', borderRadius: 7,
              border: '1px solid rgba(167,139,250,0.3)',
            }}
          >
            Үргэлжлүүлэх →
          </Link>
        ) : (
          <Link
            href={`/timer/competitions/me/${attempt.id}?comp=${comp.id}`}
            style={{
              fontSize: '0.78rem', fontWeight: 600, color: C.muted,
              textDecoration: 'none', padding: '0.3rem 0.75rem',
              background: 'rgba(255,255,255,0.04)', borderRadius: 7,
              border: `1px solid ${C.border}`,
            }}
          >
            Дэлгэрэнгүй →
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type GroupedEntry = {
  comp: VirtualCompetition;
  attempts: CompetitionAttempt[];
};

export default function MyAttemptsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [groups, setGroups] = useState<GroupedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login?redirect=/timer/competitions/me');
      return;
    }
    if (!user.displayName?.trim()) {
      router.push('/timer/profile');
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const entries = await getAllMyAttempts(user!.uid);
        if (cancelled) return;

        // Group by competition, preserving comp order (first occurrence)
        const compOrder: string[] = [];
        const compMap = new Map<string, { comp: VirtualCompetition; attempts: CompetitionAttempt[] }>();
        for (const { comp, attempt } of entries) {
          if (!compMap.has(comp.id)) {
            compOrder.push(comp.id);
            compMap.set(comp.id, { comp, attempts: [] });
          }
          compMap.get(comp.id)!.attempts.push(attempt);
        }
        // Sort attempts within each group: newest first
        for (const g of compMap.values()) {
          g.attempts.sort((a, b) => b.startedAt.toMillis() - a.startedAt.toMillis());
        }

        setGroups(compOrder.map((id) => compMap.get(id)!));
      } catch {
        // show empty state on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [authLoading, user, router]);

  if (authLoading || loading) {
    return (
      <div style={{
        minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: '0.85rem', color: C.muted }}>Ачааллаж байна...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: C.bg, borderBottom: `1px solid ${C.border}`,
        padding: '0.75rem 1rem', flexShrink: 0,
      }}>
        <Link href="/timer/competitions" style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.82rem', fontWeight: 600, color: C.muted, textDecoration: 'none',
        }}>
          ← Тэмцээнүүд рүү
        </Link>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1rem 3rem' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 1.75rem' }}>
            Миний тэмцээнүүд
          </h1>

          {groups.length === 0 ? (
            /* Empty state */
            <div style={{
              textAlign: 'center', padding: '4rem 1rem',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem',
            }}>
              <div style={{ fontSize: '2rem', opacity: 0.25 }}>🏆</div>
              <div style={{ fontSize: '0.95rem', color: C.muted, lineHeight: 1.6 }}>
                Та өмнө нь ямар ч тэмцээнд оролцоогүй байна.
              </div>
              <Link href="/timer/competitions" style={{
                fontSize: '0.85rem', fontWeight: 600, color: C.accent, textDecoration: 'none',
                padding: '0.5rem 1.1rem', borderRadius: 8,
                background: C.accentDim, border: '1px solid rgba(167,139,250,0.25)',
              }}>
                Тэмцээнүүд хайх →
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {groups.map(({ comp, attempts }) => (
                <div key={comp.id}>
                  {/* Competition title */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <Link href={`/timer/competitions/${comp.id}`} style={{
                      fontSize: '1rem', fontWeight: 700, color: C.text, textDecoration: 'none',
                    }}>
                      {comp.name}
                    </Link>
                    <div style={{ fontSize: '0.72rem', color: C.muted, fontFamily: MONO, marginTop: '0.1rem' }}>
                      {comp.date}{comp.location ? ` · ${comp.location}` : ''}
                    </div>
                  </div>

                  {/* Attempt cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {attempts.map((attempt) => (
                      <AttemptCard key={attempt.id} comp={comp} attempt={attempt} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
