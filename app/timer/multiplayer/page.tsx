'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Scrambow } from 'scrambow';
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

// ── Types ──────────────────────────────────────────────────────────────────
type Penalty = 'ok' | '+2' | 'dnf' | null;
type RoomStatus = 'waiting' | 'countdown' | 'solving' | 'results';

interface MemberData {
  name: string;
  ready: boolean;
  time: number | null;
  penalty: Penalty;
  finishedAt: number | null;
  startedAt?: number | null;
  totalPoints?: number;
}

interface RoomData {
  host: string;
  event: string;
  scramble: string;
  status: RoomStatus;
  round: number;
  maxRounds: number;
  createdAt: number;
  countdownStart?: number | null;
  raceStart?: number | null;
  members: Record<string, MemberData>;
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function MultiplayerPage() {
  const router = useRouter();

  // Identity (persisted)
  const [userId, setUserId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');

  // UI state
  const [view, setView] = useState<'lobby' | 'create' | 'join' | 'room'>('lobby');
  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Active room
  const [roomCode, setRoomCode] = useState<string>('');
  const [room, setRoom] = useState<RoomData | null>(null);

  // Initial mount: pull user id + saved name
  useEffect(() => {
    const uid = getUserId();
    setUserId(uid);
    const savedName = localStorage.getItem('mp_display_name') || '';
    setDisplayName(savedName);
    setCreateName(savedName);
    setJoinName(savedName);
  }, []);

  // Subscribe to room
  useEffect(() => {
    if (!roomCode) return;
    const r = ref(rtdb, `rooms/${roomCode}`);
    const off = onValue(r, snap => {
      const v = snap.val() as RoomData | null;
      if (!v) {
        // Room deleted (host left, etc.)
        setRoom(null);
        setRoomCode('');
        setView('lobby');
        setErrorMsg('Room no longer exists.');
        return;
      }
      setRoom(v);
    });
    return () => off();
  }, [roomCode]);

  // Auto-cleanup: when our connection drops, remove our member entry.
  // If we're the host and we leave, delete the whole room (everyone returns to lobby).
  useEffect(() => {
    if (!roomCode || !userId || !room) return;
    const isHost = room.host === userId;
    const memberRef = ref(rtdb, `rooms/${roomCode}/members/${userId}`);
    const roomRef = ref(rtdb, `rooms/${roomCode}`);
    onDisconnect(memberRef).remove();
    if (isHost) {
      onDisconnect(roomRef).remove();
    }
    return () => {
      // Cancel disconnect handlers when this effect re-runs (host change, etc.)
      onDisconnect(memberRef).cancel();
      onDisconnect(roomRef).cancel();
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
        const initial: RoomData = {
          host: uid,
          event: '333',
          scramble: generateScramble('333'),
          status: 'waiting',
          round: 1,
          maxRounds: 5,
          createdAt: Date.now(),
          countdownStart: null,
          raceStart: null,
          members: {
            [uid]: {
              name,
              ready: false,
              time: null,
              penalty: null,
              finishedAt: null,
              startedAt: null,
              totalPoints: 0,
            },
          },
        };
        await set(roomRef, initial);
        console.log('[mp] room created', code);
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
      const memberRef = ref(rtdb, `rooms/${code}/members/${uid}`);
      const memberData: MemberData = {
        name,
        ready: false,
        time: null,
        penalty: null,
        finishedAt: null,
        startedAt: null,
        totalPoints: 0,
      };
      await set(memberRef, memberData);
      console.log('[mp] joined', code);
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
    const isHost = room?.host === userId;
    if (isHost) {
      await remove(ref(rtdb, `rooms/${roomCode}`));
    } else {
      await remove(ref(rtdb, `rooms/${roomCode}/members/${userId}`));
    }
    setRoom(null);
    setRoomCode('');
    setView('lobby');
  }, [roomCode, userId, room?.host]);

  // Host controls
  const setEvent = useCallback(async (eventId: string) => {
    if (!roomCode || !room || room.host !== userId) return;
    await update(ref(rtdb, `rooms/${roomCode}`), {
      event: eventId,
      scramble: generateScramble(eventId),
    });
  }, [roomCode, room, userId]);

  const setMaxRounds = useCallback(async (n: number) => {
    if (!roomCode || !room || room.host !== userId) return;
    await update(ref(rtdb, `rooms/${roomCode}`), { maxRounds: n });
  }, [roomCode, room, userId]);

  const toggleReady = useCallback(async () => {
    if (!roomCode || !room || !userId) return;
    const me = room.members?.[userId];
    if (!me) return;
    await update(ref(rtdb, `rooms/${roomCode}/members/${userId}`), {
      ready: !me.ready,
    });
  }, [roomCode, room, userId]);

  const startRace = useCallback(async () => {
    if (!roomCode || !room || room.host !== userId) return;
    const members = Object.entries(room.members || {});
    if (members.length < 1) return;
    const allReady = members.every(([, m]) => m.ready);
    if (!allReady) return;
    // Reset member round results
    const memberUpdates: Record<string, unknown> = {};
    for (const [uid] of members) {
      memberUpdates[`members/${uid}/time`] = null;
      memberUpdates[`members/${uid}/penalty`] = null;
      memberUpdates[`members/${uid}/finishedAt`] = null;
      memberUpdates[`members/${uid}/startedAt`] = null;
    }
    // 3-second countdown, then GO. raceStart computed on each client from
    // countdownStart + 3000.
    const now = Date.now();
    await update(ref(rtdb, `rooms/${roomCode}`), {
      ...memberUpdates,
      status: 'countdown',
      countdownStart: now,
      raceStart: now + 3000,
      // keep current scramble — host already has one
    });
  }, [roomCode, room, userId]);

  const submitTime = useCallback(async (timeMs: number, penalty: Penalty) => {
    if (!roomCode || !userId) return;
    await update(ref(rtdb, `rooms/${roomCode}/members/${userId}`), {
      time: timeMs,
      penalty: penalty ?? 'ok',
      finishedAt: Date.now(),
    });
  }, [roomCode, userId]);

  const nextRound = useCallback(async () => {
    if (!roomCode || !room || room.host !== userId) return;
    const newRound = room.round + 1;
    if (newRound > room.maxRounds) {
      // End of match — back to waiting and reset rounds. Keep cumulative points.
      const memberUpdates: Record<string, unknown> = {};
      for (const uid of Object.keys(room.members || {})) {
        memberUpdates[`members/${uid}/ready`] = false;
        memberUpdates[`members/${uid}/time`] = null;
        memberUpdates[`members/${uid}/penalty`] = null;
        memberUpdates[`members/${uid}/finishedAt`] = null;
        memberUpdates[`members/${uid}/startedAt`] = null;
        memberUpdates[`members/${uid}/totalPoints`] = 0;
      }
      await update(ref(rtdb, `rooms/${roomCode}`), {
        ...memberUpdates,
        status: 'waiting',
        round: 1,
        countdownStart: null,
        raceStart: null,
        scramble: generateScramble(room.event),
      });
      return;
    }
    const memberUpdates: Record<string, unknown> = {};
    for (const uid of Object.keys(room.members || {})) {
      memberUpdates[`members/${uid}/ready`] = false;
      memberUpdates[`members/${uid}/time`] = null;
      memberUpdates[`members/${uid}/penalty`] = null;
      memberUpdates[`members/${uid}/finishedAt`] = null;
      memberUpdates[`members/${uid}/startedAt`] = null;
    }
    await update(ref(rtdb, `rooms/${roomCode}`), {
      ...memberUpdates,
      status: 'waiting',
      round: newRound,
      countdownStart: null,
      raceStart: null,
      scramble: generateScramble(room.event),
    });
  }, [roomCode, room, userId]);

  // ── Status transitions (host-driven) ─────────────────────────────────────
  // Host transitions: countdown → solving when raceStart elapses.
  useEffect(() => {
    if (!room || !roomCode) return;
    if (room.host !== userId) return;
    if (room.status !== 'countdown' || !room.raceStart) return;
    const delay = Math.max(0, room.raceStart - Date.now());
    const t = setTimeout(() => {
      update(ref(rtdb, `rooms/${roomCode}`), { status: 'solving' });
    }, delay);
    return () => clearTimeout(t);
  }, [room?.status, room?.raceStart, room?.host, roomCode, userId]);

  // Host transitions: solving → results when all members have finishedAt set.
  useEffect(() => {
    if (!room || !roomCode) return;
    if (room.host !== userId) return;
    if (room.status !== 'solving') return;
    const members = Object.values(room.members || {});
    if (members.length === 0) return;
    const allFinished = members.every(m => m.finishedAt != null);
    if (!allFinished) return;
    // Compute points and bump cumulative totals.
    const ranked = computeRanking(room.members);
    const memberUpdates: Record<string, unknown> = {};
    ranked.forEach(({ uid, points }) => {
      const prev = room.members[uid]?.totalPoints ?? 0;
      memberUpdates[`members/${uid}/totalPoints`] = prev + points;
    });
    update(ref(rtdb, `rooms/${roomCode}`), {
      ...memberUpdates,
      status: 'results',
    });
  }, [room?.status, room?.members, room?.host, roomCode, userId]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @media (max-width: 900px) {
          /* Lobby */
          .mp-lobby-buttons {
            flex-direction: column !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 1rem !important;
          }
          .mp-lobby-buttons button {
            width: 100% !important;
          }

          /* Forms (Create / Join) */
          .mp-form-shell {
            max-width: 100% !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 1.5rem 1rem !important;
            border-radius: 12px !important;
          }

          /* Waiting room / shared room shell */
          .mp-room-container {
            max-width: 100% !important;
            padding: 1rem !important;
          }

          /* Action button rows (Ready/Start, Next/Leave) */
          .mp-action-grid {
            grid-template-columns: 1fr !important;
            flex-direction: column !important;
            width: 100% !important;
          }
          .mp-action-grid button {
            width: 100% !important;
          }

          /* Results / leaderboard */
          .mp-results-container,
          .mp-leaderboard {
            max-width: 100% !important;
            padding: 0.5rem !important;
          }

          /* Room code display on waiting screen */
          .mp-room-code {
            font-size: clamp(2rem, 8vw, 4rem) !important;
          }

          /* Catch-all: any remaining inline maxWidth caps go full-width */
          [style*="max-width: 380"],
          [style*="max-width: 420"],
          [style*="max-width: 720"] {
            max-width: 100% !important;
            width: 100% !important;
          }
        }
      `}</style>

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
            onCreate={() => { setErrorMsg(''); setView('create'); }}
            onJoin={() => { setErrorMsg(''); setView('join'); }}
          />
        )}

        {view === 'create' && (
          <CreateForm
            name={createName}
            setName={setCreateName}
            onSubmit={createRoom}
            onBack={() => setView('lobby')}
          />
        )}

        {view === 'join' && (
          <JoinForm
            code={joinCode}
            setCode={setJoinCode}
            name={joinName}
            setName={setJoinName}
            onSubmit={joinRoom}
            onBack={() => setView('lobby')}
          />
        )}

        {view === 'room' && room && (
          <RoomView
            roomCode={roomCode}
            room={room}
            userId={userId}
            onToggleReady={toggleReady}
            onSetEvent={setEvent}
            onSetMaxRounds={setMaxRounds}
            onStartRace={startRace}
            onSubmitTime={submitTime}
            onNextRound={nextRound}
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
function Lobby({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div style={{
      flex: '1 1 auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '1.5rem', padding: '2rem 1rem',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'clamp(1.6rem, 6vw, 2.4rem)', fontWeight: 800, letterSpacing: '-0.02em' }}>
          Multiplayer Racing
        </div>
        <div style={{ color: C.muted, fontSize: '0.92rem', marginTop: '0.5rem' }}>
          Race friends in real time. Same scramble, live leaderboard.
        </div>
      </div>
      <div className="mp-lobby-buttons" style={{
        display: 'grid', gridTemplateColumns: '1fr', gap: '0.7rem',
        width: '100%', maxWidth: 380,
      }}>
        <BigButton accent onClick={onCreate}>Create Room</BigButton>
        <BigButton onClick={onJoin}>Join Room</BigButton>
      </div>
    </div>
  );
}

// ── CreateForm ────────────────────────────────────────────────────────────
function CreateForm({
  name, setName, onSubmit, onBack,
}: {
  name: string; setName: (v: string) => void;
  onSubmit: () => void; onBack: () => void;
}) {
  return (
    <FormShell title="Create Room" onBack={onBack}>
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
  code, setCode, name, setName, onSubmit, onBack,
}: {
  code: string; setCode: (v: string) => void;
  name: string; setName: (v: string) => void;
  onSubmit: () => void; onBack: () => void;
}) {
  return (
    <FormShell title="Join Room" onBack={onBack}>
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
      <Field label="Display name">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          maxLength={24}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
          style={inputStyle}
        />
      </Field>
      <BigButton accent onClick={onSubmit}>Join</BigButton>
    </FormShell>
  );
}

// ── RoomView (router by status) ───────────────────────────────────────────
function RoomView(props: {
  roomCode: string;
  room: RoomData;
  userId: string;
  onToggleReady: () => void;
  onSetEvent: (id: string) => void;
  onSetMaxRounds: (n: number) => void;
  onStartRace: () => void;
  onSubmitTime: (ms: number, penalty: Penalty) => void;
  onNextRound: () => void;
  onLeave: () => void;
}) {
  const { room, userId } = props;
  const isHost = room.host === userId;

  if (room.status === 'waiting') {
    return <WaitingRoom {...props} isHost={isHost} />;
  }
  if (room.status === 'countdown') {
    return <CountdownScreen {...props} isHost={isHost} />;
  }
  if (room.status === 'solving') {
    return <RacingScreen {...props} isHost={isHost} />;
  }
  return <ResultsScreen {...props} isHost={isHost} />;
}

// ── Waiting room ──────────────────────────────────────────────────────────
function WaitingRoom({
  roomCode, room, userId, isHost,
  onToggleReady, onSetEvent, onSetMaxRounds, onStartRace,
}: {
  roomCode: string; room: RoomData; userId: string; isHost: boolean;
  onToggleReady: () => void;
  onSetEvent: (id: string) => void;
  onSetMaxRounds: (n: number) => void;
  onStartRace: () => void;
  onSubmitTime: (ms: number, penalty: Penalty) => void;
  onNextRound: () => void;
  onLeave: () => void;
}) {
  const members = Object.entries(room.members || {});
  const allReady = members.length > 0 && members.every(([, m]) => m.ready);
  const me = room.members?.[userId];

  return (
    <div className="mp-room-container" style={{ width: '100%', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <RoomCodeCard code={roomCode} />

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <SectionLabel>Players ({members.length})</SectionLabel>
          <div style={{ fontSize: '0.7rem', color: C.muted }}>Round {room.round} / {room.maxRounds}</div>
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
            <Field label="Rounds">
              <select
                value={room.maxRounds}
                onChange={e => onSetMaxRounds(parseInt(e.target.value, 10))}
                style={inputStyle}
              >
                {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </div>
        </Card>
      )}

      <div className="mp-action-grid" style={{ display: 'grid', gridTemplateColumns: isHost ? '1fr 1fr' : '1fr', gap: '0.6rem' }}>
        <BigButton
          accent={!!me?.ready ? false : true}
          onClick={onToggleReady}
        >
          {me?.ready ? 'Cancel Ready' : 'Ready'}
        </BigButton>
        {isHost && (
          <BigButton
            success
            disabled={!allReady}
            onClick={onStartRace}
          >
            Start Race
          </BigButton>
        )}
      </div>
    </div>
  );
}

// ── Countdown ─────────────────────────────────────────────────────────────
function CountdownScreen({
  room,
}: {
  roomCode: string; room: RoomData; userId: string; isHost: boolean;
  onToggleReady: () => void;
  onSetEvent: (id: string) => void;
  onSetMaxRounds: (n: number) => void;
  onStartRace: () => void;
  onSubmitTime: (ms: number, penalty: Penalty) => void;
  onNextRound: () => void;
  onLeave: () => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 100);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const ms = (room.raceStart ?? 0) - Date.now();
  const big = ms > 2000 ? '3' : ms > 1000 ? '2' : ms > 0 ? '1' : 'GO!';
  const isGo = ms <= 0;

  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', padding: '2rem 1rem', textAlign: 'center' }}>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 'clamp(6rem, 28vw, 16rem)',
        fontWeight: 800, lineHeight: 0.95,
        color: isGo ? C.success : C.accent,
        textShadow: isGo ? `0 0 60px ${C.success}77` : `0 0 50px ${C.accent}55`,
        transition: 'transform 0.15s, color 0.15s',
        transform: isGo ? 'scale(1.05)' : 'scale(1)',
      }}>
        {big}
      </div>
      {isGo && (
        <div style={{
          maxWidth: 720, width: '100%',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 'clamp(0.95rem, 2.4vw, 1.4rem)',
          color: C.text, lineHeight: 1.5, letterSpacing: '0.04em',
          padding: '0.85rem 1rem',
          background: C.card, border: `1px solid ${C.borderHi}`,
          borderRadius: 12,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {room.scramble}
        </div>
      )}
    </div>
  );
}

// ── Racing screen ─────────────────────────────────────────────────────────
function RacingScreen({
  roomCode, room, userId, isHost,
  onSubmitTime,
}: {
  roomCode: string; room: RoomData; userId: string; isHost: boolean;
  onToggleReady: () => void;
  onSetEvent: (id: string) => void;
  onSetMaxRounds: (n: number) => void;
  onStartRace: () => void;
  onSubmitTime: (ms: number, penalty: Penalty) => void;
  onNextRound: () => void;
  onLeave: () => void;
}) {
  void roomCode; void isHost;
  const me = room.members?.[userId];
  const myFinished = me?.finishedAt != null;
  const raceStart = room.raceStart ?? Date.now();

  // Local timer state — runs from raceStart until I tap to stop.
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const stoppedAtRef = useRef<number | null>(null);

  // Re-render every 50ms while running.
  useEffect(() => {
    if (!running || myFinished) return;
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Date.now() - raceStart));
    }, 50);
    return () => window.clearInterval(id);
  }, [running, raceStart, myFinished]);

  // If I've already submitted (e.g. reload), reflect that.
  useEffect(() => {
    if (myFinished && me) {
      setRunning(false);
      const t = me.time ?? 0;
      setElapsed(t);
      stoppedAtRef.current = t;
    }
  }, [myFinished, me?.time]);

  const stop = useCallback(() => {
    if (myFinished || !running) return;
    const ms = Math.max(0, Date.now() - raceStart);
    stoppedAtRef.current = ms;
    setElapsed(ms);
    setRunning(false);
    onSubmitTime(ms, 'ok');
  }, [myFinished, running, raceStart, onSubmitTime]);

  const markDnf = useCallback(() => {
    if (myFinished) return;
    const ms = Math.max(0, Date.now() - raceStart);
    stoppedAtRef.current = ms;
    setElapsed(ms);
    setRunning(false);
    onSubmitTime(ms, 'dnf');
  }, [myFinished, raceStart, onSubmitTime]);

  // Spacebar to stop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !myFinished && running) {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop, myFinished, running]);

  const timerDisplay = fmtMs(elapsed, false, 2);

  return (
    <div className="mp-race-container" style={{
      flex: '1 1 auto', minHeight: 0, width: '100%', maxWidth: 1100, margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: 'auto 1fr auto',
      gap: '0.85rem',
      padding: '0.5rem 0',
    }}>
      {/* Scramble */}
      <div className="mp-race-scramble" style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 'clamp(0.85rem, 2vw, 1.2rem)',
        color: C.text, lineHeight: 1.5, letterSpacing: '0.04em',
        padding: '0.7rem 0.9rem',
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 12,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'center',
      }}>
        {room.scramble}
      </div>

      {/* Center: timer + leaderboard */}
      <div className="mp-race-grid" style={{
        display: 'grid', gridTemplateColumns: '1fr',
        gap: '0.85rem', minHeight: 0,
      }}>
        <div
          onClick={stop}
          onTouchStart={(e) => { e.preventDefault(); stop(); }}
          style={{
            background: C.card, border: `1px solid ${myFinished ? C.success : C.border}`,
            borderRadius: 16, padding: '1.5rem 1rem',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none', cursor: myFinished ? 'default' : 'pointer', textAlign: 'center',
            touchAction: 'manipulation',
            transition: 'border-color 0.15s',
            minHeight: 220,
          }}
        >
          <div style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 'clamp(3.5rem, 14vw, 7rem)',
            fontWeight: 800, lineHeight: 0.95,
            fontVariantNumeric: 'tabular-nums',
            color: myFinished ? C.success : C.text,
          }}>
            {timerDisplay}
          </div>
          <div style={{ fontSize: '0.75rem', color: C.muted, marginTop: '1rem', letterSpacing: '0.06em' }}>
            {myFinished ? 'Time submitted — waiting for others' : 'Tap or press SPACE to stop'}
          </div>
          {!myFinished && (
            <button
              onClick={(e) => { e.stopPropagation(); markDnf(); }}
              style={{
                marginTop: '1rem',
                background: 'transparent', color: C.danger,
                border: `1px solid ${C.danger}`, borderRadius: 8,
                padding: '0.4rem 0.8rem', fontSize: '0.78rem',
                fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600,
              }}
            >DNF</button>
          )}
        </div>

        <Leaderboard room={room} userId={userId} live raceStart={raceStart} />
      </div>

      <div style={{ fontSize: '0.7rem', color: C.muted, textAlign: 'center' }}>
        Round {room.round} / {room.maxRounds}
      </div>

      <style>{`
        @media (min-width: 901px) {
          .mp-race-grid { grid-template-columns: 2fr 1fr !important; }
        }
        @media (max-width: 1024px) and (orientation: portrait) {
          .mp-race-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────────
function ResultsScreen({
  room, userId, isHost,
  onNextRound, onLeave,
}: {
  roomCode: string; room: RoomData; userId: string; isHost: boolean;
  onToggleReady: () => void;
  onSetEvent: (id: string) => void;
  onSetMaxRounds: (n: number) => void;
  onStartRace: () => void;
  onSubmitTime: (ms: number, penalty: Penalty) => void;
  onNextRound: () => void;
  onLeave: () => void;
}) {
  const ranked = useMemo(() => computeRanking(room.members), [room.members]);
  const cumulative = useMemo(() => {
    return Object.entries(room.members || {})
      .map(([uid, m]) => ({ uid, name: m.name, points: m.totalPoints ?? 0 }))
      .sort((a, b) => b.points - a.points);
  }, [room.members]);

  const isFinalRound = room.round >= room.maxRounds;

  return (
    <div className="mp-room-container mp-results-container" style={{ width: '100%', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.7rem' }}>
          <SectionLabel>Round {room.round} results</SectionLabel>
          <div style={{ fontSize: '0.72rem', color: C.muted }}>{room.round} / {room.maxRounds}</div>
        </div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Rank</Th>
              <Th>Name</Th>
              <Th align="right">Time</Th>
              <Th align="right">Pts</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={r.uid} style={{ background: r.uid === userId ? C.accentDim : 'transparent' }}>
                <Td><span style={{ color: i === 0 ? C.success : i < 3 ? C.accent : C.text, fontWeight: 700 }}>{r.dnf ? '—' : i + 1}</span></Td>
                <Td>{r.name}</Td>
                <Td align="right" style={{ color: r.dnf ? C.danger : C.text, fontFamily: 'JetBrains Mono, monospace' }}>
                  {r.dnf ? 'DNF' : fmtMs(r.effectiveTime, false, 2)}
                </Td>
                <Td align="right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.points}</Td>
              </tr>
            ))}
          </tbody>
        </table>
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

      <div className="mp-action-grid" style={{ display: 'grid', gridTemplateColumns: isHost ? '1fr 1fr' : '1fr', gap: '0.6rem' }}>
        {isHost ? (
          <BigButton accent onClick={onNextRound}>
            {isFinalRound ? 'Finish & Reset' : 'Next Round'}
          </BigButton>
        ) : (
          <div style={{ textAlign: 'center', color: C.muted, fontSize: '0.82rem', padding: '0.75rem' }}>
            Waiting for host to advance the round…
          </div>
        )}
        <BigButton onClick={onLeave}>Leave</BigButton>
      </div>
    </div>
  );
}

// ── Leaderboard ──────────────────────────────────────────────────────────
function Leaderboard({
  room, userId, live, raceStart,
}: {
  room: RoomData; userId: string; live: boolean; raceStart: number;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => force(t => t + 1), 100);
    return () => window.clearInterval(id);
  }, [live]);

  const rows = useMemo(() => {
    const list = Object.entries(room.members || {}).map(([uid, m]) => ({
      uid,
      name: m.name,
      finished: m.finishedAt != null,
      time: m.time,
      penalty: m.penalty,
    }));
    // Order: finished (best first) → still solving (alphabetical)
    list.sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) {
        const aDnf = a.penalty === 'dnf';
        const bDnf = b.penalty === 'dnf';
        if (aDnf && !bDnf) return 1;
        if (!aDnf && bDnf) return -1;
        return (a.time ?? 0) - (b.time ?? 0);
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [room.members]);

  return (
    <div className="mp-leaderboard" style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '0.7rem',
      display: 'flex', flexDirection: 'column', gap: '0.35rem',
      minHeight: 0, overflow: 'auto',
    }}>
      <div style={{
        fontSize: '0.62rem', letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.muted, fontWeight: 700,
        padding: '0.1rem 0.3rem 0.4rem',
      }}>
        Live leaderboard
      </div>
      {rows.map(r => {
        const isYou = r.uid === userId;
        const dnf = r.penalty === 'dnf';
        const liveMs = !r.finished ? Math.max(0, Date.now() - raceStart) : (r.time ?? 0);
        return (
          <div key={r.uid} style={{
            display: 'grid', gridTemplateColumns: '1fr auto',
            alignItems: 'center', gap: '0.5rem',
            padding: '0.45rem 0.55rem',
            background: isYou ? C.accentDim : C.cardAlt,
            border: `1px solid ${isYou ? C.borderHi : 'transparent'}`,
            borderRadius: 10,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.name}{isYou ? ' (you)' : ''}
              </div>
              <div style={{ fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: r.finished ? (dnf ? C.danger : C.success) : C.muted, fontWeight: 700 }}>
                {r.finished ? (dnf ? 'DNF' : 'Finished') : 'Solving'}
              </div>
            </div>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontVariantNumeric: 'tabular-nums',
              fontWeight: 700, fontSize: '1rem',
              color: dnf ? C.danger : (r.finished ? C.success : C.text),
            }}>
              {dnf ? 'DNF' : fmtMs(liveMs, false, 2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Ranking helpers ──────────────────────────────────────────────────────
interface Ranked {
  uid: string;
  name: string;
  effectiveTime: number;
  dnf: boolean;
  points: number;
}

function computeRanking(members: Record<string, MemberData> | undefined): Ranked[] {
  const list: Ranked[] = Object.entries(members || {}).map(([uid, m]) => {
    const dnf = m.penalty === 'dnf' || m.time == null;
    const eff = m.time == null ? Number.MAX_SAFE_INTEGER : (m.penalty === '+2' ? m.time + 2000 : m.time);
    return { uid, name: m.name, effectiveTime: eff, dnf, points: 0 };
  });
  // Sort by dnf last, then by effective time
  list.sort((a, b) => {
    if (a.dnf && !b.dnf) return 1;
    if (!a.dnf && b.dnf) return -1;
    return a.effectiveTime - b.effectiveTime;
  });
  // Points: 1st=5, 2nd=3, 3rd=2, 4th+=1, DNF=0
  const POINTS = [5, 3, 2];
  list.forEach((r, i) => {
    if (r.dnf) r.points = 0;
    else if (i < 3) r.points = POINTS[i];
    else r.points = 1;
  });
  return list;
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

function FormShell({ title, children, onBack }: { title: string; children: React.ReactNode; onBack: () => void }) {
  void onBack;
  return (
    <div className="mp-form-shell" style={{ width: '100%', maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 800, textAlign: 'center' }}>{title}</div>
      {children}
    </div>
  );
}

function BigButton({
  children, onClick, accent, success, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  success?: boolean;
  disabled?: boolean;
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
