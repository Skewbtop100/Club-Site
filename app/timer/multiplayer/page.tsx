'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Scrambow } from 'scrambow';
import { QRCodeSVG } from 'qrcode.react';
import {
  ref,
  onValue,
  set,
  update,
  remove,
  onDisconnect,
  get,
} from 'firebase/database';
import { rtdb } from '@/lib/firebase';

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

function fmtMs(ms: number | null, dnf?: boolean, precision: 2 | 3 = 2): string {
  if (dnf) return 'DNF';
  if (ms == null) return '—';
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  if (m > 0) return `${m}:${s.toFixed(precision).padStart(precision + 3, '0')}`;
  return s.toFixed(precision);
}

// ── Timer state machine ─────────────────────────────────────────────────────
// Ported verbatim from app/timer/page.tsx so multiplayer feels identical:
// hold-to-arm (≥350ms), green-when-armed, inspection countdown if enabled,
// and a state-based touch/space flow that doesn't fire on incidental taps.
type MpTimerState = 'idle' | 'inspecting' | 'armed' | 'running' | 'stopped';

function useMpTimer(
  inspectionEnabled: boolean,
  onSolveCommit: (ms: number, dnf: boolean) => void,
) {
  const [state, setState] = useState<MpTimerState>('idle');
  const [displayMs, setDisplayMs] = useState(0);
  const [inspectionMs, setInspectionMs] = useState(15000);

  const runStartRef = useRef(0);
  const inspStartRef = useRef(0);
  const armStartRef = useRef(0);
  const rafRef = useRef(0);

  const stop = useCallback(() => {
    if (state === 'running') {
      const final = Date.now() - runStartRef.current;
      cancelAnimationFrame(rafRef.current);
      setDisplayMs(final);
      setState('stopped');
      const dnf = inspectionMs <= -2000;
      inspStartRef.current = 0;
      setInspectionMs(15000);
      onSolveCommit(final, dnf);
    }
  }, [state, inspectionMs, onSolveCommit]);

  // Tick loop
  useEffect(() => {
    if (state === 'running') {
      const tick = () => {
        setDisplayMs(Date.now() - runStartRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }
    if (state === 'inspecting') {
      const id = setInterval(() => {
        const elapsed = Date.now() - inspStartRef.current;
        setInspectionMs(15000 - elapsed);
      }, 50);
      return () => clearInterval(id);
    }
  }, [state]);

  const beginInspection = useCallback(() => {
    inspStartRef.current = Date.now();
    setInspectionMs(15000);
    setState('inspecting');
  }, []);

  const startArming = useCallback(() => {
    armStartRef.current = Date.now();
    setState('armed');
  }, []);

  const startRunning = useCallback(() => {
    runStartRef.current = Date.now();
    setDisplayMs(0);
    setState('running');
  }, []);

  const fireRunning = useCallback(() => {
    const heldFor = Date.now() - armStartRef.current;
    if (heldFor < 350) {
      // Released too early — return to inspecting (or idle).
      setState(prev => prev === 'armed'
        ? (inspectionMs > -2000 && inspStartRef.current > 0 ? 'inspecting' : 'idle')
        : prev);
      return;
    }
    runStartRef.current = Date.now();
    setDisplayMs(0);
    setState('running');
  }, [inspectionMs]);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setState('idle');
    setDisplayMs(0);
    setInspectionMs(15000);
    inspStartRef.current = 0;
  }, []);

  void inspectionEnabled; // prefs flag is consumed by the caller, not this hook

  return {
    state, displayMs, inspectionMs,
    beginInspection, startArming, startRunning, fireRunning, stop, reset,
  };
}

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

  // Responsive: JS-based mobile detection (≤900px). Initial render is desktop;
  // the effect runs on mount and on resize.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

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

  const joinRoom = useCallback(async () => {
    setErrorMsg('');
    const code = joinCode.trim().toUpperCase();
    const name = joinName.trim();
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
      const memberRef = ref(rtdb, `rooms/${code}/members/${uid}`);
      const existingMember = data.members?.[uid];
      const memberData: MemberData = {
        name,
        ready: existingMember?.ready ?? false,
        currentSolve: existingMember?.currentSolve ?? 0,
        roundAverage: existingMember?.roundAverage ?? null,
        totalPoints: existingMember?.totalPoints ?? 0,
        connected: true,
      };
      await set(memberRef, memberData);
      console.log('[mp] joined', code);
      try { localStorage.setItem(LAST_ROOM_KEY, code); } catch {}
      setRoomCode(code);
      setView('room');
    } catch (err) {
      console.error('[mp] joinRoom error', err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Couldn't join: ${msg}. Check Firebase RTDB is enabled and rules allow reads/writes.`);
    }
  }, [joinCode, joinName, userId, persistName]);

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
    setRoom(null);
    setRoomCode('');
    setView('lobby');
    setPendingRejoin('');
  }, [roomCode, userId]);

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
      // Preserve cumulative points / round progress on return.
      const memberData: MemberData = {
        name,
        ready: existing?.ready ?? false,
        currentSolve: existing?.currentSolve ?? 0,
        roundAverage: existing?.roundAverage ?? null,
        totalPoints: existing?.totalPoints ?? 0,
        connected: true,
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
    for (const uid of Object.keys(room.members || {})) {
      updates[`members/${uid}/currentSolve`] = 0;
      updates[`members/${uid}/roundAverage`] = null;
      updates[`members/${uid}/ready`] = false;
    }
    await update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [roomCode, room, userId]);

  // Host: reset everything for another full match. Clears totalPoints.
  const playAgain = useCallback(async () => {
    if (!roomCode || !room || room.host !== userId) return;
    const updates: Record<string, unknown> = {
      status: 'waiting',
      round: 1,
      roundName: getRoundName(1, room.maxRounds),
      scrambles: null,
      solves: null,
    };
    for (const uid of Object.keys(room.members || {})) {
      updates[`members/${uid}/currentSolve`] = 0;
      updates[`members/${uid}/roundAverage`] = null;
      updates[`members/${uid}/totalPoints`] = 0;
      updates[`members/${uid}/ready`] = false;
    }
    await update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [roomCode, room, userId]);

  // ── Status transitions (host-driven) ─────────────────────────────────────
  // Host: racing → results when every member has confirmed all 5 solves
  // (currentSolve >= SOLVES_PER_ROUND). Awards round points to cumulative.
  useEffect(() => {
    if (!room || !roomCode) return;
    if (room.host !== userId) return;
    if (room.status !== 'racing') return;
    const members = Object.entries(room.members || {});
    if (members.length === 0) return;
    const allDone = members.every(([, m]) => m.currentSolve >= SOLVES_PER_ROUND);
    if (!allDone) return;
    // Rank by Ao5 (DNF last). Award points: 1st=N, 2nd=N-1, ..., last=1; DNF=0.
    const ranked = rankByRoundAverage(room.members);
    const updates: Record<string, unknown> = { status: 'results' };
    const N = ranked.length;
    ranked.forEach((r, i) => {
      const pts = r.dnf ? 0 : Math.max(1, N - i);
      const prev = room.members[r.uid]?.totalPoints ?? 0;
      updates[`members/${r.uid}/totalPoints`] = prev + pts;
    });
    update(ref(rtdb, `rooms/${roomCode}`), updates);
  }, [room?.status, room?.members, room?.host, roomCode, userId]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      display: 'flex', flexDirection: 'column',
    }}>
      <TopBar
        roomCode={view === 'room' ? roomCode : ''}
        onBack={() => {
          if (view === 'room') leaveRoom();
          else if (view === 'lobby') router.push('/timer');
          else { setView('lobby'); setErrorMsg(''); }
        }}
      />

      <main style={{ flex: '1 1 auto', minWidth: 0, padding: '1rem', display: 'flex', flexDirection: 'column' }}>
        {errorMsg && view !== 'room' && (
          <div style={{
            maxWidth: 480, margin: '0 auto 0.85rem', width: '100%',
            background: C.dangerDim, border: `1px solid ${C.danger}`,
            color: C.danger, borderRadius: 10, padding: '0.6rem 0.8rem',
            fontSize: '0.82rem',
          }}>{errorMsg}</div>
        )}

        {view === 'lobby' && (
          <Lobby
            isMobile={isMobile}
            pendingRejoin={pendingRejoin}
            onRejoin={rejoinRoom}
            onDismissRejoin={() => {
              try { localStorage.removeItem(LAST_ROOM_KEY); } catch {}
              setPendingRejoin('');
            }}
            onCreate={() => { setErrorMsg(''); setView('create'); }}
            onJoin={() => { setErrorMsg(''); setView('join'); }}
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

        {view === 'room' && room && (
          <RoomView
            isMobile={isMobile}
            roomCode={roomCode}
            room={room}
            userId={userId}
            onToggleReady={toggleReady}
            onSetEvent={setEvent}
            onSetMaxRounds={setMaxRounds}
            onStartRace={startRace}
            onSubmitSolve={submitSolve}
            onReadyForNext={readyForNext}
            onNextRound={nextRound}
            onPlayAgain={playAgain}
            onLeave={leaveRoom}
          />
        )}
      </main>
    </div>
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
    }}>
      <button
        onClick={onBack}
        style={{
          background: 'transparent', border: `1px solid ${C.border}`,
          color: C.muted, borderRadius: 8, padding: '0.35rem 0.65rem',
          fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer',
        }}
      >← {roomCode ? 'Leave' : 'Back'}</button>
      <div style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em' }}>
        Multiplayer Racing
      </div>
      <div style={{ width: 64 }} />
    </header>
  );
}

// ── Lobby ─────────────────────────────────────────────────────────────────
function Lobby({
  isMobile, pendingRejoin, onRejoin, onDismissRejoin, onCreate, onJoin,
}: {
  isMobile: boolean;
  pendingRejoin?: string;
  onRejoin?: () => void;
  onDismissRejoin?: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <div style={{
      flex: '1 1 auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '1.5rem',
      padding: isMobile ? '1rem' : '2rem',
      width: '100%',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'clamp(1.6rem, 6vw, 2.4rem)', fontWeight: 800, letterSpacing: '-0.02em' }}>
          Multiplayer Racing
        </div>
        <div style={{ color: C.muted, fontSize: '0.92rem', marginTop: '0.5rem' }}>
          Race friends in real time. Same scramble, live leaderboard.
        </div>
      </div>

      {pendingRejoin && (
        <div style={{
          width: '100%', maxWidth: 420,
          background: C.accentDim, border: `1px solid ${C.borderHi}`,
          borderRadius: 12, padding: '0.85rem 1rem',
          display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          <div style={{ fontSize: '0.78rem', color: C.muted, textAlign: 'center' }}>
            You were in room{' '}
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', color: C.accent,
              fontWeight: 800, letterSpacing: '0.15em',
            }}>{pendingRejoin}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
            <BigButton accent onClick={onRejoin ?? (() => {})}>
              Rejoin {pendingRejoin}
            </BigButton>
            <button
              onClick={onDismissRejoin}
              aria-label="Dismiss"
              title="Dismiss"
              style={{
                background: 'transparent', color: C.muted,
                border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '0 0.85rem', fontSize: '1rem',
                fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
              }}
            >×</button>
          </div>
        </div>
      )}

      <div className="mp-lobby-buttons" style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: '1rem',
        width: isMobile ? '100%' : 'auto',
      }}>
        <BigButton accent onClick={onCreate} style={{ width: isMobile ? '100%' : '200px' }}>Create Room</BigButton>
        <BigButton onClick={onJoin} style={{ width: isMobile ? '100%' : '200px' }}>Join Room</BigButton>
      </div>
    </div>
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
  onToggleReady: () => void;
  onSetEvent: (id: string) => void;
  onSetMaxRounds: (n: number) => void;
  onStartRace: () => void;
  onSubmitSolve: (index: number, time: number, penalty: Penalty, scramble: string) => void;
  onReadyForNext: () => void;
  onNextRound: () => void;
  onPlayAgain: () => void;
  onLeave: () => void;
}

function RoomView(props: RoomViewProps) {
  const { room, userId } = props;
  const isHost = room.host === userId;

  if (room.status === 'waiting') return <WaitingRoom {...props} isHost={isHost} />;
  if (room.status === 'racing')  return <RacingScreen {...props} isHost={isHost} />;
  return <ResultsScreen {...props} isHost={isHost} />;
}

// ── Waiting room ──────────────────────────────────────────────────────────
function WaitingRoom({
  isMobile, roomCode, room, userId, isHost,
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
// Multiplayer behaviour parity with main timer:
//   - Hold-to-start always on (≥350ms hold to arm; release to begin)
//   - Inspection off (multiplayer is a quick race; can be exposed later)
const MP_HOLD_TO_START = true;
const MP_INSPECTION_ENABLED = false;

function RacingScreen({
  isMobile, room, userId, onSubmitSolve,
}: RoomViewProps & { isHost: boolean }) {
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

  const otherCurrents = useMemo(() => {
    return Object.entries(room.members || {})
      .filter(([uid]) => uid !== userId)
      .map(([, m]) => m.currentSolve);
  }, [room.members, userId]);
  const minOthers = otherCurrents.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...otherCurrents);
  const isWaitingForOpponents = otherCurrents.length > 0 && (myCurrent - minOthers) >= 1 && myCurrent < SOLVES_PER_ROUND;

  const isRoundDone = myCurrent >= SOLVES_PER_ROUND;
  const currentScramble = !isRoundDone ? (room.scrambles?.[String(myCurrent)] ?? '') : '';

  const [scrambleShown, setScrambleShown] = useState(false);
  // Pending = waiting for OK/+2/DNF confirmation after a stop. While pending,
  // all touch/space input is ignored to prevent another solve from starting.
  const [pending, setPending] = useState<{ ms: number; defaultDnf: boolean } | null>(null);

  const onSolveCommit = useCallback((ms: number, dnf: boolean) => {
    setPending({ ms, defaultDnf: dnf });
  }, []);

  const timer = useMpTimer(MP_INSPECTION_ENABLED, onSolveCommit);

  const interactionLocked = !scrambleShown || isWaitingForOpponents || isRoundDone || !!pending;

  // Reset local + timer state at solve / round boundary.
  useEffect(() => {
    setScrambleShown(false);
    setPending(null);
    timer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCurrent, room.round]);

  const confirmSolve = useCallback((penalty: Penalty) => {
    if (!pending) return;
    onSubmitSolve(myCurrent, pending.ms, penalty, currentScramble);
    setPending(null);
    // The myCurrent-change effect will reset timer + scrambleShown.
  }, [pending, myCurrent, currentScramble, onSubmitSolve]);

  // Touch handlers — mirror main timer's onTimerTouchStart / onTimerTouchEnd.
  const onTimerTouchStart = useCallback(() => {
    if (interactionLocked) return;
    if (timer.state === 'running') { timer.stop(); return; }
    if (timer.state === 'idle' || timer.state === 'stopped') {
      if (MP_INSPECTION_ENABLED) timer.beginInspection();
      else if (MP_HOLD_TO_START) timer.startArming();
      else timer.startRunning();
      return;
    }
    if (timer.state === 'inspecting') {
      if (MP_HOLD_TO_START) timer.startArming();
      else timer.startRunning();
    }
  }, [interactionLocked, timer]);

  const onTimerTouchEnd = useCallback(() => {
    if (timer.state === 'armed') timer.fireRunning();
  }, [timer]);

  // Keyboard — mirror main timer with auto-repeat guard. Hold-to-arm requires
  // both keydown (start arming) and keyup (fire running after ≥350ms held).
  const spaceHeldRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (spaceHeldRef.current) return;
      spaceHeldRef.current = true;
      if (interactionLocked && timer.state !== 'running') return;
      if (timer.state === 'running') { timer.stop(); return; }
      if (timer.state === 'idle' || timer.state === 'stopped') {
        if (MP_INSPECTION_ENABLED) timer.beginInspection();
        else if (MP_HOLD_TO_START) timer.startArming();
        else timer.startRunning();
        return;
      }
      if (timer.state === 'inspecting') {
        if (MP_HOLD_TO_START) timer.startArming();
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
  }, [interactionLocked, timer]);

  const [opponentsOpen, setOpponentsOpen] = useState(!isMobile);
  useEffect(() => { setOpponentsOpen(!isMobile); }, [isMobile]);

  const opponentCount = Object.keys(room.members || {}).length - 1;

  // Display: while pending, freeze on the recorded time.
  const displayValue = pending ? fmtMs(pending.ms, false, 2)
    : timer.state === 'inspecting' ? Math.max(0, Math.ceil(timer.inspectionMs / 1000)).toString()
    : timer.state === 'armed' ? '0.00'
    : fmtMs(timer.displayMs, false, 2);

  const timerColor =
    pending ? C.warn
    : timer.state === 'armed' ? C.success
    : timer.state === 'running' ? C.accent
    : timer.state === 'inspecting' ? (timer.inspectionMs <= 0 ? C.danger : timer.inspectionMs <= 3000 ? C.warn : C.text)
    : C.text;

  const borderColor =
    pending ? C.warn
    : timer.state === 'armed' ? C.success
    : timer.state === 'running' ? C.accent
    : C.border;

  return (
    <div className="mp-race-container" style={{
      flex: '1 1 auto', minHeight: 0, width: '100%',
      maxWidth: isMobile ? '100%' : '1100px',
      margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: '0.85rem',
      padding: isMobile ? '0.5rem' : '0.5rem 0',
    }}>
      {/* Mobile: compact S1..S5 strip + tiny round label */}
      {isMobile && (
        <MobileSolveStrip
          mySolves={mySolves}
          current={myCurrent}
          isRoundDone={isRoundDone}
          roundLabel={room.roundName || getRoundName(room.round, room.maxRounds)}
        />
      )}

      {/* Desktop: round header card + dot progress */}
      {!isMobile && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: '0.6rem 0.85rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>
              {room.roundName || getRoundName(room.round, room.maxRounds)}
            </div>
            <div style={{ fontSize: '0.78rem', color: C.text, fontWeight: 700 }}>
              Solve {Math.min(myCurrent + 1, SOLVES_PER_ROUND)} of {SOLVES_PER_ROUND}
            </div>
          </div>
          <SolveProgressDots count={SOLVES_PER_ROUND} done={myCurrent} />
        </div>
      )}

      {/* Sync gate */}
      {isWaitingForOpponents && (
        <div style={{
          background: C.accentDim, border: `1px solid ${C.borderHi}`,
          borderRadius: 12, padding: '0.85rem 1rem', textAlign: 'center',
          color: C.accent, fontWeight: 700, fontSize: '0.92rem',
        }}>
          Waiting for opponents to catch up…
        </div>
      )}

      {/* Round done banner */}
      {isRoundDone && (
        <div style={{
          background: C.successDim, border: `1px solid ${C.success}`,
          borderRadius: 12, padding: '0.85rem 1rem', textAlign: 'center',
          color: C.success, fontWeight: 700, fontSize: '0.95rem',
        }}>
          You finished the round! Waiting for everyone else to finish…
        </div>
      )}

      {/* Scramble: hidden until tapped */}
      {!isRoundDone && !isWaitingForOpponents && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: '0.7rem 0.9rem',
          minHeight: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {scrambleShown ? (
            <div style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 'clamp(0.95rem, 2.4vw, 1.35rem)',
              color: C.text, lineHeight: 1.5, letterSpacing: '0.04em',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'center',
              width: '100%',
            }}>
              {currentScramble}
            </div>
          ) : (
            <button
              onClick={() => setScrambleShown(true)}
              style={{
                background: C.accentDim, color: C.accent,
                border: `1px solid ${C.borderHi}`, borderRadius: 10,
                padding: '0.6rem 1.1rem', fontSize: '0.92rem', fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.02em',
              }}
            >Show Scramble</button>
          )}
        </div>
      )}

      {/* Timer + opponents panel */}
      <div className="mp-race-grid" style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr',
        gap: '0.85rem', minHeight: 0,
        flex: '1 1 auto',
      }}>
        <div
          onTouchStart={(e) => { e.preventDefault(); onTimerTouchStart(); }}
          onTouchEnd={(e) => { e.preventDefault(); onTimerTouchEnd(); }}
          style={{
            background: timer.state === 'armed' ? `${C.success}10` : C.card,
            border: `1px solid ${borderColor}`,
            borderRadius: 16, padding: '1.5rem 1rem',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none', cursor: interactionLocked ? 'default' : 'pointer',
            textAlign: 'center', touchAction: 'manipulation',
            transition: 'border-color 0.12s, background 0.12s',
            minHeight: 220,
          }}
        >
          {timer.state === 'inspecting' && (
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.warn, marginBottom: '0.6rem', fontWeight: 700 }}>
              Inspection
            </div>
          )}
          <div style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 'clamp(3.5rem, 14vw, 7rem)',
            fontWeight: 800, lineHeight: 0.95,
            fontVariantNumeric: 'tabular-nums',
            color: timerColor,
            textShadow: timer.state === 'armed' ? `0 0 30px ${C.success}55` : 'none',
            transition: 'color 0.12s',
          }}>
            {displayValue}
          </div>
          <div style={{ fontSize: '0.78rem', color: C.muted, marginTop: '0.85rem', letterSpacing: '0.04em', minHeight: '1.1rem' }}>
            {pending && 'Confirm your time'}
            {!pending && isRoundDone && 'Round complete'}
            {!pending && !isRoundDone && isWaitingForOpponents && 'Waiting for opponents…'}
            {!pending && !isRoundDone && !isWaitingForOpponents && !scrambleShown && 'Show the scramble first'}
            {!pending && !isRoundDone && !isWaitingForOpponents && scrambleShown && timer.state === 'idle' && 'Hold SPACE / press to arm'}
            {!pending && timer.state === 'inspecting' && 'Hold to arm, release to start'}
            {!pending && timer.state === 'armed' && (<span style={{ color: C.success, fontWeight: 700 }}>RELEASE TO START</span>)}
            {!pending && timer.state === 'running' && 'Tap or press SPACE to stop'}
          </div>

          {pending && (
            <div style={{
              marginTop: '1.2rem',
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem',
              width: '100%', maxWidth: 360,
            }}>
              <ConfirmButton color={C.success} onClick={(e) => { e.stopPropagation(); confirmSolve('ok'); }}>OK</ConfirmButton>
              <ConfirmButton color={C.warn}    onClick={(e) => { e.stopPropagation(); confirmSolve('+2'); }}>+2</ConfirmButton>
              <ConfirmButton color={C.danger}  onClick={(e) => { e.stopPropagation(); confirmSolve('dnf'); }}>DNF</ConfirmButton>
            </div>
          )}

          {/* Desktop only: in-timer S1..S5 strip (mobile shows it at top instead) */}
          {!isMobile && (
            <div style={{
              marginTop: '1.5rem', display: 'flex', gap: '0.4rem',
              flexWrap: 'wrap', justifyContent: 'center',
            }}>
              {Array.from({ length: SOLVES_PER_ROUND }, (_, i) => {
                const s = mySolves[i];
                const isCurrent = i === myCurrent && !isRoundDone;
                return (
                  <div key={i} style={{
                    minWidth: 56, padding: '0.3rem 0.5rem',
                    background: s ? C.cardAlt : 'transparent',
                    border: `1px solid ${isCurrent ? C.accent : C.border}`,
                    borderRadius: 8,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem',
                  }}>
                    <div style={{ fontSize: '0.55rem', letterSpacing: '0.12em', color: C.mutedDim, fontWeight: 700 }}>
                      S{i + 1}
                    </div>
                    <div style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: !s ? C.mutedDim : s.penalty === 'dnf' ? C.danger : C.text,
                    }}>
                      {!s ? '—' : s.penalty === 'dnf' ? 'DNF' : fmtMs(effectiveSolveMs(s), false, 2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Opponents panel — collapsible on mobile */}
        {(opponentsOpen || !isMobile) && (
          <OpponentsPanel
            room={room} userId={userId}
            onClose={isMobile ? () => setOpponentsOpen(false) : undefined}
          />
        )}
        {!opponentsOpen && isMobile && (
          <button
            onClick={() => setOpponentsOpen(true)}
            style={{
              background: C.cardAlt, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '0.6rem 0.85rem', fontSize: '0.85rem',
              fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
            }}
          >
            <span aria-hidden>👥</span> {opponentCount} opponent{opponentCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </div>
  );
}

// Mobile compact strip — replaces the round-name + "Solve X of 5" header on
// phones with a single row of S1..S5 (times / current marker / —) plus a
// tiny round label below.
function MobileSolveStrip({
  mySolves, current, isRoundDone, roundLabel,
}: {
  mySolves: SolveData[];
  current: number;
  isRoundDone: boolean;
  roundLabel: string;
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '0.55rem 0.7rem',
      display: 'flex', flexDirection: 'column', gap: '0.2rem',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.3rem',
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
                fontSize: '0.92rem', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'center',
                padding: '0.25rem 0.1rem',
                color: isCurrent ? C.accent
                  : !s ? C.mutedDim
                  : dnf ? C.danger : C.text,
                letterSpacing: dnf ? '0.04em' : '0',
              }}
            >
              {isCurrent && !s ? '●' : !s ? '—' : dnf ? 'DNF' : fmtMs(effectiveSolveMs(s), false, 2)}
            </div>
          );
        })}
      </div>
      <div style={{
        fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase',
        color: C.mutedDim, fontWeight: 700, textAlign: 'center',
      }}>
        {roundLabel} · Ao5
      </div>
      <style>{`
        @keyframes mp-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.9); }
        }
        .mp-solve-current { animation: mp-pulse 1.1s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

function SolveProgressDots({ count, done }: { count: number; done: number }) {
  return (
    <div style={{ display: 'inline-flex', gap: '0.3rem' }}>
      {Array.from({ length: count }, (_, i) => {
        const filled = i < done;
        return (
          <span key={i} style={{
            width: 11, height: 11, borderRadius: '50%',
            background: filled ? C.accent : 'transparent',
            border: `2px solid ${filled ? C.accent : C.border}`,
            display: 'inline-block',
          }} />
        );
      })}
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
  room, userId, onClose,
}: {
  room: RoomData; userId: string; onClose?: () => void;
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
  }, [room.members, room.solves, userId]);

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
              <div style={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.name}{isYou ? ' (you)' : ''}
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
                return (
                  <div key={i} style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.7rem', fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    padding: '0.25rem 0.2rem',
                    background: s ? '#0a0a0a' : 'transparent',
                    border: `1px solid ${isCurrent && !s ? C.accent : C.border}`,
                    borderRadius: 6, textAlign: 'center',
                    color: !s ? (isCurrent ? C.accent : C.mutedDim) : s.penalty === 'dnf' ? C.danger : C.text,
                  }}>
                    {!s ? (isCurrent ? '●' : '—') : s.penalty === 'dnf' ? 'DNF' : fmtMs(effectiveSolveMs(s), false, 2)}
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

// ── Results ───────────────────────────────────────────────────────────────
function ResultsScreen({
  isMobile, room, userId, isHost,
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

  // Champion (final mode) — highest cumulative points, ties go to first.
  const champion = cumulative[0];

  return (
    <div className="mp-room-container mp-results-container" style={{
      width: '100%',
      maxWidth: isMobile ? '100%' : '720px',
      padding: isMobile ? '0.5rem' : '2rem',
      margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: '1rem',
    }}>
      {isFinalRound && champion && (
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
          }}>
            {champion.name}
          </div>
          <div style={{ fontSize: '0.85rem', color: C.muted }}>
            {champion.points} point{champion.points === 1 ? '' : 's'}
          </div>
        </div>
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.7rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <SectionLabel>{room.roundName || getRoundName(room.round, room.maxRounds)} results</SectionLabel>
          </div>
          <div style={{ fontSize: '0.72rem', color: C.muted }}>{room.round} / {room.maxRounds}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Rank</Th>
                <Th>Name</Th>
                <Th align="right">S1</Th>
                <Th align="right">S2</Th>
                <Th align="right">S3</Th>
                <Th align="right">S4</Th>
                <Th align="right">S5</Th>
                <Th align="right">Avg</Th>
                <Th align="right">Pts</Th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
                const rankColor = i === 0 ? '#fbbf24' : i === 1 ? '#cbd5e1' : i === 2 ? '#d97706' : C.text;
                return (
                  <tr key={r.uid} style={{ background: r.uid === userId ? C.accentDim : 'transparent' }}>
                    <Td><span style={{ color: rankColor, fontWeight: 800 }}>{r.dnf ? '—' : `${i + 1}${medal ? ' ' + medal : ''}`}</span></Td>
                    <Td>{r.name}</Td>
                    {r.solves.map((s, si) => (
                      <Td key={si} align="right" style={{ fontFamily: 'JetBrains Mono, monospace', color: !s ? C.mutedDim : s.penalty === 'dnf' ? C.danger : C.text }}>
                        {!s ? '—' : s.penalty === 'dnf' ? 'DNF' : fmtMs(effectiveSolveMs(s), false, 2)}
                      </Td>
                    ))}
                    <Td align="right" style={{ color: r.dnf ? C.danger : C.success, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                      {r.dnf ? 'DNF' : fmtMs(r.average, false, 2)}
                    </Td>
                    <Td align="right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.points}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {room.maxRounds > 1 && (
        <Card>
          <SectionLabel>Standings</SectionLabel>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Rank</Th>
                <Th>Name</Th>
                <Th align="right">Total Pts</Th>
              </tr>
            </thead>
            <tbody>
              {cumulative.map((r, i) => (
                <tr key={r.uid} style={{ background: r.uid === userId ? C.accentDim : 'transparent' }}>
                  <Td><span style={{ color: i === 0 ? C.success : i < 3 ? C.accent : C.text, fontWeight: 700 }}>{i + 1}</span></Td>
                  <Td>{r.name}</Td>
                  <Td align="right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.points}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Action row */}
      {isFinalRound ? (
        <div className="mp-action-grid" style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : (isHost ? '1fr 1fr' : '1fr'),
          gap: '0.6rem',
        }}>
          {isHost && (
            <BigButton accent onClick={onPlayAgain}>Play Again</BigButton>
          )}
          <BigButton onClick={onLeave}>Leave</BigButton>
        </div>
      ) : (
        <>
          <BigButton
            accent={!me?.ready}
            onClick={onReadyForNext}
            style={isMobile ? { width: '100%' } : undefined}
          >
            {me?.ready ? 'Cancel Ready' : 'Ready for next round'}
          </BigButton>
          <div className="mp-action-grid" style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : (isHost ? '1fr 1fr' : '1fr'),
            gap: '0.6rem',
          }}>
            {isHost && (
              <BigButton
                success
                disabled={!everyoneReady}
                onClick={onNextRound}
              >
                Start Next Round
              </BigButton>
            )}
            <BigButton onClick={onLeave}>Leave</BigButton>
          </div>
          {!isHost && (
            <div style={{ textAlign: 'center', color: C.muted, fontSize: '0.78rem', padding: '0.4rem' }}>
              {everyoneReady ? 'Everyone ready — host can start.' : 'Waiting for everyone to ready up…'}
            </div>
          )}
        </>
      )}
    </div>
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
  name, isHost, isYou, right,
}: {
  name: string; isHost: boolean; isYou: boolean; right: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0.65rem',
      background: C.cardAlt, border: `1px solid ${C.border}`,
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        {isHost && <Pill color={C.accent}>Host</Pill>}
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
