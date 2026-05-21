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

// Defensive: Firestore can return array-of-maps as a plain object with numeric
// keys when there's only one entry or due to SDK quirks. Convert if needed.
function toStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as string[];
  if (typeof val === 'object') return Object.values(val as Record<string, string>);
  return [];
}

function getGroupScrambles(round: VirtualRound, groupIndex: number): string[] {
  if (round.groups && (Array.isArray(round.groups) ? round.groups.length > 0 : Object.keys(round.groups).length > 0)) {
    const groupsArr = Array.isArray(round.groups)
      ? round.groups
      : Object.values(round.groups as unknown as Record<string, VirtualRound['groups'] extends (infer T)[] | undefined ? T : never>);
    const g = groupsArr[groupIndex % groupsArr.length];
    if (g) {
      const scrms = toStringArray((g as { scrambles: unknown }).scrambles);
      if (scrms.length > 0) return scrms;
    }
  }
  return toStringArray(round.scrambles);
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

const SCRAMBLE_FONT: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'clamp(0.72rem, 2.6vw, 0.9rem)',
  md: 'clamp(0.9rem, 3.4vw, 1.15rem)',
  lg: 'clamp(1.1rem, 4.5vw, 1.5rem)',
};

// cstimer-style: digits only, right-to-left fill (last 2 = cs, next 2 = secs, rest = mins)
function parseCstimerInput(digits: string): number {
  const clean = digits.replace(/\D/g, '');
  if (!clean) return 0;
  const cs   = parseInt(clean.slice(-2) || '0', 10);
  const secs = parseInt(clean.slice(-4, -2) || '0', 10);
  const mins = parseInt(clean.slice(0, -4) || '0', 10);
  return (mins * 60 + secs) * 1000 + cs * 10;
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
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
  const hist = round.historicalResults ?? [];

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

  const [view, setView] = useState<'loading' | 'solving' | 'result' | 'not_found'>('loading');
  const [round, setRound] = useState<VirtualRound | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [solves, setSolves] = useState<DraftSolve[]>([]);
  const [pendingSolve, setPendingSolve] = useState<DraftSolve | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [myResult, setMyResult] = useState<ParticipantRoundResult | null>(null);

  // Explicit solve index — avoids stale-state issues with solves.length
  const [currentSolveIndex, setCurrentSolveIndex] = useState(0);

  // Confirm cooldown
  const [confirmArmed, setConfirmArmed] = useState(false);

  // Extra scrambles
  const [usedExtras, setUsedExtras] = useState(0);
  const [scrambleOverrides, setScrambleOverrides] = useState<Record<string, string>>({});

  // Issue 3: timer mode, persisted to localStorage
  const [timerMode, setTimerMode] = useState<'standard' | 'manual'>(() => {
    try { return localStorage.getItem('compete.timerMode') === 'manual' ? 'manual' : 'standard'; }
    catch { return 'standard'; }
  });
  const [manualInput, setManualInput] = useState('');

  // Issue 3: settings panel state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<'standard' | 'manual'>('standard');
  const [scrambleSize, setScrambleSize] = useState<'sm' | 'md' | 'lg'>(() => {
    try { return (localStorage.getItem('compete.scrambleSize') as 'sm' | 'md' | 'lg' | null) ?? 'md'; }
    catch { return 'md'; }
  });
  const [scrambleSizeDraft, setScrambleSizeDraft] = useState<'sm' | 'md' | 'lg'>('md');
  const [inspectionEnabled, setInspectionEnabled] = useState(() => {
    try { return localStorage.getItem('compete.inspection') !== 'false'; }
    catch { return true; }
  });
  const [inspectionEnabledDraft, setInspectionEnabledDraft] = useState(true);
  const [extraPopupSolveIdx, setExtraPopupSolveIdx] = useState<number | null>(null);

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

  pendingSolveRef.current = pendingSolve;
  viewRef.current = view;
  solvesRef.current = solves;
  roundRef.current = round;
  groupIndexRef.current = groupIndex;
  currentSolveIndexRef.current = currentSolveIndex;
  usedExtrasRef.current = usedExtras;
  scrambleOverridesRef.current = scrambleOverrides;
  timerModeRef.current = timerMode;

  const inspectionEnabledRef = useRef(true);
  inspectionEnabledRef.current = inspectionEnabled;

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

  timerStopRef.current = timer.stop;
  timerResetRef.current = timer.reset;
  timerBeginInspectionRef.current = timer.beginInspection;
  timerStartArmingRef.current = timer.startArming;
  timerFireRunningRef.current = timer.fireRunning;
  timerStateRef.current = timer.state;

  // ── Auth guard ──
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.push(`/login?redirect=/timer/competitions/${compId}/compete/${roundId}`);
  }, [authLoading, user, compId, roundId, router]);

  // ── Init ──
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
          savedOverrides = (data.scrambleOverrides && typeof data.scrambleOverrides === 'object')
            ? (data.scrambleOverrides as Record<string, string>)
            : {};
        } else if (roundData.groups && toStringArray(roundData.groups as unknown as unknown[]).length === 0
            && Array.isArray(roundData.groups) && roundData.groups.length > 1) {
          gi = hashStringToInt(user!.uid + roundId) % roundData.groups.length;
          await rtdbSet(rtdbRef(rtdb, path), {
            groupIndex: gi, solves: [], usedExtras: 0, scrambleOverrides: {},
          } satisfies SolveProgressData);
        } else if (Array.isArray(roundData.groups) && roundData.groups.length > 1) {
          gi = hashStringToInt(user!.uid + roundId) % roundData.groups.length;
          await rtdbSet(rtdbRef(rtdb, path), {
            groupIndex: gi, solves: [], usedExtras: 0, scrambleOverrides: {},
          } satisfies SolveProgressData);
        }

        // DEBUG — save/read mismatch investigation
        console.log('[compete] RAW groups from Firestore:', JSON.stringify(roundData.groups, null, 2));
        console.log('[compete] group detail:', roundData.groups?.map((g, i) => ({
          index: i,
          name: g.name,
          scrambleCount: Array.isArray(g.scrambles) ? g.scrambles.length : ('NOT ARRAY: ' + typeof g.scrambles),
          scramblesRaw: g.scrambles,
        })));
        const scrms = getGroupScrambles(roundData, gi);
        console.log('[compete] round loaded', {
          roundId,
          groupIndex: gi,
          groupsLength: Array.isArray(roundData.groups) ? roundData.groups.length : 'non-array',
          scrambles: scrms,
          scrambleCount: scrms.length,
          savedSolvesLength: savedSolves.length,
        });

        setRound(roundData);
        setGroupIndex(gi);
        setSolves(savedSolves);
        setCurrentSolveIndex(savedSolves.length);
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

  // ── Confirm cooldown ──
  useEffect(() => {
    if (!pendingSolve) { setConfirmArmed(false); return; }
    setConfirmArmed(false);
    const t = setTimeout(() => setConfirmArmed(true), 2000);
    return () => clearTimeout(t);
  }, [pendingSolve]);

  // ── Pointer + keyboard listeners (registered once, read from refs) ──
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if ((e.target as HTMLElement)?.closest('[data-ignore]')) return;
      if (viewRef.current !== 'solving') return;
      if (pendingSolveRef.current) return;
      if (timerModeRef.current !== 'standard') return;
      const s = timerStateRef.current;
      if (s === 'running') {
        timerStopRef.current();
      } else if (s === 'idle' || s === 'stopped') {
        timerResetRef.current();
        timerBeginInspectionRef.current();
        if (!inspectionEnabledRef.current) timerStartArmingRef.current();
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
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
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
        if (!inspectionEnabledRef.current) timerStartArmingRef.current();
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

  // ── Manual submit ──
  function handleManualSubmit() {
    const raw = manualInput.trim();
    if (!raw) return;
    const ms = parseCstimerInput(raw);
    if (ms <= 0) return;
    setPendingSolve({ ms, penalty: 'none' });
    setManualInput('');
  }

  // ── Save settings ──
  function handleSaveSettings() {
    setTimerMode(settingsDraft);
    setScrambleSize(scrambleSizeDraft);
    setInspectionEnabled(inspectionEnabledDraft);
    try {
      localStorage.setItem('compete.timerMode', settingsDraft);
      localStorage.setItem('compete.scrambleSize', scrambleSizeDraft);
      localStorage.setItem('compete.inspection', String(inspectionEnabledDraft));
    } catch {}
    setSettingsOpen(false);
  }

  // ── Extra scramble ── (for a specific completed solve; removes it so user can redo)
  async function requestExtraScramble(forSolveIdx: number) {
    const r = roundRef.current;
    if (!r || !user) return;
    const gi = groupIndexRef.current;
    const extras = usedExtrasRef.current;
    if (extras >= 2) return;
    const groupsArr = Array.isArray(r.groups) ? r.groups : [];
    const group = groupsArr[gi % (groupsArr.length || 1)];
    const extraScramble = toStringArray((group as { extraScrambles?: unknown })?.extraScrambles ?? [])[extras];
    if (!extraScramble) return;

    // Remove the solve at forSolveIdx and all subsequent solves so user can redo from there
    const newSolves = solvesRef.current.slice(0, forSolveIdx);
    const newOverrides = { ...scrambleOverridesRef.current, [String(forSolveIdx)]: extraScramble };
    const newExtras = extras + 1;

    setExtraPopupSolveIdx(null);
    setSolves(newSolves);
    setCurrentSolveIndex(forSolveIdx);
    setScrambleOverrides(newOverrides);
    setUsedExtras(newExtras);

    const path = `virtualProgress/${compId}/${user.uid}/${roundId}`;
    await rtdbSet(rtdbRef(rtdb, path), {
      groupIndex: gi, solves: newSolves,
      usedExtras: newExtras, scrambleOverrides: newOverrides,
    } satisfies SolveProgressData);
  }

  // ── Confirm solve ──
  async function confirmSolve() {
    const ps = pendingSolveRef.current;
    const r = roundRef.current;
    if (!ps || !r || !user) return;

    const newSolves = [...solvesRef.current, ps];
    const total = getSolveCount(r.format);
    const path = `virtualProgress/${compId}/${user.uid}/${roundId}`;

    // Advance index BEFORE clearing pendingSolve so the next scramble is ready
    const nextIdx = newSolves.length;
    if (nextIdx < total) setCurrentSolveIndex(nextIdx);

    setSolves(newSolves);
    setPendingSolve(null);
    timer.reset();

    // DEBUG
    console.log('[compete] solve confirmed', {
      confirmedIdx: nextIdx - 1,
      advancingTo: nextIdx < total ? nextIdx : 'result',
      newSolvesLength: newSolves.length,
      total,
    });

    if (newSolves.length >= total) {
      setSubmitting(true);
      try {
        const scrms = getGroupScrambles(r, groupIndexRef.current);
        const overrides = scrambleOverridesRef.current;
        const pSolves: ParticipantSolve[] = newSolves.map((s, i) => ({
          index: i, ms: s.ms, penalty: s.penalty,
          scramble: overrides[String(i)] ?? scrms[i] ?? '',
          completedAt: Date.now(),
        }));
        const best = computeBest(pSolves);
        const average = computeAverage(pSolves, r.format);
        await submitRoundResult(compId, {
          uid: user.uid, eventId: r.eventId, roundNumber: r.roundNumber,
          solves: pSolves, best, average, completedAt: Timestamp.now(),
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
        groupIndex: groupIndexRef.current, solves: newSolves,
        usedExtras: usedExtrasRef.current, scrambleOverrides: scrambleOverridesRef.current,
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
          style={{ fontSize: '0.85rem', color: C.muted, textDecoration: 'none' }}>← Буцах</Link>
      </div>
    );
  }

  if (view === 'result' && myResult) {
    return <ResultView compId={compId} round={round} result={myResult} />;
  }

  // ── Solving UI ──────────────────────────────────────────────────────────────

  const scrambles = getGroupScrambles(round, groupIndex);
  const totalSolves = getSolveCount(round.format);
  const currentScramble = scrambleOverrides[String(currentSolveIndex)]
    ?? scrambles[currentSolveIndex]
    ?? '';
  const noScrambles = scrambles.length === 0;

  const isRunning = timer.state === 'running';
  const isArmed = timer.state === 'armed';
  const isInspecting = timer.state === 'inspecting';
  const showFocus = isRunning || isArmed || isInspecting;

  // Whether a specific completed solve can be swapped for an extra scramble
  function canRequestExtraFor(idx: number): boolean {
    if (!round || !solves[idx] || pendingSolve || showFocus) return false;
    if (usedExtras >= 2) return false;
    const gArr = Array.isArray(round.groups) ? round.groups : [];
    const g = gArr[groupIndex % (gArr.length || 1)];
    return !!(toStringArray((g as { extraScrambles?: unknown })?.extraScrambles ?? [])[usedExtras]);
  }

  // DEBUG: log every render so we can trace scramble changes
  console.log('[compete] render', { currentSolveIndex, currentScramble, scrambleCount: scrambles.length, showFocus, pendingSolve: !!pendingSolve });

  // Timer display
  let timerDisplay: string;
  let timerColor: string = C.text;
  if (isInspecting) {
    timerDisplay = timer.inspectionMs > 0 ? String(Math.ceil(timer.inspectionMs / 1000))
      : timer.inspectionMs > -2000 ? '+2' : 'DNF';
    if (timer.inspectionMs <= -2000) timerColor = C.danger;
    else if (timer.inspectionMs <= 0) timerColor = C.warn;
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

  // Solve chips row height is ~80px; cube sits above it
  const CUBE_BOTTOM = 88;

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column', position: 'relative',
      userSelect: 'none', touchAction: 'none',
    }}>
      {/* ── Header ── */}
      {!showFocus && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.75rem 1rem', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <button
            data-ignore="1"
            onClick={() => router.push(`/timer/competitions/${compId}/compete`)}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: 600, color: C.muted, fontFamily: FONT }}
          >
            ← Дуусгах
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem',
            fontSize: '0.82rem', color: C.muted }}>
            <WcaEventIcon eventId={round.eventId} size={14} />
            {round.roundName}
          </div>
          {/* Issue 3: progress counter + gear icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: MONO, color: C.accent }}>
              {Math.min(currentSolveIndex + 1, totalSolves)}/{totalSolves}
            </span>
            <button
              data-ignore="1"
              onClick={() => { setSettingsDraft(timerMode); setScrambleSizeDraft(scrambleSize); setInspectionEnabledDraft(inspectionEnabled); setSettingsOpen(true); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '1rem', color: C.muted, lineHeight: 1, padding: '0.1rem 0',
                fontFamily: FONT,
              }}
              aria-label="Тохиргоо"
            >
              ⚙
            </button>
          </div>
        </div>
      )}

      {/* ── Scramble text (no cube here — cube is bottom-right absolute) ── */}
      {!showFocus && !pendingSolve && currentSolveIndex < totalSolves && (
        <div style={{ flexShrink: 0, padding: '0.75rem 1rem 0' }}>
          {noScrambles ? (
            <div style={{ textAlign: 'center', padding: '0.75rem',
              fontSize: '0.85rem', color: C.muted }}>
              Холилтуудыг удирдагч бэлдэж байна...
            </div>
          ) : currentScramble ? (
            <div style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: '0.65rem 0.85rem',
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: SCRAMBLE_FONT[scrambleSize],
                fontWeight: 600, fontFamily: MONO,
                color: C.text, lineHeight: 1.65, letterSpacing: '0.03em',
              }}>
                {currentScramble}
              </div>
            </div>
          ) : (
            // Scramble slot exists but no string yet (data gap)
            <div style={{ textAlign: 'center', padding: '0.75rem',
              fontSize: '0.82rem', color: C.muted }}>
              Энэ эвлүүлэлтэд холилт оруулаагүй байна
            </div>
          )}
        </div>
      )}

      {/* ── Timer / Manual input ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '1rem', minHeight: 160, position: 'relative',
      }}>
        {timerMode === 'standard' && (
          <>
            {isInspecting && timer.inspectionMs > 0 && (
              <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em',
                textTransform: 'uppercase', color: C.muted, marginBottom: '0.5rem' }}>
                INSPECTION
              </div>
            )}
            <div style={{
              fontSize: 'clamp(3.5rem, 18vw, 8rem)',
              fontWeight: 700, fontFamily: MONO, color: timerColor, lineHeight: 1,
              transition: (isRunning || isArmed) ? 'none' : 'color 0.12s',
            }}>
              {timerDisplay}
            </div>
            {isArmed && !timer.armedReady && !pendingSolve && (
              <div style={{ fontSize: '0.75rem', color: C.muted, marginTop: '0.75rem' }}>
                Удаан дарсаар байна...
              </div>
            )}
          </>
        )}

        {timerMode === 'manual' && !pendingSolve && currentSolveIndex < totalSolves && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '0.65rem', width: '100%', maxWidth: 320,
          }}>
            {/* Live parsed time preview */}
            <div style={{
              fontSize: 'clamp(3rem, 15vw, 6rem)', fontWeight: 700,
              fontFamily: MONO, lineHeight: 1,
              color: manualInput ? C.text : C.muted,
            }}>
              {manualInput ? fmtMs(parseCstimerInput(manualInput), false, 'cs') : '0.00'}
            </div>
            <input
              data-ignore="1"
              type="text"
              inputMode="numeric"
              value={manualInput}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 7);
                setManualInput(val);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
              placeholder="тоо оруулах"
              autoFocus
              style={{
                width: '100%', padding: '0.65rem 0.85rem', borderRadius: 10,
                background: C.card, border: `1px solid ${C.border}`,
                color: C.text, fontFamily: MONO, fontSize: '1.1rem',
                outline: 'none', touchAction: 'auto', textAlign: 'center',
                boxSizing: 'border-box',
              }}
            />
            <button
              data-ignore="1"
              onClick={handleManualSubmit}
              disabled={!manualInput}
              style={{
                width: '100%', padding: '0.75rem', borderRadius: 10,
                fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
                background: manualInput ? C.accentDim : 'rgba(255,255,255,0.04)',
                border: `1px solid ${manualInput ? 'rgba(167,139,250,0.4)' : C.border}`,
                color: manualInput ? C.accent : C.muted,
                cursor: manualInput ? 'pointer' : 'not-allowed',
                boxSizing: 'border-box',
              }}
            >
              Баталгаажуулах ↵
            </button>
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
              zIndex: 10,
            }}
          >
            {!confirmArmed && (
              <div style={{ textAlign: 'center', fontSize: '0.72rem', color: C.muted,
                letterSpacing: '0.05em' }}>
                Баталгаажуулах боломжтой болж байна...
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              {(['none', '+2', 'dnf'] as const).map((p) => {
                const active = pendingSolve.penalty === p;
                return (
                  <button key={p} type="button" data-ignore="1"
                    onClick={() => setPendingSolve((prev) => prev ? { ...prev, penalty: p } : null)}
                    style={{
                      flex: 1, maxWidth: 100, padding: '0.55rem',
                      borderRadius: 9, fontFamily: FONT, fontSize: '0.88rem', fontWeight: 700,
                      border: `1px solid ${active ? (p === 'dnf' ? C.danger : p === '+2' ? C.warn : C.accent) : C.border}`,
                      background: active ? (p === 'dnf' ? C.dangerDim : p === '+2' ? 'rgba(251,191,36,0.12)' : C.accentDim) : C.card,
                      color: active ? (p === 'dnf' ? C.danger : p === '+2' ? C.warn : C.accent) : C.muted,
                      cursor: 'pointer',
                    }}>
                    {p === 'none' ? 'OK' : p.toUpperCase()}
                  </button>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', fontFamily: MONO, fontSize: '0.85rem', color: C.muted }}>
              {pendingSolve.penalty === 'dnf' ? 'DNF'
                : pendingSolve.penalty === '+2' ? `${fmtMs(pendingSolve.ms + 2000, false, 'cs')} (+2)`
                : fmtMs(pendingSolve.ms, false, 'cs')}
            </div>
            <button type="button" data-ignore="1"
              onClick={() => { void confirmSolve(); }}
              disabled={!confirmArmed || submitting}
              style={{
                width: '100%', padding: '0.78rem', borderRadius: 10,
                fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
                background: confirmArmed && !submitting ? 'rgba(167,139,250,0.75)' : 'rgba(167,139,250,0.25)',
                border: '1px solid rgba(167,139,250,0.9)',
                color: confirmArmed ? '#fff' : C.muted,
                cursor: confirmArmed && !submitting ? 'pointer' : 'not-allowed',
                transition: 'background 0.2s, color 0.2s',
              }}>
              {submitting ? 'Хадгалж байна...' : !confirmArmed ? '...' : isLastSolve ? 'Дуусгах ✓' : 'Баталгаажуулах →'}
            </button>
          </div>
        )}
      </div>

      {/* ── Solve chips ── */}
      {!showFocus && (
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${C.border}`,
          padding: '0.65rem 1rem 1.1rem',
        }}>
          <div style={{
            fontSize: '0.56rem', fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.muted, marginBottom: '0.4rem',
            textAlign: 'center',
          }}>
            {formatLabel(round.format)}
          </div>
          <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {Array.from({ length: totalSolves }).map((_, i) => {
              const s = solves[i];
              const isCurrent = i === currentSolveIndex;
              const usedExtra = !!scrambleOverrides[String(i)];
              const tappable = !!s && canRequestExtraFor(i);
              return (
                <div
                  key={i}
                  data-ignore="1"
                  onClick={() => { if (tappable) setExtraPopupSolveIdx(i); }}
                  style={{
                    padding: '0.3rem 0.6rem', borderRadius: 8,
                    background: isCurrent ? C.accentDim : s ? 'rgba(255,255,255,0.05)' : 'transparent',
                    border: `1px solid ${isCurrent ? 'rgba(167,139,250,0.35)' : s ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}`,
                    display: 'flex', alignItems: 'center', gap: '0.2rem',
                    cursor: tappable ? 'pointer' : 'default',
                    transition: 'opacity 0.1s',
                  }}
                >
                  {usedExtra && <span style={{ fontSize: '0.6rem', lineHeight: 1 }}>🎲</span>}
                  <span style={{
                    fontSize: '0.82rem', fontFamily: MONO, fontWeight: s ? 600 : 400,
                    color: s ? (s.penalty === 'dnf' ? C.danger : C.text) : isCurrent ? C.accent : C.muted,
                  }}>
                    {i + 1}. {s ? fmtSolve(s.ms, s.penalty) : isCurrent && pendingSolve ? '...' : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Issue 2: Cube preview — absolute bottom-right corner ── */}
      {!pendingSolve && currentScramble && currentSolveIndex < totalSolves && (
        <div
          style={{
            position: 'absolute',
            bottom: CUBE_BOTTOM,
            right: 16,
            width: 80,
            height: 80,
            zIndex: 5,
            opacity: 0.85,
            pointerEvents: 'none',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <CubeViewer eventId={round.eventId} scramble={currentScramble} />
        </div>
      )}

      {/* ── Extra scramble popup ── */}
      {extraPopupSolveIdx !== null && (
        <div
          data-ignore="1"
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}
          onClick={() => setExtraPopupSolveIdx(null)}
        >
          <div
            data-ignore="1"
            style={{
              background: '#1a1a1a', borderRadius: '16px 16px 0 0',
              border: `1px solid ${C.border}`, borderBottom: 'none',
              padding: '1.25rem 1.25rem 2rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: '1rem',
            }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text }}>
                {extraPopupSolveIdx + 1}. Эвлүүлэлт
              </span>
              <button
                data-ignore="1"
                onClick={() => setExtraPopupSolveIdx(null)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '1rem', color: C.muted, padding: '0.2rem',
                }}
              >✕</button>
            </div>
            <button
              data-ignore="1"
              onClick={() => { void requestExtraScramble(extraPopupSolveIdx); }}
              style={{
                width: '100%', padding: '0.78rem', borderRadius: 10,
                fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
                background: 'rgba(251,191,36,0.12)',
                border: '1px solid rgba(251,191,36,0.3)',
                color: C.warn, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                boxSizing: 'border-box',
              }}
            >
              🎲 Нэмэлт холилт авах
              <span style={{ fontSize: '0.8rem', color: C.muted }}>({2 - usedExtras} үлдсэн)</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Issue 3: Settings bottom sheet ── */}
      {settingsOpen && (
        <div
          data-ignore="1"
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            data-ignore="1"
            style={{
              background: '#1a1a1a', borderRadius: '16px 16px 0 0',
              border: `1px solid ${C.border}`, borderBottom: 'none',
              padding: '1.25rem 1.25rem 2rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: '1.25rem',
            }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: C.text }}>Тохиргоо</span>
              <button
                data-ignore="1"
                onClick={() => setSettingsOpen(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '1rem', color: C.muted, fontFamily: FONT, padding: '0.2rem',
                }}
              >✕</button>
            </div>

            {/* Timer mode section */}
            <div style={{
              fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: C.muted, marginBottom: '0.75rem',
            }}>
              Цаг хэмжих горим
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginBottom: '1.25rem' }}>
              {(['standard', 'manual'] as const).map((mode) => {
                const active = settingsDraft === mode;
                return (
                  <div
                    key={mode}
                    data-ignore="1"
                    onClick={() => setSettingsDraft(mode)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.65rem 0.75rem', borderRadius: 10, cursor: 'pointer',
                      background: active ? C.accentDim : 'transparent',
                      border: `1px solid ${active ? 'rgba(167,139,250,0.25)' : 'transparent'}`,
                      transition: 'background 0.1s',
                    }}
                  >
                    {/* Radio circle */}
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${active ? C.accent : C.muted}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {active && (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: active ? C.text : C.muted }}>
                        {mode === 'standard' ? 'Стандарт' : 'Гараар бичих'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: C.muted, marginTop: '0.1rem' }}>
                        {mode === 'standard'
                          ? 'Дарж барих таймер'
                          : 'Цагийг гараар оруулах'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Scramble size section */}
            <div style={{
              fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: C.muted, marginBottom: '0.6rem',
            }}>
              Холилтын хэмжээ
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {(['sm', 'md', 'lg'] as const).map((sz) => {
                const label = sz === 'sm' ? 'Бага' : sz === 'md' ? 'Дунд' : 'Том';
                const active = scrambleSizeDraft === sz;
                return (
                  <div
                    key={sz}
                    data-ignore="1"
                    onClick={() => setScrambleSizeDraft(sz)}
                    style={{
                      flex: 1, textAlign: 'center',
                      padding: '0.55rem 0.4rem', borderRadius: 9, cursor: 'pointer',
                      background: active ? C.accentDim : 'transparent',
                      border: `1px solid ${active ? 'rgba(167,139,250,0.35)' : C.border}`,
                      fontSize: '0.88rem', fontWeight: 600,
                      color: active ? C.accent : C.muted,
                      transition: 'background 0.1s',
                    }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>

            {/* Inspection section */}
            <div style={{
              fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: C.muted, marginBottom: '0.6rem',
            }}>
              Inspection
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {([true, false] as const).map((val) => {
                const label = val ? 'Идэвхтэй' : 'Идэвхгүй';
                const active = inspectionEnabledDraft === val;
                return (
                  <div
                    key={String(val)}
                    data-ignore="1"
                    onClick={() => setInspectionEnabledDraft(val)}
                    style={{
                      flex: 1, textAlign: 'center',
                      padding: '0.55rem 0.4rem', borderRadius: 9, cursor: 'pointer',
                      background: active ? C.accentDim : 'transparent',
                      border: `1px solid ${active ? 'rgba(167,139,250,0.35)' : C.border}`,
                      fontSize: '0.88rem', fontWeight: 600,
                      color: active ? C.accent : C.muted,
                      transition: 'background 0.1s',
                    }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>

            <button
              data-ignore="1"
              onClick={handleSaveSettings}
              style={{
                width: '100%', padding: '0.82rem', borderRadius: 12,
                fontFamily: FONT, fontSize: '0.97rem', fontWeight: 700,
                background: 'rgba(167,139,250,0.75)',
                border: '1px solid rgba(167,139,250,0.9)',
                color: '#fff', cursor: 'pointer',
              }}
            >
              Хадгалах
            </button>
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
