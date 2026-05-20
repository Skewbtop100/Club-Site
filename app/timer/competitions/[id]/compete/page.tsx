'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCompetition,
  getRounds,
  getParticipant,
  getMyResults,
  computeRank,
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualCompetition,
  VirtualRound,
  VirtualParticipant,
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

type RoundState = 'completed' | 'available' | 'locked' | 'not_advanced';

function getRoundState(
  round: VirtualRound,
  allEventRounds: VirtualRound[],
  myResults: ParticipantRoundResult[],
  compClosed: boolean,
): RoundState {
  const done = myResults.some(
    (r) => r.eventId === round.eventId && r.roundNumber === round.roundNumber,
  );
  if (done) return 'completed';
  if (compClosed) return 'locked';
  if (round.roundNumber === 1) return 'available';

  const prevResult = myResults.find(
    (r) => r.eventId === round.eventId && r.roundNumber === round.roundNumber - 1,
  );
  if (!prevResult) return 'locked';

  // Check if user advanced from the previous round
  const prevRound = allEventRounds.find((r) => r.roundNumber === round.roundNumber - 1);
  if (!prevRound) return 'available';
  if (prevRound.advancementType === 'final') return 'not_advanced';
  if (prevRound.advancementValue == null) return 'available'; // no criteria set

  const hist = prevRound.historicalResults;
  const rank = computeRank(
    { best: prevResult.best, average: prevResult.average, format: prevRound.format },
    hist,
  );
  const total = hist.length + 1;
  const threshold =
    prevRound.advancementType === 'fixed'
      ? prevRound.advancementValue
      : Math.ceil(total * prevRound.advancementValue / 100);

  return rank <= threshold ? 'available' : 'not_advanced';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompeteHubPage() {
  const params = useParams();
  const compId = params.id as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [comp, setComp] = useState<VirtualCompetition | null>(null);
  const [participant, setParticipant] = useState<VirtualParticipant | null>(null);
  const [rounds, setRounds] = useState<VirtualRound[]>([]);
  const [myResults, setMyResults] = useState<ParticipantRoundResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push(`/login?redirect=/timer/competitions/${compId}/compete`);
      return;
    }
    if (!user.displayName?.trim()) {
      router.push('/timer/profile');
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const [compData, roundsData, participantData, myResultsData] = await Promise.all([
          getCompetition(compId),
          getRounds(compId),
          getParticipant(compId, user!.uid),
          getMyResults(compId, user!.uid),
        ]);
        if (cancelled) return;
        if (!compData) { setNotFound(true); setLoading(false); return; }
        if (!participantData) {
          router.push(`/timer/competitions/${compId}`);
          return;
        }
        setComp(compData);
        setRounds(roundsData);
        setParticipant(participantData);
        setMyResults(myResultsData);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [authLoading, user, compId, router]);

  if (authLoading || loading) {
    return (
      <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '0.85rem', color: C.muted }}>Ачааллаж байна...</div>
      </div>
    );
  }

  if (notFound || !comp || !participant) {
    return (
      <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '1rem', textAlign: 'center', padding: '2rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Тэмцээн олдсонгүй</div>
        <Link href="/timer/competitions"
          style={{ fontSize: '0.85rem', color: C.muted, textDecoration: 'none' }}>
          ← Жагсаалт руу буцах
        </Link>
      </div>
    );
  }

  const isClosed = comp.status === 'closed';
  const registeredEvents = participant.registeredEvents;

  // Group rounds by eventId
  const roundsByEvent = rounds.reduce<Record<string, VirtualRound[]>>((acc, r) => {
    (acc[r.eventId] ??= []).push(r);
    return acc;
  }, {});
  for (const ev of Object.keys(roundsByEvent)) {
    roundsByEvent[ev].sort((a, b) => a.roundNumber - b.roundNumber);
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
        <Link href={`/timer/competitions/${compId}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.82rem', fontWeight: 600, color: C.muted, textDecoration: 'none',
        }}>
          ← Тэмцээний хуудас
        </Link>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem 3rem' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 0.2rem' }}>
            {comp.name}
          </h1>
          <div style={{ fontSize: '0.78rem', color: C.muted, fontFamily: MONO, marginBottom: '1.75rem' }}>
            {comp.date}
            {isClosed && (
              <span style={{
                marginLeft: '0.5rem', padding: '0.1rem 0.45rem', borderRadius: 999,
                fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em',
                background: 'rgba(100,116,139,0.2)', color: C.muted, display: 'inline-block',
              }}>
                ХААГДСАН
              </span>
            )}
          </div>

          <div style={{
            fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '0.75rem',
          }}>
            Хийх төрлүүд
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {registeredEvents.map((eventId) => {
              const ev = getEvent(eventId);
              const eventRounds = roundsByEvent[eventId] ?? [];
              return (
                <div key={eventId} style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 12, overflow: 'hidden',
                }}>
                  {/* Event header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.85rem 1rem',
                    borderBottom: eventRounds.length > 0 ? `1px solid ${C.border}` : 'none',
                  }}>
                    <WcaEventIcon eventId={eventId} size={18} />
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text }}>
                      {ev?.name ?? eventId}
                    </span>
                  </div>

                  {/* Rounds */}
                  {eventRounds.length === 0 ? (
                    <div style={{ padding: '0.65rem 1rem', fontSize: '0.8rem', color: C.muted }}>
                      Раунд тохируулагдаагүй
                    </div>
                  ) : (
                    eventRounds.map((round, idx) => {
                      const state = getRoundState(round, eventRounds, myResults, isClosed);
                      const myResult = myResults.find(
                        (r) => r.eventId === round.eventId && r.roundNumber === round.roundNumber,
                      );
                      const isLast = idx === eventRounds.length - 1;
                      return (
                        <RoundRow
                          key={round.id}
                          compId={compId}
                          round={round}
                          state={state}
                          myResult={myResult}
                          borderBottom={!isLast}
                        />
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>

          {registeredEvents.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem 0', fontSize: '0.9rem', color: C.muted }}>
              Бүртгүүлсэн төрөл байхгүй
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RoundRow({
  compId, round, state, myResult, borderBottom,
}: {
  compId: string;
  round: VirtualRound;
  state: RoundState;
  myResult?: ParticipantRoundResult;
  borderBottom: boolean;
}) {
  const router = useRouter();
  const isAvailable = state === 'available';

  return (
    <div
      onClick={() => isAvailable && router.push(`/timer/competitions/${compId}/compete/${round.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1rem',
        borderBottom: borderBottom ? `1px solid ${C.border}` : 'none',
        cursor: isAvailable ? 'pointer' : 'default',
        background: isAvailable ? 'transparent' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (isAvailable) (e.currentTarget as HTMLDivElement).style.background = C.accentDim; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {/* Circle indicator */}
      <div style={{ flexShrink: 0, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {state === 'completed' ? (
          <span style={{ fontSize: '0.85rem', color: C.success }}>✓</span>
        ) : state === 'available' ? (
          <span style={{ fontSize: '0.75rem', color: C.accent }}>●</span>
        ) : state === 'not_advanced' ? (
          <span style={{ fontSize: '0.85rem', color: C.danger }}>✗</span>
        ) : (
          <span style={{ fontSize: '0.75rem', color: C.muted }}>○</span>
        )}
      </div>

      {/* Round name + sub-info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.88rem', fontWeight: 600,
          color: state === 'locked' || state === 'not_advanced' ? C.muted : C.text,
        }}>
          {round.roundName}
        </div>
        {state === 'completed' && myResult && (
          <div style={{ fontSize: '0.73rem', color: C.muted, fontFamily: MONO, marginTop: '0.1rem' }}>
            Best: {fmtTime(myResult.best)} · Avg: {fmtTime(myResult.average)}
          </div>
        )}
        {state === 'locked' && (
          <div style={{ fontSize: '0.72rem', color: C.muted, marginTop: '0.1rem' }}>
            Round {round.roundNumber - 1} дуусгасны дараа
          </div>
        )}
        {state === 'not_advanced' && myResult && (
          <div style={{ fontSize: '0.72rem', color: C.muted, marginTop: '0.1rem' }}>
            Шилжээгүй · Best: {fmtTime(myResult.best)}
          </div>
        )}
      </div>

      {/* Right pill / arrow */}
      {state === 'available' && (
        <div style={{
          flexShrink: 0, padding: '0.25rem 0.65rem', borderRadius: 999,
          fontSize: '0.72rem', fontWeight: 700,
          background: 'rgba(167,139,250,0.15)',
          color: C.accent,
          border: '1px solid rgba(167,139,250,0.3)',
        }}>
          Хийх →
        </div>
      )}
      {state === 'completed' && (
        <div style={{
          flexShrink: 0, padding: '0.25rem 0.65rem', borderRadius: 999,
          fontSize: '0.72rem', fontWeight: 700,
          background: C.successDim,
          color: C.success,
          border: '1px solid rgba(52,211,153,0.3)',
        }}>
          Дууссан
        </div>
      )}
    </div>
  );
}
