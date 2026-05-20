'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ref as rtdbRef, get as rtdbGet, set as rtdbSet, remove as rtdbRemove } from 'firebase/database';
import { Timestamp } from 'firebase/firestore';
import { rtdb } from '@/lib/firebase';
import {
  getCompetition,
  getRounds,
  getRound,
  getParticipant,
  getMyResults,
  getMyResult,
  submitRoundResult,
  computeBest,
  computeAverage,
  computeRank,
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualCompetition,
  VirtualRound,
  VirtualParticipant,
  ParticipantRoundResult,
  ParticipantSolve,
} from '@/lib/firebase/services/virtual-competitions';
import { getEvent } from '@/lib/wca-events';
import { useAuth } from '@/lib/auth-context';
import { useTimer, fmtMs, DEFAULT_HOLD_TIME_MS, INSPECTION_MS } from '@/lib/timer-engine';
import type { Penalty } from '@/lib/timer-engine';

// ─── Theme ────────────────────────────────────────────────────────────────────

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
  successDim:'rgba(52,211,153,0.15)',
  warn:      '#fbbf24',
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

function getSolveCount(format: VirtualRound['format']): number {
  if (format === 'bo1') return 1;
  if (format === 'mo3' || format === 'bo3') return 3;
  return 5;
}

function getScrambles(round: VirtualRound): string[] {
  if (round.groups && round.groups.length > 0 && round.groups[0].scrambles.length > 0) {
    return round.groups[0].scrambles;
  }
  return round.scrambles;
}

function formatLabel(format: VirtualRound['format']): string {
  if (format === 'avg5') return 'Avg of 5';
  if (format === 'mo3') return 'Mean of 3';
  if (format === 'bo1') return 'Best of 1';
  return 'Best of 3';
}

type RoundState = 'completed' | 'available' | 'locked';

function getRoundState(
  round: VirtualRound,
  myResults: ParticipantRoundResult[],
  compClosed: boolean,
): RoundState {
  const done = myResults.some(
    (r) => r.eventId === round.eventId && r.roundNumber === round.roundNumber,
  );
  if (done) return 'completed';
  if (compClosed) return 'locked';
  if (round.roundNumber === 1) return 'available';
  const prevDone = myResults.some(
    (r) => r.eventId === round.eventId && r.roundNumber === round.roundNumber - 1,
  );
  return prevDone ? 'available' : 'locked';
}

// ─── Shared shells ────────────────────────────────────────────────────────────

function LoadingShell() {
  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '0.85rem', color: C.muted }}>Ачааллаж байна...</div>
    </div>
  );
}

function NotFoundShell({ compId }: { compId: string }) {
  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '1rem', textAlign: 'center', padding: '2rem',
    }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Раунд олдсонгүй</div>
      <Link href={`/timer/competitions/${compId}`}
        style={{ fontSize: '0.85rem', color: C.muted, textDecoration: 'none' }}>
        ← Тэмцээний хуудасруу буцах
      </Link>
    </div>
  );
}

// ─── RTDB progress ────────────────────────────────────────────────────────────

interface ProgressDraft {
  solves: { ms: number; penalty: 'none' | '+2' | 'dnf' }[];
}

function progressPath(compId: string, uid: string, eventId: string, roundNumber: number) {
  return `virtualProgress/${compId}/${uid}/${eventId}_${roundNumber}`;
}

// ─── HUB VIEW ─────────────────────────────────────────────────────────────────

interface HubProps {
  compId: string;
}

function HubView({ compId }: HubProps) {
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

  if (authLoading || loading) return <LoadingShell />;
  if (notFound || !comp || !participant) return <NotFoundShell compId={compId} />;

  const isClosed = comp.status === 'closed';

  // Group rounds by eventId; only show participant's registered events
  const registeredEvents = participant.registeredEvents;
  const roundsByEvent = rounds.reduce<Record<string, VirtualRound[]>>((acc, r) => {
    if (registeredEvents.includes(r.eventId)) {
      (acc[r.eventId] ??= []).push(r);
    }
    return acc;
  }, {});
  // Sort rounds within each event
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

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem 3rem' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 0.25rem', color: C.text }}>
            {comp.name}
          </h1>
          <div style={{ fontSize: '0.78rem', color: C.muted, fontFamily: MONO, marginBottom: '1.5rem' }}>
            {comp.date}
            {isClosed && (
              <span style={{
                marginLeft: '0.5rem',
                display: 'inline-block', padding: '0.1rem 0.45rem', borderRadius: 999,
                fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em',
                background: 'rgba(100,116,139,0.2)', color: C.muted,
              }}>
                ХААГДСАН
              </span>
            )}
          </div>

          <div style={{
            fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '1rem',
          }}>
            Бүртгүүлсэн төрлүүд
          </div>

          {registeredEvents.length === 0 ? (
            <div style={{ fontSize: '0.9rem', color: C.muted, padding: '2rem 0', textAlign: 'center' }}>
              Бүртгүүлсэн төрөл байхгүй
            </div>
          ) : (
            registeredEvents.map((eventId) => {
              const ev = getEvent(eventId);
              const eventRounds = roundsByEvent[eventId] ?? [];
              return (
                <div key={eventId} style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: C.text, marginBottom: '0.5rem' }}>
                    {ev?.name ?? eventId}
                  </div>
                  {eventRounds.length === 0 ? (
                    <div style={{
                      padding: '0.7rem 0.9rem', borderRadius: 10,
                      background: C.card, border: `1px solid ${C.border}`,
                      fontSize: '0.8rem', color: C.muted,
                    }}>
                      Раунд тохируулагдаагүй байна
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {eventRounds.map((round) => {
                        const state = getRoundState(round, myResults, isClosed);
                        const myResult = myResults.find(
                          (r) => r.eventId === round.eventId && r.roundNumber === round.roundNumber,
                        );
                        return (
                          <RoundCard
                            key={round.id}
                            compId={compId}
                            round={round}
                            state={state}
                            myResult={myResult}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function RoundCard({
  compId,
  round,
  state,
  myResult,
}: {
  compId: string;
  round: VirtualRound;
  state: RoundState;
  myResult?: ParticipantRoundResult;
}) {
  const router = useRouter();
  const isCompleted = state === 'completed';
  const isAvailable = state === 'available';
  const isLocked = state === 'locked';

  function handleClick() {
    if (!isAvailable) return;
    router.push(`/timer/competitions/${compId}/compete?event=${round.eventId}&round=${round.roundNumber}`);
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 0.9rem', borderRadius: 10,
        background: isCompleted ? C.successDim : isAvailable ? C.accentDim : C.card,
        border: `1px solid ${
          isCompleted ? 'rgba(52,211,153,0.25)'
          : isAvailable ? 'rgba(167,139,250,0.35)'
          : C.border
        }`,
        cursor: isAvailable ? 'pointer' : 'default',
        transition: 'background 0.12s',
        gap: '0.75rem',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: isLocked ? C.muted : C.text }}>
          {round.roundName}
        </div>
        {isCompleted && myResult && (
          <div style={{ fontSize: '0.75rem', color: C.muted, fontFamily: MONO, marginTop: '0.2rem' }}>
            Best: {fmtTime(myResult.best)} · Avg: {fmtTime(myResult.average)}
          </div>
        )}
        {isLocked && (
          <div style={{ fontSize: '0.72rem', color: C.muted, marginTop: '0.2rem' }}>
            Дараагийн раундад орох
          </div>
        )}
      </div>
      <div style={{
        flexShrink: 0, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em',
        padding: '0.25rem 0.65rem', borderRadius: 999,
        background: isCompleted ? 'rgba(52,211,153,0.15)'
          : isAvailable ? 'rgba(167,139,250,0.15)'
          : 'rgba(255,255,255,0.05)',
        color: isCompleted ? C.success : isAvailable ? C.accent : C.muted,
      }}>
        {isCompleted ? '✓ Дууссан' : isAvailable ? 'Хийх' : 'Түгжээтэй'}
      </div>
    </div>
  );
}

// ─── SOLVING VIEW ─────────────────────────────────────────────────────────────

interface SolvingProps {
  compId: string;
  eventId: string;
  roundNumber: number;
}

type DraftSolve = { ms: number; penalty: 'none' | '+2' | 'dnf' };

function SolvingView({ compId, eventId, roundNumber }: SolvingProps) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [round, setRound] = useState<VirtualRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [solves, setSolves] = useState<DraftSolve[]>([]);
  const [pendingSolve, setPendingSolve] = useState<DraftSolve | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const solvesRef = useRef<DraftSolve[]>([]);
  solvesRef.current = solves;

  // Hold-to-start from solo prefs
  const [holdTimeMs] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('pv.timer.prefs.v1');
      if (raw) {
        const p = JSON.parse(raw) as { holdTimeMs?: unknown };
        if (typeof p.holdTimeMs === 'number' && isFinite(p.holdTimeMs)) {
          return Math.max(200, Math.min(1000, p.holdTimeMs));
        }
      }
    } catch {}
    return DEFAULT_HOLD_TIME_MS;
  });

  const onSolveCommit = useCallback((ms: number, inspPenalty: Penalty) => {
    setPendingSolve({ ms, penalty: inspPenalty });
  }, []);

  const timer = useTimer(onSolveCommit, holdTimeMs);

  // ── Auth guard ──
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push(`/login?redirect=/timer/competitions/${compId}/compete?event=${eventId}&round=${roundNumber}`);
    }
  }, [authLoading, user, compId, eventId, roundNumber, router]);

  // ── Fetch round + check for existing result + restore RTDB progress ──
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      try {
        const roundId = `${eventId}_${roundNumber}`;
        const [roundData, existingResult] = await Promise.all([
          getRound(compId, roundId),
          getMyResult(compId, user!.uid, eventId, roundNumber),
        ]);
        if (cancelled) return;
        if (!roundData) { setNotFound(true); setLoading(false); return; }
        if (existingResult) {
          router.replace(
            `/timer/competitions/${compId}/compete?event=${eventId}&round=${roundNumber}&done=1`,
          );
          return;
        }
        // Restore RTDB progress
        const path = progressPath(compId, user!.uid, eventId, roundNumber);
        const snap = await rtdbGet(rtdbRef(rtdb, path));
        if (!cancelled && snap.exists()) {
          const data = snap.val() as ProgressDraft;
          if (Array.isArray(data.solves)) setSolves(data.solves);
        }
        if (!cancelled) {
          setRound(roundData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [user, compId, eventId, roundNumber, router]);

  // ── Save progress to RTDB after each confirmed solve ──
  async function saveDraft(updatedSolves: DraftSolve[]) {
    if (!user) return;
    const path = progressPath(compId, user.uid, eventId, roundNumber);
    try {
      await rtdbSet(rtdbRef(rtdb, path), { solves: updatedSolves } satisfies ProgressDraft);
    } catch (err) {
      console.warn('[compete] RTDB save failed', err);
    }
  }

  // ── Submit and finish ──
  async function submitAndFinish(finalSolves: DraftSolve[]) {
    if (!user || !round) return;
    setSubmitting(true);
    try {
      const participantSolves: ParticipantSolve[] = finalSolves.map((s, i) => ({
        index: i,
        ms: s.ms,
        penalty: s.penalty,
        scramble: getScrambles(round)[i] ?? '',
        completedAt: Date.now(),
      }));
      const best = computeBest(participantSolves);
      const average = computeAverage(participantSolves, round.format);
      await submitRoundResult(compId, {
        uid: user.uid,
        eventId,
        roundNumber,
        solves: participantSolves,
        best,
        average,
        completedAt: Timestamp.now(),
      });
      // Clear RTDB progress
      const path = progressPath(compId, user.uid, eventId, roundNumber);
      await rtdbRemove(rtdbRef(rtdb, path));
      router.replace(
        `/timer/competitions/${compId}/compete?event=${eventId}&round=${roundNumber}&done=1`,
      );
    } catch (err) {
      console.error('[compete] submit failed', err);
      setSubmitting(false);
    }
  }

  // ── Confirm a pending solve ──
  async function confirmSolve() {
    if (!pendingSolve || !round) return;
    const newSolves = [...solvesRef.current, pendingSolve];
    setSolves(newSolves);
    setPendingSolve(null);
    timer.reset();
    const total = getSolveCount(round.format);
    if (newSolves.length >= total) {
      await submitAndFinish(newSolves);
    } else {
      await saveDraft(newSolves);
    }
  }

  // ── Touch/keyboard events ──
  const pendingSolveRef = useRef<DraftSolve | null>(null);
  pendingSolveRef.current = pendingSolve;

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      // Don't interfere with penalty/confirm buttons
      if ((e.target as HTMLElement)?.closest('[data-timer-ignore]')) return;
      const pend = pendingSolveRef.current;
      if (pend) return;
      const s = timer.state;
      if (s === 'running') {
        timer.stop();
      } else if (s === 'idle' || s === 'stopped') {
        timer.reset();
        timer.beginInspection();
      } else if (s === 'inspecting') {
        timer.startArming();
      }
    }
    function onPointerUp() {
      if (timer.state === 'armed') timer.fireRunning();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (e.repeat) return;
      e.preventDefault();
      const pend = pendingSolveRef.current;
      if (pend) return;
      const s = timer.state;
      if (s === 'running') {
        timer.stop();
      } else if (s === 'idle' || s === 'stopped') {
        timer.reset();
        timer.beginInspection();
      } else if (s === 'inspecting') {
        timer.startArming();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (timer.state === 'armed') timer.fireRunning();
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [timer]);

  if (authLoading || loading) return <LoadingShell />;
  if (notFound || !round) return <NotFoundShell compId={compId} />;

  const scrambles = getScrambles(round);
  const totalSolves = getSolveCount(round.format);
  const currentIdx = solves.length; // 0-based index of next solve
  const currentScramble = scrambles[currentIdx] ?? '';
  const ev = getEvent(round.eventId);

  // Timer display
  const isRunning = timer.state === 'running';
  const isArmed = timer.state === 'armed';
  const isInspecting = timer.state === 'inspecting';
  const isStopped = timer.state === 'stopped';

  let timerDisplay: string;
  let timerColor: string = C.text;

  if (isInspecting) {
    const secLeft = Math.ceil(Math.max(-2, timer.inspectionMs / 1000));
    if (timer.inspectionMs > 0) {
      timerDisplay = String(secLeft);
    } else if (timer.inspectionMs > -2000) {
      timerDisplay = '+2';
      timerColor = C.warn;
    } else {
      timerDisplay = 'DNF';
      timerColor = C.danger;
    }
  } else if (isArmed) {
    timerDisplay = '0.00';
    timerColor = timer.armedReady ? C.success : C.danger;
  } else if (isRunning) {
    timerDisplay = fmtMs(timer.displayMs, false, 'cs');
    timerColor = C.text;
  } else if (isStopped && pendingSolve) {
    timerDisplay = fmtTime(pendingSolve.ms);
    timerColor = timer.stopFlashing ? C.success : C.text;
  } else {
    timerDisplay = '0.00';
    timerColor = C.muted;
  }

  const showFocus = isRunning || isArmed || isInspecting;
  const noScrambles = scrambles.length === 0;

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column',
      userSelect: 'none', touchAction: 'none',
    }}>
      {/* Header */}
      {!showFocus && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: C.bg, borderBottom: `1px solid ${C.border}`,
          padding: '0.75rem 1rem', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button
            data-timer-ignore="1"
            onClick={() => router.push(`/timer/competitions/${compId}/compete`)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              fontSize: '0.82rem', fontWeight: 600, color: C.muted, fontFamily: FONT,
            }}
          >
            ← Дуусгах
          </button>
          <div style={{ fontSize: '0.82rem', color: C.muted }}>
            {ev?.short ?? round.eventId} · {round.roundName}
          </div>
          <div style={{
            fontSize: '0.78rem', fontWeight: 700,
            color: pendingSolve ? C.accent : C.muted,
            fontFamily: MONO,
          }}>
            Solve {Math.min(currentIdx + 1, totalSolves)}/{totalSolves}
          </div>
        </div>
      )}

      {/* Scramble */}
      {!showFocus && !pendingSolve && (
        <div style={{
          padding: '1.25rem 1.25rem 0',
          textAlign: 'center',
          flexShrink: 0,
        }}>
          {noScrambles ? (
            <div style={{ fontSize: '0.88rem', color: C.muted, padding: '1rem 0' }}>
              Холилтуудыг удирдагч бэлдэж байна...
            </div>
          ) : currentIdx < scrambles.length ? (
            <div style={{
              fontSize: 'clamp(0.95rem, 4vw, 1.3rem)', fontWeight: 600,
              color: C.text, lineHeight: 1.6, fontFamily: MONO,
              letterSpacing: '0.03em',
            }}>
              {currentScramble}
            </div>
          ) : (
            <div style={{ fontSize: '0.88rem', color: C.muted }}>Холилт дуусгав</div>
          )}
        </div>
      )}

      {/* Timer area */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: showFocus ? '0' : '1rem',
        minHeight: 200,
        position: 'relative',
      }}>
        {isInspecting && timer.inspectionMs > 0 && (
          <div style={{ fontSize: '0.7rem', color: C.muted, marginBottom: '0.5rem', letterSpacing: '0.1em' }}>
            INSPECTION
          </div>
        )}
        <div style={{
          fontSize: 'clamp(4.5rem, 20vw, 10rem)', fontWeight: 700,
          fontFamily: MONO, letterSpacing: '-0.02em',
          color: timerColor,
          transition: (isRunning || isArmed) ? 'none' : 'color 0.15s',
          lineHeight: 1,
        }}>
          {timerDisplay}
        </div>
        {!showFocus && !pendingSolve && !noScrambles && currentIdx < totalSolves && (
          <div style={{ fontSize: '0.75rem', color: C.muted, marginTop: '1rem' }}>
            {isArmed && !timer.armedReady ? 'Удаан дарсаар байна...' : 'Дарж эхлэх'}
          </div>
        )}

        {/* Pending solve confirm panel */}
        {pendingSolve && (
          <div
            data-timer-ignore="1"
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'rgba(14,14,14,0.97)',
              borderTop: `1px solid ${C.border}`,
              padding: '1rem',
              display: 'flex', flexDirection: 'column', gap: '0.75rem',
            }}
          >
            {/* Penalty buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              {(['none', '+2', 'dnf'] as const).map((p) => {
                const active = pendingSolve.penalty === p;
                return (
                  <button
                    key={p}
                    type="button"
                    data-timer-ignore="1"
                    onClick={() => setPendingSolve((prev) => prev ? { ...prev, penalty: p } : prev)}
                    style={{
                      flex: 1, maxWidth: 100,
                      padding: '0.55rem',
                      borderRadius: 9, fontFamily: FONT, fontSize: '0.88rem', fontWeight: 700,
                      border: `1px solid ${active ? (p === 'dnf' ? C.danger : p === '+2' ? C.warn : C.accent) : C.border}`,
                      background: active
                        ? (p === 'dnf' ? C.dangerDim : p === '+2' ? 'rgba(251,191,36,0.12)' : C.accentDim)
                        : C.card,
                      color: active
                        ? (p === 'dnf' ? C.danger : p === '+2' ? C.warn : C.accent)
                        : C.muted,
                      cursor: 'pointer',
                    }}
                  >
                    {p === 'none' ? 'OK' : p.toUpperCase()}
                  </button>
                );
              })}
            </div>

            {/* Adjusted time display */}
            <div style={{ textAlign: 'center', fontFamily: MONO, fontSize: '0.9rem', color: C.muted }}>
              {pendingSolve.penalty === 'dnf'
                ? 'DNF'
                : pendingSolve.penalty === '+2'
                ? `${fmtMs(pendingSolve.ms + 2000, false, 'cs')} (+2)`
                : fmtMs(pendingSolve.ms, false, 'cs')}
            </div>

            {/* Confirm */}
            <button
              type="button"
              data-timer-ignore="1"
              onClick={() => { void confirmSolve(); }}
              disabled={submitting}
              style={{
                width: '100%', padding: '0.78rem',
                borderRadius: 10, fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
                background: submitting ? 'rgba(167,139,250,0.3)' : 'rgba(167,139,250,0.75)',
                border: '1px solid rgba(167,139,250,0.9)', color: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting
                ? 'Хадгалж байна...'
                : solves.length + 1 >= totalSolves
                ? 'Дуусгах ✓'
                : 'Баталгаажуулах →'}
            </button>
          </div>
        )}
      </div>

      {/* Solve list */}
      {!showFocus && (
        <div style={{
          flexShrink: 0, padding: '0 1rem 1.5rem',
          borderTop: `1px solid ${C.border}`,
          paddingTop: '0.85rem',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '0.55rem' }}>
            Эвлүүлсэн — {formatLabel(round.format)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {Array.from({ length: totalSolves }).map((_, i) => {
              const s = solves[i];
              const isCurrent = i === currentIdx;
              const isPending = isCurrent && pendingSolve != null;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.35rem 0.55rem', borderRadius: 7,
                  background: isCurrent ? C.accentDim : 'transparent',
                  border: `1px solid ${isCurrent ? 'rgba(167,139,250,0.2)' : 'transparent'}`,
                }}>
                  <span style={{ fontSize: '0.72rem', color: C.muted, fontFamily: MONO, width: 14, flexShrink: 0 }}>
                    {i + 1}.
                  </span>
                  <span style={{
                    fontSize: '0.88rem', fontFamily: MONO, fontWeight: s ? 600 : 400,
                    color: s
                      ? (s.penalty === 'dnf' ? C.danger : C.text)
                      : isCurrent ? C.accent : C.muted,
                  }}>
                    {s
                      ? (s.penalty === 'dnf' ? 'DNF' : s.penalty === '+2'
                          ? `${fmtMs(s.ms + 2000, false, 'cs')}+`
                          : fmtMs(s.ms, false, 'cs'))
                      : isPending ? '...'
                      : '___'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RESULT VIEW ──────────────────────────────────────────────────────────────

interface ResultProps {
  compId: string;
  eventId: string;
  roundNumber: number;
}

function ResultView({ compId, eventId, roundNumber }: ResultProps) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [result, setResult] = useState<ParticipantRoundResult | null>(null);
  const [round, setRound] = useState<VirtualRound | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push(`/login?redirect=/timer/competitions/${compId}/compete`);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const [resultData, roundData] = await Promise.all([
          getMyResult(compId, user!.uid, eventId, roundNumber),
          getRound(compId, `${eventId}_${roundNumber}`),
        ]);
        if (cancelled) return;
        setResult(resultData);
        setRound(roundData);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [authLoading, user, compId, eventId, roundNumber, router]);

  if (authLoading || loading) return <LoadingShell />;
  if (!result || !round) return <NotFoundShell compId={compId} />;

  const ev = getEvent(round.eventId);
  const historical = round.historicalResults;

  // Compute rank vs historical results
  const rank = computeRank(
    { best: result.best, average: result.average, format: round.format },
    historical,
  );
  const total = historical.length + 1;

  // Advancement check
  let advancedText: string | null = null;
  let advancedColor: string = C.success;
  if (round.advancementType !== 'final') {
    let threshold = 0;
    if (round.advancementType === 'fixed' && round.advancementValue != null) {
      threshold = round.advancementValue;
    } else if (round.advancementType === 'percentage' && round.advancementValue != null) {
      threshold = Math.ceil(total * round.advancementValue / 100);
    }
    if (threshold > 0) {
      const advanced = rank <= threshold;
      advancedText = advanced
        ? `✓ Дараагийн раундад шилжих эрхтэй (Top ${threshold})`
        : `✗ Дараагийн раундад шилжээгүй (#${rank})`;
      advancedColor = advanced ? C.success : C.danger;
    }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 1rem 3rem',
    }}>
      {/* Check mark */}
      <div style={{
        marginTop: '3rem', marginBottom: '0.5rem',
        fontSize: '2.5rem', color: C.success,
      }}>
        ✓
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: C.text, marginBottom: '0.25rem' }}>
        Дууссан
      </div>
      <div style={{ fontSize: '0.85rem', color: C.muted, marginBottom: '2rem' }}>
        {ev?.name ?? round.eventId} · {round.roundName}
      </div>

      {/* Result card */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '1.25rem',
        marginBottom: '1rem',
      }}>
        {/* Solves row */}
        <div style={{
          display: 'flex', gap: '0.4rem', flexWrap: 'wrap',
          marginBottom: '1.1rem',
        }}>
          {result.solves.map((s, i) => (
            <span key={i} style={{
              fontFamily: MONO, fontSize: '0.82rem',
              color: s.penalty === 'dnf' ? C.danger : C.text,
            }}>
              {s.penalty === 'dnf'
                ? 'DNF'
                : s.penalty === '+2'
                ? `${fmtMs(s.ms + 2000, false, 'cs')}+`
                : fmtMs(s.ms, false, 'cs')}
              {i < result.solves.length - 1 && (
                <span style={{ color: C.muted }}>{' · '}</span>
              )}
            </span>
          ))}
        </div>

        {/* Best / Average */}
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: C.muted, marginBottom: '0.2rem' }}>
              Best
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 700, fontFamily: MONO, color: C.text }}>
              {fmtTime(result.best)}
            </div>
          </div>
          {round.format !== 'bo1' && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: '0.2rem' }}>
                Average
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, fontFamily: MONO, color: C.text }}>
                {fmtTime(result.average)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rank */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '1rem 1.25rem',
        marginBottom: advancedText ? '0.5rem' : '1.5rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
      }}>
        <div style={{ fontSize: '1.5rem', color: C.accent }}>🏆</div>
        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text }}>
            #{rank} байрт орлоо
          </div>
          <div style={{ fontSize: '0.78rem', color: C.muted }}>
            {total} хүний дотор
          </div>
        </div>
      </div>

      {/* Advancement */}
      {advancedText && (
        <div style={{
          width: '100%', maxWidth: 400,
          padding: '0.75rem 1rem', borderRadius: 10, marginBottom: '1.5rem',
          background: advancedColor === C.success ? C.successDim : C.dangerDim,
          border: `1px solid ${advancedColor === C.success ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
          fontSize: '0.85rem', fontWeight: 600, color: advancedColor,
        }}>
          {advancedText}
        </div>
      )}

      {/* Back */}
      <Link
        href={`/timer/competitions/${compId}/compete`}
        style={{
          display: 'block', width: '100%', maxWidth: 400,
          padding: '0.78rem 1rem', borderRadius: 10, textAlign: 'center',
          fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
          background: C.card, border: `1px solid ${C.border}`,
          color: C.muted, textDecoration: 'none',
        }}
      >
        ← Тэмцээний хуудас руу
      </Link>
    </div>
  );
}

// ─── ROUTER INNER ─────────────────────────────────────────────────────────────

function CompeteInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const compId = params.id as string;

  const eventId = searchParams.get('event');
  const roundParam = searchParams.get('round');
  const done = searchParams.get('done') === '1';
  const roundNumber = roundParam ? parseInt(roundParam, 10) : NaN;

  if (!eventId || isNaN(roundNumber)) {
    return <HubView compId={compId} />;
  }
  if (done) {
    return <ResultView compId={compId} eventId={eventId} roundNumber={roundNumber} />;
  }
  return <SolvingView compId={compId} eventId={eventId} roundNumber={roundNumber} />;
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function CompetePage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <CompeteInner />
    </Suspense>
  );
}
