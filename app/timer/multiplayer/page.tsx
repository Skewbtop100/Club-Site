'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Scrambow } from 'scrambow';
import { QRCodeSVG } from 'qrcode.react';
import type { TwistyPlayer as TwistyPlayerType } from 'cubing/twisty';
import {
  ref,
  onValue,
  set,
  update,
  remove,
  onDisconnect,
  get,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import { useWakeLock } from '../useWakeLock';
import { useGanTimer } from '../useGanTimer';
import { useQiyiTimer } from '../useQiyiTimer';
import { saveMatchHistory, type RoundSnapshotInput } from '@/lib/firebase/services/matchHistory';
import TimerProfileMenu from '@/components/timer/TimerProfileMenu';
import MultiplayerHub from './MultiplayerHub';
import { useAuth } from '@/lib/auth-context';
import { awardMpMatchIfNew } from '@/lib/points';
import { showToast } from '@/lib/toast';
import {
  useTimer,
  fmtMs as fmtMsShared,
  clampHoldTimeMs,
  DEFAULT_HOLD_TIME_MS,
  type Precision,
  type UseTimerReturn,
} from '@/lib/timer-engine';

// Solo-timer prefs key — multiplayer reads only the smart-timer brand
// from here so the user's choice syncs across both pages. Other prefs
// (precision, hold-to-start, etc.) stay separate via MP_PREFS_KEY.
type TimerBrand = 'gan' | 'qiyi';
const SOLO_PREFS_KEY = 'pv.timer.prefs.v1';
function readSoloTimerBrand(): TimerBrand {
  if (typeof window === 'undefined') return 'gan';
  try {
    const raw = localStorage.getItem(SOLO_PREFS_KEY);
    if (!raw) return 'gan';
    const parsed = JSON.parse(raw) as { timerBrand?: unknown };
    return parsed.timerBrand === 'qiyi' ? 'qiyi' : 'gan';
  } catch { return 'gan'; }
}
function writeSoloTimerBrand(brand: TimerBrand): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(SOLO_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed.timerBrand = brand;
    localStorage.setItem(SOLO_PREFS_KEY, JSON.stringify(parsed));
  } catch { /* localStorage unavailable */ }
}

// ── Theme ──────────────────────────────────────────────────────────────────
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
  successDim:'rgba(52,211,153,0.15)',
  warn:      '#fbbf24',
  danger:    '#ef4444',
  dangerDim: 'rgba(239,68,68,0.12)',
} as const;

// ── Events (subset of timer/page events that scrambow supports) ───────────
interface EventDef { id: string; name: string; short: string }
const EVENTS: EventDef[] = [
  { id: '333',     name: '3x3x3 Cube',       short: '3x3'   },
  { id: '222',     name: '2x2x2 Cube',       short: '2x2'   },
  { id: '444',     name: '4x4x4 Cube',       short: '4x4'   },
  { id: '555',     name: '5x5x5 Cube',       short: '5x5'   },
  { id: '666',     name: '6x6x6 Cube',       short: '6x6'   },
  { id: '777',     name: '7x7x7 Cube',       short: '7x7'   },
  { id: 'pyram',   name: 'Pyraminx',         short: 'Pyra'  },
  { id: 'skewb',   name: 'Skewb',            short: 'Skewb' },
  { id: 'sq1',     name: 'Square-1',         short: 'Sq-1'  },
  { id: 'clock',   name: 'Clock',            short: 'Clock' },
  { id: 'minx',    name: 'Megaminx',         short: 'Mega'  },
];

const SCRAMBOW_TYPE: Record<string, string> = {
  '333': '333', '222': '222', '444': '444', '555': '555', '666': '666', '777': '777',
  'pyram': 'pyram', 'skewb': 'skewb', 'sq1': 'sq1', 'clock': 'clock', 'minx': 'minx',
};

function generateScramble(eventId: string): string {
  const type = SCRAMBOW_TYPE[eventId] ?? '333';
  try {
    const s = new Scrambow().setType(type).get(1)[0];
    return (s?.scramble_string ?? '').trim();
  } catch {
    return '';
  }
}

// Map event ids → TwistyPlayer puzzle ids. (Mirrors main timer's PUZZLE_MAP.)
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

// 3D cube preview using cubing/twisty's TwistyPlayer Web Component.
// Dynamic-imported so HTMLElement access doesn't break SSR.
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
        console.warn('[mp] TwistyPlayer load failed', err);
      }
    })();
    return () => {
      cancelled = true;
      const player = playerRef.current as unknown as HTMLElement | null;
      const c = containerRef.current;
      if (player && c && c.contains(player)) c.removeChild(player);
      playerRef.current = null;
    };
    // Mount only — subsequent puzzle/scramble changes go through the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !puzzleId) return;
    try {
      (player as unknown as { puzzle: string }).puzzle = puzzleId;
      (player as unknown as { experimentalSetupAlg: string }).experimentalSetupAlg = scramble;
      (player as unknown as { alg: string }).alg = '';
    } catch (err) {
      console.warn('[mp] TwistyPlayer update failed', err);
    }
  }, [scramble, puzzleId]);

  if (!puzzleId) {
    return (
      <div style={{
        width: '100%', height: '100%', minHeight: 90,
        fontSize: '0.7rem', color: C.mutedDim,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        No preview for this puzzle.
      </div>
    );
  }
  return (
    <div ref={containerRef} style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} />
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function genRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function genUserId(): string {
  return 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function getUserId(): string {
  if (typeof window === 'undefined') return '';
  let uid = localStorage.getItem('mp_user_id');
  if (!uid) {
    uid = genUserId();
    localStorage.setItem('mp_user_id', uid);
  }
  return uid;
}

// Thin adapter over the shared engine's fmtMs. Multiplayer historically
// stored precision as `2 | 3` (digits after the decimal) in MP_PREFS_KEY;
// converting to the shared 'cs'/'ms' surface here keeps that on-disk
// format intact while sharing the formatter implementation.
function fmtMs(ms: number | null, dnf?: boolean, precision: 2 | 3 = 2): string {
  return fmtMsShared(ms, dnf ?? false, precision === 3 ? 'ms' : 'cs');
}

// Length-based font scaling for the racing-screen big timer. Matches the
// pattern used in the single-player timer (see app/timer/page.tsx ::
// getTimerFontSize) but anchored to this screen's existing base clamps so
// sub-minute times render unchanged. Step ratios are ~80% / ~63% / ~51%
// of the base for 6-7 / 8-9 / 10+ char strings respectively.
function getMpTimerFontSize(text: string, isMobile: boolean): string {
  const len = text.length;
  if (isMobile) {
    if (len <= 5) return 'clamp(3rem, 16vw, 9rem)';
    if (len <= 7) return 'clamp(2.4rem, 12.5vw, 7rem)';
    if (len <= 9) return 'clamp(1.9rem, 9.5vw, 5.5rem)';
    return 'clamp(1.5rem, 8vw, 4.5rem)';
  }
  if (len <= 5) return 'clamp(5rem, 12vw, 11rem)';
  if (len <= 7) return 'clamp(4rem, 9.5vw, 8.5rem)';
  if (len <= 9) return 'clamp(3.2rem, 7.5vw, 7rem)';
  return 'clamp(2.6rem, 6vw, 5.5rem)';
}

// ── Multiplayer prefs (persisted to localStorage) ───────────────────────────
const MP_PREFS_KEY = 'pv.timer.mp.prefs.v1';

interface MpPrefs {
  inspectionEnabled: boolean;
  holdToStart: boolean;
  // ms the player must hold SPACE / touch before the timer arms.
  // Default DEFAULT_HOLD_TIME_MS (550) — same WCA Stackmat default as solo.
  // Persisted in MP_PREFS_KEY but on first load we fall back to solo's
  // SOLO_PREFS_KEY value so a user who already configured it on /timer
  // doesn't have to set it again here.
  holdTimeMs: number;
  precision: 2 | 3;                 // 2 = centiseconds, 3 = milliseconds
  scrambleFontSize: 'sm' | 'md' | 'lg';
}

const DEFAULT_MP_PREFS: MpPrefs = {
  inspectionEnabled: false,
  holdToStart: true,
  holdTimeMs: DEFAULT_HOLD_TIME_MS,
  precision: 2,
  scrambleFontSize: 'md',
};

function useMpPrefs(): [MpPrefs, (patch: Partial<MpPrefs>) => void] {
  const [prefs, setPrefs] = useState<MpPrefs>(DEFAULT_MP_PREFS);

  useEffect(() => {
    let stored: Partial<MpPrefs> = {};
    try {
      const raw = localStorage.getItem(MP_PREFS_KEY);
      if (raw) stored = JSON.parse(raw) as Partial<MpPrefs>;
    } catch {}
    // Cross-page hold-time inheritance: if we don't yet have an MP value
    // for holdTimeMs (first visit to multiplayer), pick up whatever the
    // solo timer is using. Avoids forcing the user to reconfigure.
    let holdTimeMs = stored.holdTimeMs;
    if (typeof holdTimeMs !== 'number' || !Number.isFinite(holdTimeMs)) {
      try {
        const soloRaw = localStorage.getItem(SOLO_PREFS_KEY);
        if (soloRaw) {
          const soloParsed = JSON.parse(soloRaw) as { holdTimeMs?: unknown };
          if (typeof soloParsed.holdTimeMs === 'number' && Number.isFinite(soloParsed.holdTimeMs)) {
            holdTimeMs = soloParsed.holdTimeMs;
          }
        }
      } catch {}
    }
    setPrefs(prev => ({
      ...prev,
      ...stored,
      ...(typeof holdTimeMs === 'number' ? { holdTimeMs: clampHoldTimeMs(holdTimeMs) } : {}),
    }));
  }, []);

  const update = useCallback((patch: Partial<MpPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      if (typeof patch.holdTimeMs === 'number') {
        next.holdTimeMs = clampHoldTimeMs(patch.holdTimeMs);
      }
      try { localStorage.setItem(MP_PREFS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return [prefs, update];
}

const SCRAMBLE_FONT_PX: Record<MpPrefs['scrambleFontSize'], { mobile: string; desktop: string }> = {
  sm: { mobile: '0.78rem', desktop: '0.95rem' },
  md: { mobile: '0.92rem', desktop: '1.15rem' },
  lg: { mobile: '1.05rem', desktop: '1.35rem' },
};

// Timer state machine + fmtMs + helpers all live in @/lib/timer-engine.
// Multiplayer used to have its own useMpTimer with a hard-coded 350ms hold
// threshold; that code now lives in the shared module and reads holdTimeMs
// from prefs so solo and multiplayer feel identical (550ms WCA default).

// ── Types ──────────────────────────────────────────────────────────────────
type Penalty = 'ok' | '+2' | 'dnf';
type RoomStatus = 'waiting' | 'racing' | 'results';
const SOLVES_PER_ROUND = 5;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const LAST_ROOM_KEY = 'mp_last_room';

interface SolveData {
  time: number;          // raw ms (NOT including +2 adjustment)
  penalty: Penalty;      // 'ok' | '+2' | 'dnf'
  confirmedAt: number;
  scramble: string;
}

interface MemberData {
  name: string;
  ready: boolean;
  currentSolve: number;          // 0..5 — index of next solve to do
  roundAverage: number | null;   // ms, set after solve 5 confirmed; null if pending or DNF
  totalPoints: number;
  connected: boolean;
  joinedAt: number;              // server timestamp; used to pick next host on migration
  lastHeartbeat: number;         // server timestamp; refreshed every HEARTBEAT_INTERVAL_MS
  /**
   * True when the member joined while a race was in progress. They are
   * spectators for the current round (excluded from the round-completion
   * check + the standings) and get promoted to a normal member at the
   * top of the next round (`nextRound` clears this flag).
   */
  queued?: boolean;
}

interface RoomData {
  host: string;
  event: string;
  status: RoomStatus;
  round: number;
  maxRounds: number;
  roundName: string;
  createdAt: number;
  expiresAt?: number;
  scrambles?: Record<string, string>;                       // {"0": "...", ...}
  members: Record<string, MemberData>;
  solves?: Record<string, Record<string, SolveData>>;       // {uid: {0: {...}}}
}

// ── Round / scoring helpers ──────────────────────────────────────────────
function getRoundName(round: number, maxRounds: number): string {
  if (maxRounds === 1) return 'Final';
  if (maxRounds === 2) return round === 1 ? 'First Round' : 'Final';
  if (maxRounds === 3) {
    if (round === 1) return 'First Round';
    if (round === 2) return 'Second Round';
    return 'Final';
  }
  // maxRounds === 4
  if (round === 1) return 'First Round';
  if (round === 2) return 'Second Round';
  if (round === 3) return 'Semi Final';
  return 'Final';
}

function effectiveSolveMs(s: SolveData): number {
  if (s.penalty === 'dnf') return Number.POSITIVE_INFINITY;
  return s.penalty === '+2' ? s.time + 2000 : s.time;
}

// Average of 5 with best+worst dropped, WCA-style. Returns null when DNF.
function computeAo5(solves: SolveData[]): number | null {
  if (solves.length !== 5) return null;
  const dnfCount = solves.filter(s => s.penalty === 'dnf').length;
  if (dnfCount >= 2) return null;
  const eff = solves.map(effectiveSolveMs).sort((a, b) => a - b);
  const middle3 = eff.slice(1, 4);
  if (middle3.some(v => !Number.isFinite(v))) return null;
  return (middle3[0] + middle3[1] + middle3[2]) / 3;
}

function generateScrambles(eventId: string, n = SOLVES_PER_ROUND): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) out[String(i)] = generateScramble(eventId);
  return out;
}

// ── Heartbeat / connection status ────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 5_000;
const ONLINE_THRESHOLD_MS = 10_000;
const IDLE_THRESHOLD_MS = 30_000;
const STATUS_TICK_MS = 2_000;

type ConnectionStatus = 'online' | 'idle' | 'disconnected';

function getConnectionStatus(
  member: { lastHeartbeat?: number } | undefined,
  now: number,
): ConnectionStatus {
  if (!member) return 'disconnected';
  const hb = member.lastHeartbeat ?? 0;
  if (!hb) return 'disconnected';
  const age = now - hb;
  if (age < ONLINE_THRESHOLD_MS) return 'online';
  if (age < IDLE_THRESHOLD_MS) return 'idle';
  return 'disconnected';
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  online: 'Online',
  idle: 'Reconnecting…',
  disconnected: 'Disconnected',
};

// ── Host migration ───────────────────────────────────────────────────────
// Runs as a Firebase transaction so concurrent attempts from multiple
// remaining clients can't double-promote. The transaction is a no-op when
// the current host is still in `members`. When the host is gone we pick the
// member with the earliest joinedAt; when no members remain, we delete the
// room. Every remaining client may safely call this — only one will commit.
async function migrateHostIfOrphaned(roomCode: string): Promise<void> {
  try {
    await runTransaction(ref(rtdb, `rooms/${roomCode}`), (room: RoomData | null) => {
      if (!room) return room;
      const members = room.members || {};
      // Host still present — abort (returning undefined leaves data unchanged).
      if (room.host && members[room.host]) return;
      const memberUids = Object.keys(members);
      // No one left — delete the room.
      if (memberUids.length === 0) return null;
      // Pick the member who joined earliest. Members without joinedAt (legacy
      // rows from before this field existed) sort last.
      const sorted = memberUids.slice().sort((a, b) => {
        const aJ = members[a].joinedAt ?? Number.MAX_SAFE_INTEGER;
        const bJ = members[b].joinedAt ?? Number.MAX_SAFE_INTEGER;
        return aJ - bJ;
      });
      room.host = sorted[0];
      return room;
    });
  } catch (err) {
    console.error('[mp] migrateHostIfOrphaned failed', err);
  }
}

// ── Leave-confirmation kind ───────────────────────────────────────────────
// Picks the right confirmation copy based on the user's role + room state.
// Priority: last > host > active > immediate. The most consequential
// outcome wins (closing the room beats migrating it; migrating beats DNF).
type LeaveKind = 'immediate' | 'active' | 'host' | 'last';

function decideLeaveKind(room: RoomData | null, userId: string): LeaveKind {
  if (!room || !userId) return 'immediate';
  const memberCount = Object.keys(room.members || {}).length;
  if (memberCount <= 1) return 'last';
  const isHost = room.host === userId;
  if (isHost) return 'host';
  if (room.status === 'racing') return 'active';
  return 'immediate';
}

// Mirror of migrateHostIfOrphaned's tie-break: earliest joinedAt wins,
// excluding the leaving user. Used purely to preview the next host's name
// in the confirmation modal — actual assignment happens in the transaction.
function previewNextHostName(room: RoomData | null, leavingUserId: string): string {
  if (!room) return '';
  const others = Object.entries(room.members || {}).filter(([uid]) => uid !== leavingUserId);
  if (others.length === 0) return '';
  others.sort((a, b) => {
    const aJ = a[1].joinedAt ?? Number.MAX_SAFE_INTEGER;
    const bJ = b[1].joinedAt ?? Number.MAX_SAFE_INTEGER;
    return aJ - bJ;
  });
  return others[0][1].name || 'Дараагийн тоглогч';
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function MultiplayerPage() {
  // Suspense boundary required for useSearchParams in Next 16.
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: C.bg }} />}>
      <MultiplayerPageInner />
    </Suspense>
  );
}

function MultiplayerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: authUser } = useAuth();

  // Identity (persisted)
  const [userId, setUserId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');

  // UI state
  const [view, setView] = useState<'lobby' | 'create' | 'join' | 'room'>('lobby');
  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [invitedCode, setInvitedCode] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Active room
  const [roomCode, setRoomCode] = useState<string>('');
  const [room, setRoom] = useState<RoomData | null>(null);

  // Saved room code from a prior session that's still active (for the
  // "Rejoin {code}" lobby card). Empty string = nothing to rejoin.
  const [pendingRejoin, setPendingRejoin] = useState<string>('');

  // Prefs (inspection / hold-to-start / precision / scramble font size).
  // Persisted to localStorage; mutated only via the Settings modal.
  const [prefs, updatePrefs] = useMpPrefs();

  // Settings + Pause modal state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  // Smart leave-confirmation kind. null = no modal; otherwise the kind
  // dictates the title/body/confirm-label shown in MpLeaveConfirmModal.
  // 'immediate' is excluded because it bypasses the modal entirely.
  const [leaveModalKind, setLeaveModalKind] = useState<Exclude<LeaveKind, 'immediate'> | null>(null);
  // Pending mid-round join: when the user submits the join form for a
  // room that's already in 'racing' status, we hold the join params here
  // and render a confirmation modal instead of immediately writing the
  // member entry. Resolved by user action in the modal (queue or cancel).
  const [pendingMidRoundJoin, setPendingMidRoundJoin] = useState<
    { code: string; name: string; uid: string } | null
  >(null);
  // Fade-out gate. Flipped true right before we router.push('/timer') after
  // a confirmed leave so the room view dissolves instead of cutting away.
  const [isLeaving, setIsLeaving] = useState(false);

  // ── Bluetooth smart-timer integration ─────────────────────────────────
  //
  // Hooks live at page level (not inside RacingScreen) so the connection
  // persists across waiting/racing/results transitions and round boundaries.
  // The brand is shared with the solo timer via SOLO_PREFS_KEY.
  //
  // RacingScreen subscribes to events through `btSolveCallbacksRef`: it
  // sets handlers on mount that drive its local timer state machine. When
  // not racing, the ref's handlers are null and BT events are no-ops.
  const [timerBrand, setTimerBrand] = useState<TimerBrand>('gan');
  useEffect(() => { setTimerBrand(readSoloTimerBrand()); }, []);
  const btSolveCallbacksRef = useRef<{
    onSolveStart?: () => void;
    onSolveStop?: (ms: number) => void;
    onIdle?: () => void;
  }>({});

  const ganHook = useGanTimer({
    onSolveStart: () => btSolveCallbacksRef.current.onSolveStart?.(),
    onSolveStop:  (ms) => btSolveCallbacksRef.current.onSolveStop?.(ms),
    onIdle:       () => btSolveCallbacksRef.current.onIdle?.(),
  });
  const qiyiHook = useQiyiTimer({
    onSolveStart: () => btSolveCallbacksRef.current.onSolveStart?.(),
    onSolveStop:  (ms) => btSolveCallbacksRef.current.onSolveStop?.(ms),
    onIdle:       () => btSolveCallbacksRef.current.onIdle?.(),
  });
  const bt = timerBrand === 'qiyi' ? qiyiHook : ganHook;
  const btConnected = bt.state === 'connected';
  const btDeviceLabel: string | null =
    ganHook.state === 'connected' ? 'GAN Timer'
    : qiyiHook.state === 'connected' ? 'QiYi Timer'
    : null;

  // Drop the inactive brand's connection when the user switches.
  useEffect(() => {
    if (timerBrand === 'qiyi' && ganHook.state === 'connected') ganHook.disconnect();
    if (timerBrand === 'gan'  && qiyiHook.state === 'connected') qiyiHook.disconnect();
    // disconnect() functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerBrand]);

  // Connection-failure toast — fires on the idle→error→idle dance from
  // gan-web-bluetooth when the user dismisses the picker or pairing
  // fails. We watch for the 'error' transition specifically (not idle,
  // which is also the resting state).
  const ganPrevState = useRef(ganHook.state);
  const qiyiPrevState = useRef(qiyiHook.state);
  useEffect(() => {
    if (ganHook.state === 'error' && ganPrevState.current !== 'error') {
      showToast({ msg: 'Холболт амжилтгүй', tone: 'error' });
    }
    ganPrevState.current = ganHook.state;
  }, [ganHook.state]);
  useEffect(() => {
    if (qiyiHook.state === 'error' && qiyiPrevState.current !== 'error') {
      showToast({ msg: 'Холболт амжилтгүй', tone: 'error' });
    }
    qiyiPrevState.current = qiyiHook.state;
  }, [qiyiHook.state]);

  // Mid-race disconnect toast — connected → idle while we're inside a
  // room (view === 'room') means the device dropped, not a deliberate
  // disconnect from the user. We can't perfectly distinguish those
  // server-side, but the surface still works because user-initiated
  // disconnect from settings is silent (no toast wanted there) when
  // we're in lobby/create/join. Keeping it scoped to view === 'room'
  // reduces false positives.
  const wasBtConnectedRef = useRef(false);
  useEffect(() => {
    const nowConnected = ganHook.state === 'connected' || qiyiHook.state === 'connected';
    if (wasBtConnectedRef.current && !nowConnected && view === 'room') {
      showToast({ msg: 'Цаг таслагдсан, дахин холбоно уу', tone: 'error' });
    }
    wasBtConnectedRef.current = nowConnected;
  }, [ganHook.state, qiyiHook.state, view]);

  const setTimerBrandPersist = useCallback((brand: TimerBrand) => {
    setTimerBrand(brand);
    writeSoloTimerBrand(brand);
  }, []);

  // Wrap the active hook's disconnect so an in-flight solve doesn't get
  // silently orphaned. liveState === 'running' means the device is mid-
  // solve (HANDS_OFF received, no STOPPED yet); we ask for confirmation
  // rather than block outright since the user might be trying to recover
  // from a stuck state.
  const guardedBtDisconnect = useCallback(() => {
    if (bt.liveState === 'running') {
      // eslint-disable-next-line no-alert
      const ok = window.confirm('Та одоогоор уралдаж байна. Цаг салгахад тухайн round тасарна. Үргэлжлүүлэх үү?');
      if (!ok) return;
    }
    bt.disconnect();
  }, [bt]);

  // Responsive: ≤1024px gets the mobile/tablet single-column layout (so iPads
  // and other tablets share the bottom-tab racing UI). Desktop above 1024px
  // uses the side-by-side layout. Initial render is desktop; the effect runs
  // on mount and on resize.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // While racing, lock both <html> and <body> overflow so iOS Safari can't
  // rubber-band the document under our 100dvh wrapper.
  useEffect(() => {
    const racing = view === 'room' && room?.status === 'racing';
    if (!racing) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [view, room?.status]);

  // Keep the screen on for the entire racing phase — solves can take longer
  // than mobile auto-dim timeouts (30–60 s), and dimming mid-solve is
  // disruptive. We hold the lock across the whole round (not just the local
  // timer state) so a player waiting on opponents at solve N+1 doesn't lose
  // the screen either. Released on lobby/waiting/results and on unmount.
  useWakeLock(view === 'room' && room?.status === 'racing');

  // Prompt on browser close / refresh / hard navigation, but ONLY during an
  // active round. Waiting room and results screen don't risk DNFs from a
  // sudden exit, so we skip the prompt there to keep navigation snappy.
  // Modern browsers ignore the custom message and show their own generic
  // "Leave site?" dialog — assigning returnValue is what triggers the prompt.
  useEffect(() => {
    if (!(view === 'room' && room?.status === 'racing')) return;
    const msg = 'Round дуусаагүй байна. Гарах уу?';
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [view, room?.status]);

  // ── Match-history persistence ───────────────────────────────────────────
  // Per-round scrambles + solves get wiped on `nextRound`, so a snapshot
  // taken at match-end can only see the FINAL round. We accumulate each
  // round's data into a host-local ref the moment we observe a
  // `racing → results` transition; on the FINAL such transition the host
  // writes one matchHistory doc covering every round.
  //
  // savedRef prevents double-writes from re-renders or status flickers.
  // Both refs reset on a fresh `*→waiting` transition (Play Again).
  const matchPrevStatusRef = useRef<RoomStatus | null>(null);
  const pastRoundsRef = useRef<RoundSnapshotInput[]>([]);
  const savedMatchRef = useRef(false);
  useEffect(() => {
    if (!room) return;
    const prevStatus = matchPrevStatusRef.current;
    matchPrevStatusRef.current = room.status;

    // Reset on new-match boundary so a second match in the same room saves
    // independently of the first.
    if (prevStatus && prevStatus !== 'waiting' && room.status === 'waiting') {
      savedMatchRef.current = false;
      pastRoundsRef.current = [];
    }

    // Capture a snapshot the moment a round's results screen first appears.
    // The room.solves / room.scrambles values still reflect the just-finished
    // round at this point (they're wiped on nextRound, which fires later).
    if (prevStatus === 'racing' && room.status === 'results') {
      const r = room.round;
      if (!pastRoundsRef.current.some(x => x.roundNumber === r)) {
        const scrambles = Object.entries(room.scrambles ?? {})
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, s]) => s as string);
        // Snapshot via JSON round-trip — solves + members are plain data,
        // and the deep clone prevents later RTDB updates from mutating the
        // ref entry (since onValue hands us the same object on next push
        // for unchanged subtrees in some adapter versions).
        pastRoundsRef.current.push({
          roundNumber: r,
          roundName: room.roundName ?? getRoundName(r, room.maxRounds),
          scrambles,
          solves: JSON.parse(JSON.stringify(room.solves ?? {})),
          membersAtRoundEnd: JSON.parse(JSON.stringify(room.members ?? {})),
        });
      }
    }

    // Final-round results — host writes once. Skip silently if we don't
    // have all rounds (e.g., a fresh post-migration host that missed
    // earlier transitions); a partial save would mislead the history UI.
    const isFinalResults = room.status === 'results' && room.round >= room.maxRounds;
    const isHost = !!userId && room.host === userId;
    if (
      isFinalResults &&
      isHost &&
      !savedMatchRef.current &&
      pastRoundsRef.current.length === room.maxRounds
    ) {
      savedMatchRef.current = true;
      console.log('[mp] saving match history...');
      saveMatchHistory({
        roomCode,
        event: room.event,
        hostId: userId,
        matchStartedAtMs: room.createdAt,
        totalRounds: room.maxRounds,
        finalMembers: room.members ?? {},
        pastRounds: pastRoundsRef.current.slice(),
      }).catch(err => {
        // UI failure is intentionally swallowed — match history is
        // best-effort and shouldn't break the post-match flow.
        console.error('[mp] save match history failed', err);
      });
    }
  }, [room, roomCode, userId]);

  // Multiplayer points award — fires for EACH client (host + non-hosts)
  // once per match when the room reaches its final results screen. The
  // points service is idempotent on `matchId`, so a brief disconnect/
  // remount that re-runs this effect is safe.
  //
  // We trigger off `room.status === 'results'` plus the final-round gate.
  // Non-final-round 'results' (between-round results screen) doesn't end
  // the match, so we skip those.
  const mpAwardedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!authUser?.uid || !userId || !room) return;
    if (room.status !== 'results') return;
    if (room.round < room.maxRounds) return;
    const me = (room.members ?? {})[userId];
    if (!me) return;
    const matchId = `${roomCode}-${room.createdAt}`;
    if (mpAwardedRef.current.has(matchId)) return;
    mpAwardedRef.current.add(matchId);

    // Final-rank computation mirrors saveMatchHistory's tie-break: total
    // points desc, then a stable order. We don't have access to the full
    // ao5/best-single tie-breakers from the live RTDB snapshot, so a
    // points-only sort is close enough for the toast — the canonical
    // ranking lives in the persisted match-history doc.
    const standings = Object.entries(room.members ?? {})
      .map(([uid, m]) => ({ uid, totalPoints: m.totalPoints ?? 0 }))
      .sort((a, b) => b.totalPoints - a.totalPoints);
    const myRank = standings.findIndex(s => s.uid === userId) + 1;
    if (myRank <= 0) return;

    awardMpMatchIfNew(authUser.uid, matchId, myRank, room.event)
      .then(result => {
        if (!result.awarded) return;
        showToast({
          msg: result.won
            ? `Multiplayer хожсон! +${result.amount} 💎`
            : `Multiplayer тоглолт +${result.amount} 💎`,
          tone: 'success',
        });
      })
      .catch(err => console.warn('[points] mp match award failed', err));
  }, [
    room?.status, room?.round, room?.maxRounds,
    room?.members, room?.createdAt, room?.event,
    roomCode, userId, authUser?.uid, room,
  ]);

  // Initial mount: pull user id + saved name
  useEffect(() => {
    const uid = getUserId();
    setUserId(uid);
    const savedName = localStorage.getItem('mp_display_name') || '';
    setDisplayName(savedName);
    setCreateName(savedName);
    setJoinName(savedName);
  }, []);

  // Auto-join via ?join=ABC123 — pre-fill the join form and switch view.
  // Only runs once on first mount; users can manually navigate away after.
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const raw = searchParams.get('join');
    if (!raw) return;
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (code.length !== 6) return;
    autoJoinedRef.current = true;
    setInvitedCode(code);
    setJoinCode(code);
    setView('join');
  }, [searchParams]);

  // Probe a saved last-room (if any) on first mount. If it still exists
  // and hasn't expired, surface a "Rejoin XXX" button on the lobby.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = localStorage.getItem(LAST_ROOM_KEY);
        if (!saved) return;
        const code = saved.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (code.length !== 6) {
          localStorage.removeItem(LAST_ROOM_KEY);
          return;
        }
        const snap = await get(ref(rtdb, `rooms/${code}`));
        if (cancelled) return;
        if (!snap.exists()) {
          localStorage.removeItem(LAST_ROOM_KEY);
          return;
        }
        const data = snap.val() as RoomData;
        if (data.expiresAt != null && data.expiresAt < Date.now()) {
          localStorage.removeItem(LAST_ROOM_KEY);
          return;
        }
        setPendingRejoin(code);
      } catch (err) {
        console.error('[mp] rejoin probe failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to room
  useEffect(() => {
    if (!roomCode) return;
    const r = ref(rtdb, `rooms/${roomCode}`);
    const off = onValue(r, snap => {
      const v = snap.val() as RoomData | null;
      if (!v) {
        // Room no longer exists.
        setRoom(null);
        setRoomCode('');
        setView('lobby');
        setErrorMsg('Room no longer exists.');
        try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
        return;
      }
      // Expiry check — rooms older than 24h are considered stale.
      if (v.expiresAt != null && v.expiresAt < Date.now()) {
        setRoom(null);
        setRoomCode('');
        setView('lobby');
        setErrorMsg('Room has expired.');
        try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
        // Best-effort delete; ignore failures.
        remove(ref(rtdb, `rooms/${roomCode}`)).catch(() => {});
        return;
      }
      setRoom(v);
    });
    return () => off();
  }, [roomCode]);

  // Auto-cleanup on disconnect: only remove our own member entry. We
  // intentionally do NOT delete the room when the host disconnects, so
  // rooms persist across reloads and a returning host can resume.
  useEffect(() => {
    if (!roomCode || !userId || !room) return;
    const memberRef = ref(rtdb, `rooms/${roomCode}/members/${userId}`);
    onDisconnect(memberRef).remove();
    return () => {
      onDisconnect(memberRef).cancel();
    };
  }, [roomCode, userId, room?.host]);

  // Host migration: when the snapshot shows room.host pointing at a uid that
  // is no longer in members (host disconnected, was kicked, or left), every
  // remaining client kicks off the migration transaction. The transaction is
  // a no-op when it sees the host already replaced, so concurrent attempts
  // don't double-promote.
  useEffect(() => {
    if (!roomCode || !room) return;
    if (!room.host) return;
    if (room.members?.[room.host]) return;
    migrateHostIfOrphaned(roomCode);
  }, [roomCode, room?.host, room?.members]);

  // Toast: "Host transferred to {Name}" when room.host changes between
  // snapshots. We seed prevHostUidRef on the first non-empty snapshot so the
  // initial render doesn't fire a phantom transfer.
  const [hostTransferName, setHostTransferName] = useState<string>('');
  const prevHostUidRef = useRef<string>('');
  useEffect(() => {
    if (!room?.host) return;
    if (!prevHostUidRef.current) {
      prevHostUidRef.current = room.host;
      return;
    }
    if (room.host !== prevHostUidRef.current) {
      prevHostUidRef.current = room.host;
      const name = room.members?.[room.host]?.name ?? 'New host';
      setHostTransferName(name);
    }
  }, [room?.host, room?.members]);
  useEffect(() => {
    if (!hostTransferName) return;
    const t = window.setTimeout(() => setHostTransferName(''), 3000);
    return () => window.clearTimeout(t);
  }, [hostTransferName]);

  // ── Heartbeat ────────────────────────────────────────────────────────────
  // Every player writes a server-side timestamp every HEARTBEAT_INTERVAL_MS.
  // Other clients compute connection status from `now - lastHeartbeat`.
  // We only run the heartbeat while we're an actual member of the room — if
  // the host has kicked us, writing lastHeartbeat would silently resurrect a
  // stub member entry on the server.
  const isMemberOfRoom = !!(room?.members && userId && room.members[userId]);
  useEffect(() => {
    if (!roomCode || !userId || !isMemberOfRoom) return;
    const hbRef = ref(rtdb, `rooms/${roomCode}/members/${userId}/lastHeartbeat`);
    const writeBeat = () => {
      set(hbRef, serverTimestamp()).catch(err => {
        if (err && /permission/i.test(String(err))) return;
        console.warn('[mp] heartbeat write failed', err);
      });
    };
    writeBeat();
    const id = window.setInterval(writeBeat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [roomCode, userId, isMemberOfRoom]);

  // Periodic re-render so connection-status thresholds tick over without
  // requiring snapshot updates. 2s is fast enough that a freshly disconnected
  // player flips to 'idle' / 'disconnected' within one tick of crossing the
  // boundary, but slow enough not to thrash the tree.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // ── Notifications (toast queue) ──────────────────────────────────────────
  // Used for "X reconnected" and "X was removed (disconnected)" messages.
  // Each notification auto-dismisses after 4s. The host-transfer banner is
  // its own thing (kept separate so it stands out from chatter).
  type Notif = { id: string; text: string; tone: 'info' | 'success' | 'warn' };
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const pushNotif = useCallback((text: string, tone: Notif['tone']) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setNotifs(prev => [...prev, { id, text, tone }]);
    window.setTimeout(() => {
      setNotifs(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  // Reconnect detection: when a member's status flips from 'disconnected' →
  // 'online' between status ticks, fire a toast for everyone except the
  // member themselves.
  const prevStatusRef = useRef<Record<string, ConnectionStatus>>({});
  useEffect(() => {
    if (!room?.members) return;
    const cur: Record<string, ConnectionStatus> = {};
    for (const [uid, m] of Object.entries(room.members)) {
      cur[uid] = getConnectionStatus(m, now);
    }
    const prev = prevStatusRef.current;
    for (const uid of Object.keys(cur)) {
      if (uid === userId) continue;
      if (prev[uid] === 'disconnected' && cur[uid] === 'online') {
        const name = room.members[uid]?.name ?? 'A player';
        pushNotif(`${name} reconnected`, 'success');
      }
    }
    prevStatusRef.current = cur;
  }, [now, room?.members, userId, pushNotif]);

  // Member-removal detection: track the previous snapshot of members. When
  // a uid is gone we toast the rest of the room — distinguishing a kick
  // (last-seen status was 'disconnected') from a voluntary leave (online or
  // idle at removal time) so the wording matches what the rest of the room
  // actually saw happen.
  const prevMembersRef = useRef<Record<string, { name: string; status: ConnectionStatus }>>({});
  useEffect(() => {
    if (!room?.members) {
      prevMembersRef.current = {};
      return;
    }
    const prev = prevMembersRef.current;
    const cur = room.members;
    for (const uid of Object.keys(prev)) {
      if (cur[uid]) continue;
      if (uid === userId) continue;
      if (prev[uid].status === 'disconnected') {
        pushNotif(`${prev[uid].name} was removed (disconnected)`, 'warn');
      } else {
        pushNotif(`${prev[uid].name} left the room`, 'info');
      }
    }
    const next: typeof prev = {};
    for (const [uid, m] of Object.entries(cur)) {
      next[uid] = { name: m.name, status: getConnectionStatus(m, now) };
    }
    prevMembersRef.current = next;
  }, [now, room?.members, userId, pushNotif]);

  // ── Kicked detection ─────────────────────────────────────────────────────
  // If we used to be in members and the latest snapshot says we're not, we
  // were kicked (host removed us at round end after disconnect). Show a
  // dedicated "rejoin?" prompt instead of dumping the user back to the lobby.
  const [wasKicked, setWasKicked] = useState(false);
  const wasMemberRef = useRef(false);
  useEffect(() => {
    if (!roomCode || !userId || !room) return;
    const inMembers = !!room.members?.[userId];
    if (inMembers) {
      wasMemberRef.current = true;
      if (wasKicked) setWasKicked(false);
      return;
    }
    if (wasMemberRef.current) {
      // We had been a member; the latest snapshot lost us.
      setWasKicked(true);
    }
  }, [roomCode, userId, room, wasKicked]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const persistName = useCallback((n: string) => {
    setDisplayName(n);
    try { localStorage.setItem('mp_display_name', n); } catch {}
  }, []);

  const createRoom = useCallback(async () => {
    setErrorMsg('');
    const name = createName.trim();
    if (!name) { setErrorMsg('Enter a display name.'); return; }
    // Self-heal: if the mount-effect hasn't populated userId yet, generate now.
    let uid = userId;
    if (!uid) {
      uid = getUserId();
      setUserId(uid);
    }
    if (!uid) { setErrorMsg('Could not establish a user id (localStorage unavailable?).'); return; }
    persistName(name);
    console.log('[mp] createRoom start', { uid, name, rtdb });
    try {
      // Try a few times in case of code collision
      for (let i = 0; i < 5; i++) {
        const code = genRoomCode();
        console.log('[mp] trying code', code);
        const roomRef = ref(rtdb, `rooms/${code}`);
        const snap = await get(roomRef);
        if (snap.exists()) { console.log('[mp] code collision, retrying'); continue; }
        const now = Date.now();
        const initial: RoomData = {
          host: uid,
          event: '333',
          status: 'waiting',
          round: 1,
          maxRounds: 3,
          roundName: getRoundName(1, 3),
          createdAt: now,
          expiresAt: now + ROOM_TTL_MS,
          members: {
            [uid]: {
              name,
              ready: false,
              currentSolve: 0,
              roundAverage: null,
              totalPoints: 0,
              connected: true,
              joinedAt: now,
              lastHeartbeat: 0,
            },
          },
        };
        await set(roomRef, initial);
        console.log('[mp] room created', code);
        try { localStorage.setItem(LAST_ROOM_KEY, code); } catch {}
        setRoomCode(code);
        setView('room');
        return;
      }
      setErrorMsg('Could not allocate a room code. Try again.');
    } catch (err) {
      console.error('[mp] createRoom error', err);
      const msg = err instanceof Error ? err.message : String(err);
      // Most common cause: RTDB rules deny writes, RTDB not enabled, or wrong databaseURL.
      setErrorMsg(`Couldn't create room: ${msg}. Check Firebase RTDB is enabled and rules allow writes.`);
    }
  }, [createName, userId, persistName]);

  // Inner write — used both by the normal join path and by the mid-round
  // queue-confirmation path. When `queued` is true the new member will
  // not participate in the current round (round-end check excludes
  // them); the host's `nextRound` clears the flag.
  const performJoin = useCallback(async (
    code: string,
    uid: string,
    name: string,
    queued: boolean,
    existingMember: MemberData | undefined,
  ): Promise<void> => {
    const memberRef = ref(rtdb, `rooms/${code}/members/${uid}`);
    const memberData: MemberData = {
      name,
      ready: existingMember?.ready ?? false,
      currentSolve: existingMember?.currentSolve ?? 0,
      roundAverage: existingMember?.roundAverage ?? null,
      totalPoints: existingMember?.totalPoints ?? 0,
      connected: true,
      joinedAt: existingMember?.joinedAt ?? Date.now(),
      lastHeartbeat: 0,
      ...(queued ? { queued: true } : {}),
    };
    await set(memberRef, memberData);
    try { localStorage.setItem(LAST_ROOM_KEY, code); } catch {}
    setRoomCode(code);
    setView('room');
  }, []);

  const joinRoom = useCallback(async (overrideCode?: string) => {
    setErrorMsg('');
    // joinRoom is wired both as JoinForm's onSubmit (click/keydown handler,
    // so React passes a SyntheticEvent here) AND as a programmatic call
    // from the active-rooms join modal (passes a real string). Only treat
    // the arg as a code when it actually IS a string — otherwise fall
    // back to the form-controlled joinCode state.
    const rawCode = typeof overrideCode === 'string' ? overrideCode : joinCode;
    const code = String(rawCode ?? '').trim().toUpperCase();
    const name = String(joinName ?? '').trim();
    if (!code) { setErrorMsg('Enter a room code.'); return; }
    if (!name) { setErrorMsg('Enter a display name.'); return; }
    let uid = userId;
    if (!uid) {
      uid = getUserId();
      setUserId(uid);
    }
    if (!uid) { setErrorMsg('Could not establish a user id (localStorage unavailable?).'); return; }
    persistName(name);
    console.log('[mp] joinRoom', { code, uid, name });
    try {
      const roomRef = ref(rtdb, `rooms/${code}`);
      const snap = await get(roomRef);
      if (!snap.exists()) {
        setErrorMsg(`Room ${code} not found.`);
        return;
      }
      const data = snap.val() as RoomData;
      if (data.expiresAt != null && data.expiresAt < Date.now()) {
        setErrorMsg(`Room ${code} has expired.`);
        try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
        remove(roomRef).catch(() => {});
        return;
      }
      // Existing members (including a returning user with the same uid)
      // skip the queue prompt entirely — they were already part of the
      // round before any disconnect/refresh.
      const existingMember = data.members?.[uid];
      if (data.status === 'racing' && !existingMember) {
        setPendingMidRoundJoin({ code, name, uid });
        return;
      }
      await performJoin(code, uid, name, false, existingMember);
      console.log('[mp] joined', code);
    } catch (err) {
      console.error('[mp] joinRoom error', err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Couldn't join: ${msg}. Check Firebase RTDB is enabled and rules allow reads/writes.`);
    }
  }, [joinCode, joinName, userId, persistName, performJoin]);

  const confirmMidRoundJoin = useCallback(async () => {
    if (!pendingMidRoundJoin) return;
    const { code, uid, name } = pendingMidRoundJoin;
    setPendingMidRoundJoin(null);
    try {
      // Re-read the room so we don't clobber a fresh existing-member
      // snapshot (e.g. status flipped to 'results' during the prompt).
      const snap = await get(ref(rtdb, `rooms/${code}`));
      if (!snap.exists()) {
        setErrorMsg(`Room ${code} not found.`);
        return;
      }
      const data = snap.val() as RoomData;
      const existingMember = data.members?.[uid];
      // If the round wrapped up while the modal was open the user can
      // join normally — no need to mark them queued any more.
      const queued = data.status === 'racing' && !existingMember;
      await performJoin(code, uid, name, queued, existingMember);
      console.log('[mp] joined (queued=' + queued + ')', code);
    } catch (err) {
      console.error('[mp] confirmMidRoundJoin error', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [pendingMidRoundJoin, performJoin]);

  const cancelMidRoundJoin = useCallback(() => {
    setPendingMidRoundJoin(null);
  }, []);

  const leaveRoom = useCallback(async () => {
    if (!roomCode || !userId) return;
    // Always just remove our own member entry — never delete the room.
    // Rooms persist for 24h so a returning host can resume; the cleanup
    // happens via the expiresAt check on next load.
    try {
      await remove(ref(rtdb, `rooms/${roomCode}/members/${userId}`));
    } catch (err) {
      console.error('[mp] leaveRoom error', err);
    }
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
    if (ganHook.state === 'connected') ganHook.disconnect();
    if (qiyiHook.state === 'connected') qiyiHook.disconnect();
    setRoom(null);
    setRoomCode('');
    setView('lobby');
    setPendingRejoin('');
  }, [roomCode, userId, ganHook, qiyiHook]);

  // After being kicked, the user can re-add themselves. They come back as a
  // brand new member: fresh ready/solve state, no inherited round results,
  // and a new joinedAt so they sort *after* anyone still in the room (host
  // migration tie-break). Their userId stays the same so the rejoin probe and
  // any saved share-links keep working.
  const rejoinAfterKick = useCallback(async () => {
    if (!roomCode || !userId) return;
    const name = (displayName || localStorage.getItem('mp_display_name') || '').trim() || 'Player';
    try {
      const memberRef = ref(rtdb, `rooms/${roomCode}/members/${userId}`);
      const memberData: MemberData = {
        name,
        ready: false,
        currentSolve: 0,
        roundAverage: null,
        totalPoints: 0,
        connected: true,
        joinedAt: Date.now(),
        lastHeartbeat: 0,
      };
      await set(memberRef, memberData);
      try { localStorage.setItem(LAST_ROOM_KEY, roomCode); } catch {}
      setWasKicked(false);
      wasMemberRef.current = true;
    } catch (err) {
      console.error('[mp] rejoinAfterKick error', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [roomCode, userId, displayName]);

  const dismissKicked = useCallback(() => {
    setWasKicked(false);
    wasMemberRef.current = false;
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
    setRoom(null);
    setRoomCode('');
    setView('lobby');
    setPendingRejoin('');
  }, []);

  // Leave temporarily — keep our room slot + LAST_ROOM_KEY so we can rejoin.
  // Navigate back to /timer; the rejoin probe on next visit will offer to come
  // back. Cancel the onDisconnect-remove handler so our member entry stays.
  const leaveTemporarily = useCallback(async () => {
    if (!roomCode || !userId) return;
    try {
      const memberRef = ref(rtdb, `rooms/${roomCode}/members/${userId}`);
      await onDisconnect(memberRef).cancel();
    } catch (err) {
      console.error('[mp] leaveTemporarily cancel onDisconnect', err);
    }
    // Drop BT before nav so the solo timer page can re-pair cleanly.
    if (ganHook.state === 'connected') ganHook.disconnect();
    if (qiyiHook.state === 'connected') qiyiHook.disconnect();
    // LAST_ROOM_KEY stays set; member entry stays in Firebase.
    router.push('/timer');
  }, [roomCode, userId, router, ganHook, qiyiHook]);

  // Exit permanently — remove our slot. If we're the last person in the
  // room (regardless of host status) the room is deleted; otherwise we just
  // remove the member entry and let remaining clients run the migration
  // transaction (which also picks the next host when needed).
  const exitPermanently = useCallback(async () => {
    if (!roomCode || !userId) return;
    const memberCount = Object.keys(room?.members || {}).length;
    try {
      if (memberCount <= 1) {
        await remove(ref(rtdb, `rooms/${roomCode}`));
      } else {
        await remove(ref(rtdb, `rooms/${roomCode}/members/${userId}`));
      }
    } catch (err) {
      console.error('[mp] exitPermanently error', err);
    }
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
    if (ganHook.state === 'connected') ganHook.disconnect();
    if (qiyiHook.state === 'connected') qiyiHook.disconnect();
    setRoom(null);
    setRoomCode('');
    setView('lobby');
    setPendingRejoin('');
    setPauseOpen(false);
    setLeaveModalKind(null);
  }, [roomCode, userId, room?.members, ganHook, qiyiHook]);

  // Single entry point for the user-initiated leave flow. Picks the right
  // confirmation copy based on context (waiting/active/host/last). For the
  // 'immediate' case (waiting room, non-host, others remain) we skip the
  // modal entirely — same friction as the old plain Leave button.
  const requestLeave = useCallback(() => {
    const kind = decideLeaveKind(room, userId);
    if (kind === 'immediate') {
      setPauseOpen(false);
      leaveRoom();
      return;
    }
    setLeaveModalKind(kind);
  }, [room, userId, leaveRoom]);

  // Confirmed-leave path (any modal kind). Plays a short fade-out, performs
  // the RTDB write (delete room if last, else remove member), then redirects
  // out of /timer/multiplayer entirely. Other clients see "[name] left the
  // room" via the prevMembers detector below.
  const confirmedLeave = useCallback(async () => {
    setLeaveModalKind(null);
    setPauseOpen(false);
    setIsLeaving(true);
    await new Promise(r => window.setTimeout(r, 240));
    await exitPermanently();
    router.push('/timer');
  }, [exitPermanently, router]);

  // Rejoin a previously-active room. Re-adds our member entry (which was
  // removed by onDisconnect when we last left) and switches to the room view.
  const rejoinRoom = useCallback(async () => {
    setErrorMsg('');
    if (!pendingRejoin) return;
    let uid = userId;
    if (!uid) {
      uid = getUserId();
      setUserId(uid);
    }
    if (!uid) { setErrorMsg('Could not establish a user id.'); return; }
    const name = (displayName || localStorage.getItem('mp_display_name') || '').trim();
    if (!name) {
      // No saved name — fall back to manual join with code pre-filled.
      setJoinCode(pendingRejoin);
      setView('join');
      return;
    }
    try {
      const roomRef = ref(rtdb, `rooms/${pendingRejoin}`);
      const snap = await get(roomRef);
      if (!snap.exists()) {
        setErrorMsg('That room no longer exists.');
        try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
        setPendingRejoin('');
        return;
      }
      const data = snap.val() as RoomData;
      if (data.expiresAt != null && data.expiresAt < Date.now()) {
        setErrorMsg('That room has expired.');
        try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
        setPendingRejoin('');
        remove(roomRef).catch(() => {});
        return;
      }
      const memberRef = ref(rtdb, `rooms/${pendingRejoin}/members/${uid}`);
      const existing = data.members?.[uid];
      // Preserve cumulative points / round progress on return. joinedAt is
      // preserved when present so a returning host (after migration) keeps
      // their original join order, but they remain a regular member.
      const memberData: MemberData = {
        name,
        ready: existing?.ready ?? false,
        currentSolve: existing?.currentSolve ?? 0,
        roundAverage: existing?.roundAverage ?? null,
        totalPoints: existing?.totalPoints ?? 0,
        connected: true,
        joinedAt: existing?.joinedAt ?? Date.now(),
        lastHeartbeat: 0,
      };
      await set(memberRef, memberData);
      setRoomCode(pendingRejoin);
      setView('room');
      setPendingRejoin('');
    } catch (err) {
      console.error('[mp] rejoinRoom error', err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Couldn't rejoin: ${msg}`);
    }
  }, [pendingRejoin, userId, displayName]);

  // Host controls
  const setEvent = useCallback(async (eventId: string) => {
    if (!roomCode || !room || room.host !== userId) return;
    await update(ref(rtdb, `rooms/${roomCode}`), { event: eventId });
  }, [roomCode, room, userId]);

  const setMaxRounds = useCallback(async (n: number) => {
    if (!roomCode || !room || room.host !== userId) return;
    await update(ref(rtdb, `rooms/${roomCode}`), {
      maxRounds: n,
      // Refresh round name in case round 1 already shown — getRoundName depends on maxRounds
      roundName: getRoundName(room.round, n),
    });
  }, [roomCode, room, userId]);

  const toggleReady = useCallback(async () => {
    if (!roomCode || !room || !userId) return;
    const me = room.members?.[userId];
    if (!me) return;
    await update(ref(rtdb, `rooms/${roomCode}/members/${userId}`), {
      ready: !me.ready,
    });
  }, [roomCode, room, userId]);

  // Host: pre-generate 5 scrambles, reset member solve progress, status → racing.
  const startRace = useCallback(async () => {
    if (!roomCode || !room || room.host !== userId) return;
    const members = Object.entries(room.members || {});
    if (members.length < 1) return;
    if (!members.every(([, m]) => m.ready)) return;
    const updates: Record<string, unknown> = {
      status: 'racing',
      roundName: getRoundName(room.round, room.maxRounds),
      scrambles: generateScrambles(room.event),
      // Wipe any leftover round solves
      solves: null,
    };
    for (const [uid] of members) {
      updates[`members/${uid}/currentSolve`] = 0;
      updates[`members/${uid}/roundAverage`] = null;
      updates[`members/${uid}/ready`] = false;
    }
    await update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [roomCode, room, userId]);

  // Member: confirm a solve. Writes the solve and bumps currentSolve.
  // If this was solve 5, also computes and stores roundAverage.
  const submitSolve = useCallback(async (
    index: number,
    timeMs: number,
    penalty: Penalty,
    scramble: string,
  ) => {
    if (!roomCode || !userId || !room) return;
    const updates: Record<string, unknown> = {
      [`solves/${userId}/${index}`]: {
        time: timeMs,
        penalty,
        confirmedAt: Date.now(),
        scramble,
      },
      [`members/${userId}/currentSolve`]: index + 1,
    };
    if (index === SOLVES_PER_ROUND - 1) {
      // Compose all 5 solves locally to compute Ao5 immediately.
      const all: SolveData[] = [];
      for (let i = 0; i < SOLVES_PER_ROUND - 1; i++) {
        const existing = room.solves?.[userId]?.[String(i)];
        if (existing) all.push(existing);
      }
      all.push({ time: timeMs, penalty, confirmedAt: Date.now(), scramble });
      if (all.length === SOLVES_PER_ROUND) {
        updates[`members/${userId}/roundAverage`] = computeAo5(all);
      }
    }
    await update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [roomCode, userId, room]);

  // Member: mark "ready for next round" on the results screen.
  const readyForNext = useCallback(async () => {
    if (!roomCode || !userId || !room) return;
    const me = room.members?.[userId];
    if (!me) return;
    await update(ref(rtdb, `rooms/${roomCode}/members/${userId}`), {
      ready: !me.ready,
    });
  }, [roomCode, userId, room]);

  // Host: advance to next round, gen 5 fresh scrambles, reset solves.
  // Members who are still disconnected at round-start are removed here —
  // this is the deferred kick that we held off on at round-end (so they
  // had a window to reconnect during the results screen).
  const nextRound = useCallback(async () => {
    if (!roomCode || !room || room.host !== userId) return;
    const newRound = room.round + 1;
    if (newRound > room.maxRounds) return; // shouldn't be called past final
    const updates: Record<string, unknown> = {
      status: 'racing',
      round: newRound,
      roundName: getRoundName(newRound, room.maxRounds),
      scrambles: generateScrambles(room.event),
      solves: null,
    };
    for (const [uid, m] of Object.entries(room.members || {})) {
      if (getConnectionStatus(m, now) === 'disconnected') {
        updates[`members/${uid}`] = null;
        continue;
      }
      updates[`members/${uid}/currentSolve`] = 0;
      updates[`members/${uid}/roundAverage`] = null;
      updates[`members/${uid}/ready`] = false;
      // Promote anyone who joined mid-round during the previous round —
      // they participate normally from this round forward. Setting to
      // null removes the field entirely, keeping the doc tidy.
      if (m.queued) updates[`members/${uid}/queued`] = null;
    }
    await update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [roomCode, room, userId, now]);

  // Host: reset everything for another full match. Clears totalPoints. Same
  // deferred-kick rule applies: disconnected members are removed here.
  const playAgain = useCallback(async () => {
    if (!roomCode || !room || room.host !== userId) return;
    const updates: Record<string, unknown> = {
      status: 'waiting',
      round: 1,
      roundName: getRoundName(1, room.maxRounds),
      scrambles: null,
      solves: null,
    };
    for (const [uid, m] of Object.entries(room.members || {})) {
      if (getConnectionStatus(m, now) === 'disconnected') {
        updates[`members/${uid}`] = null;
        continue;
      }
      updates[`members/${uid}/currentSolve`] = 0;
      updates[`members/${uid}/roundAverage`] = null;
      updates[`members/${uid}/totalPoints`] = 0;
      updates[`members/${uid}/ready`] = false;
      if (m.queued) updates[`members/${uid}/queued`] = null;
    }
    await update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [roomCode, room, userId, now]);

  // ── Status transitions (host-driven, with disconnected-host fallback) ───
  // Round-end logic: racing → results when every non-disconnected member has
  // confirmed all 5 solves. Disconnected players don't block the round and
  // are NOT kicked here — they're given DNF for any incomplete solves so the
  // results screen still ranks them, and they keep their slot in the room so
  // they have a window to reconnect. Kicks happen at the start of the next
  // round (in `nextRound` / `playAgain`) only if they're still disconnected.
  //
  // Trigger source: the host normally runs this. If the host is disconnected
  // we fall back to the earliest-joined non-disconnected member so the round
  // can still wrap up without waiting for the server-side onDisconnect (and
  // the subsequent host migration). Each client computes the same trigger
  // uid from the same room snapshot, so only one client writes — and even
  // if a borderline `now` causes two clients to think they're the trigger,
  // the writes are idempotent (DNF fills are deterministic — confirmedAt is
  // 0 — and totalPoints uses the snapshot's `prev` not a read-modify-write).
  useEffect(() => {
    if (!room || !roomCode) return;
    if (room.status !== 'racing') return;
    const memberEntries = Object.entries(room.members || {});
    if (memberEntries.length === 0) return;
    // Queued members are spectators for the current round — they neither
    // count toward the round-end gate nor get DNF-filled below. They'll
    // join the active set when the host advances to the next round.
    const onlineEntries = memberEntries.filter(([, m]) =>
      getConnectionStatus(m, now) !== 'disconnected' && !m.queued
    );
    if (onlineEntries.length === 0) return; // everyone disconnected; wait for someone to come back
    const allOnlineDone = onlineEntries.every(([, m]) => m.currentSolve >= SOLVES_PER_ROUND);
    if (!allOnlineDone) return;

    // Pick trigger: host if online, else earliest-joined online member.
    const hostMember = room.host ? room.members?.[room.host] : undefined;
    const hostOnline = !!hostMember && getConnectionStatus(hostMember, now) !== 'disconnected';
    let triggerUid: string;
    if (hostOnline) {
      triggerUid = room.host;
    } else {
      const sortedOnline = onlineEntries
        .slice()
        .sort(([, a], [, b]) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
      triggerUid = sortedOnline[0]?.[0] ?? '';
    }
    if (triggerUid !== userId) return;

    // Build the synthesised members map: online entries pass through; for
    // each disconnected entry with incomplete solves, fill DNF for missing
    // slots and compute their Ao5 (which will usually itself be DNF). The
    // synthesised map drives ranking so disconnected players are scored
    // alongside online players (DNFs rank last and earn 0 points).
    const updates: Record<string, unknown> = { status: 'results' };
    const synthMembers: Record<string, MemberData> = {};
    for (const [uid, m] of memberEntries) {
      // Queued members aren't part of this round at all — keep them in
      // the snapshot (so they survive the writeback) but don't rank them.
      if (m.queued) continue;
      synthMembers[uid] = m;
      if (getConnectionStatus(m, now) !== 'disconnected') continue;
      if (m.currentSolve >= SOLVES_PER_ROUND) continue;
      const filled: SolveData[] = [];
      for (let i = 0; i < SOLVES_PER_ROUND; i++) {
        const existing = room.solves?.[uid]?.[String(i)];
        if (existing) {
          filled.push(existing);
        } else {
          const dnfSolve: SolveData = {
            time: 0,
            penalty: 'dnf',
            confirmedAt: 0, // deterministic so concurrent triggers don't thrash
            scramble: room.scrambles?.[String(i)] ?? '',
          };
          updates[`solves/${uid}/${i}`] = dnfSolve;
          filled.push(dnfSolve);
        }
      }
      const ao5 = computeAo5(filled);
      updates[`members/${uid}/currentSolve`] = SOLVES_PER_ROUND;
      updates[`members/${uid}/roundAverage`] = ao5;
      synthMembers[uid] = {
        ...m,
        currentSolve: SOLVES_PER_ROUND,
        roundAverage: ao5,
      };
    }

    // Rank everyone (online + DNF-filled disconnected). Award round points.
    const ranked = rankByRoundAverage(synthMembers);
    const N = ranked.length;
    ranked.forEach((r, i) => {
      const pts = r.dnf ? 0 : Math.max(1, N - i);
      const prev = synthMembers[r.uid]?.totalPoints ?? 0;
      updates[`members/${r.uid}/totalPoints`] = prev + pts;
    });

    update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [room?.status, room?.members, room?.host, room?.solves, room?.scrambles, roomCode, userId, now]);

  // Toast: when status flips racing → results, announce any member who was
  // disconnected at the moment the round ended. The detection runs on every
  // client (so all online players see the toast), gated by a ref-tracked
  // status transition to fire exactly once per round.
  const prevRoundStatusRef = useRef<RoomStatus | null>(null);
  useEffect(() => {
    if (!room?.status) return;
    const prev = prevRoundStatusRef.current;
    prevRoundStatusRef.current = room.status;
    if (prev === 'racing' && room.status === 'results') {
      for (const [uid, m] of Object.entries(room.members || {})) {
        if (uid === userId) continue;
        if (getConnectionStatus(m, now) === 'disconnected') {
          pushNotif(`${m.name} was disconnected during round`, 'warn');
        }
      }
    }
  }, [room?.status, room?.members, userId, now, pushNotif]);

  // ── Render ──────────────────────────────────────────────────────────────
  // While racing the page is locked to the visible viewport — height: 100dvh
  // (dynamic viewport so iOS Safari URL-bar dynamics don't cause overflow),
  // overflow hidden so the document body itself can never scroll, and safe-
  // area paddings so notch / home-indicator never overlap the layout. Other
  // views (lobby / create / join / waiting / results) fall back to 100vh
  // and scroll normally.
  const isRacing = view === 'room' && room?.status === 'racing';
  return (
    <div style={{
      ...(isRacing
        ? {
            // dvh tracks the visible viewport on mobile so URL-bar dynamics
            // don't cause the layout to overflow. Older browsers without dvh
            // (~Safari <15.4 / Chrome <108) gracefully degrade — still works,
            // just with the classic vh quirk.
            height: '100dvh',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            overflow: 'hidden',
          }
        : { minHeight: '100vh' }),
      background: C.bg, color: C.text,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      display: 'flex', flexDirection: 'column',
      opacity: isLeaving ? 0 : 1,
      transition: 'opacity 0.24s ease-out',
      pointerEvents: isLeaving ? 'none' : undefined,
    }}>
      {/* The racing screen renders its own header (settings + pause icons)
          on every breakpoint, so we suppress the global TopBar there. */}
      {!(view === 'room' && room?.status === 'racing') && (
        <TopBar
          roomCode={view === 'room' ? roomCode : ''}
          onBack={() => {
            if (view === 'room') requestLeave();
            else if (view === 'lobby') router.push('/timer');
            else { setView('lobby'); setErrorMsg(''); }
          }}
        />
      )}

      <main style={{
        flex: '1 1 auto', minWidth: 0,
        padding: (view === 'room' && room?.status === 'racing') ? 0 : '1rem',
        display: 'flex', flexDirection: 'column',
      }}>
        {errorMsg && view !== 'room' && (
          <div style={{
            maxWidth: 480, margin: '0 auto 0.85rem', width: '100%',
            background: C.dangerDim, border: `1px solid ${C.danger}`,
            color: C.danger, borderRadius: 10, padding: '0.6rem 0.8rem',
            fontSize: '0.82rem',
          }}>{errorMsg}</div>
        )}

        {view === 'lobby' && (
          <MultiplayerHub
            isMobile={isMobile}
            pendingRejoin={pendingRejoin}
            onRejoin={rejoinRoom}
            onDismissRejoin={() => {
              try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
              setPendingRejoin('');
            }}
            onCreate={() => { setErrorMsg(''); setView('create'); }}
            onJoin={() => { setErrorMsg(''); setView('join'); }}
            onJoinRoom={(code) => {
              setErrorMsg('');
              setJoinCode(code);
              const savedName = (
                joinName ||
                displayName ||
                (typeof window !== 'undefined'
                  ? (localStorage.getItem('mp_display_name') ?? '')
                  : '')
              ).trim();
              if (!savedName) { setView('join'); return; }
              if (!joinName.trim()) setJoinName(savedName);
              joinRoom(code);
            }}
          />
        )}

        {view === 'create' && (
          <CreateForm
            isMobile={isMobile}
            name={createName}
            setName={setCreateName}
            onSubmit={createRoom}
            onBack={() => setView('lobby')}
          />
        )}

        {view === 'join' && (
          <JoinForm
            isMobile={isMobile}
            code={joinCode}
            setCode={setJoinCode}
            name={joinName}
            setName={setJoinName}
            invitedCode={invitedCode}
            onSubmit={joinRoom}
            onBack={() => setView('lobby')}
          />
        )}

        {view === 'room' && room && wasKicked && (
          <KickedScreen
            isMobile={isMobile}
            roomCode={roomCode}
            onRejoin={rejoinAfterKick}
            onLeave={dismissKicked}
          />
        )}

        {view === 'room' && room && !wasKicked && (
          <RoomView
            isMobile={isMobile}
            roomCode={roomCode}
            room={room}
            userId={userId}
            prefs={prefs}
            now={now}
            onOpenSettings={() => setSettingsOpen(true)}
            onPause={() => setPauseOpen(true)}
            onToggleReady={toggleReady}
            onSetEvent={setEvent}
            onSetMaxRounds={setMaxRounds}
            onStartRace={startRace}
            onSubmitSolve={submitSolve}
            onReadyForNext={readyForNext}
            onNextRound={nextRound}
            onPlayAgain={playAgain}
            onLeave={requestLeave}
            btState={bt.state}
            btLiveState={bt.state === 'connected' ? bt.liveState : null}
            btDeviceLabel={btDeviceLabel}
            onBtConnect={bt.connect}
            onBtDisconnect={guardedBtDisconnect}
            btSolveCallbacksRef={btSolveCallbacksRef}
          />
        )}
      </main>

      {/* Host-transfer toast — auto-dismisses after 3s (set in effect). */}
      {hostTransferName && view === 'room' && (
        <HostTransferToast name={hostTransferName} />
      )}

      {/* Connection toasts (reconnects, kicks). Stacked under host toast. */}
      {view === 'room' && notifs.length > 0 && (
        <NotificationStack notifs={notifs} hostToastVisible={!!hostTransferName} />
      )}

      {/* Settings + Pause modals — overlay on top of everything. */}
      {settingsOpen && (
        <MpSettingsModal
          isMobile={isMobile}
          prefs={prefs}
          onChange={updatePrefs}
          onClose={() => setSettingsOpen(false)}
          timerBrand={timerBrand}
          onTimerBrandChange={setTimerBrandPersist}
          btState={bt.state}
          btDeviceLabel={btDeviceLabel}
          onBtConnect={bt.connect}
          onBtDisconnect={guardedBtDisconnect}
        />
      )}
      {pauseOpen && (
        <MpPauseModal
          isMobile={isMobile}
          onResume={() => setPauseOpen(false)}
          onLeaveTemporarily={() => { setPauseOpen(false); leaveTemporarily(); }}
          onExit={requestLeave}
        />
      )}
      {leaveModalKind && (
        <MpLeaveConfirmModal
          isMobile={isMobile}
          kind={leaveModalKind}
          nextHostName={previewNextHostName(room, userId)}
          onCancel={() => setLeaveModalKind(null)}
          onConfirm={confirmedLeave}
        />
      )}
      {pendingMidRoundJoin && (
        <MpQueueConfirmModal
          isMobile={isMobile}
          onCancel={cancelMidRoundJoin}
          onConfirm={confirmMidRoundJoin}
        />
      )}
    </div>
  );
}

// ── MpQueueConfirmModal ──────────────────────────────────────────────────
//
// Shown when the user submits the join form for a room whose status is
// already 'racing'. Two-button confirmation: queue (write member with
// queued: true) or cancel (no-op, user stays on the join form).
function MpQueueConfirmModal({
  isMobile, onCancel, onConfirm,
}: {
  isMobile: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell isMobile={isMobile} title="Тоглолт эхэлчихсэн байна" onClose={onCancel} maxWidth={360}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ fontSize: '0.92rem', color: C.text, lineHeight: 1.55 }}>
          Та одоо нэгдвэл одоогийн round дуустал хүлээх болно. Дараагийн round-д хамт уралдах боломжтой.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '0.75rem 0.85rem', fontSize: '0.95rem',
              fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
            }}
          >Болих</button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              background: C.accent, color: '#0a0a0a',
              border: `1px solid ${C.accent}`, borderRadius: 10,
              padding: '0.75rem 0.85rem', fontSize: '0.95rem',
              fontFamily: 'inherit', cursor: 'pointer', fontWeight: 800,
            }}
          >Хүлээх</button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────
function TopBar({ roomCode, onBack }: { roomCode: string; onBack: () => void }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.7rem 0.95rem',
      borderBottom: `1px solid ${C.border}`,
      background: C.card,
      gap: '0.6rem',
    }}>
      <button
        onClick={onBack}
        style={{
          background: 'transparent', border: `1px solid ${C.border}`,
          color: C.muted, borderRadius: 8, padding: '0.35rem 0.65rem',
          fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer',
          flexShrink: 0,
        }}
      >← {roomCode ? 'Leave' : 'Back'}</button>
      <div style={{
        fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em',
        flex: '0 1 auto', minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        Multiplayer Racing
      </div>
      <div style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
        <TimerProfileMenu size={30} redirectAfterLogin="/timer/multiplayer" align="right" />
      </div>
    </header>
  );
}

// ── CreateForm ────────────────────────────────────────────────────────────
function CreateForm({
  isMobile, name, setName, onSubmit, onBack,
}: {
  isMobile: boolean;
  name: string; setName: (v: string) => void;
  onSubmit: () => void; onBack: () => void;
}) {
  return (
    <FormShell isMobile={isMobile} title="Create Room" onBack={onBack}>
      <Field label="Display name">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          maxLength={24}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
          style={inputStyle}
        />
      </Field>
      <BigButton accent onClick={onSubmit}>Create Room</BigButton>
    </FormShell>
  );
}

// ── JoinForm ──────────────────────────────────────────────────────────────
function JoinForm({
  isMobile, code, setCode, name, setName, invitedCode, onSubmit, onBack,
}: {
  isMobile: boolean;
  code: string; setCode: (v: string) => void;
  name: string; setName: (v: string) => void;
  invitedCode?: string;
  onSubmit: () => void; onBack: () => void;
}) {
  const isInvited = !!invitedCode;
  const [scanning, setScanning] = useState(false);
  const [scanFound, setScanFound] = useState<string>('');

  const handleScanResult = useCallback((scanned: string) => {
    setCode(scanned);
    setScanFound(scanned);
    setScanning(false);
    window.setTimeout(() => setScanFound(''), 2500);
  }, [setCode]);

  return (
    <FormShell isMobile={isMobile} title={isInvited ? 'Join Race' : 'Join Room'} onBack={onBack}>
      {isInvited ? (
        <div style={{
          background: C.accentDim, border: `1px solid ${C.borderHi}`,
          borderRadius: 12, padding: '0.85rem 1rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.78rem', color: C.muted, marginBottom: '0.3rem' }}>
            You&rsquo;ve been invited to room
          </div>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 'clamp(1.6rem, 6vw, 2.2rem)', fontWeight: 800,
            letterSpacing: '0.25em', color: C.accent,
          }}>{invitedCode}</div>
        </div>
      ) : (
        <>
          <Field label="Room code">
            <input
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ABC123"
              maxLength={6}
              onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
              style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.25rem' }}
            />
          </Field>
          {scanFound && (
            <div style={{
              background: C.successDim, border: `1px solid ${C.success}`,
              color: C.success, borderRadius: 10, padding: '0.55rem 0.75rem',
              fontSize: '0.82rem', fontWeight: 700, textAlign: 'center',
            }}>
              Room code found: <span style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.18em' }}>{scanFound}</span>
            </div>
          )}
          {!scanning ? (
            <button
              onClick={() => setScanning(true)}
              type="button"
              style={{
                background: C.cardAlt, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '0.6rem 0.85rem', fontSize: '0.85rem',
                fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
                letterSpacing: '0.02em',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              }}
            >
              <CameraIcon /> Scan QR Code
            </button>
          ) : (
            <QrScanner
              onResult={handleScanResult}
              onCancel={() => setScanning(false)}
            />
          )}
        </>
      )}
      <Field label="Display name">
        <input
          autoFocus={isInvited}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          maxLength={24}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
          style={inputStyle}
        />
      </Field>
      <BigButton accent onClick={onSubmit}>{isInvited ? 'Join Race' : 'Join'}</BigButton>
    </FormShell>
  );
}

// ── QR scanner (uses html5-qrcode, dynamically imported) ─────────────────
function extractRoomCode(decoded: string): string | null {
  // Try parsing as URL first (the QR we generate is a URL with ?join=XXX).
  try {
    const url = new URL(decoded);
    const join = url.searchParams.get('join');
    if (join) {
      const c = join.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (c.length === 6) return c;
    }
  } catch {}
  // Fall back: bare 6-char alphanumeric.
  const bare = decoded.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (bare.length === 6) return bare;
  return null;
}

const QR_READER_ID = 'mp-qr-reader';

function QrScanner({
  onResult, onCancel,
}: {
  onResult: (code: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string>('');
  const [starting, setStarting] = useState(true);
  // Track the live scanner so the unmount handler can stop the camera.
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  useEffect(() => {
    let cancelled = false;
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;

    (async () => {
      try {
        const mod = await import('html5-qrcode');
        if (cancelled) return;
        const { Html5Qrcode } = mod;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        scanner = new (Html5Qrcode as any)(QR_READER_ID);
        scannerRef.current = scanner;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (scanner as any).start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText: string) => {
            const code = extractRoomCode(decodedText);
            if (code) onResultRef.current(code);
          },
          () => { /* ignore per-frame decode errors */ },
        );
        if (cancelled) return;
        setStarting(false);
      } catch (err) {
        console.error('[mp] QR scanner start failed', err);
        const msg = err instanceof Error ? err.message : String(err);
        if (/Permission|denied|NotAllowed/i.test(msg)) {
          setError('Camera access denied. Enter code manually.');
        } else if (/NotFound|no camera/i.test(msg)) {
          setError('No camera found on this device. Enter code manually.');
        } else {
          setError(`Couldn't start scanner: ${msg}`);
        }
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .then(() => { try { s.clear(); } catch {} })
          .catch(() => { try { s.clear(); } catch {} });
        scannerRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{
      background: C.cardAlt, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '0.6rem',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
    }}>
      {error ? (
        <div style={{
          color: C.danger, fontSize: '0.82rem',
          padding: '0.6rem 0.4rem', textAlign: 'center', fontWeight: 600,
        }}>{error}</div>
      ) : (
        <>
          <div
            id={QR_READER_ID}
            style={{
              width: '100%', minHeight: 240,
              background: '#000', borderRadius: 8, overflow: 'hidden',
            }}
          />
          {starting && (
            <div style={{ fontSize: '0.78rem', color: C.muted, textAlign: 'center' }}>
              Starting camera…
            </div>
          )}
        </>
      )}
      <button
        onClick={onCancel}
        type="button"
        style={{
          background: 'transparent', color: C.muted,
          border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '0.5rem 0.75rem', fontSize: '0.82rem',
          fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600,
        }}
      >Cancel Scan</button>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// ── RoomView (router by status) ───────────────────────────────────────────
interface RoomViewProps {
  isMobile: boolean;
  roomCode: string;
  room: RoomData;
  userId: string;
  prefs: MpPrefs;
  now: number;                  // shared "now" tick for connection-status checks
  onOpenSettings: () => void;
  onPause: () => void;
  onToggleReady: () => void;
  onSetEvent: (id: string) => void;
  onSetMaxRounds: (n: number) => void;
  onStartRace: () => void;
  onSubmitSolve: (index: number, time: number, penalty: Penalty, scramble: string) => void;
  onReadyForNext: () => void;
  onNextRound: () => void;
  onPlayAgain: () => void;
  onLeave: () => void;
  // Bluetooth smart-timer integration. The page-level hooks own the
  // connection lifecycle; RacingScreen subscribes via btSolveCallbacksRef
  // to drive its local timer state machine while connected. btLiveState
  // surfaces the device's physical phase ('handsOn', 'getSet', etc.) so
  // we can paint the same red→green arming progression as the keyboard
  // path.
  btState: 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
  btLiveState: string | null;
  btDeviceLabel: string | null;
  onBtConnect: () => void;
  onBtDisconnect: () => void;
  btSolveCallbacksRef: React.MutableRefObject<{
    onSolveStart?: () => void;
    onSolveStop?: (ms: number) => void;
    onIdle?: () => void;
  }>;
}

function RoomView(props: RoomViewProps) {
  const { room, userId } = props;
  const isHost = room.host === userId;
  const me = room.members?.[userId];

  // Mid-round joiner: while the round we joined into is still racing,
  // we render a static waiting screen instead of the active timer UI.
  // The host's `nextRound` clears `queued`, so when status flips back to
  // 'racing' for the next round we fall through into RacingScreen
  // automatically.
  if (me?.queued && room.status === 'racing') {
    return <QueuedWaitScreen {...props} />;
  }

  if (room.status === 'waiting') return <WaitingRoom {...props} isHost={isHost} />;
  if (room.status === 'racing')  return <RacingScreen {...props} isHost={isHost} />;
  return <ResultsScreen {...props} isHost={isHost} />;
}

// Spectator screen for users who joined while a race was already in
// progress. Pure UI — the join-time write set `queued: true` and the
// round-end / next-round transitions own the lifecycle.
function QueuedWaitScreen({ isMobile, room, onLeave }: RoomViewProps) {
  return (
    <div style={{
      flex: '1 1 auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '1.25rem',
      padding: isMobile ? '1.5rem 1rem' : '2.5rem 2rem',
      textAlign: 'center',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: C.accentDim, border: `1px solid ${C.borderHi}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 30,
      }}>⏳</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxWidth: 360 }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: C.text }}>
          Дараагийн round-ыг хүлээж байна…
        </div>
        <div style={{ fontSize: '0.88rem', color: C.muted, lineHeight: 1.55 }}>
          Тоглолт {room.round} / {room.maxRounds} round-н дунд явагдаж байна. Дараагийн round-аас та хамт уралдах болно.
        </div>
      </div>
      <button
        onClick={onLeave}
        style={{
          background: 'transparent', color: C.muted,
          border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '0.6rem 1rem', fontSize: '0.88rem', fontWeight: 700,
          fontFamily: 'inherit', cursor: 'pointer',
        }}
      >Гарах</button>
    </div>
  );
}

// ── Waiting room ──────────────────────────────────────────────────────────
function WaitingRoom({
  isMobile, roomCode, room, userId, now, isHost,
  onToggleReady, onSetEvent, onSetMaxRounds, onStartRace,
}: RoomViewProps & { isHost: boolean }) {
  const members = Object.entries(room.members || {});
  const allReady = members.length > 0 && members.every(([, m]) => m.ready);
  const me = room.members?.[userId];

  return (
    <div className="mp-room-container" style={{
      width: '100%',
      maxWidth: isMobile ? '100%' : '720px',
      padding: isMobile ? '1rem' : '2rem',
      margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: '1rem',
    }}>
      <RoomCodeCard code={roomCode} />
      <SharePanel roomCode={roomCode} />

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <SectionLabel>Players ({members.length})</SectionLabel>
          <div style={{ fontSize: '0.7rem', color: C.muted }}>
            {getRoundName(room.round, room.maxRounds)} • {room.round} / {room.maxRounds}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {members.map(([uid, m]) => (
            <MemberRow
              key={uid}
              name={m.name}
              isHost={uid === room.host}
              isYou={uid === userId}
              status={getConnectionStatus(m, now)}
              right={
                m.ready ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: C.success, fontWeight: 700, fontSize: '0.78rem' }}>
                    <CheckIcon /> Ready
                  </span>
                ) : (
                  <span style={{ color: C.muted, fontSize: '0.78rem', fontWeight: 600 }}>Waiting…</span>
                )
              }
            />
          ))}
        </div>
      </Card>

      {isHost && (
        <Card>
          <SectionLabel>Race settings</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginTop: '0.5rem' }}>
            <Field label="Event">
              <select
                value={room.event}
                onChange={e => onSetEvent(e.target.value)}
                style={inputStyle}
              >
                {EVENTS.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </Field>
            <Field label="Rounds (1–4)">
              <select
                value={room.maxRounds}
                onChange={e => onSetMaxRounds(parseInt(e.target.value, 10))}
                style={inputStyle}
              >
                {[1, 2, 3, 4].map(n => (
                  <option key={n} value={n}>
                    {n} — {Array.from({ length: n }, (_, i) => getRoundName(i + 1, n)).join(' → ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ marginTop: '0.6rem', fontSize: '0.72rem', color: C.muted, lineHeight: 1.45 }}>
            Each round is 5 solves, ranked by Average of 5 (drop best + worst, WCA style).
          </div>
        </Card>
      )}

      <div className="mp-action-grid" style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : (isHost ? '1fr 1fr' : '1fr'),
        gap: '0.6rem',
        width: isMobile ? '100%' : 'auto',
      }}>
        <BigButton
          accent={!me?.ready}
          onClick={onToggleReady}
          style={isMobile ? { width: '100%' } : undefined}
        >
          {me?.ready ? 'Cancel Ready' : 'Ready'}
        </BigButton>
        {isHost && (
          <BigButton
            success
            disabled={!allReady}
            onClick={onStartRace}
            style={isMobile ? { width: '100%' } : undefined}
          >
            Start Race
          </BigButton>
        )}
      </div>
    </div>
  );
}

// ── Racing screen ─────────────────────────────────────────────────────────
function RacingScreen({
  isMobile, room, userId, prefs, now, onSubmitSolve, onOpenSettings, onPause,
  btState, btLiveState, btDeviceLabel, onBtConnect, onBtDisconnect, btSolveCallbacksRef,
}: RoomViewProps & { isHost: boolean }) {
  // Behaviour driven by user prefs (Settings modal). The shared timer
  // engine takes the commit callback and the user-configured hold-to-arm
  // threshold; inspection on/off and hold-to-start gating live in the
  // touch/space dispatch below, not the hook itself.
  const holdToStart = prefs.holdToStart;
  const inspectionEnabled = prefs.inspectionEnabled;
  const holdTimeMs = prefs.holdTimeMs;
  const me = room.members?.[userId];
  const myCurrent = me?.currentSolve ?? 0;
  const mySolves = useMemo(() => {
    const out: SolveData[] = [];
    for (let i = 0; i < SOLVES_PER_ROUND; i++) {
      const s = room.solves?.[userId]?.[String(i)];
      if (s) out.push(s);
    }
    return out;
  }, [room.solves, userId]);

  // Sync gating — single source of truth, applied identically on every
  // breakpoint via the shared `isWaitingForOpponents` flag below.
  //
  //   canProceed: myIndex <= minOpponent + 1  (1-ahead allowed)
  //   wait:      myIndex >  minOpponent + 1  (≥2-ahead → wait)
  //
  // Where myIndex = number of solves I have CONFIRMED (= members[me].currentSolve).
  //
  // Disconnected players are excluded from the sync calculation — they could
  // be reconnecting (idle) or fully gone, but either way the round must not
  // stall on them. If they reconnect mid-round they re-enter the gate at
  // their actual currentSolve, which may briefly stall faster racers (1-
  // ahead rule applies again immediately).
  const otherCurrents = useMemo(() => {
    return Object.entries(room.members || {})
      .filter(([uid, m]) => uid !== userId && getConnectionStatus(m, now) !== 'disconnected')
      .map(([, m]) => m.currentSolve);
  }, [room.members, userId, now]);
  const minOthers = otherCurrents.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...otherCurrents);
  const isWaitingForOpponents = otherCurrents.length > 0 && (myCurrent - minOthers) >= 2 && myCurrent < SOLVES_PER_ROUND;

  const isRoundDone = myCurrent >= SOLVES_PER_ROUND;
  const currentScramble = !isRoundDone ? (room.scrambles?.[String(myCurrent)] ?? '') : '';

  // Pending = awaiting OK / +2 / DNF confirmation.
  const [pending, setPending] = useState<{ ms: number; defaultDnf: boolean } | null>(null);

  // Scramble reveal — hidden until the user taps "Tap to reveal scramble".
  // Re-hides on every solve boundary so each solve starts fresh.
  const [scrambleShown, setScrambleShown] = useState(false);

  const onSolveCommit = useCallback((ms: number, dnf: boolean) => {
    setPending({ ms, defaultDnf: dnf });
  }, []);

  const timer = useTimer(onSolveCommit, holdTimeMs);

  // Timer can't fire until the player has revealed the scramble.
  const interactionLocked = isWaitingForOpponents || isRoundDone || !!pending || !scrambleShown;

  // Reset local + timer state at solve / round boundary.
  useEffect(() => {
    setPending(null);
    setScrambleShown(false);
    timer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCurrent, room.round]);

  // Bluetooth-driven solve flow — the page-level useGanTimer / useQiyiTimer
  // hooks own the connection; we expose handlers via btSolveCallbacksRef
  // that drive our local timer state machine. The smart timer reports
  // pads-off (start) and a final ms (stop); we ignore events fired while
  // the player is still locked out (waiting for opponents, round done,
  // pending confirmation, or scramble not yet revealed) so the device's
  // physical state can't bypass the UI gate.
  const btConnected = btState === 'connected';
  useEffect(() => {
    btSolveCallbacksRef.current = {
      onSolveStart: () => {
        if (interactionLocked) return;
        if (timer.state !== 'idle' && timer.state !== 'stopped') return;
        timer.startRunning();
      },
      onSolveStop: (ms) => {
        // Accept stop only if we believe the timer is running; otherwise
        // the device is reporting a stale event (e.g. ghost touch after
        // we already committed). Ignoring keeps onSolveCommit from
        // double-firing.
        if (timer.state !== 'running') return;
        timer.finishExternal(ms);
      },
      onIdle: () => {
        // Device reset — only matters if we haven't yet committed.
        if (timer.state === 'running') timer.reset();
      },
    };
    return () => { btSolveCallbacksRef.current = {}; };
  }, [btSolveCallbacksRef, interactionLocked, timer]);

  const confirmSolve = useCallback((penalty: Penalty) => {
    console.log('[mp] Penalty clicked', penalty, 'solveIndex:', myCurrent);
    if (!pending) {
      console.warn('[mp] confirmSolve ignored — no pending solve');
      return;
    }
    onSubmitSolve(myCurrent, pending.ms, penalty, currentScramble);
    setPending(null);
    // The myCurrent-change effect resets timer to idle.
  }, [pending, myCurrent, currentScramble, onSubmitSolve]);

  const onTimerTouchStart = useCallback(() => {
    // BT timer owns the start/stop transitions when connected — we
    // ignore touch so the player can't accidentally double-trigger.
    if (btConnected) return;
    if (interactionLocked) return;
    if (timer.state === 'running') { timer.stop(); return; }
    if (timer.state === 'idle' || timer.state === 'stopped') {
      if (inspectionEnabled) timer.beginInspection();
      else if (holdToStart) timer.startArming();
      else timer.startRunning();
      return;
    }
    if (timer.state === 'inspecting') {
      if (holdToStart) timer.startArming();
      else timer.startRunning();
    }
  }, [btConnected, interactionLocked, timer, inspectionEnabled, holdToStart]);

  const onTimerTouchEnd = useCallback(() => {
    if (btConnected) return;
    if (timer.state === 'armed') timer.fireRunning();
  }, [btConnected, timer]);

  // Keyboard — mirrors main timer. Auto-repeat guard via spaceHeldRef so
  // holding space doesn't repeatedly fire keydown on platforms that don't
  // expose the standalone repeat flag. When the BT timer is connected,
  // space is fully disabled so the device is the only input source.
  const spaceHeldRef = useRef(false);
  useEffect(() => {
    if (btConnected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (spaceHeldRef.current) return;
      spaceHeldRef.current = true;
      if (interactionLocked && timer.state !== 'running') return;
      if (timer.state === 'running') { timer.stop(); return; }
      if (timer.state === 'idle' || timer.state === 'stopped') {
        if (inspectionEnabled) timer.beginInspection();
        else if (holdToStart) timer.startArming();
        else timer.startRunning();
        return;
      }
      if (timer.state === 'inspecting') {
        if (holdToStart) timer.startArming();
        else timer.startRunning();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      spaceHeldRef.current = false;
      if (timer.state === 'armed') timer.fireRunning();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [btConnected, interactionLocked, timer, inspectionEnabled, holdToStart]);

  // Display values — precision pulled from prefs (2=cs, 3=ms).
  const p = prefs.precision;
  const armedZero = p === 3 ? '0.000' : '0.00';
  const displayValue = pending ? fmtMs(pending.ms, false, p)
    : timer.state === 'inspecting' ? Math.max(0, Math.ceil(timer.inspectionMs / 1000)).toString()
    : timer.state === 'armed' ? armedZero
    : fmtMs(timer.displayMs, false, p);

  // Color of the big timer. Mirrors solo timer's red→green arming
  // progression: red while held but not yet past holdTimeMs, green once
  // ready to release, white while running, then a 300ms green pulse on
  // stop. Pending OK/+2/DNF confirmation paints amber (unique to mp).
  const btConnectedForColor = btState === 'connected';
  const timerColor =
    pending ? C.warn
    : timer.state === 'armed'
        ? (timer.armedReady ? C.success : C.danger)
    : timer.state === 'inspecting'
        ? (timer.inspectionMs <= 0 ? C.danger
           : timer.inspectionMs <= 3000 ? C.warn
           : C.text)
    : btConnectedForColor && btLiveState === 'handsOn' ? C.danger
    : btConnectedForColor && btLiveState === 'getSet'  ? C.success
    : timer.state === 'stopped' && timer.stopFlashing ? C.success
    : C.text;

  const timerGlow =
    (timer.state === 'armed' && timer.armedReady) ||
    (timer.state === 'stopped' && timer.stopFlashing) ||
    (btConnectedForColor && btLiveState === 'getSet');

  const borderColor =
    pending ? C.warn
    : timer.state === 'armed'
        ? (timer.armedReady ? C.success : C.danger)
    : timer.state === 'running' ? C.accent
    : C.border;

  // ── Mobile / tablet layout: header + tabs + S1..S5 strip + bottom nav ─
  if (isMobile) {
    return (
      <MobileRacingLayout
        room={room}
        userId={userId}
        prefs={prefs}
        now={now}
        myCurrent={myCurrent}
        mySolves={mySolves}
        isRoundDone={isRoundDone}
        isWaitingForOpponents={isWaitingForOpponents}
        currentScramble={currentScramble}
        scrambleShown={scrambleShown}
        onRevealScramble={() => setScrambleShown(true)}
        timer={timer}
        pending={pending}
        displayValue={displayValue}
        timerColor={timerColor}
        timerGlow={timerGlow}
        borderColor={borderColor}
        interactionLocked={interactionLocked}
        confirmSolve={confirmSolve}
        onTimerTouchStart={onTimerTouchStart}
        onTimerTouchEnd={onTimerTouchEnd}
        onOpenSettings={onOpenSettings}
        onPause={onPause}
        btState={btState}
        btDeviceLabel={btDeviceLabel}
        onBtConnect={onBtConnect}
        onBtDisconnect={onBtDisconnect}
      />
    );
  }

  // ── Desktop layout ───────────────────────────────────────────────────
  return (
    <div className="mp-race-container" style={{
      flex: '1 1 auto', minHeight: 0, width: '100%',
      maxWidth: '1100px', margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: '0.85rem',
      padding: '0.5rem 1rem 1rem',
    }}>
      {/* Unified header: ⚙ ⌭ left, round info center, ⏸ right. Same icons as mobile. */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: '0.55rem 0.7rem',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center', gap: '0.7rem',
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <IconButton aria-label="Settings" title="Settings" onClick={onOpenSettings}>
            <SettingsIcon />
          </IconButton>
          <MpGanButton
            state={btState}
            onConnect={onBtConnect}
            onDisconnect={onBtDisconnect}
            size={34}
          />
          {btDeviceLabel && <BtConnectedBadge label={btDeviceLabel} />}
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
          minWidth: 0,
        }}>
          <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>
            {room.roundName || getRoundName(room.round, room.maxRounds)}
          </div>
          <div style={{ fontSize: '0.78rem', color: C.text, fontWeight: 700 }}>
            Solve {Math.min(myCurrent + 1, SOLVES_PER_ROUND)} of {SOLVES_PER_ROUND}
          </div>
        </div>
        <IconButton aria-label="Pause race" title="Pause" onClick={onPause}>
          <PauseIcon />
        </IconButton>
      </div>

      {isWaitingForOpponents && (
        <div style={{
          background: C.accentDim, border: `1px solid ${C.borderHi}`,
          borderRadius: 12, padding: '0.85rem 1rem', textAlign: 'center',
          color: C.accent, fontWeight: 700, fontSize: '0.92rem',
        }}>Waiting for opponents to catch up…</div>
      )}
      {isRoundDone && (
        <div style={{
          background: C.successDim, border: `1px solid ${C.success}`,
          borderRadius: 12, padding: '0.85rem 1rem', textAlign: 'center',
          color: C.success, fontWeight: 700, fontSize: '0.95rem',
        }}>You finished the round! Waiting for everyone else to finish…</div>
      )}

      <ScrambleArea
        isMobile={false}
        scramble={currentScramble}
        shown={scrambleShown}
        onReveal={() => setScrambleShown(true)}
        hidden={isRoundDone || isWaitingForOpponents}
        fontSizeDesktop={SCRAMBLE_FONT_PX[prefs.scrambleFontSize].desktop}
      />

      <div className="mp-race-grid" style={{
        display: 'grid', gridTemplateColumns: '2fr 1fr',
        gap: '0.85rem', minHeight: 0, flex: '1 1 auto',
      }}>
        <div
          onTouchStart={(e) => {
            if (interactionLocked) return;
            e.preventDefault();
            onTimerTouchStart();
          }}
          onTouchEnd={(e) => {
            if (interactionLocked) return;
            e.preventDefault();
            onTimerTouchEnd();
          }}
          style={{
            background: timer.state === 'armed' && timer.armedReady ? `${C.success}10` : C.card,
            border: `1px solid ${borderColor}`,
            borderRadius: 16, padding: '1rem',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none', cursor: interactionLocked ? 'default' : 'pointer',
            textAlign: 'center', touchAction: 'manipulation',
            transition: 'border-color 0.12s, background 0.12s',
          }}
        >
          {timer.state === 'inspecting' && (
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.warn, marginBottom: '0.6rem', fontWeight: 700 }}>
              Inspection
            </div>
          )}
          <div style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: getMpTimerFontSize(displayValue, false),
            fontWeight: 800, lineHeight: 0.95,
            fontVariantNumeric: 'tabular-nums',
            color: timerColor,
            textShadow: timerGlow ? `0 0 30px ${C.success}55` : 'none',
            transition: `color ${timer.state === 'stopped' ? 0.3 : 0.12}s, font-size 0.12s`,
          }}>{displayValue}</div>
          <div style={{ fontSize: '0.78rem', color: C.muted, marginTop: '0.85rem', letterSpacing: '0.04em', minHeight: '1.1rem' }}>
            {pending && 'Confirm your time'}
            {!pending && isRoundDone && 'Round complete'}
            {!pending && !isRoundDone && isWaitingForOpponents && 'Waiting for opponents…'}
            {!pending && !isRoundDone && !isWaitingForOpponents && !scrambleShown && 'Reveal the scramble first'}
            {!pending && !isRoundDone && !isWaitingForOpponents && scrambleShown && timer.state === 'idle' && 'Hold SPACE / press to arm'}
            {!pending && timer.state === 'inspecting' && 'Hold to arm, release to start'}
            {!pending && timer.state === 'armed' && !timer.armedReady && (
              <span style={{ color: C.danger, fontWeight: 700 }}>HOLD…</span>
            )}
            {!pending && timer.state === 'armed' && timer.armedReady && (
              <span style={{ color: C.success, fontWeight: 700 }}>RELEASE TO START</span>
            )}
            {!pending && timer.state === 'running' && 'Tap or press SPACE to stop'}
          </div>

          {pending && (
            <div
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{
                marginTop: '1.2rem',
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem',
                width: '100%', maxWidth: 360,
              }}
            >
              <ConfirmButton color={C.success} onClick={(e) => { e.stopPropagation(); confirmSolve('ok'); }}>OK</ConfirmButton>
              <ConfirmButton color={C.warn}    onClick={(e) => { e.stopPropagation(); confirmSolve('+2'); }}>+2</ConfirmButton>
              <ConfirmButton color={C.danger}  onClick={(e) => { e.stopPropagation(); confirmSolve('dnf'); }}>DNF</ConfirmButton>
            </div>
          )}
        </div>

        <OpponentsPanel room={room} userId={userId} now={now} />
      </div>

      <SolveAndCubeRow
        isMobile={false}
        mySolves={mySolves}
        current={myCurrent}
        isRoundDone={isRoundDone}
        eventId={room.event}
        scramble={currentScramble}
        scrambleShown={scrambleShown}
      />
    </div>
  );
}

// ── Mobile racing layout (header + flex-1 timer + S1..S5/cube row + tabs) ─
function MobileRacingLayout({
  room, userId, prefs, now, myCurrent, mySolves, isRoundDone, isWaitingForOpponents,
  currentScramble, scrambleShown, onRevealScramble,
  timer, pending, displayValue, timerColor, timerGlow, borderColor,
  interactionLocked, confirmSolve, onTimerTouchStart, onTimerTouchEnd,
  onOpenSettings, onPause,
  btState, btDeviceLabel, onBtConnect, onBtDisconnect,
}: {
  room: RoomData;
  userId: string;
  prefs: MpPrefs;
  now: number;
  myCurrent: number;
  mySolves: SolveData[];
  isRoundDone: boolean;
  isWaitingForOpponents: boolean;
  currentScramble: string;
  scrambleShown: boolean;
  onRevealScramble: () => void;
  timer: UseTimerReturn;
  pending: { ms: number; defaultDnf: boolean } | null;
  displayValue: string;
  timerColor: string;
  timerGlow: boolean;
  borderColor: string;
  interactionLocked: boolean;
  confirmSolve: (p: Penalty) => void;
  onTimerTouchStart: () => void;
  onTimerTouchEnd: () => void;
  onOpenSettings: () => void;
  onPause: () => void;
  btState: 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
  btDeviceLabel: string | null;
  onBtConnect: () => void;
  onBtDisconnect: () => void;
}) {
  const [tab, setTab] = useState<'timer' | 'opponents'>('timer');
  const roundLabel = room.roundName || getRoundName(room.round, room.maxRounds);
  void prefs;

  // Layout strategy: this container fills the parent (which is the page
  // wrapper locked to 100dvh + safe-area paddings + overflow:hidden). Inside,
  // a flex column distributes height; only the timer area takes flex:1, every
  // other section is flex-shrink:0. Bottom nav lives in normal flow.
  return (
    <div style={{
      flex: '1 1 auto', minHeight: 0, width: '100%',
      display: 'flex', flexDirection: 'column',
      background: C.bg,
      overflow: 'hidden',
    }}>
      {/* Header: ⚙ ⌭ left, ⏸ right. Subtle, low-contrast — doesn't distract. */}
      <header style={{
        flexShrink: 0,
        padding: '0.3rem 0.55rem',
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
          <IconButton aria-label="Settings" title="Settings" onClick={onOpenSettings}>
            <SettingsIcon />
          </IconButton>
          <MpGanButton
            state={btState}
            onConnect={onBtConnect}
            onDisconnect={onBtDisconnect}
            size={34}
          />
          {btDeviceLabel && <BtConnectedBadge label={btDeviceLabel} compact />}
        </div>
        <IconButton aria-label="Pause race" title="Pause" onClick={onPause}>
          <PauseIcon />
        </IconButton>
      </header>

      {/* Tab content area — flex: 1 so the timer fills all available space.
          overflow:hidden keeps any over-tall children clipped instead of
          pushing the layout past the viewport. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'timer' ? (
          <div style={{
            flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',
          }}>
            {/* Scramble (compact, top, muted via ScrambleArea styling) */}
            <div style={{ flexShrink: 0, padding: '0.4rem 0.55rem 0' }}>
              {(isRoundDone || isWaitingForOpponents) ? (
                <div style={{
                  background: isRoundDone ? C.successDim : C.accentDim,
                  border: `1px solid ${isRoundDone ? C.success : C.borderHi}`,
                  borderRadius: 12, padding: '0.6rem 0.85rem', textAlign: 'center',
                  color: isRoundDone ? C.success : C.accent, fontWeight: 700, fontSize: '0.82rem',
                }}>
                  {isRoundDone ? 'Round complete — waiting for the others…' : 'Waiting for opponents…'}
                </div>
              ) : (
                <ScrambleArea
                  isMobile={true}
                  scramble={currentScramble}
                  shown={scrambleShown}
                  onReveal={onRevealScramble}
                  fontSizeMobile={SCRAMBLE_FONT_PX[prefs.scrambleFontSize].mobile}
                />
              )}
            </div>

            {/* Big timer — flex: 1 fills ALL remaining space. Tap area = whole div. */}
            <div
              onTouchStart={(e) => {
                if (interactionLocked) return;
                e.preventDefault();
                onTimerTouchStart();
              }}
              onTouchEnd={(e) => {
                if (interactionLocked) return;
                e.preventDefault();
                onTimerTouchEnd();
              }}
              style={{
                flex: '1 1 0%', minHeight: 0,
                margin: '0.4rem 0.55rem',
                background: timer.state === 'armed' && timer.armedReady ? `${C.success}10` : 'transparent',
                border: `1px solid ${borderColor}`,
                borderRadius: 14, padding: '0.4rem',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                userSelect: 'none', cursor: interactionLocked ? 'default' : 'pointer',
                textAlign: 'center', touchAction: 'manipulation',
                transition: 'border-color 0.12s, background 0.12s',
                overflow: 'hidden',
              }}
            >
              {timer.state === 'inspecting' && (
                <div style={{
                  fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase',
                  color: C.warn, marginBottom: '0.4rem', fontWeight: 700,
                }}>Inspection</div>
              )}
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                // Floor dropped from 5rem → 3rem so small phones can shrink the
                // text instead of pushing the layout past the viewport.
                // getMpTimerFontSize additionally scales for multi-digit
                // minute strings ("11:23.456") so they fit on narrow widths.
                fontSize: getMpTimerFontSize(displayValue, true),
                fontWeight: 800, lineHeight: 0.95,
                fontVariantNumeric: 'tabular-nums',
                color: timerColor,
                textShadow: timerGlow ? `0 0 30px ${C.success}55` : 'none',
                transition: `color ${timer.state === 'stopped' ? 0.3 : 0.12}s, font-size 0.12s`,
              }}>{displayValue}</div>
              <div style={{
                fontSize: '0.7rem', color: C.muted,
                marginTop: '0.35rem', letterSpacing: '0.04em', minHeight: '0.9rem',
              }}>
                {pending && 'Confirm your time'}
                {!pending && isRoundDone && 'Round complete'}
                {!pending && !isRoundDone && isWaitingForOpponents && 'Waiting for opponents…'}
                {!pending && !isRoundDone && !isWaitingForOpponents && !scrambleShown && 'Reveal the scramble first'}
                {!pending && !isRoundDone && !isWaitingForOpponents && scrambleShown && timer.state === 'idle' && 'Hold to arm, release to start'}
                {!pending && timer.state === 'inspecting' && 'Hold to arm, release to start'}
                {!pending && timer.state === 'armed' && !timer.armedReady && (
                  <span style={{ color: C.danger, fontWeight: 700 }}>HOLD…</span>
                )}
                {!pending && timer.state === 'armed' && timer.armedReady && (
                  <span style={{ color: C.success, fontWeight: 700 }}>RELEASE TO START</span>
                )}
                {!pending && timer.state === 'running' && 'Tap to stop'}
              </div>

              {pending && (
                <div
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  style={{
                    marginTop: '1rem',
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem',
                    width: '100%', maxWidth: 360,
                    position: 'relative', zIndex: 2,
                  }}
                >
                  <ConfirmButton color={C.success} onClick={(e) => { e.stopPropagation(); console.log('[mp] OK clicked'); confirmSolve('ok'); }}>OK</ConfirmButton>
                  <ConfirmButton color={C.warn}    onClick={(e) => { e.stopPropagation(); console.log('[mp] +2 clicked'); confirmSolve('+2'); }}>+2</ConfirmButton>
                  <ConfirmButton color={C.danger}  onClick={(e) => { e.stopPropagation(); console.log('[mp] DNF clicked'); confirmSolve('dnf'); }}>DNF</ConfirmButton>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0.7rem' }}>
            <OpponentsPanel room={room} userId={userId} now={now} />
          </div>
        )}
      </div>

      {/* S1..S5 + cube viz row, persistent above the tab bar. No bottom
          padding — flush against the nav so there's no empty band. */}
      <div style={{ padding: '0.35rem 0.55rem 0', flexShrink: 0 }}>
        <SolveAndCubeRow
          isMobile={true}
          mySolves={mySolves}
          current={myCurrent}
          isRoundDone={isRoundDone}
          eventId={room.event}
          scramble={currentScramble}
          scrambleShown={scrambleShown}
          roundLabel={roundLabel}
        />
      </div>

      {/* Bottom 2-tab nav — flex-shrink:0 in normal flow. Safe-area is
          handled by the page wrapper, so no extra paddingBottom here. */}
      <nav style={{
        flexShrink: 0,
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        background: 'rgba(20, 20, 20, 0.78)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
        borderTop: `1px solid ${C.border}`,
      }}>
        <RaceTabButton active={tab === 'timer'} onClick={() => setTab('timer')} icon={<StopwatchIcon />} label="Timer" />
        <RaceTabButton active={tab === 'opponents'} onClick={() => setTab('opponents')} icon={<UsersIcon />} label="Opponents" />
      </nav>

      <style>{`
        @keyframes mp-pulse {
          0%, 100%   { opacity: 1; box-shadow: 0 0 0 0 rgba(167, 139, 250, 0); }
          50%        { opacity: 0.7; box-shadow: 0 0 14px 0 rgba(167, 139, 250, 0.55); }
        }
        .mp-solve-current { animation: mp-pulse 1.2s ease-in-out infinite; }
        @keyframes mp-ble-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        @keyframes mp-bt-dot-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.55); }
          50%      { box-shadow: 0 0 0 5px rgba(52,211,153,0); }
        }
      `}</style>
    </div>
  );
}

// ── Tiny icons + tab button used by the mobile racing screen ─────────────
function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StopwatchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="2" x2="14" y2="2" />
      <circle cx="12" cy="14" r="8" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="14" x2="15" y2="16" />
    </svg>
  );
}

function SettingsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function IconButton({
  onClick, children, ...rest
}: {
  onClick: () => void;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'style' | 'children'>) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 34, height: 34, borderRadius: 8,
        background: 'transparent', color: C.muted,
        border: `1px solid ${C.border}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = C.text;
        e.currentTarget.style.borderColor = C.borderHi;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = C.muted;
        e.currentTarget.style.borderColor = C.border;
      }}
      {...rest}
    >{children}</button>
  );
}

function IconBluetooth({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7l10 10-5 5V2l5 5L7 17" />
    </svg>
  );
}

// Mirrors the solo-timer GanButton (app/timer/page.tsx). Duplicated rather
// than imported because the solo page doesn't export it and we'd rather
// not refactor the solo timer for this. States: idle / connecting /
// connected / error / unsupported. Click toggles connect/disconnect; on
// unsupported we show the iOS / browser message via window.alert.
function MpGanButton({
  state, onConnect, onDisconnect, size = 34, iconSize = 16,
}: {
  state: 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
  onConnect: () => void;
  onDisconnect: () => void;
  size?: number;
  iconSize?: number;
}) {
  const isConnected = state === 'connected';
  const isConnecting = state === 'connecting';
  const isUnsupported = state === 'unsupported';
  const color = isConnected ? C.success
    : isConnecting ? C.accent
    : isUnsupported ? C.mutedDim
    : C.muted;
  const title = isUnsupported ? 'Web Bluetooth not supported in this browser'
    : isConnecting ? 'Connecting…'
    : isConnected ? 'Smart timer connected — tap to disconnect'
    : 'Connect smart timer';
  return (
    <button
      onClick={() => {
        if (isUnsupported) {
          const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
          // eslint-disable-next-line no-alert
          alert(isIOS
            ? "iOS browsers don't support Web Bluetooth. Install Bluefy from the App Store and open this site in Bluefy to use a smart timer."
            : 'Web Bluetooth is required for smart-timer support. Use Chrome or Edge over HTTPS / localhost.');
          return;
        }
        if (isConnected) onDisconnect();
        else if (!isConnecting) onConnect();
      }}
      aria-label={title}
      title={title}
      style={{
        width: size, height: size, borderRadius: 8,
        background: isConnected ? 'rgba(52,211,153,0.12)'
          : isConnecting ? C.accentDim
          : 'transparent',
        border: `1px solid ${
          isConnected ? 'rgba(52,211,153,0.4)'
          : isConnecting ? C.borderHi
          : C.border
        }`,
        color, cursor: isUnsupported ? 'help' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        animation: isConnecting ? 'mp-ble-pulse 1.1s ease-in-out infinite' : undefined,
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        fontFamily: 'inherit', flexShrink: 0,
      }}
    ><IconBluetooth size={iconSize} /></button>
  );
}

// Compact pill rendered next to MpGanButton in the racing header.
// Strips "Timer" off the device label so it stays narrow on phones —
// "GAN Timer" → "GAN", "QiYi Timer" → "QiYi". Lavender accent so the
// pulse green dot stays the connection cue and the pill itself doesn't
// fight the existing solve-progress text in the header.
function BtConnectedBadge({ label, compact }: { label: string; compact?: boolean }) {
  const short = label.replace(/\s*Timer\s*$/i, '');
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      padding: compact ? '0.18rem 0.45rem' : '0.22rem 0.55rem',
      borderRadius: 999,
      background: C.accentDim,
      border: `1px solid ${C.borderHi}`,
      fontSize: compact ? '0.62rem' : '0.66rem',
      fontWeight: 700, color: C.accent, letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: C.success,
        animation: 'mp-bt-dot-pulse 1.4s ease-in-out infinite',
        flexShrink: 0,
      }} />
      <span>{short}</span>
    </span>
  );
}

function UsersIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function RaceTabButton({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none',
        color: active ? C.accent : C.muted,
        fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 700,
        letterSpacing: '0.04em',
        padding: '0.4rem 0.4rem 0.45rem',
        display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
        cursor: 'pointer',
        borderTop: `2px solid ${active ? C.accent : 'transparent'}`,
        transition: 'color 0.12s, border-color 0.12s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Shared scramble + solve+cube row (used on desktop AND mobile) ────────
// Behaviour is identical at every breakpoint; only sizes differ.

function ScrambleArea({
  isMobile, scramble, shown, onReveal, hidden,
  fontSizeMobile, fontSizeDesktop,
}: {
  isMobile: boolean;
  scramble: string;
  shown: boolean;
  onReveal: () => void;
  // Optionally suppress the whole component (e.g. round done / waiting banners).
  hidden?: boolean;
  // Pref-driven size overrides; default to medium.
  fontSizeMobile?: string;
  fontSizeDesktop?: string;
}) {
  if (hidden) return null;
  const fontSize = isMobile
    ? (fontSizeMobile ?? '0.92rem')
    : (fontSizeDesktop ?? '1.15rem');
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: isMobile ? '0.4rem 0.55rem' : '0.7rem 0.9rem',
      minHeight: isMobile ? 38 : 64,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {shown ? (
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize,
          color: C.muted,
          lineHeight: isMobile ? 1.35 : 1.5,
          letterSpacing: '0.04em',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'center',
          width: '100%',
        }}>{scramble}</div>
      ) : (
        <button
          onClick={onReveal}
          type="button"
          style={{
            background: C.accentDim, color: C.accent,
            border: `1px solid ${C.borderHi}`, borderRadius: 10,
            padding: isMobile ? '0.35rem 0.85rem' : '0.6rem 1.2rem',
            fontSize: isMobile ? '0.8rem' : '0.92rem',
            fontWeight: 700, fontFamily: 'inherit',
            cursor: 'pointer', letterSpacing: '0.02em',
          }}
        >Tap to reveal scramble</button>
      )}
    </div>
  );
}

// Single horizontal row: 5 solve chips on the left, cube viz cell on the
// right. The cube viz also respects scrambleShown so the visualisation
// doesn't leak the scramble before reveal.
function SolveAndCubeRow({
  isMobile, mySolves, current, isRoundDone, eventId, scramble, scrambleShown, roundLabel,
}: {
  isMobile: boolean;
  mySolves: SolveData[];
  current: number;
  isRoundDone: boolean;
  eventId: string;
  scramble: string;
  scrambleShown: boolean;
  roundLabel?: string;
}) {
  // Mobile cube shrunk 120 → 92px; the row was the single biggest fixed block
  // in the mobile layout. Desktop keeps its original size.
  const cubeSize = isMobile ? 92 : 160;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: isMobile ? '0.4rem 0.5rem' : '0.75rem 0.9rem',
      display: 'flex', flexDirection: 'column', gap: isMobile ? '0.25rem' : '0.4rem',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `minmax(0, 1fr) ${cubeSize}px`,
        gap: isMobile ? '0.4rem' : '0.85rem',
        alignItems: 'center',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: isMobile ? '0.25rem' : '0.45rem',
          minWidth: 0,
        }}>
          {Array.from({ length: SOLVES_PER_ROUND }, (_, i) => {
            const s = mySolves[i];
            const isCurrent = i === current && !isRoundDone;
            const dnf = s?.penalty === 'dnf';
            return (
              <div
                key={i}
                className={isCurrent ? 'mp-solve-current' : undefined}
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: isMobile ? '0.74rem' : '0.92rem', fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'center',
                  padding: isMobile ? '0.3rem 0.15rem' : '0.55rem 0.3rem',
                  background: s ? C.cardAlt : 'transparent',
                  border: `1px solid ${isCurrent ? C.accent : C.border}`,
                  borderRadius: 999,
                  color: isCurrent && !s ? C.accent
                    : !s ? C.mutedDim
                    : dnf ? C.danger : C.text,
                  letterSpacing: dnf ? '0.04em' : '0',
                  minHeight: isMobile ? 28 : 44,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {isCurrent && !s ? '●' : !s ? '—' : dnf ? 'DNF' : fmtMs(effectiveSolveMs(s), false, 2)}
              </div>
            );
          })}
        </div>
        <div style={{
          width: cubeSize, height: cubeSize,
          background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: isMobile ? 2 : 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          {scrambleShown && !isRoundDone ? (
            <CubeViewer eventId={eventId} scramble={scramble} />
          ) : (
            <div style={{
              fontSize: '0.58rem', letterSpacing: '0.12em', textTransform: 'uppercase',
              color: C.mutedDim, fontWeight: 700, textAlign: 'center',
            }}>{isRoundDone ? '—' : 'Hidden'}</div>
          )}
        </div>
      </div>
      {roundLabel && (
        <div style={{
          fontSize: isMobile ? '0.55rem' : '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase',
          color: C.mutedDim, fontWeight: 700, textAlign: 'center',
        }}>
          {roundLabel} · Ao5
        </div>
      )}
      {/* Inline keyframes — pill-shape current chip pulses with a purple glow.
          Same animation also referenced from MobileRacingLayout's <style>.
          mp-ble-pulse / mp-bt-dot-pulse drive the smart-timer button and
          connection indicator; defined here so they're available on both
          mobile and desktop layouts. */}
      <style>{`
        @keyframes mp-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0); }
          50%      { box-shadow: 0 0 14px 0 rgba(167, 139, 250, 0.55); }
        }
        .mp-solve-current { animation: mp-pulse 1.2s ease-in-out infinite; }
        @keyframes mp-ble-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        @keyframes mp-bt-dot-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.55); }
          50%      { box-shadow: 0 0 0 5px rgba(52,211,153,0); }
        }
      `}</style>
    </div>
  );
}

function ConfirmButton({
  color, onClick, children,
}: {
  color: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: color, color: '#0a0a0a',
        border: `1px solid ${color}`, borderRadius: 12,
        padding: '0.7rem 0.85rem', fontSize: '1rem', fontWeight: 800,
        fontFamily: 'inherit', cursor: 'pointer',
        letterSpacing: '0.02em',
      }}
    >{children}</button>
  );
}

// ── OpponentsPanel ───────────────────────────────────────────────────────
function OpponentsPanel({
  room, userId, now, onClose,
}: {
  room: RoomData; userId: string; now: number; onClose?: () => void;
}) {
  const rows = useMemo(() => {
    const list = Object.entries(room.members || {}).map(([uid, m]) => {
      const solves: (SolveData | null)[] = [];
      for (let i = 0; i < SOLVES_PER_ROUND; i++) {
        solves.push(room.solves?.[uid]?.[String(i)] ?? null);
      }
      // Running average: for now just show the WCA Ao5 if all 5 done; else show
      // current mean of finished solves (excluding DNFs unless ≥2).
      let runningAvg: number | null = null;
      let runningDnf = false;
      if (solves.every(s => s != null)) {
        const all = solves.filter(Boolean) as SolveData[];
        const ao5 = computeAo5(all);
        runningAvg = ao5;
        runningDnf = ao5 == null;
      } else {
        const done = solves.filter(Boolean) as SolveData[];
        if (done.length > 0) {
          const dnfs = done.filter(s => s.penalty === 'dnf').length;
          if (dnfs < done.length) {
            const sum = done
              .filter(s => s.penalty !== 'dnf')
              .reduce((acc, s) => acc + (s.penalty === '+2' ? s.time + 2000 : s.time), 0);
            const cnt = done.filter(s => s.penalty !== 'dnf').length;
            runningAvg = cnt > 0 ? sum / cnt : null;
          }
        }
      }
      return {
        uid, name: m.name,
        currentSolve: m.currentSolve,
        solves, runningAvg, runningDnf,
        status: getConnectionStatus(m, now),
      };
    });
    // Sort: you first, then by progress desc, then alphabetical.
    list.sort((a, b) => {
      if (a.uid === userId && b.uid !== userId) return -1;
      if (b.uid === userId && a.uid !== userId) return 1;
      if (a.currentSolve !== b.currentSolve) return b.currentSolve - a.currentSolve;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [room.members, room.solves, userId, now]);

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '0.7rem',
      display: 'flex', flexDirection: 'column', gap: '0.45rem',
      minHeight: 0, overflow: 'auto',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.1rem 0.3rem 0.4rem',
      }}>
        <div style={{
          fontSize: '0.62rem', letterSpacing: '0.12em',
          textTransform: 'uppercase', color: C.muted, fontWeight: 700,
        }}>
          Opponents
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', color: C.muted,
              border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '0.15rem 0.5rem', fontSize: '0.85rem',
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >×</button>
        )}
      </div>
      {rows.map(r => {
        const isYou = r.uid === userId;
        return (
          <div key={r.uid} style={{
            background: isYou ? C.accentDim : C.cardAlt,
            border: `1px solid ${isYou ? C.borderHi : 'transparent'}`,
            borderRadius: 10, padding: '0.5rem 0.6rem',
            display: 'flex', flexDirection: 'column', gap: '0.4rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
              <div style={{
                fontSize: '0.85rem', fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                minWidth: 0,
              }}>
                <StatusDot status={r.status} size={7} />
                {r.uid === room.host && <HostBadge size={12} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.name}{isYou ? ' (you)' : ''}
                </span>
              </div>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', fontWeight: 700,
                color: r.runningDnf ? C.danger : (r.runningAvg != null ? C.success : C.muted),
                fontVariantNumeric: 'tabular-nums',
              }}>
                {r.runningDnf ? 'DNF' : r.runningAvg != null ? `Ao: ${fmtMs(r.runningAvg, false, 2)}` : `S${r.currentSolve + 1}/${SOLVES_PER_ROUND}`}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.25rem' }}>
              {r.solves.map((s, i) => {
                const isCurrent = i === r.currentSolve;
                const empty = !s;
                const isDisconnected = r.status === 'disconnected';
                return (
                  <div
                    key={i}
                    title={empty && isDisconnected ? 'Waiting — player is disconnected' : undefined}
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.7rem', fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      padding: '0.25rem 0.2rem',
                      background: s ? '#0a0a0a' : 'transparent',
                      border: `1px solid ${isCurrent && empty && !isDisconnected ? C.accent : C.border}`,
                      borderRadius: 6, textAlign: 'center',
                      color: empty
                        ? (isDisconnected ? C.warn : isCurrent ? C.accent : C.mutedDim)
                        : s.penalty === 'dnf' ? C.danger : C.text,
                    }}
                  >
                    {empty
                      ? (isDisconnected ? '⋯' : isCurrent ? '●' : '—')
                      : s.penalty === 'dnf' ? 'DNF' : fmtMs(effectiveSolveMs(s), false, 2)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Modals: Settings / Pause / Exit-confirm ───────────────────────────────

function ModalShell({
  isMobile, title, onClose, children, maxWidth = 480,
}: {
  isMobile: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? '100%' : `min(${maxWidth}px, 100%)`,
          background: C.card, border: `1px solid ${C.border}`,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          borderBottomLeftRadius: isMobile ? 0 : 16, borderBottomRightRadius: isMobile ? 0 : 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
          display: 'flex', flexDirection: 'column',
          maxHeight: isMobile ? '90dvh' : '85dvh',
          paddingBottom: 'env(safe-area-inset-bottom)',
          overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><CloseIcon size={14} /></button>
        </header>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0.95rem 1rem' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function MpSettingsRow({
  label, hint, control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto',
      alignItems: 'center', gap: '0.85rem',
      padding: '0.6rem 0',
      borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: C.text }}>{label}</div>
        {hint && <div style={{ fontSize: '0.72rem', color: C.muted, marginTop: '0.15rem', lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div>{control}</div>
    </div>
  );
}

function MpToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        width: 44, height: 26, borderRadius: 999,
        background: checked ? C.accent : C.cardAlt,
        border: `1px solid ${checked ? C.accent : C.border}`,
        position: 'relative', cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2, left: checked ? 20 : 2,
        width: 20, height: 20, borderRadius: 999,
        background: checked ? '#0a0a0a' : C.muted,
        transition: 'left 0.15s, background 0.15s',
      }} />
    </button>
  );
}

function MpSelect<T extends string | number>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const opt = options.find(o => String(o.value) === raw);
        if (opt) onChange(opt.value);
      }}
      style={{
        background: C.cardAlt, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '0.4rem 0.6rem', fontSize: '0.85rem',
        fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

function MpSettingsModal({
  isMobile, prefs, onChange, onClose,
  timerBrand, onTimerBrandChange,
  btState, btDeviceLabel, onBtConnect, onBtDisconnect,
}: {
  isMobile: boolean;
  prefs: MpPrefs;
  onChange: (patch: Partial<MpPrefs>) => void;
  onClose: () => void;
  timerBrand: TimerBrand;
  onTimerBrandChange: (b: TimerBrand) => void;
  btState: 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
  btDeviceLabel: string | null;
  onBtConnect: () => void;
  onBtDisconnect: () => void;
}) {
  const isConnected = btState === 'connected';
  const isConnecting = btState === 'connecting';
  const isUnsupported = btState === 'unsupported';
  return (
    <ModalShell isMobile={isMobile} title="Settings" onClose={onClose}>
      <div style={{
        fontSize: '0.66rem', letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.muted, fontWeight: 700,
        marginBottom: '0.5rem',
      }}>Timer</div>

      <MpSettingsRow
        label="Inspection time"
        hint="WCA-style 15s inspection countdown before each solve."
        control={<MpToggle checked={prefs.inspectionEnabled} onChange={(v) => onChange({ inspectionEnabled: v })} />}
      />
      <MpSettingsRow
        label="Hold to start"
        hint="Hold space / press to arm the timer; release after the hold time to start. WCA Stackmat default is 0.55s."
        control={<MpToggle checked={prefs.holdToStart} onChange={(v) => onChange({ holdToStart: v })} />}
      />
      {prefs.holdToStart && (
        <MpSettingsRow
          label="Hold time"
          hint={`${(prefs.holdTimeMs / 1000).toFixed(2)}s — how long you must hold before the timer arms. Shared with /timer.`}
          control={
            <MpSelect<number>
              value={prefs.holdTimeMs}
              options={[
                { value: 300, label: '0.30s' },
                { value: 400, label: '0.40s' },
                { value: 550, label: '0.55s (WCA)' },
                { value: 700, label: '0.70s' },
                { value: 1000, label: '1.00s' },
              ]}
              onChange={(v) => onChange({ holdTimeMs: v })}
            />
          }
        />
      )}
      <MpSettingsRow
        label="Precision"
        control={
          <MpSelect<2 | 3>
            value={prefs.precision}
            options={[
              { value: 2, label: 'Centiseconds (0.00)' },
              { value: 3, label: 'Milliseconds (0.000)' },
            ]}
            onChange={(v) => onChange({ precision: v })}
          />
        }
      />
      <MpSettingsRow
        label="Scramble font size"
        control={
          <MpSelect<MpPrefs['scrambleFontSize']>
            value={prefs.scrambleFontSize}
            options={[
              { value: 'sm', label: 'Small' },
              { value: 'md', label: 'Medium' },
              { value: 'lg', label: 'Large' },
            ]}
            onChange={(v) => onChange({ scrambleFontSize: v })}
          />
        }
      />

      <div style={{
        fontSize: '0.66rem', letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.muted, fontWeight: 700,
        margin: '1.1rem 0 0.5rem',
      }}>Цахим цаг (Smart timer)</div>
      <div style={{
        background: C.cardAlt, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '0.75rem 0.85rem',
        display: 'flex', flexDirection: 'column', gap: '0.7rem',
      }}>
        {/* Brand toggle — disabled while a connection is live so we can't
            silently drop the user's active device behind their back. They
            must disconnect first to switch brands. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: '0.4rem', padding: '0.2rem',
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 10,
        }}>
          {(['gan', 'qiyi'] as const).map(b => {
            const active = timerBrand === b;
            const label = b === 'gan' ? 'GAN' : 'QiYi';
            return (
              <button
                key={b}
                type="button"
                disabled={isConnected || isConnecting}
                onClick={() => onTimerBrandChange(b)}
                style={{
                  background: active ? C.accent : 'transparent',
                  color: active ? '#0a0a0a' : (isConnected || isConnecting) ? C.mutedDim : C.text,
                  border: 'none', borderRadius: 8,
                  padding: '0.5rem 0.4rem', fontSize: '0.85rem',
                  fontFamily: 'inherit', fontWeight: 700,
                  cursor: (isConnected || isConnecting) ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.02em',
                }}
              >{label}</button>
            );
          })}
        </div>

        {/* Status line — green pill when connected, muted otherwise. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.45rem',
          fontSize: '0.78rem', color: isConnected ? C.success : C.muted,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isConnected ? C.success
              : isConnecting ? C.accent
              : C.mutedDim,
          }} />
          <span style={{ fontWeight: 700 }}>
            {isConnected ? (btDeviceLabel ?? 'Холбогдсон')
              : isConnecting ? 'Холбогдож байна…'
              : isUnsupported ? 'Web Bluetooth дэмжихгүй'
              : 'Холболт идэвхгүй'}
          </span>
        </div>

        {/* Connect / Disconnect — single button that flips role based
            on state. iOS/unsupported case routes to the Bluefy hint via
            the same alert MpGanButton uses. */}
        <button
          type="button"
          onClick={() => {
            if (isUnsupported) {
              const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
              // eslint-disable-next-line no-alert
              alert(isIOS
                ? "iOS browsers don't support Web Bluetooth. Install Bluefy from the App Store and open this site in Bluefy to use a smart timer."
                : 'Web Bluetooth is required for smart-timer support. Use Chrome or Edge over HTTPS / localhost.');
              return;
            }
            if (isConnected) onBtDisconnect();
            else if (!isConnecting) onBtConnect();
          }}
          disabled={isConnecting}
          style={{
            background: isConnected ? 'rgba(239,68,68,0.12)'
              : isUnsupported ? 'transparent'
              : C.accent,
            color: isConnected ? C.danger
              : isUnsupported ? C.mutedDim
              : '#0a0a0a',
            border: `1px solid ${
              isConnected ? 'rgba(239,68,68,0.35)'
              : isUnsupported ? C.border
              : C.accent
            }`,
            borderRadius: 10, padding: '0.65rem 0.8rem',
            fontSize: '0.88rem', fontWeight: 800,
            fontFamily: 'inherit',
            cursor: isConnecting ? 'wait' : isUnsupported ? 'help' : 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          {isConnecting ? 'Холбогдож байна…'
            : isConnected ? 'Холболт салгах'
            : `Холбох (${timerBrand === 'gan' ? 'GAN' : 'QiYi'})`}
        </button>

        <div style={{ fontSize: '0.7rem', color: C.muted, lineHeight: 1.45 }}>
          Холбогдсон үед цаг таны smart timer-аас автоматаар тоологдоно. Space болон touch түр идэвхгүй болно.
        </div>
      </div>
    </ModalShell>
  );
}

function MpPauseModal({
  isMobile, onResume, onLeaveTemporarily, onExit,
}: {
  isMobile: boolean;
  onResume: () => void;
  onLeaveTemporarily: () => void;
  onExit: () => void;
}) {
  return (
    <ModalShell isMobile={isMobile} title="Race Paused" onClose={onResume} maxWidth={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <button
          onClick={onResume}
          style={{
            background: C.success, color: '#0a0a0a',
            border: `1px solid ${C.success}`, borderRadius: 12,
            padding: '0.95rem 1rem', fontSize: '1rem', fontWeight: 800,
            fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.02em',
          }}
        >Resume Race</button>
        <button
          onClick={onLeaveTemporarily}
          style={{
            background: 'transparent', color: C.warn,
            border: `1px solid ${C.warn}`, borderRadius: 12,
            padding: '0.95rem 1rem', fontSize: '1rem', fontWeight: 700,
            fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.02em',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
          }}
        >
          <span>Leave Temporarily</span>
          <span style={{ fontSize: '0.7rem', color: C.muted, fontWeight: 500 }}>You can rejoin from /timer</span>
        </button>
        <button
          onClick={onExit}
          style={{
            background: 'transparent', color: C.danger,
            border: `1px solid ${C.danger}`, borderRadius: 12,
            padding: '0.95rem 1rem', fontSize: '1rem', fontWeight: 700,
            fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.02em',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
          }}
        >
          <span>Exit Race</span>
          <span style={{ fontSize: '0.7rem', color: C.muted, fontWeight: 500 }}>Permanent — your slot is removed</span>
        </button>
      </div>
    </ModalShell>
  );
}

// Context-aware leave confirmation. Same shell, different copy/colours per
// kind — pulled from one place so wording stays consistent across TopBar,
// Pause modal, and the Results-screen Leave button.
function MpLeaveConfirmModal({
  isMobile, kind, nextHostName, onCancel, onConfirm,
}: {
  isMobile: boolean;
  kind: Exclude<LeaveKind, 'immediate'>;
  nextHostName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const config = (() => {
    switch (kind) {
      case 'active':
        return {
          title: 'Гарах уу?',
          body: 'Round дуусаагүй байна. Гарвал үлдсэн solve-ууд DNF болно.',
          confirmLabel: 'Гарах',
          danger: true,
        };
      case 'host':
        return {
          title: 'Host эрх шилжүүлэх',
          body: `Гарвал host эрх ${nextHostName || 'дараагийн тоглогч'}-д шилжинэ.`,
          confirmLabel: 'Гарах',
          danger: false,
        };
      case 'last':
        return {
          title: 'Room хаах',
          body: 'Та сүүлчийн хүн байна. Гарвал room устгагдана.',
          confirmLabel: 'Room хаах',
          danger: true,
        };
    }
  })();

  return (
    <ModalShell isMobile={isMobile} title={config.title} onClose={onCancel} maxWidth={360}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ fontSize: '0.92rem', color: C.text, lineHeight: 1.55 }}>
          {config.body}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <button
            onClick={onCancel}
            autoFocus
            style={{
              background: 'transparent', color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '0.75rem 0.85rem', fontSize: '0.95rem',
              fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
            }}
          >Үргэлжлүүлэх</button>
          <button
            onClick={onConfirm}
            style={{
              background: config.danger ? C.danger : 'transparent',
              color: config.danger ? '#fff' : C.text,
              border: `1px solid ${config.danger ? C.danger : C.border}`,
              borderRadius: 10,
              padding: '0.75rem 0.85rem', fontSize: '0.95rem',
              fontFamily: 'inherit', cursor: 'pointer', fontWeight: 800,
            }}
          >{config.confirmLabel}</button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Results ───────────────────────────────────────────────────────────────
function ResultsScreen({
  isMobile, room, userId, now, isHost,
  onReadyForNext, onNextRound, onPlayAgain, onLeave,
}: RoomViewProps & { isHost: boolean }) {
  const ranked = useMemo(() => rankByRoundAverageWithSolves(room.members, room.solves), [room.members, room.solves]);
  const cumulative = useMemo(() => {
    return Object.entries(room.members || {})
      .map(([uid, m]) => ({ uid, name: m.name, points: m.totalPoints ?? 0 }))
      .sort((a, b) => b.points - a.points);
  }, [room.members]);

  const me = room.members?.[userId];
  const isFinalRound = room.round >= room.maxRounds;
  const everyoneReady = Object.values(room.members || {}).every(m => m.ready);
  const roundName = room.roundName || getRoundName(room.round, room.maxRounds);

  // Champion (final mode) — highest cumulative points, ties go to first.
  const champion = cumulative[0];

  // ── Final-round path (champion + Play Again) — UNCHANGED from prior turn ──
  if (isFinalRound) {
    return (
      <div className="mp-room-container mp-results-container" style={{
        width: '100%',
        maxWidth: isMobile ? '100%' : '720px',
        padding: isMobile ? '0.5rem' : '2rem',
        margin: '0 auto',
        display: 'flex', flexDirection: 'column', gap: '1rem',
      }}>
        {champion && (
          <div style={{
            background: `linear-gradient(135deg, ${C.accentDim}, ${C.successDim})`,
            border: `1px solid ${C.borderHi}`, borderRadius: 14,
            padding: '1rem', textAlign: 'center',
            display: 'flex', flexDirection: 'column', gap: '0.4rem',
          }}>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>
              🏆 Champion
            </div>
            <div className="mp-champion-name" style={{
              fontSize: 'clamp(1.6rem, 5vw, 2.4rem)', fontWeight: 800,
              color: C.success, letterSpacing: '-0.01em',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: '0.5rem',
            }}>
              {champion.uid === room.host && <HostBadge size={22} />}
              <span>{champion.name}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: C.muted }}>
              {champion.points} point{champion.points === 1 ? '' : 's'}
            </div>
          </div>
        )}
        <Card>
          <SectionLabel>{roundName} results</SectionLabel>
          <table style={tableStyle}>
            <thead>
              <tr><Th>Rank</Th><Th>Name</Th><Th align="right">Avg</Th><Th align="right">Pts</Th></tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.uid} style={{ background: r.uid === userId ? C.accentDim : 'transparent' }}>
                  <Td><span style={{ color: i === 0 ? C.success : i < 3 ? C.accent : C.text, fontWeight: 700 }}>{r.dnf ? '—' : i + 1}</span></Td>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <StatusDot status={getConnectionStatus(room.members?.[r.uid], now)} size={8} />
                      {r.uid === room.host && <HostBadge size={13} />}
                      {r.name}
                    </span>
                  </Td>
                  <Td align="right" style={{ color: r.dnf ? C.danger : C.text, fontFamily: 'JetBrains Mono, monospace' }}>
                    {r.dnf ? 'DNF' : fmtMs(r.average, false, 2)}
                  </Td>
                  <Td align="right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.points}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <SectionLabel>Standings</SectionLabel>
          <table style={tableStyle}>
            <thead>
              <tr><Th>Rank</Th><Th>Name</Th><Th align="right">Total Pts</Th></tr>
            </thead>
            <tbody>
              {cumulative.map((r, i) => (
                <tr key={r.uid} style={{ background: r.uid === userId ? C.accentDim : 'transparent' }}>
                  <Td><span style={{ color: i === 0 ? C.success : i < 3 ? C.accent : C.text, fontWeight: 700 }}>{i + 1}</span></Td>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <StatusDot status={getConnectionStatus(room.members?.[r.uid], now)} size={8} />
                      {r.uid === room.host && <HostBadge size={13} />}
                      {r.name}
                    </span>
                  </Td>
                  <Td align="right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.points}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="mp-action-grid" style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : (isHost ? '1fr 1fr' : '1fr'),
          gap: '0.6rem',
        }}>
          {isHost && <BigButton accent onClick={onPlayAgain}>Play Again</BigButton>}
          <BigButton onClick={onLeave}>Leave</BigButton>
        </div>
      </div>
    );
  }

  // ── Per-round path (between rounds) — REDESIGNED ─────────────────────────
  const leaderPoints = cumulative[0]?.points ?? 0;
  const myReady = !!me?.ready;

  return (
    <div className="mp-results-screen" style={{
      width: '100%',
      maxWidth: isMobile ? '100%' : '760px',
      minHeight: isMobile ? 'calc(100dvh - 0px)' : 'auto',
      padding: isMobile ? '0.85rem 0.75rem 1rem' : '1.5rem',
      margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: '0.85rem',
      animation: 'mp-results-fade-in 0.32s cubic-bezier(0.2, 0.8, 0.3, 1) both',
    }}>
      {/* Round badge */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.3rem 0.85rem',
          background: C.accentDim, color: C.accent,
          border: `1px solid ${C.borderHi}`,
          borderRadius: 999,
          fontSize: '0.66rem', fontWeight: 700,
          letterSpacing: '0.15em', textTransform: 'uppercase',
        }}>
          <TrophyIcon size={12} /> {roundName} · Round {room.round} of {room.maxRounds}
        </span>
      </div>

      {/* Round results card */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '0.7rem 0.9rem',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        }}>
          <SectionLabel>Round results</SectionLabel>
          <span style={{ fontSize: '0.66rem', color: C.muted, letterSpacing: '0.08em' }}>
            Avg of 5
          </span>
        </div>
        {ranked.map((r, i) => (
          <RoundResultRow
            key={r.uid}
            rank={i + 1}
            name={r.name}
            solves={r.solves}
            average={r.average}
            dnf={r.dnf}
            points={r.points}
            isMe={r.uid === userId}
            isHost={r.uid === room.host}
            status={getConnectionStatus(room.members?.[r.uid], now)}
            isMobile={isMobile}
            isLast={i === ranked.length - 1}
          />
        ))}
      </div>

      {/* Standings card — only when there are multiple rounds total */}
      {room.maxRounds > 1 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '0.7rem 0.9rem',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          }}>
            <SectionLabel>Standings</SectionLabel>
            <span style={{ fontSize: '0.66rem', color: C.muted, letterSpacing: '0.08em' }}>
              After round {room.round}
            </span>
          </div>
          {cumulative.map((r, i) => (
            <StandingsRow
              key={r.uid}
              rank={i + 1}
              name={r.name}
              points={r.points}
              diff={r.points - leaderPoints}
              isMe={r.uid === userId}
              isHost={r.uid === room.host}
              status={getConnectionStatus(room.members?.[r.uid], now)}
              isLast={i === cumulative.length - 1}
            />
          ))}
        </div>
      )}

      {/* Spacer so action area pushes to the bottom on tall viewports */}
      <div style={{ flex: '1 1 auto', minHeight: '0.25rem' }} />

      {/* Actions card — primary buttons grouped together */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
        padding: '0.85rem',
        display: 'flex', flexDirection: 'column', gap: '0.55rem',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isHost ? '1fr 1fr' : '1fr',
          gap: '0.5rem',
        }}>
          <ResultsActionButton
            tone={myReady ? 'neutral' : 'accent'}
            onClick={onReadyForNext}
            icon={myReady ? <CloseIcon size={14} /> : <CheckIcon />}
            label={myReady ? 'Cancel Ready' : 'Ready Up'}
          />
          {isHost && (
            <ResultsActionButton
              tone="success"
              disabled={!everyoneReady}
              onClick={onNextRound}
              icon={<PlayIcon size={14} />}
              label="Start Next Round"
            />
          )}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '0.4rem',
          fontSize: '0.74rem',
          color: everyoneReady ? C.success : C.muted,
          fontWeight: 600, letterSpacing: '0.04em',
        }}>
          {everyoneReady ? (
            <>
              <CheckIcon /> Everyone&rsquo;s ready{isHost ? ' — start when you like' : ' — host can start'}
            </>
          ) : (
            <>Waiting for {Object.values(room.members || {}).filter(m => !m.ready).length} player{Object.values(room.members || {}).filter(m => !m.ready).length === 1 ? '' : 's'}…</>
          )}
        </div>
      </div>

      {/* Leave — small secondary text button at the very bottom */}
      <button
        onClick={onLeave}
        style={{
          alignSelf: 'center',
          background: 'transparent', color: C.muted,
          border: 'none', padding: '0.55rem 0.85rem',
          fontSize: '0.82rem', fontFamily: 'inherit', fontWeight: 600,
          cursor: 'pointer', letterSpacing: '0.02em',
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          transition: 'color 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = C.danger)}
        onMouseLeave={e => (e.currentTarget.style.color = C.muted)}
      >
        <ExitIcon size={14} /> Leave race
      </button>

      <style>{`
        @keyframes mp-results-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Round results helpers ─────────────────────────────────────────────────

const MEDAL_COLOR: Record<number, string> = { 1: '#fbbf24', 2: '#cbd5e1', 3: '#d97706' };

function MedalBadge({ rank }: { rank: number }) {
  if (rank > 3) {
    return (
      <span style={{
        flexShrink: 0,
        width: 28, height: 28, borderRadius: '50%',
        background: C.cardAlt,
        border: `1px solid ${C.border}`,
        color: C.muted, fontSize: '0.78rem', fontWeight: 800,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{rank}</span>
    );
  }
  const color = MEDAL_COLOR[rank];
  return (
    <span style={{
      flexShrink: 0,
      width: 30, height: 30, borderRadius: '50%',
      background: `${color}1f`,
      border: `1px solid ${color}66`,
      color, fontSize: '0.78rem', fontWeight: 800,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: rank === 1 ? `0 0 18px ${color}66, inset 0 0 8px ${color}22` : undefined,
    }}>{rank}</span>
  );
}

function RoundResultRow({
  rank, name, solves, average, dnf, points, isMe, isHost, status, isMobile, isLast,
}: {
  rank: number;
  name: string;
  solves: (SolveData | null)[];
  average: number;
  dnf: boolean;
  points: number;
  isMe: boolean;
  isHost: boolean;
  status: ConnectionStatus;
  isMobile: boolean;
  isLast: boolean;
}) {
  const isWinner = rank === 1 && !dnf;
  return (
    <div style={{
      padding: isMobile ? '0.6rem 0.8rem' : '0.7rem 0.95rem',
      borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
      borderLeft: isMe ? `3px solid ${C.accent}` : '3px solid transparent',
      background: isWinner
        ? `linear-gradient(135deg, ${C.accentDim} 0%, ${C.successDim} 100%)`
        : 'transparent',
      display: 'flex', flexDirection: 'column', gap: '0.45rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        <MedalBadge rank={dnf ? 99 : rank} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.05rem' }}>
          <div style={{
            fontSize: '0.95rem', fontWeight: 700, color: C.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0,
          }}>
            <StatusDot status={status} size={8} />
            {isHost && <HostBadge size={14} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name}{isMe ? <span style={{ color: C.accent, fontWeight: 700, marginLeft: '0.3rem' }}>(you)</span> : null}
            </span>
          </div>
          <div style={{
            fontSize: '0.6rem', color: C.muted,
            letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700,
          }}>
            Average of 5
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem', flexShrink: 0 }}>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: isMobile ? '1.25rem' : '1.45rem', fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            color: dnf ? C.danger : C.success,
            lineHeight: 1,
          }}>{dnf ? 'DNF' : fmtMs(average, false, 2)}</span>
          <span style={{
            background: C.cardAlt, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 999,
            padding: '0.08rem 0.55rem',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.66rem', fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}>+{points} pts</span>
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        gap: isMobile ? '0.2rem' : '0.3rem',
      }}>
        {solves.map((s, i) => {
          const sDnf = s?.penalty === 'dnf';
          return (
            <div key={i} style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: isMobile ? '0.66rem' : '0.78rem', fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
              padding: isMobile ? '0.18rem 0.05rem' : '0.25rem 0.1rem',
              background: !s ? 'transparent' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: !s ? C.mutedDim : sDnf ? C.danger : C.text,
              letterSpacing: sDnf ? '0.04em' : '0',
              minHeight: isMobile ? 22 : 26,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {!s ? '—' : sDnf ? 'DNF' : fmtMs(effectiveSolveMs(s), false, 2)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StandingsRow({
  rank, name, points, diff, isMe, isHost, status, isLast,
}: {
  rank: number;
  name: string;
  points: number;
  diff: number;       // points relative to leader; ≤0
  isMe: boolean;
  isHost: boolean;
  status: ConnectionStatus;
  isLast: boolean;
}) {
  const isLeader = rank === 1;
  return (
    <div style={{
      padding: '0.6rem 0.85rem',
      borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
      borderLeft: isMe ? `3px solid ${C.accent}` : '3px solid transparent',
      display: 'flex', alignItems: 'center', gap: '0.65rem',
    }}>
      <MedalBadge rank={rank} />
      <div style={{
        flex: 1, minWidth: 0,
        fontSize: '0.92rem', fontWeight: 700, color: C.text,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        display: 'flex', alignItems: 'center', gap: '0.35rem',
      }}>
        <StatusDot status={status} size={8} />
        {isHost && <HostBadge size={13} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}{isMe ? <span style={{ color: C.accent, fontWeight: 700, marginLeft: '0.3rem' }}>(you)</span> : null}
        </span>
      </div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '1.05rem', fontWeight: 800,
          color: isLeader ? C.success : C.text,
          fontVariantNumeric: 'tabular-nums',
        }}>{points}</span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.7rem', fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: isLeader ? C.muted : (diff === 0 ? C.muted : C.danger),
        }}>
          {isLeader ? 'leader' : diff === 0 ? 'tied' : `${diff} pts`}
        </span>
      </div>
    </div>
  );
}

function ResultsActionButton({
  tone, onClick, icon, label, disabled,
}: {
  tone: 'accent' | 'success' | 'neutral';
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  const palette = disabled
    ? { bg: C.cardAlt, fg: C.mutedDim, border: C.border }
    : tone === 'accent'  ? { bg: C.accent,  fg: '#0a0a0a', border: C.accent }
    : tone === 'success' ? { bg: C.success, fg: '#0a0a0a', border: C.success }
    : { bg: 'transparent', fg: C.text, border: C.border };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: palette.bg, color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 12, padding: '0.85rem 0.95rem',
        fontSize: '0.95rem', fontWeight: 800, fontFamily: 'inherit',
        letterSpacing: '0.02em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem',
        transition: 'transform 0.08s, opacity 0.15s',
      }}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = 'scale(0.985)'; }}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {icon}
      {label}
    </button>
  );
}

function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 3.5v17l15-8.5z" />
    </svg>
  );
}

function TrophyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 4h3a2 2 0 0 1 0 4h-3" />
      <path d="M7 4H4a2 2 0 0 0 0 4h3" />
    </svg>
  );
}

function ExitIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ── Ranking helpers ──────────────────────────────────────────────────────
interface Ranked {
  uid: string;
  name: string;
  solves: (SolveData | null)[];
  average: number;        // ms; 0 if dnf
  dnf: boolean;
  points: number;         // computed at display, not used for cumulative (server already added)
}

// Rank by Ao5 (DNF last). Points: 1st=N, 2nd=N-1, ..., last=1; DNF=0.
// (Server has already added these points to cumulative when transitioning
// racing → results — this just produces the per-round table.)
function rankByRoundAverage(members: Record<string, MemberData> | undefined): Ranked[] {
  const list: Ranked[] = Object.entries(members || {}).map(([uid, m]) => {
    const dnf = m.roundAverage == null;
    return {
      uid, name: m.name,
      solves: [],   // filled in below; left empty here so this fn can be used without solves
      average: dnf ? 0 : (m.roundAverage as number),
      dnf,
      points: 0,
    };
  });
  list.sort((a, b) => {
    if (a.dnf && !b.dnf) return 1;
    if (!a.dnf && b.dnf) return -1;
    return a.average - b.average;
  });
  const N = list.length;
  list.forEach((r, i) => { r.points = r.dnf ? 0 : Math.max(1, N - i); });
  return list;
}

// Variant used by ResultsScreen so we can show S1..S5 alongside the avg.
function rankByRoundAverageWithSolves(
  members: Record<string, MemberData> | undefined,
  solves: Record<string, Record<string, SolveData>> | undefined,
): Ranked[] {
  const ranked = rankByRoundAverage(members);
  for (const r of ranked) {
    const s: (SolveData | null)[] = [];
    for (let i = 0; i < SOLVES_PER_ROUND; i++) {
      s.push(solves?.[r.uid]?.[String(i)] ?? null);
    }
    r.solves = s;
  }
  return ranked;
}

// ── Tiny UI primitives ───────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.cardAlt, color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '0.6rem 0.7rem', fontSize: '0.95rem',
  fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse',
  fontSize: '0.88rem',
};

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left',
      padding: '0.4rem 0.55rem',
      fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
      color: C.muted, fontWeight: 700,
      borderBottom: `1px solid ${C.border}`,
    }}>{children}</th>
  );
}

function Td({ children, align, style }: { children: React.ReactNode; align?: 'left' | 'right'; style?: React.CSSProperties }) {
  return (
    <td style={{
      textAlign: align ?? 'left',
      padding: '0.5rem 0.55rem',
      borderBottom: `1px solid ${C.border}`,
      ...style,
    }}>{children}</td>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.66rem', letterSpacing: '0.12em',
      textTransform: 'uppercase', color: C.muted, fontWeight: 700,
    }}>{children}</div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '0.9rem 1rem',
    }}>{children}</div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <span style={{ fontSize: '0.66rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

function FormShell({ isMobile, title, children, onBack }: { isMobile: boolean; title: string; children: React.ReactNode; onBack: () => void }) {
  void onBack;
  return (
    <div className="mp-form-shell" style={{
      width: isMobile ? '100%' : '420px',
      padding: isMobile ? '1rem' : '2rem',
      margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: '0.85rem',
    }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 800, textAlign: 'center' }}>{title}</div>
      {children}
    </div>
  );
}

function BigButton({
  children, onClick, accent, success, disabled, style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  success?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const bg = disabled ? C.cardAlt
    : success ? C.success
    : accent ? C.accent
    : C.cardAlt;
  const fg = disabled ? C.mutedDim
    : (success || accent) ? '#0a0a0a'
    : C.text;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg, color: fg,
        border: `1px solid ${disabled ? C.border : (success ? C.success : accent ? C.accent : C.border)}`,
        borderRadius: 12, padding: '0.85rem 1rem',
        fontSize: '1rem', fontWeight: 700, fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: '0.02em',
        transition: 'transform 0.08s, opacity 0.15s',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = 'scale(0.985)'; }}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >{children}</button>
  );
}

function MemberRow({
  name, isHost, isYou, status, right,
}: {
  name: string;
  isHost: boolean;
  isYou: boolean;
  status: ConnectionStatus;
  right: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0.65rem',
      background: C.cardAlt, border: `1px solid ${C.border}`,
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
        <StatusDot status={status} />
        {isHost && <HostBadge />}
        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        {isYou && isHost && <Pill color={C.warn}>HOST</Pill>}
        {isYou && !isHost && <Pill color={C.muted}>You</Pill>}
      </div>
      <div>{right}</div>
    </div>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase',
      color, border: `1px solid ${color}`, borderRadius: 999,
      padding: '0.1rem 0.45rem', fontWeight: 700,
    }}>{children}</span>
  );
}

function RoomCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {}
  }, [code]);
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.borderHi}`,
      borderRadius: 14, padding: '1rem',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.45rem',
    }}>
      <div style={{ fontSize: '0.66rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>
        Room code
      </div>
      <div className="mp-room-code" style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 'clamp(2.2rem, 8vw, 3.2rem)', fontWeight: 800,
        letterSpacing: '0.25em', color: C.accent,
      }}>{code}</div>
      <button
        onClick={onCopy}
        style={{
          background: C.accentDim, color: C.accent,
          border: `1px solid ${C.borderHi}`, borderRadius: 8,
          padding: '0.35rem 0.8rem', fontSize: '0.78rem',
          fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
        }}
      >{copied ? 'Copied!' : 'Copy code'}</button>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CrownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 7l4 3 5-6 5 6 4-3-2 12H5L3 7zm2.7 10h12.6l.4-2H5.3l.4 2z" />
    </svg>
  );
}

// Inline gold crown next to a host's name. Use everywhere the host's name
// appears so the role is identifiable at a glance.
function HostBadge({ size = 14 }: { size?: number }) {
  return (
    <span
      title="Host"
      aria-label="Host"
      style={{
        color: C.warn,
        display: 'inline-flex',
        alignItems: 'center',
        flex: '0 0 auto',
        verticalAlign: 'middle',
      }}
    >
      <CrownIcon size={size} />
    </span>
  );
}

// Coloured presence dot. The dot is the `🟢🟡🔴` from the spec, expressed
// as an SVG circle so it stays consistent across platforms (no emoji-font
// drift). Tooltip is the human-readable status label.
function StatusDot({ status, size = 8 }: { status: ConnectionStatus; size?: number }) {
  const color =
    status === 'online' ? C.success
    : status === 'idle' ? C.warn
    : C.danger;
  const label = STATUS_LABEL[status];
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: status === 'online' ? `0 0 6px ${color}80` : 'none',
        verticalAlign: 'middle',
      }}
    />
  );
}

// Stacked toast queue for connection events. Sits below the host-transfer
// toast (when present) so the two systems don't fight for the same screen
// real estate. Each notification is keyed and dismisses itself via the
// page's pushNotif setTimeout — this component is purely presentational.
function NotificationStack({
  notifs,
  hostToastVisible,
}: {
  notifs: { id: string; text: string; tone: 'info' | 'success' | 'warn' }[];
  hostToastVisible: boolean;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: hostToastVisible
          ? 'calc(env(safe-area-inset-top) + 3.5rem)'
          : 'calc(env(safe-area-inset-top) + 0.75rem)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        alignItems: 'center',
        pointerEvents: 'none',
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      {notifs.map(n => {
        const palette = n.tone === 'success'
          ? { fg: C.success, border: C.success, bg: C.successDim }
          : n.tone === 'warn'
          ? { fg: C.warn, border: C.warn, bg: 'rgba(251,191,36,0.12)' }
          : { fg: C.text, border: C.border, bg: C.card };
        return (
          <div
            key={n.id}
            role="status"
            aria-live="polite"
            style={{
              background: palette.bg,
              border: `1px solid ${palette.border}`,
              color: palette.fg,
              borderRadius: 999,
              padding: '0.5rem 0.95rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
              animation: 'mp-notif-in 0.22s ease-out',
              pointerEvents: 'auto',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {n.text}
          </div>
        );
      })}
      <style>{`
        @keyframes mp-notif-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// Shown in place of RoomView when the host has removed us at round end. The
// user can either rejoin (re-adds a fresh member entry, losing prior round
// totals) or leave for good. Identity (userId) is preserved so any saved
// share-links still work.
function KickedScreen({
  isMobile,
  roomCode,
  onRejoin,
  onLeave,
}: {
  isMobile: boolean;
  roomCode: string;
  onRejoin: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      style={{
        flex: '1 1 auto',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '1.25rem',
        padding: isMobile ? '1.25rem' : '2rem',
        width: '100%',
        maxWidth: 460, margin: '0 auto',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 64, height: 64, borderRadius: '50%',
          background: C.dangerDim, border: `1px solid ${C.danger}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.danger,
        }}
        aria-hidden="true"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.4rem' }}>
          You were removed from this room
        </div>
        <div style={{ color: C.muted, fontSize: '0.88rem', lineHeight: 1.5 }}>
          You went offline during the round and the host removed you when it
          ended. You can rejoin{' '}
          <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.accent, letterSpacing: '0.15em', fontWeight: 700 }}>
            {roomCode}
          </span>{' '}
          as a new member. Your previous points for this match will be reset.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', width: '100%' }}>
        <BigButton onClick={onLeave}>Leave</BigButton>
        <BigButton accent onClick={onRejoin}>Rejoin</BigButton>
      </div>
    </div>
  );
}

function HostTransferToast({ name }: { name: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 0.75rem)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: C.card,
        border: `1px solid ${C.warn}`,
        color: C.text,
        borderRadius: 999,
        padding: '0.55rem 1rem',
        fontSize: '0.85rem',
        fontWeight: 700,
        letterSpacing: '0.01em',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        animation: 'mp-host-toast-in 0.22s ease-out',
        maxWidth: 'calc(100vw - 2rem)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span style={{ color: C.warn, display: 'inline-flex', alignItems: 'center' }}>
        <CrownIcon />
      </span>
      <span>Host transferred to {name}</span>
      <style>{`
        @keyframes mp-host-toast-in {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

// ── SharePanel: QR code + Copy Link + Share buttons ──────────────────────
function SharePanel({ roomCode }: { roomCode: string }) {
  const [joinUrl, setJoinUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // window.location is only safe to read on the client.
  useEffect(() => {
    if (typeof window === 'undefined' || !roomCode) return;
    setJoinUrl(`${window.location.origin}/timer/multiplayer?join=${roomCode}`);
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, [roomCode]);

  const onCopyLink = useCallback(async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[mp] copy link failed', err);
    }
  }, [joinUrl]);

  const onShare = useCallback(async () => {
    if (!joinUrl) return;
    try {
      await navigator.share({
        title: 'Join my speedcubing race!',
        text: `Join room ${roomCode} on Precision Velocity Timer`,
        url: joinUrl,
      });
    } catch (err) {
      // User canceled (AbortError) — silently ignore. Log others.
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[mp] share failed', err);
      }
    }
  }, [joinUrl, roomCode]);

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '1rem',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.7rem',
    }}>
      <div style={{
        background: '#0a0a0a', border: `1px solid ${C.border}`,
        borderRadius: 12, padding: '0.6rem',
        lineHeight: 0,
      }}>
        {joinUrl ? (
          <QRCodeSVG
            value={joinUrl}
            size={180}
            bgColor="#0a0a0a"
            fgColor="#A78BFA"
            level="M"
          />
        ) : (
          <div style={{ width: 180, height: 180 }} />
        )}
      </div>
      <div style={{
        fontSize: '0.66rem', letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.muted, fontWeight: 700,
      }}>
        Scan to join
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: canShare ? '1fr 1fr' : '1fr',
        gap: '0.5rem', width: '100%',
      }}>
        <button
          onClick={onCopyLink}
          disabled={!joinUrl}
          style={{
            background: copied ? C.successDim : C.accentDim,
            color: copied ? C.success : C.accent,
            border: `1px solid ${copied ? C.success : C.borderHi}`,
            borderRadius: 10,
            padding: '0.6rem 0.85rem', fontSize: '0.85rem',
            fontFamily: 'inherit', cursor: joinUrl ? 'pointer' : 'not-allowed',
            fontWeight: 700, letterSpacing: '0.02em',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          }}
        >
          <span aria-hidden>📋</span> {copied ? 'Copied!' : 'Copy Link'}
        </button>
        {canShare && (
          <button
            onClick={onShare}
            disabled={!joinUrl}
            style={{
              background: C.cardAlt, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '0.6rem 0.85rem', fontSize: '0.85rem',
              fontFamily: 'inherit', cursor: joinUrl ? 'pointer' : 'not-allowed',
              fontWeight: 700, letterSpacing: '0.02em',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
            }}
          >
            <span aria-hidden>📤</span> Share
          </button>
        )}
      </div>
    </div>
  );
}
