'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getCompetition,
  getRounds,
  getAttemptById,
  getMyResultsForAttempt,
  computeRank,
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualCompetition,
  VirtualRound,
  CompetitionAttempt,
  ParticipantRoundResult,
} from '@/lib/firebase/services/virtual-competitions';
import { getEvent } from '@/lib/wca-events';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import { useAuth } from '@/lib/auth-context';
import { fmtMs } from '@/lib/timer-engine';

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  bg:        '#0a0a0a',
  card:      '#141414',
  border:    'rgba(255,255,255,0.06)',
  text:      '#e8e8ed',
  muted:     '#8b8d98',
  accent:    '#a78bfa',
  accentDim: 'rgba(167,139,250,0.15)',
  success:   '#34d399',
  successDim:'rgba(52,211,153,0.15)',
  danger:    '#ef4444',
  dangerDim: 'rgba(239,68,68,0.12)',
} as const;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", "Fira Code", monospace';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  if (ms === -1) return 'DNF';
  return fmtMs(ms, false, 'cs');
}

function fmtDate(ts: { toMillis: () => number } | undefined): string {
  if (!ts) return '—';
  return new Date(ts.toMillis()).toISOString().slice(0, 10);
}

function fmtSolve(ms: number, penalty: 'none' | '+2' | 'dnf'): string {
  if (penalty === 'dnf') return 'DNF';
  if (penalty === '+2') return `${fmtMs(ms + 2000, false, 'cs')}+`;
  return fmtMs(ms, false, 'cs');
}

function formatSolvesWCA(
  times: number[],
  format: string,
  penalties?: ('none' | '+2' | 'dnf')[],
): string[] {
  if (!times || times.length === 0) return [];
  const fmtSingle = (t: number, pen?: 'none' | '+2' | 'dnf'): string =>
    fmtSolve(t, pen ?? 'none');

  if (format === 'avg5' && times.length >= 5) {
    const effVals = times.map((t) => (t === -1 ? Infinity : t));
    const maxEff = Math.max(...effVals);
    const minEff = Math.min(...effVals);
    const worstIdx = effVals.lastIndexOf(maxEff);
    const bestIdx = effVals.indexOf(minEff);
    return times.map((t, i) => {
      const s = fmtSingle(t, penalties?.[i]);
      return i === worstIdx || i === bestIdx ? `(${s})` : s;
    });
  }
  return times.map((t, i) => fmtSingle(t, penalties?.[i]));
}

// ─── Round result row ─────────────────────────────────────────────────────────

function RoundResultRow({
  round,
  result,
  onLeaderboard,
}: {
  round: VirtualRound;
  result: ParticipantRoundResult;
  onLeaderboard: () => void;
}) {
  const hist = round.historicalResults ?? [];
  const rank =
    hist.length > 0
      ? computeRank({ best: result.best, average: result.average, format: round.format }, hist)
      : null;

  const isFinal = round.advancementType === 'final';
  const advanced = !isFinal && result.advanced;

  const solveStrings = formatSolvesWCA(
    result.solves.map((s) => s.ms),
    round.format,
    result.solves.map((s) => s.penalty),
  );

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 10, overflow: 'hidden', marginBottom: '0.5rem',
    }}>
      {/* Round header */}
      <div style={{
        padding: '0.7rem 1rem',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <WcaEventIcon eventId={round.eventId} size={14} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text }}>
            {round.roundName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
          {isFinal ? (
            <span style={{ fontSize: '0.7rem', color: C.muted }}>Финал</span>
          ) : advanced ? (
            <span style={{ fontSize: '0.7rem', color: C.success }}>✓ Шилжсэн</span>
          ) : (
            <span style={{ fontSize: '0.7rem', color: C.danger }}>✗ Шилжээгүй</span>
          )}
          {rank !== null && (
            <span style={{
              fontSize: '0.7rem', fontFamily: MONO, color: C.accent,
              background: C.accentDim, padding: '0.15rem 0.45rem', borderRadius: 6,
            }}>
              #{rank}
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: '0.65rem 1rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.6rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.15rem' }}>Best</div>
          <div style={{ fontFamily: MONO, fontSize: '0.9rem', color: C.success }}>{fmtTime(result.best)}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.6rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.15rem' }}>Avg</div>
          <div style={{ fontFamily: MONO, fontSize: '0.9rem', color: C.text }}>{fmtTime(result.average)}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onLeaderboard}
            style={{
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
              borderRadius: 7, padding: '0.3rem 0.65rem',
              fontSize: '0.72rem', color: C.muted, cursor: 'pointer', fontFamily: FONT,
            }}
          >
            Жагсаалт ▾
          </button>
        </div>
      </div>

      {/* Solves */}
      <div style={{
        padding: '0.55rem 1rem 0.7rem',
        borderTop: `1px solid ${C.border}`,
        display: 'flex', gap: '0.65rem', flexWrap: 'wrap',
        fontFamily: MONO, fontSize: '0.82rem', color: C.muted,
      }}>
        {solveStrings.map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Leaderboard panel ────────────────────────────────────────────────────────

function LeaderboardPanel({
  round,
  myResult,
  myName,
  onClose,
}: {
  round: VirtualRound;
  myResult: ParticipantRoundResult;
  myName: string;
  onClose: () => void;
}) {
  const hist = round.historicalResults ?? [];
  const eff = (v: number) => (v === -1 ? Infinity : v);

  type LBEntry = { name: string; best: number; average: number; isMe: boolean; rank: number };
  const raw: Omit<LBEntry, 'rank'>[] = [
    ...hist.map((h) => ({ name: h.athleteName, best: h.best, average: h.average, isMe: false })),
    { name: myName, best: myResult.best, average: myResult.average, isMe: true },
  ];
  raw.sort((a, b) => {
    const da = eff(a.average) - eff(b.average);
    if (da !== 0) return da;
    return eff(a.best) - eff(b.best);
  });
  const entries: LBEntry[] = raw.map((e, i) => ({ ...e, rank: i + 1 }));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1rem', borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <WcaEventIcon eventId={round.eventId} size={14} />
          <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>{round.roundName}</span>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.muted,
          cursor: 'pointer', fontSize: '1.15rem', padding: '0.2rem 0.5rem',
        }}>✕</button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1rem 2rem' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {/* Col headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '32px 1fr 68px 72px',
            padding: '0.75rem 0.5rem 0.35rem', gap: '0.25rem',
          }}>
            {['#', 'Нэр', 'Best', 'Avg'].map((h, i) => (
              <span key={h} style={{
                fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted,
                textAlign: i >= 2 ? 'right' : 'left',
              }}>{h}</span>
            ))}
          </div>

          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {entries.map((entry, idx) => (
              <div
                key={idx}
                style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr 68px 72px',
                  padding: '0.55rem 0.75rem', gap: '0.25rem', alignItems: 'center',
                  background: entry.isMe ? C.accentDim : 'transparent',
                  borderBottom: idx < entries.length - 1 ? `1px solid ${C.border}` : 'none',
                }}
              >
                <span style={{
                  fontFamily: MONO, fontSize: '0.82rem', fontWeight: 700,
                  color: entry.rank <= 3 ? C.accent : C.muted,
                }}>{entry.rank}</span>
                <span style={{
                  fontSize: '0.85rem', fontWeight: entry.isMe ? 700 : 400,
                  color: entry.isMe ? C.accent : C.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{entry.name}</span>
                <span style={{
                  fontFamily: MONO, fontSize: '0.82rem', color: C.success,
                  textAlign: 'right',
                }}>{fmtTime(entry.best)}</span>
                <span style={{
                  fontFamily: MONO, fontSize: '0.82rem', color: C.text,
                  textAlign: 'right',
                }}>{fmtTime(entry.average)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inner page (needs useSearchParams) ───────────────────────────────────────

function AttemptDetailInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const attemptId = params.attemptId as string;
  const compIdParam = searchParams.get('comp');

  const [comp, setComp] = useState<VirtualCompetition | null>(null);
  const [attempt, setAttempt] = useState<CompetitionAttempt | null>(null);
  const [rounds, setRounds] = useState<VirtualRound[]>([]);
  const [results, setResults] = useState<ParticipantRoundResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lbRound, setLbRound] = useState<VirtualRound | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    async function load() {
      try {
        // compId can come from query param (fast path) or from attempt doc
        let resolvedCompId = compIdParam ?? '';

        if (!resolvedCompId) {
          // Scan all competitions — slow path, only if no comp param
          const { getAllMyAttempts: getAllMy } = await import('@/lib/firebase/services/virtual-competitions');
          const allEntries = await getAllMy(user!.uid);
          const found = allEntries.find((e) => e.attempt.id === attemptId);
          if (!found) { setNotFound(true); setLoading(false); return; }
          resolvedCompId = found.comp.id;
        }

        const [compData, attemptData, roundsData, resultsData] = await Promise.all([
          getCompetition(resolvedCompId),
          getAttemptById(resolvedCompId, attemptId),
          getRounds(resolvedCompId),
          getMyResultsForAttempt(resolvedCompId, attemptId),
        ]);

        if (cancelled) return;
        if (!compData || !attemptData) { setNotFound(true); setLoading(false); return; }

        setComp(compData);
        setAttempt(attemptData);
        setRounds(roundsData);
        setResults(resultsData);
        setLoading(false);
      } catch {
        if (!cancelled) { setNotFound(true); setLoading(false); }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [authLoading, user, attemptId, compIdParam]);

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

  if (notFound || !comp || !attempt) {
    return (
      <div style={{
        minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '1rem', padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Оролдлого олдсонгүй</div>
        <Link href="/timer/competitions/me"
          style={{ fontSize: '0.85rem', color: C.muted, textDecoration: 'none' }}>
          ← Миний тэмцээнүүд
        </Link>
      </div>
    );
  }

  // Group rounds by event
  const roundsByEvent = rounds.reduce<Record<string, VirtualRound[]>>((acc, r) => {
    (acc[r.eventId] ??= []).push(r);
    return acc;
  }, {});
  for (const ev of Object.keys(roundsByEvent)) {
    roundsByEvent[ev].sort((a, b) => a.roundNumber - b.roundNumber);
  }

  const lbResult = lbRound
    ? results.find((r) => r.eventId === lbRound.eventId && r.roundNumber === lbRound.roundNumber)
    : null;

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
        <Link href="/timer/competitions/me" style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.82rem', fontWeight: 600, color: C.muted, textDecoration: 'none',
        }}>
          ← Миний тэмцээнүүд
        </Link>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1rem 3rem' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {/* Title */}
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.2rem' }}>
            {attempt.attemptNumber}-р оролдлого
          </h1>
          <div style={{ fontSize: '0.82rem', color: C.text, fontWeight: 600, marginBottom: '0.55rem' }}>
            {comp.name}
          </div>
          <div style={{
            fontSize: '0.71rem', color: C.muted, fontFamily: MONO,
            lineHeight: 1.7, marginBottom: '1.5rem',
          }}>
            <div>Тэмцээний огноо: {comp.date}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <span>
                {attempt.status === 'in_progress'
                  ? 'Явагдаж байна'
                  : `Оролцсон: ${fmtDate(attempt.finishedAt ?? attempt.startedAt)}`}
              </span>
              <span>·</span>
              <span>{attempt.registeredEvents.length} төрөл</span>
              {attempt.status === 'in_progress' && (
                <span style={{
                  padding: '0.1rem 0.45rem', borderRadius: 999, fontSize: '0.6rem',
                  fontWeight: 800, background: 'rgba(167,139,250,0.15)', color: C.accent,
                  border: '1px solid rgba(167,139,250,0.3)', letterSpacing: '0.06em',
                }}>ЯВАГДАЖ БАЙНА</span>
              )}
            </div>
          </div>

          {/* Results by event */}
          {attempt.registeredEvents.map((eventId) => {
            const ev = getEvent(eventId);
            const eventRounds = roundsByEvent[eventId] ?? [];
            const eventResults = results.filter((r) => r.eventId === eventId);

            if (eventResults.length === 0) return null;

            return (
              <div key={eventId} style={{ marginBottom: '1.5rem' }}>
                {/* Event label */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  marginBottom: '0.5rem',
                }}>
                  <WcaEventIcon eventId={eventId} size={16} />
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: C.text }}>
                    {ev?.name ?? eventId}
                  </span>
                </div>

                {/* Round results */}
                {eventRounds
                  .filter((r) => eventResults.some((er) => er.roundNumber === r.roundNumber))
                  .map((round) => {
                    const result = eventResults.find((r) => r.roundNumber === round.roundNumber);
                    if (!result) return null;
                    return (
                      <RoundResultRow
                        key={round.id}
                        round={round}
                        result={result}
                        onLeaderboard={() => setLbRound(round)}
                      />
                    );
                  })}
              </div>
            );
          })}

          {results.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '3rem 0',
              fontSize: '0.88rem', color: C.muted,
            }}>
              Энэ оролдлогод үр дүн байхгүй байна.
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard overlay */}
      {lbRound && lbResult && (
        <LeaderboardPanel
          round={lbRound}
          myResult={lbResult}
          myName={attempt.displayName}
          onClose={() => setLbRound(null)}
        />
      )}
    </div>
  );
}

// ─── Page export (Suspense for useSearchParams) ────────────────────────────────

function LoadingFallback() {
  return (
    <div style={{
      minHeight: '100dvh', background: '#0a0a0a', fontFamily: 'system-ui, sans-serif', color: '#e8e8ed',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ fontSize: '0.85rem', color: '#8b8d98' }}>Ачааллаж байна...</div>
    </div>
  );
}

export default function AttemptDetailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AttemptDetailInner />
    </Suspense>
  );
}
