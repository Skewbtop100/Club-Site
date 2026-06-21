'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCompetition,
  getRounds,
  getParticipant,
  getActiveAttempt,
  getMyResultsForAttempt,
  finishAttempt,
  computeRank,
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualCompetition,
  VirtualRound,
  VirtualParticipant,
  ParticipantRoundResult,
  CompetitionAttempt,
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

type CanFinishResult = {
  canFinish: boolean;
  missing: { eventId: string; roundNumber: number; roundName: string }[];
};

function computeCanFinish(
  registeredEvents: string[],
  roundsByEvent: Record<string, VirtualRound[]>,
  myResults: ParticipantRoundResult[],
): CanFinishResult {
  const missing: CanFinishResult['missing'] = [];
  for (const eventId of registeredEvents) {
    const eventRounds = (roundsByEvent[eventId] ?? [])
      .slice()
      .sort((a, b) => a.roundNumber - b.roundNumber);
    for (const round of eventRounds) {
      const result = myResults.find(
        (r) => r.eventId === eventId && r.roundNumber === round.roundNumber,
      );
      if (!result) {
        missing.push({ eventId, roundNumber: round.roundNumber, roundName: round.roundName });
        break;
      }
      if (round.advancementType === 'final') break;
      if (!result.advanced) break;
    }
  }
  return { canFinish: missing.length === 0, missing };
}

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
  const [activeAttempt, setActiveAttempt] = useState<CompetitionAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [finishing, setFinishing] = useState(false);

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
        // Step 1: comp + rounds + participant (well-established collections)
        const [compData, roundsData, participantData] = await Promise.all([
          getCompetition(compId),
          getRounds(compId),
          getParticipant(compId, user!.uid),
        ]);
        if (cancelled) return;

        if (!compData) { setNotFound(true); setLoading(false); return; }
        if (!participantData) {
          router.replace(`/timer/competitions/${compId}?from=hub`);
          return;
        }

        // Step 2: active attempt isolated — a rules/network error here must not
        // crash the page. On mobile Safari the Firestore connection may not be
        // ready immediately; retry once before giving up.
        let attempt: CompetitionAttempt | null = null;
        try {
          attempt = await getActiveAttempt(compId, user!.uid);
        } catch (err) {
          console.error('[compete hub] getActiveAttempt failed', err);
        }
        if (cancelled) return;

        if (!attempt) {
          // Retry once — gives mobile Firestore connection time to settle
          await new Promise<void>((r) => setTimeout(r, 800));
          if (cancelled) return;
          try {
            attempt = await getActiveAttempt(compId, user!.uid);
          } catch (err) {
            console.error('[compete hub] getActiveAttempt retry failed', err);
          }
          if (cancelled) return;
        }

        if (!attempt) {
          router.replace(`/timer/competitions/${compId}?from=hub`);
          return;
        }

        // Step 3: results from THIS attempt only — no legacy fallback
        const resultsData = await getMyResultsForAttempt(compId, attempt.id);
        if (cancelled) return;

        setComp(compData);
        setRounds(roundsData);
        setParticipant(participantData);
        setActiveAttempt(attempt);
        setMyResults(resultsData);
        setLoading(false);
      } catch (err) {
        console.error('[compete hub] load failed', err);
        if (!cancelled) router.replace(`/timer/competitions/${compId}?from=hub`);
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
  const registeredEvents = activeAttempt?.registeredEvents ?? participant.registeredEvents;

  // Group rounds by eventId
  const roundsByEvent = rounds.reduce<Record<string, VirtualRound[]>>((acc, r) => {
    (acc[r.eventId] ??= []).push(r);
    return acc;
  }, {});
  for (const ev of Object.keys(roundsByEvent)) {
    roundsByEvent[ev].sort((a, b) => a.roundNumber - b.roundNumber);
  }

  const canFinishResult = computeCanFinish(registeredEvents, roundsByEvent, myResults);

  async function handleFinish() {
    if (!activeAttempt || finishing) return;
    setFinishing(true);
    try {
      await finishAttempt(compId, activeAttempt.id);
      router.push(`/timer/competitions/${compId}`);
    } catch {
      setFinishing(false);
    }
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
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link href={`/timer/competitions/${compId}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.82rem', fontWeight: 600, color: C.muted, textDecoration: 'none',
        }}>
          ← Тэмцээний хуудас
        </Link>
        <button
          onClick={() => setShowLeaderboard(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: C.accentDim, border: '1px solid rgba(167,139,250,0.25)',
            borderRadius: 999, padding: '0.3rem 0.75rem',
            fontSize: '0.78rem', fontWeight: 600, color: C.accent,
            cursor: 'pointer', fontFamily: FONT,
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: C.success,
            animation: 'lb-pulse 2s ease-in-out infinite',
          }} />
          Үзүүлэлт
        </button>
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
            Оролцох төрлүүд
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
                          attemptId={activeAttempt?.id}
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

          {/* ── Finish attempt CTA ── */}
          {!isClosed && (
            <div style={{ marginTop: '2rem', paddingBottom: '1rem' }}>
              {showFinishConfirm ? (
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 12, padding: '1rem',
                }}>
                  <div style={{ fontSize: '0.88rem', color: C.text, marginBottom: '0.75rem', lineHeight: 1.5 }}>
                    Тэмцээнээ дуусгаж байна уу?<br />
                    <span style={{ fontSize: '0.78rem', color: C.muted }}>
                      Дахин үргэлжлүүлэх боломжгүй болно.
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setShowFinishConfirm(false)}
                      style={{
                        flex: 1, padding: '0.65rem', borderRadius: 9,
                        background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
                        color: C.muted, fontFamily: FONT, fontSize: '0.88rem', fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Болих
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleFinish()}
                      disabled={finishing}
                      style={{
                        flex: 2, padding: '0.65rem', borderRadius: 9,
                        background: finishing ? 'rgba(167,139,250,0.3)' : 'rgba(167,139,250,0.75)',
                        border: '1px solid rgba(167,139,250,0.9)',
                        color: '#fff', fontFamily: FONT, fontSize: '0.88rem', fontWeight: 700,
                        cursor: finishing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {finishing ? 'Хадгалж байна...' : 'Тийм, дуусгах'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => canFinishResult.canFinish && setShowFinishConfirm(true)}
                    disabled={!canFinishResult.canFinish}
                    title={
                      !canFinishResult.canFinish
                        ? canFinishResult.missing.map((m) => m.roundName).join(', ') + ' үлдсэн'
                        : undefined
                    }
                    style={{
                      width: '100%', padding: '0.82rem', borderRadius: 10,
                      background: canFinishResult.canFinish
                        ? 'rgba(52,211,153,0.15)'
                        : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${canFinishResult.canFinish ? 'rgba(52,211,153,0.4)' : C.border}`,
                      color: canFinishResult.canFinish ? C.success : C.muted,
                      fontFamily: FONT, fontSize: '0.95rem', fontWeight: 700,
                      cursor: canFinishResult.canFinish ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s',
                    }}
                  >
                    {canFinishResult.canFinish
                      ? 'Тэмцээн дуусгах ✓'
                      : `Тэмцээн дуусгах · ${canFinishResult.missing.length} раунд үлдсэн`}
                  </button>
                  {!canFinishResult.canFinish && canFinishResult.missing.length > 0 && (
                    <div style={{
                      marginTop: '0.4rem', fontSize: '0.72rem', color: C.muted,
                      textAlign: 'center', lineHeight: 1.5,
                    }}>
                      {canFinishResult.missing.map((m) => m.roundName).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showLeaderboard && (
        <LeaderboardModal
          compId={compId}
          registeredEvents={registeredEvents}
          rounds={rounds}
          myResults={myResults}
          currentUid={user!.uid}
          currentUserName={participant.displayName}
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      <style>{`
        @keyframes lb-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.45; transform: scale(0.7); }
        }
        .leaderboard-list::-webkit-scrollbar { display: none; }
      `}</style>

    </div>
  );
}

function RoundRow({
  compId, round, state, myResult, attemptId, borderBottom,
}: {
  compId: string;
  round: VirtualRound;
  state: RoundState;
  myResult?: ParticipantRoundResult;
  attemptId?: string;
  borderBottom: boolean;
}) {
  const router = useRouter();
  const isAvailable = state === 'available';
  const myRank =
    state === 'completed' && myResult && round.historicalResults.length > 0
      ? computeRank(
          { best: myResult.best, average: myResult.average, format: round.format },
          round.historicalResults,
        )
      : null;

  const roundUrl = attemptId
    ? `/timer/competitions/${compId}/compete/${round.id}?attempt=${attemptId}`
    : `/timer/competitions/${compId}/compete/${round.id}`;

  return (
    <div
      onClick={() => isAvailable && router.push(roundUrl)}
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
            {myRank !== null && (
              <span style={{ color: C.accent }}> · #{myRank} байр</span>
            )}
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

// ─── Leaderboard modal ────────────────────────────────────────────────────────

interface LBEntry {
  isMe: boolean;
  name: string;
  best: number;
  average: number;
  times: number[];
  penalties?: string[];
  rank: number;
}

function formatSolvesWCA(times: number[], format: string, penalties?: string[]) {
  if (!times || times.length === 0) return <span style={{ color: C.muted }}>—</span>;

  const fmtSingle = (t: number, pen?: string): string => {
    if (pen === 'dnf' || t === -1) return 'DNF';
    if (pen === '+2') return fmtTime(Math.max(0, t - 2000)) + '+';
    return fmtTime(t);
  };

  if (format === 'avg5' && times.length >= 5) {
    const effVals = times.map((t) => (t === -1 ? Infinity : t));
    const maxEff = Math.max(...effVals);
    const minEff = Math.min(...effVals);
    const worstIdx = effVals.lastIndexOf(maxEff);
    const bestIdx = effVals.indexOf(minEff);
    return (
      <>
        {times.map((t, i) => {
          const s = fmtSingle(t, penalties?.[i]);
          const bracket = i === worstIdx || i === bestIdx;
          return <span key={i}>{bracket ? `(${s})` : s}</span>;
        })}
      </>
    );
  }
  return (
    <>
      {times.map((t, i) => (
        <span key={i}>{fmtSingle(t, penalties?.[i])}</span>
      ))}
    </>
  );
}

function LeaderboardModal({
  compId: _compId,
  registeredEvents,
  rounds,
  myResults,
  currentUid: _currentUid,
  currentUserName,
  onClose,
}: {
  compId: string;
  registeredEvents: string[];
  rounds: VirtualRound[];
  myResults: ParticipantRoundResult[];
  currentUid: string;
  currentUserName: string;
  onClose: () => void;
}) {
  const completedByEvent = useMemo(() => {
    const m: Record<string, number[]> = {};
    for (const r of myResults) {
      if (registeredEvents.includes(r.eventId)) {
        (m[r.eventId] ??= []).push(r.roundNumber);
      }
    }
    return m;
  }, [myResults, registeredEvents]);

  const defaultEvent =
    registeredEvents.find((eid) => (completedByEvent[eid]?.length ?? 0) > 0) ??
    registeredEvents[0] ??
    '';

  const [selectedEventId, setSelectedEventId] = useState(defaultEvent);
  const [selectedRound, setSelectedRound] = useState<number>(() => {
    const rns = completedByEvent[defaultEvent] ?? [];
    return rns.length > 0 ? Math.max(...rns) : 1;
  });
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    const rns = completedByEvent[selectedEventId] ?? [];
    setSelectedRound(rns.length > 0 ? Math.max(...rns) : 1);
    setExpandedIdx(null);
  }, [selectedEventId, completedByEvent]);

  useEffect(() => { setExpandedIdx(null); }, [selectedRound]);

  const completedRoundsForEvent = completedByEvent[selectedEventId] ?? [];
  const isCompleted = completedRoundsForEvent.includes(selectedRound);

  // All rounds for selected event — sorted
  const eventRounds = useMemo(
    () =>
      [...rounds.filter((r) => r.eventId === selectedEventId)].sort(
        (a, b) => a.roundNumber - b.roundNumber,
      ),
    [rounds, selectedEventId],
  );

  const selectedRoundData = eventRounds.find((r) => r.roundNumber === selectedRound);

  // Leaderboard: historical results + current user only (no other live participants)
  const entries = useMemo((): LBEntry[] => {
    if (!isCompleted || !selectedRoundData) return [];

    console.log(
      '[leaderboard] historical:',
      selectedRoundData.historicalResults.map((r) => ({
        name: r.athleteName, best: r.best, avg: r.average,
      })),
    );

    const myRound = myResults.find(
      (r) => r.eventId === selectedEventId && r.roundNumber === selectedRound,
    );
    const eff = (v: number) => (v === -1 ? Infinity : v);

    const raw: Omit<LBEntry, 'rank'>[] = [
      ...selectedRoundData.historicalResults.map((h) => ({
        isMe: false,
        name: h.athleteName,
        best: h.best,
        average: h.average,
        times: h.times,
        penalties: h.penalties as string[] | undefined,
      })),
      ...(myRound
        ? [{
            isMe: true,
            name: currentUserName,
            best: myRound.best,
            average: myRound.average,
            times: myRound.solves.map((s) => s.ms),
            penalties: myRound.solves.map((s) => s.penalty as string),
          }]
        : []),
    ];

    raw.sort((a, b) => {
      const da = eff(a.average) - eff(b.average);
      if (da !== 0) return da;
      return eff(a.best) - eff(b.best);
    });
    return raw.map((e, i) => ({ ...e, rank: i + 1 }));
  }, [isCompleted, selectedRoundData, myResults, selectedEventId, selectedRound, currentUserName]);

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
        background: C.bg, flexShrink: 0,
      }}>
        <span style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: C.success,
            animation: 'lb-pulse 2s ease-in-out infinite',
            display: 'inline-block',
          }} />
          Үзүүлэлт
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.muted,
          cursor: 'pointer', fontSize: '1.15rem', padding: '0.2rem 0.5rem', lineHeight: 1,
        }}>✕</button>
      </div>

      {/* Body — flex column so table can fill remaining height */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          maxWidth: 480, margin: '0 auto', width: '100%',
          flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          padding: '0 1rem',
        }}>

          {/* Selectors — non-scrolling */}
          <div style={{ display: 'flex', gap: '0.5rem', padding: '1rem 0 1.1rem', flexShrink: 0 }}>
            {/* Event */}
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{
                flex: 1, background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.text, padding: '0.42rem 0.65rem',
                fontFamily: FONT, fontSize: '0.82rem', outline: 'none',
              }}
            >
              {registeredEvents.map((eid) => {
                const ev = getEvent(eid);
                const has = (completedByEvent[eid]?.length ?? 0) > 0;
                return (
                  <option key={eid} value={eid}>
                    {ev?.name ?? eid}{!has ? ' —' : ''}
                  </option>
                );
              })}
            </select>

            {/* Round — ALL rounds shown; incomplete ones marked with 🔒 */}
            {eventRounds.length > 0 && (
              <select
                value={selectedRound}
                onChange={(e) => setSelectedRound(Number(e.target.value))}
                style={{
                  flex: 1, background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 8, color: C.text, padding: '0.42rem 0.65rem',
                  fontFamily: FONT, fontSize: '0.82rem', outline: 'none',
                }}
              >
                {eventRounds.map((r) => {
                  const done = completedRoundsForEvent.includes(r.roundNumber);
                  return (
                    <option key={r.roundNumber} value={r.roundNumber}>
                      {r.roundName}{!done ? ' 🔒' : ''}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Content — fills remaining height */}
          {eventRounds.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 0', color: C.muted, fontSize: '0.88rem' }}>
              Раунд тохируулагдаагүй
            </div>

          ) : !isCompleted ? (
            <div style={{
              textAlign: 'center', padding: '4rem 0',
              color: C.muted, fontSize: '0.88rem', lineHeight: 1.7,
            }}>
              🔒<br />Энэ раундыг дуусгасны дараа<br />үзүүлэлт харагдана
            </div>

          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: C.muted, fontSize: '0.85rem' }}>
              Үр дүн байхгүй
            </div>

          ) : (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
              border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: '1rem',
            }}>
              {/* Column header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '32px 1fr 68px 72px',
                padding: '0.35rem 0.75rem', gap: '0.25rem',
                background: 'rgba(255,255,255,0.03)',
                borderBottom: `1px solid ${C.border}`,
                flexShrink: 0,
              }}>
                {(['#', 'Нэр', 'Best', 'Avg ▾'] as const).map((h, i) => (
                  <span key={h} style={{
                    fontSize: '0.6rem', fontWeight: 800,
                    letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted,
                    textAlign: i >= 2 ? 'right' : 'left',
                  }}>{h}</span>
                ))}
              </div>

              {/* Scrollable rows — fills remaining height, no visible scrollbar */}
              <div
                className="leaderboard-list"
                style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' }}
              >
                {entries.map((entry, idx) => {
                  const isMe = entry.isMe;
                  const expanded = expandedIdx === idx;
                  const isLast = idx === entries.length - 1;
                  return (
                    <div
                      key={idx}
                      style={{ borderBottom: isLast && !expanded ? 'none' : `1px solid ${C.border}` }}
                    >
                      {/* Main row */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '32px 1fr 68px 72px',
                        padding: '0.55rem 0.75rem', gap: '0.25rem', alignItems: 'center',
                        background: isMe ? C.accentDim : 'transparent',
                      }}>
                        <span style={{
                          fontFamily: MONO, fontSize: '0.82rem', fontWeight: 700,
                          color: entry.rank <= 3 ? C.accent : C.muted,
                        }}>
                          {entry.rank}
                        </span>
                        <span style={{
                          fontSize: '0.85rem', fontWeight: isMe ? 700 : 400,
                          color: isMe ? C.accent : C.text,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {entry.name}
                        </span>
                        <span style={{
                          fontFamily: MONO, fontSize: '0.82rem', color: C.success,
                          textAlign: 'right',
                        }}>
                          {fmtTime(entry.best)}
                        </span>
                        {/* Avg — tap to expand solves */}
                        <span
                          onClick={() => setExpandedIdx((p) => (p === idx ? null : idx))}
                          style={{
                            fontFamily: MONO, fontSize: '0.82rem', color: C.text,
                            cursor: 'pointer', userSelect: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.2rem',
                          }}
                        >
                          {fmtTime(entry.average)}
                          <span style={{ fontSize: '0.55rem', color: C.muted, lineHeight: 1 }}>
                            {expanded ? '▴' : '▾'}
                          </span>
                        </span>
                      </div>

                      {/* Expanded solves — centered across full row width */}
                      {expanded && (
                        <div style={{
                          padding: '0.5rem 0.75rem 0.6rem',
                          borderTop: `1px solid ${C.border}`,
                          background: isMe ? 'rgba(167,139,250,0.06)' : 'rgba(255,255,255,0.02)',
                          display: 'flex', justifyContent: 'center', alignItems: 'center',
                          gap: '1rem', flexWrap: 'wrap',
                          fontFamily: MONO, fontSize: '0.9rem', color: C.muted,
                        }}>
                          {formatSolvesWCA(
                            entry.times,
                            selectedRoundData?.format ?? 'avg5',
                            entry.penalties,
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
