'use client';

import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ref as rtdbRef, get as rtdbGet, set as rtdbSet, remove as rtdbRemove } from 'firebase/database';
import { Timestamp } from 'firebase/firestore';
import { rtdb } from '@/lib/firebase';
import {
  getRound,
  getMyResult,
  submitRoundResult,
  computeBest,
  computeAverage,
  computeRank,
} from '@/lib/firebase/services/virtual-competitions';
import type {
  VirtualRound,
  ParticipantRoundResult,
  ParticipantSolve,
} from '@/lib/firebase/services/virtual-competitions';
import type { TwistyPlayer as TwistyPlayerType } from 'cubing/twisty';
import { getEvent } from '@/lib/wca-events';
import { WcaEventIcon } from '@/lib/wca-event-icon';
import { useAuth } from '@/lib/auth-context';
import { useTimer, fmtMs, DEFAULT_HOLD_TIME_MS } from '@/lib/timer-engine';
import type { Penalty } from '@/lib/timer-engine';

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
  warn:      '#fbbf24',
  danger:    '#ef4444',
  dangerDim: 'rgba(239,68,68,0.12)',
} as const;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", "Fira Code", monospace';

const PUZZLE_MAP: Record<string, string> = {
  '333':   '3x3x3',
  '222':   '2x2x2',
  '444':   '4x4x4',
  '555':   '5x5x5',
  '666':   '6x6x6',
  '777':   '7x7x7',
  'pyram': 'pyraminx',
  'skewb': 'skewb',
  'sq1':   'square1',
  'clock': 'clock',
  'minx':  'megaminx',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getSolveCount(format: VirtualRound['format']): number {
  if (format === 'bo1') return 1;
  if (format === 'mo3' || format === 'bo3') return 3;
  return 5;
}

function getGroupScrambles(round: VirtualRound, groupIndex: number): string[] {
  if (round.groups && round.groups.length > 0) {
    const g = round.groups[groupIndex % round.groups.length];
    if (g && g.scrambles.length > 0) return g.scrambles;
  }
  return round.scrambles ?? [];
}

function fmtTime(ms: number): string {
  if (ms === -1) return 'DNF';
  return fmtMs(ms, false, 'cs');
}

function fmtSolve(ms: number, penalty: 'none' | '+2' | 'dnf'): string {
  if (penalty === 'dnf') return 'DNF';
  if (penalty === '+2') return `${fmtMs(ms + 2000, false, 'cs')}+`;
  return fmtMs(ms, false, 'cs');
}

function formatLabel(format: VirtualRound['format']): string {
  if (format === 'avg5') return 'Avg of 5';
  if (format === 'mo3') return 'Mean of 3';
  if (format === 'bo1') return 'Best of 1';
  return 'Best of 3';
}

function parseRoundId(roundId: string): { eventId: string; roundNumber: number } {
  const last = roundId.lastIndexOf('_');
  if (last === -1) return { eventId: roundId, roundNumber: 1 };
  return {
    eventId: roundId.slice(0, last),
    roundNumber: parseInt(roundId.slice(last + 1), 10) || 1,
  };
}

function getScrambleFontSize(scramble: string): string {
  const len = scramble.length;
  if (len <= 25) return 'clamp(1.1rem, 4.5vw, 1.5rem)';
  if (len <= 40) return 'clamp(0.95rem, 3.8vw, 1.3rem)';
  if (len <= 60) return 'clamp(0.85rem, 3.2vw, 1.1rem)';
  return 'clamp(0.8rem, 2.8vw, 1rem)';
}

// Returns parsed ms, -1 for DNF, or null if invalid
function parseManualTime(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (s === 'dnf') return -1;

  // M:SS.ff
  const mMatch = s.match(/^(\d+):(\d{1,2})\.(\d{1,3})$/);
  if (mMatch) {
    const m = parseInt(mMatch[1], 10);
    const sec = parseInt(mMatch[2], 10);
    const frac = mMatch[3];
    return (m * 60 + sec) * 1000 + parseInt(frac, 10) * Math.pow(10, 3 - frac.length);
  }

  // SS.ff
  const sMatch = s.match(/^(\d+)\.(\d{1,3})$/);
  if (sMatch) {
    const sec = parseInt(sMatch[1], 10);
    const frac = sMatch[2];
    return sec * 1000 + parseInt(frac, 10) * Math.pow(10, 3 - frac.length);
  }

  return null;
}

// ─── RTDB schema ──────────────────────────────────────────────────────────────

type DraftSolve = { ms: number; penalty: 'none' | '+2' | 'dnf' };

interface SolveProgressData {
  groupIndex: number;
  solves: DraftSolve[];
  usedExtras: number;
  scrambleOverrides: Record<string, string>;
}

// ─── CubeViewer ───────────────────────────────────────────────────────────────

function CubeViewer({ eventId, scramble }: { eventId: string; scramble: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TwistyPlayerType | null>(null);
  const puzzleId = PUZZLE_MAP[eventId];

  useEffect(() => {
    if (!puzzleId) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('cubing/twisty');
        if (cancelled || !containerRef.current) return;
        const config = {
          puzzle: puzzleId,
          experimentalSetupAlg: scramble,
          alg: '',
          background: 'none',
          controlPanel: 'none',
          viewerLink: 'none',
          hintFacelets: 'none',
          backView: 'none',
          visualization: '3D',
        } as unknown as ConstructorParameters<typeof mod.TwistyPlayer>[0];
        const player = new mod.TwistyPlayer(config);
        const el = player as unknown as HTMLElement;
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.background = 'transparent';
        containerRef.current.appendChild(el);
        playerRef.current = player;
      } catch (err) {
        console.warn('[vc-solve] TwistyPlayer load failed', err);
      }
    })();
    return () => {
      cancelled = true;
      const player = playerRef.current as unknown as HTMLElement | null;
      const c = containerRef.current;
      if (player && c && c.contains(player)) c.removeChild(player);
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !puzzleId) return;
    try {
      (player as unknown as { puzzle: string }).puzzle = puzzleId;
      (player as unknown as { experimentalSetupAlg: string }).experimentalSetupAlg = scramble;
      (player as unknown as { alg: string }).alg = '';
    } catch {}
  }, [scramble, puzzleId]);

  if (!puzzleId) return null;
  return (
    <div ref={containerRef} style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} />
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function LoadingShell() {
  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ fontSize: '0.85rem', color: C.muted }}>Ачааллаж байна...</div>
    </div>
  );
}

// ─── Result View ──────────────────────────────────────────────────────────────

function ResultView({
  compId, round, result,
}: {
  compId: string;
  round: VirtualRound;
  result: ParticipantRoundResult;
}) {
  const ev = getEvent(round.eventId);
  const hist = round.historicalResults;

  const rank = computeRank(
    { best: result.best, average: result.average, format: round.format },
    hist,
  );
  const total = hist.length + 1;

  let advancedText: string | null = null;
  let advancedGreen = true;
  if (round.advancementType !== 'final') {
    let threshold = 0;
    if (round.advancementType === 'fixed' && round.advancementValue != null) {
      threshold = round.advancementValue;
    } else if (round.advancementType === 'percentage' && round.advancementValue != null) {
      threshold = Math.ceil(total * round.advancementValue / 100);
    }
    if (threshold > 0) {
      const advanced = rank <= threshold;
      advancedGreen = advanced;
      advancedText = advanced
        ? `✓ Дараагийн раундад шилжих эрхтэй (Top ${threshold})`
        : `✗ Дараагийн раундад шилжээгүй (#${rank} / Top ${threshold} шаардлагатай)`;
    }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 1rem 3rem',
    }}>
      <div style={{ marginTop: '3rem', fontSize: '2.8rem', color: C.success }}>✓</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.4rem' }}>Дууссан!</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.45rem',
        fontSize: '0.85rem', color: C.muted, marginTop: '0.25rem', marginBottom: '2rem',
      }}>
        <WcaEventIcon eventId={round.eventId} size={14} />
        {ev?.name ?? round.eventId} · {round.roundName}
      </div>

      <div style={{
        width: '100%', maxWidth: 400,
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '1.1rem 1.25rem', marginBottom: '0.75rem',
      }}>
        <div style={{
          fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: C.muted, marginBottom: '0.65rem',
        }}>
          {formatLabel(round.format)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.75rem', marginBottom: '1rem' }}>
          {result.solves.map((s, i) => (
            <span key={i} style={{
              fontFamily: MONO, fontSize: '0.88rem',
              color: s.penalty === 'dnf' ? C.danger : C.text,
            }}>
              {fmtSolve(s.ms, s.penalty)}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div>
            <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: C.muted, marginBottom: '0.2rem' }}>Best</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: MONO, color: C.text }}>
              {fmtTime(result.best)}
            </div>
          </div>
          {round.format !== 'bo1' && (
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.muted, marginBottom: '0.2rem' }}>Average</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: MONO, color: C.text }}>
                {fmtTime(result.average)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{
        width: '100%', maxWidth: 400,
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '0.9rem 1.25rem', marginBottom: '0.75rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
      }}>
        <div style={{ fontSize: '1.5rem' }}>🏆</div>
        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>#{rank} байрт орлоо</div>
          <div style={{ fontSize: '0.78rem', color: C.muted }}>{total} хүний дотор</div>
        </div>
      </div>

      {advancedText && (
        <div style={{
          width: '100%', maxWidth: 400,
          padding: '0.75rem 1rem', borderRadius: 10, marginBottom: '0.75rem',
          background: advancedGreen ? C.successDim : C.dangerDim,
          border: `1px solid ${advancedGreen ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
          fontSize: '0.85rem', fontWeight: 600,
          color: advancedGreen ? C.success : C.danger,
        }}>
          {advancedText}
        </div>
      )}

      <Link
        href={`/timer/competitions/${compId}/compete`}
        style={{
          display: 'block', width: '100%', maxWidth: 400, marginTop: '0.5rem',
          padding: '0.78rem', borderRadius: 10, textAlign: 'center',
          fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
          background: C.card, border: `1px solid ${C.border}`,
          color: C.muted, textDecoration: 'none',
        }}
      >
        ← Буцах
      </Link>
    </div>
  );
}

// ─── Solving View ─────────────────────────────────────────────────────────────

function SolvingPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const compId = params.id as string;
  const roundId = params.round as string;
  const { eventId, roundNumber } = parseRoundId(roundId);

  // Page state
  const [view, setView] = useState<'loading' | 'solving' | 'result' | 'not_found'>('loading');
  const [round, setRound] = useState<VirtualRound | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [solves, setSolves] = useState<DraftSolve[]>([]);
  const [pendingSolve, setPendingSolve] = useState<DraftSolve | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [myResult, setMyResult] = useState<ParticipantRoundResult | null>(null);

  // FIX 1: explicit solve index
  const [currentSolveIndex, setCurrentSolveIndex] = useState(0);

  // FIX 2: confirm cooldown
  const [confirmArmed, setConfirmArmed] = useState(false);

  // FIX 4: extra scrambles
  const [usedExtras, setUsedExtras] = useState(0);
  const [scrambleOverrides, setScrambleOverrides] = useState<Record<string, string>>({});

  // FIX 5: timer mode
  const [timerMode, setTimerMode] = useState<'standard' | 'manual'>('standard');
  const [manualInput, setManualInput] = useState('');

  // Refs for stable event listener closures
  const pendingSolveRef = useRef<DraftSolve | null>(null);
  const viewRef = useRef<'loading' | 'solving' | 'result' | 'not_found'>('loading');
  const solvesRef = useRef<DraftSolve[]>([]);
  const roundRef = useRef<VirtualRound | null>(null);
  const groupIndexRef = useRef(0);
  const currentSolveIndexRef = useRef(0);
  const usedExtrasRef = useRef(0);
  const scrambleOverridesRef = useRef<Record<string, string>>({});
  const timerModeRef = useRef<'standard' | 'manual'>('standard');

  // Keep refs current each render
  pendingSolveRef.current = pendingSolve;
  viewRef.current = view;
  solvesRef.current = solves;
  roundRef.current = round;
  groupIndexRef.current = groupIndex;
  currentSolveIndexRef.current = currentSolveIndex;
  usedExtrasRef.current = usedExtras;
  scrambleOverridesRef.current = scrambleOverrides;
  timerModeRef.current = timerMode;

  // Timer refs so event listeners stay stable
  const timerStopRef = useRef<() => void>(() => {});
  const timerResetRef = useRef<() => void>(() => {});
  const timerBeginInspectionRef = useRef<() => void>(() => {});
  const timerStartArmingRef = useRef<() => void>(() => {});
  const timerFireRunningRef = useRef<() => void>(() => {});
  const timerStateRef = useRef<string>('idle');

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

  const onSolveCommit = useCallback((ms: number, penalty: Penalty) => {
    setPendingSolve({ ms, penalty });
  }, []);

  const timer = useTimer(onSolveCommit, holdTimeMs);

  // Keep timer refs current
  timerStopRef.current = timer.stop;
  timerResetRef.current = timer.reset;
  timerBeginInspectionRef.current = timer.beginInspection;
  timerStartArmingRef.current = timer.startArming;
  timerFireRunningRef.current = timer.fireRunning;
  timerStateRef.current = timer.state;

  // ── Auth guard ──
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push(`/login?redirect=/timer/competitions/${compId}/compete/${roundId}`);
    }
  }, [authLoading, user, compId, roundId, router]);

  // ── Init: fetch round + restore progress ──
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function init() {
      try {
        const [roundData, existingResult] = await Promise.all([
          getRound(compId, roundId),
          getMyResult(compId, user!.uid, eventId, roundNumber),
        ]);
        if (cancelled) return;

        if (!roundData) { setView('not_found'); return; }

        if (existingResult) {
          setRound(roundData);
          setMyResult(existingResult);
          setView('result');
          return;
        }

        const path = `virtualProgress/${compId}/${user!.uid}/${roundId}`;
        const snap = await rtdbGet(rtdbRef(rtdb, path));
        if (cancelled) return;

        let gi = 0;
        let savedSolves: DraftSolve[] = [];
        let savedUsedExtras = 0;
        let savedOverrides: Record<string, string> = {};

        if (snap.exists()) {
          const data = snap.val() as Partial<SolveProgressData>;
          gi = typeof data.groupIndex === 'number' ? data.groupIndex : 0;
          savedSolves = Array.isArray(data.solves) ? data.solves : [];
          savedUsedExtras = typeof data.usedExtras === 'number' ? data.usedExtras : 0;
          savedOverrides = data.scrambleOverrides && typeof data.scrambleOverrides === 'object'
            ? data.scrambleOverrides as Record<string, string>
            : {};
        } else if (roundData.groups && roundData.groups.length > 1) {
          gi = hashStringToInt(user!.uid + roundId) % roundData.groups.length;
          await rtdbSet(rtdbRef(rtdb, path), {
            groupIndex: gi, solves: [], usedExtras: 0, scrambleOverrides: {},
          } satisfies SolveProgressData);
        }

        setRound(roundData);
        setGroupIndex(gi);
        setSolves(savedSolves);
        setCurrentSolveIndex(savedSolves.length); // FIX 1: set from restored progress
        setUsedExtras(savedUsedExtras);
        setScrambleOverrides(savedOverrides);
        setView('solving');
      } catch (err) {
        console.error('[vc-solve] init failed', err);
        if (!cancelled) setView('not_found');
      }
    }

    void init();
    return () => { cancelled = true; };
  }, [user, compId, roundId, eventId, roundNumber]);

  // FIX 2: confirm cooldown — resets every time a new pendingSolve appears
  useEffect(() => {
    if (!pendingSolve) {
      setConfirmArmed(false);
      return;
    }
    setConfirmArmed(false);
    const t = setTimeout(() => setConfirmArmed(true), 2000);
    return () => clearTimeout(t);
  }, [pendingSolve]);

  // ── Pointer + keyboard event listeners (registered once) ──
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if ((e.target as HTMLElement)?.closest('[data-ignore]')) return;
      if (viewRef.current !== 'solving') return;
      if (pendingSolveRef.current) return;
      if (timerModeRef.current !== 'standard') return; // FIX 5: skip in manual mode
      const s = timerStateRef.current;
      if (s === 'running') {
        timerStopRef.current();
      } else if (s === 'idle' || s === 'stopped') {
        timerResetRef.current();
        timerBeginInspectionRef.current();
      } else if (s === 'inspecting') {
        timerStartArmingRef.current();
      }
    }
    function onPointerUp() {
      if (viewRef.current !== 'solving') return;
      if (timerModeRef.current !== 'standard') return;
      if (timerStateRef.current === 'armed') timerFireRunningRef.current();
    }
    function onKeyDown(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return; // FIX 5: let input handle keys
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (e.repeat) return;
      e.preventDefault();
      if (viewRef.current !== 'solving') return;
      if (pendingSolveRef.current) return;
      if (timerModeRef.current !== 'standard') return;
      const s = timerStateRef.current;
      if (s === 'running') {
        timerStopRef.current();
      } else if (s === 'idle' || s === 'stopped') {
        timerResetRef.current();
        timerBeginInspectionRef.current();
      } else if (s === 'inspecting') {
        timerStartArmingRef.current();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (viewRef.current !== 'solving') return;
      if (timerModeRef.current !== 'standard') return;
      if (timerStateRef.current === 'armed') timerFireRunningRef.current();
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
  }, []);

  // ── FIX 5: Manual time submit ──
  function handleManualSubmit() {
    const raw = manualInput.trim();
    if (!raw) return;
    const parsed = parseManualTime(raw);
    if (parsed === null) return;
    const ms = parsed === -1 ? 0 : parsed;
    const penalty: 'none' | '+2' | 'dnf' = parsed === -1 ? 'dnf' : 'none';
    setPendingSolve({ ms, penalty });
    setManualInput('');
  }

  // ── FIX 4: Extra scramble request ──
  async function requestExtraScramble() {
    const r = roundRef.current;
    if (!r || !user) return;
    const gi = groupIndexRef.current;
    const idx = currentSolveIndexRef.current;
    const extras = usedExtrasRef.current;
    if (extras >= 2) return;
    const group = r.groups?.[gi % (r.groups?.length ?? 1)];
    const extraScramble = group?.extraScrambles?.[extras];
    if (!extraScramble) return;

    const newOverrides = { ...scrambleOverridesRef.current, [String(idx)]: extraScramble };
    setScrambleOverrides(newOverrides);
    setUsedExtras(extras + 1);

    const path = `virtualProgress/${compId}/${user.uid}/${roundId}`;
    await rtdbSet(rtdbRef(rtdb, path), {
      groupIndex: gi,
      solves: solvesRef.current,
      usedExtras: extras + 1,
      scrambleOverrides: newOverrides,
    } satisfies SolveProgressData);
  }

  // ── Confirm a pending solve ──
  async function confirmSolve() {
    const ps = pendingSolveRef.current;
    const r = roundRef.current;
    if (!ps || !r || !user) return;

    const newSolves = [...solvesRef.current, ps];
    const total = getSolveCount(r.format);
    const path = `virtualProgress/${compId}/${user.uid}/${roundId}`;

    // FIX 1: advance solve index explicitly
    if (newSolves.length < total) {
      setCurrentSolveIndex(newSolves.length);
    }
    setSolves(newSolves);
    setPendingSolve(null);
    timer.reset();

    if (newSolves.length >= total) {
      setSubmitting(true);
      try {
        const scrambles = getGroupScrambles(r, groupIndexRef.current);
        const overrides = scrambleOverridesRef.current;
        const pSolves: ParticipantSolve[] = newSolves.map((s, i) => ({
          index: i,
          ms: s.ms,
          penalty: s.penalty,
          scramble: overrides[String(i)] ?? scrambles[i] ?? '',
          completedAt: Date.now(),
        }));
        const best = computeBest(pSolves);
        const average = computeAverage(pSolves, r.format);
        await submitRoundResult(compId, {
          uid: user.uid,
          eventId: r.eventId,
          roundNumber: r.roundNumber,
          solves: pSolves,
          best,
          average,
          completedAt: Timestamp.now(),
        });
        await rtdbRemove(rtdbRef(rtdb, path));
        const savedResult = await getMyResult(compId, user.uid, r.eventId, r.roundNumber);
        setMyResult(savedResult);
        setView('result');
      } catch (err) {
        console.error('[vc-solve] submit failed', err);
        setSubmitting(false);
      }
    } else {
      await rtdbSet(rtdbRef(rtdb, path), {
        groupIndex: groupIndexRef.current,
        solves: newSolves,
        usedExtras: usedExtrasRef.current,
        scrambleOverrides: scrambleOverridesRef.current,
      } satisfies SolveProgressData);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (authLoading || view === 'loading') return <LoadingShell />;

  if (view === 'not_found' || !round) {
    return (
      <div style={{
        minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '1rem', padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Раунд олдсонгүй</div>
        <Link href={`/timer/competitions/${compId}/compete`}
          style={{ fontSize: '0.85rem', color: C.muted, textDecoration: 'none' }}>
          ← Буцах
        </Link>
      </div>
    );
  }

  if (view === 'result' && myResult) {
    return <ResultView compId={compId} round={round} result={myResult} />;
  }

  // ── Solving UI ──────────────────────────────────────────────────────────────

  const ev = getEvent(round.eventId);
  const scrambles = getGroupScrambles(round, groupIndex);
  const totalSolves = getSolveCount(round.format);
  // FIX 1: use explicit solve index
  const currentScramble = scrambleOverrides[String(currentSolveIndex)]
    ?? scrambles[currentSolveIndex]
    ?? '';
  const noScrambles = scrambles.length === 0;

  const isRunning = timer.state === 'running';
  const isArmed = timer.state === 'armed';
  const isInspecting = timer.state === 'inspecting';
  const showFocus = isRunning || isArmed || isInspecting;

  // FIX 4: extra scramble availability
  const extraAvailable =
    !pendingSolve &&
    !showFocus &&
    usedExtras < 2 &&
    currentSolveIndex < totalSolves &&
    !!(round.groups?.[groupIndex % (round.groups?.length ?? 1)]?.extraScrambles?.[usedExtras]);

  // Timer display
  let timerDisplay: string;
  let timerColor: string = C.text;

  if (isInspecting) {
    if (timer.inspectionMs > 0) {
      timerDisplay = String(Math.ceil(timer.inspectionMs / 1000));
    } else if (timer.inspectionMs > -2000) {
      timerDisplay = '+2'; timerColor = C.warn;
    } else {
      timerDisplay = 'DNF'; timerColor = C.danger;
    }
  } else if (isArmed) {
    timerDisplay = '0.00';
    timerColor = timer.armedReady ? C.success : C.danger;
  } else if (isRunning) {
    timerDisplay = fmtMs(timer.displayMs, false, 'cs');
  } else if (timer.state === 'stopped' && pendingSolve) {
    timerDisplay = fmtSolve(pendingSolve.ms, pendingSolve.penalty);
    timerColor = timer.stopFlashing ? C.success : C.text;
  } else {
    timerDisplay = '0.00'; timerColor = C.muted;
  }

  const isLastSolve = solves.length + 1 >= totalSolves;

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column',
      userSelect: 'none', touchAction: 'none',
    }}>
      {/* Header — hide during focus */}
      {!showFocus && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.75rem 1rem', borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <button
            data-ignore="1"
            onClick={() => router.push(`/timer/competitions/${compId}/compete`)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: 600, color: C.muted, fontFamily: FONT,
            }}
          >
            ← Дуусгах
          </button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            fontSize: '0.82rem', color: C.muted,
          }}>
            <WcaEventIcon eventId={round.eventId} size={14} />
            {round.roundName}
          </div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: MONO, color: C.accent }}>
            {Math.min(currentSolveIndex + 1, totalSolves)}/{totalSolves}
          </div>
        </div>
      )}

      {/* FIX 5: Mode toggle — hide during focus or when confirming */}
      {!showFocus && !pendingSolve && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: '0.4rem',
          padding: '0.6rem 1rem 0', flexShrink: 0,
        }}>
          {(['standard', 'manual'] as const).map((mode) => (
            <button
              key={mode}
              data-ignore="1"
              onClick={() => setTimerMode(mode)}
              style={{
                padding: '0.28rem 0.75rem', borderRadius: 999,
                fontSize: '0.72rem', fontWeight: 700,
                background: timerMode === mode ? C.accentDim : 'transparent',
                border: `1px solid ${timerMode === mode ? 'rgba(167,139,250,0.4)' : C.border}`,
                color: timerMode === mode ? C.accent : C.muted,
                cursor: 'pointer', fontFamily: FONT,
              }}
            >
              {mode === 'standard' ? 'Стандарт' : 'Гараар бичих'}
            </button>
          ))}
        </div>
      )}

      {/* FIX 3: Scramble area + CubeViewer — hide during focus or when pending */}
      {!showFocus && !pendingSolve && currentSolveIndex < totalSolves && (
        <div style={{ flexShrink: 0, padding: '0.75rem 1rem 0' }}>
          {/* Scramble text */}
          {!noScrambles && (
            <div style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: '0.6rem 0.85rem',
              textAlign: 'center', marginBottom: '0.5rem',
            }}>
              <div style={{
                fontSize: getScrambleFontSize(currentScramble),
                fontWeight: 600, fontFamily: MONO,
                color: C.text, lineHeight: 1.65, letterSpacing: '0.03em',
              }}>
                {currentScramble || '—'}
              </div>
            </div>
          )}
          {noScrambles && (
            <div style={{
              textAlign: 'center', padding: '0.75rem',
              fontSize: '0.85rem', color: C.muted,
            }}>
              Холилтуудыг удирдагч бэлдэж байна...
            </div>
          )}

          {/* Cube preview + extra scramble button row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'center' }}>
            {/* FIX 3: CubeViewer */}
            <div style={{
              width: 120, height: 120, flexShrink: 0,
              borderRadius: 10, overflow: 'hidden',
              background: 'transparent',
            }}>
              <CubeViewer eventId={round.eventId} scramble={currentScramble} />
            </div>

            {/* FIX 4: Extra scramble button */}
            {extraAvailable && (
              <button
                data-ignore="1"
                onClick={() => { void requestExtraScramble(); }}
                style={{
                  padding: '0.45rem 0.7rem', borderRadius: 8,
                  fontSize: '0.75rem', fontWeight: 700, fontFamily: FONT,
                  background: 'rgba(251,191,36,0.1)',
                  border: '1px solid rgba(251,191,36,0.3)',
                  color: C.warn, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  flexDirection: 'column', lineHeight: 1.3,
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>🎲</span>
                <span>Нэмэлт</span>
                <span>холилт</span>
                <span style={{ fontSize: '0.62rem', color: C.muted }}>{2 - usedExtras} үлдсэн</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Timer / Manual input — flex: 1, centered */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '1rem', minHeight: 160, position: 'relative',
      }}>
        {/* FIX 5: Standard timer display */}
        {timerMode === 'standard' && (
          <>
            {isInspecting && timer.inspectionMs > 0 && (
              <div style={{
                fontSize: '0.65rem', letterSpacing: '0.12em',
                textTransform: 'uppercase', color: C.muted, marginBottom: '0.5rem',
              }}>
                INSPECTION
              </div>
            )}
            <div style={{
              fontSize: 'clamp(3.5rem, 18vw, 8rem)',
              fontWeight: 700, fontFamily: MONO,
              color: timerColor, lineHeight: 1,
              transition: (isRunning || isArmed) ? 'none' : 'color 0.12s',
            }}>
              {timerDisplay}
            </div>
            {!showFocus && !pendingSolve && !noScrambles && currentSolveIndex < totalSolves && (
              <div style={{ fontSize: '0.75rem', color: C.muted, marginTop: '0.75rem' }}>
                {isArmed && !timer.armedReady ? 'Удаан дарсаар байна...' : 'Дарж эхлэх'}
              </div>
            )}
          </>
        )}

        {/* FIX 5: Manual input mode */}
        {timerMode === 'manual' && !pendingSolve && currentSolveIndex < totalSolves && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '0.75rem', width: '100%', maxWidth: 300,
          }}>
            <div style={{ fontSize: '0.75rem', color: C.muted }}>Цагаа оруулна уу</div>
            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
              <input
                data-ignore="1"
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
                placeholder="1:23.45 / DNF"
                autoFocus
                style={{
                  flex: 1, padding: '0.65rem 0.85rem', borderRadius: 10,
                  background: C.card, border: `1px solid ${C.border}`,
                  color: C.text, fontFamily: MONO, fontSize: '1rem',
                  outline: 'none', touchAction: 'auto',
                }}
              />
              <button
                data-ignore="1"
                onClick={handleManualSubmit}
                style={{
                  padding: '0.65rem 1rem', borderRadius: 10,
                  background: C.accentDim, border: '1px solid rgba(167,139,250,0.4)',
                  color: C.accent, fontFamily: FONT, fontSize: '0.88rem',
                  fontWeight: 700, cursor: 'pointer',
                }}
              >
                ↵
              </button>
            </div>
          </div>
        )}

        {/* Pending confirm overlay */}
        {pendingSolve && (
          <div
            data-ignore="1"
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'rgba(10,10,10,0.97)', borderTop: `1px solid ${C.border}`,
              padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem',
            }}
          >
            {/* FIX 2: cooldown progress hint */}
            {!confirmArmed && (
              <div style={{
                textAlign: 'center', fontSize: '0.72rem', color: C.muted,
                letterSpacing: '0.05em',
              }}>
                Баталгаажуулах боломжтой болж байна...
              </div>
            )}

            {/* Penalty row */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              {(['none', '+2', 'dnf'] as const).map((p) => {
                const active = pendingSolve.penalty === p;
                return (
                  <button
                    key={p}
                    type="button"
                    data-ignore="1"
                    onClick={() => setPendingSolve((prev) => prev ? { ...prev, penalty: p } : null)}
                    style={{
                      flex: 1, maxWidth: 100, padding: '0.55rem',
                      borderRadius: 9, fontFamily: FONT, fontSize: '0.88rem', fontWeight: 700,
                      border: `1px solid ${
                        active ? (p === 'dnf' ? C.danger : p === '+2' ? C.warn : C.accent) : C.border
                      }`,
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

            {/* Adjusted time */}
            <div style={{ textAlign: 'center', fontFamily: MONO, fontSize: '0.85rem', color: C.muted }}>
              {pendingSolve.penalty === 'dnf' ? 'DNF'
                : pendingSolve.penalty === '+2'
                ? `${fmtMs(pendingSolve.ms + 2000, false, 'cs')} (+2)`
                : fmtMs(pendingSolve.ms, false, 'cs')}
            </div>

            {/* FIX 2: Confirm button with cooldown */}
            <button
              type="button"
              data-ignore="1"
              onClick={() => { void confirmSolve(); }}
              disabled={!confirmArmed || submitting}
              style={{
                width: '100%', padding: '0.78rem', borderRadius: 10,
                fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
                background: confirmArmed && !submitting
                  ? 'rgba(167,139,250,0.75)'
                  : 'rgba(167,139,250,0.25)',
                border: '1px solid rgba(167,139,250,0.9)',
                color: confirmArmed ? '#fff' : C.muted,
                cursor: confirmArmed && !submitting ? 'pointer' : 'not-allowed',
                opacity: 1,
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {submitting
                ? 'Хадгалж байна...'
                : !confirmArmed
                ? '...'
                : isLastSolve
                ? 'Дуусгах ✓'
                : 'Баталгаажуулах →'}
            </button>
          </div>
        )}
      </div>

      {/* FIX 3: Horizontal solve chips — hide during focus */}
      {!showFocus && (
        <div style={{
          flexShrink: 0,
          borderTop: `1px solid ${C.border}`,
          padding: '0.75rem 1rem 1.25rem',
        }}>
          <div style={{
            fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '0.45rem',
            textAlign: 'center',
          }}>
            {formatLabel(round.format)}
          </div>
          <div style={{
            display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'center',
          }}>
            {Array.from({ length: totalSolves }).map((_, i) => {
              const s = solves[i];
              const isCurrent = i === currentSolveIndex;
              const usedExtra = !!scrambleOverrides[String(i)];
              return (
                <div key={i} style={{
                  padding: '0.28rem 0.55rem',
                  borderRadius: 8,
                  background: isCurrent ? C.accentDim : s ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: `1px solid ${
                    isCurrent ? 'rgba(167,139,250,0.35)'
                    : s ? 'rgba(255,255,255,0.08)'
                    : 'rgba(255,255,255,0.04)'
                  }`,
                  display: 'flex', alignItems: 'center', gap: '0.2rem',
                }}>
                  {usedExtra && (
                    <span style={{ fontSize: '0.6rem', lineHeight: 1 }}>🎲</span>
                  )}
                  <span style={{
                    fontSize: '0.8rem', fontFamily: MONO, fontWeight: s ? 600 : 400,
                    color: s
                      ? (s.penalty === 'dnf' ? C.danger : C.text)
                      : isCurrent ? C.accent : C.muted,
                  }}>
                    {i + 1}. {s ? fmtSolve(s.ms, s.penalty) : isCurrent && pendingSolve ? '...' : '—'}
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

// ─── Page export ──────────────────────────────────────────────────────────────

export default function SolvingPageWrapper() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <SolvingPage />
    </Suspense>
  );
}
