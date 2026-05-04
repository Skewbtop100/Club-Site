'use client';

// Multiplayer hub — replaces the bare-bones lobby with a community page:
// quick actions, live activity, personal stats, recent matches, leaderboard,
// event averages, achievements, how-to-play. The Create/Join callbacks the
// host page passes in are the same ones that previously fed the Lobby.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ref as rtdbRef, onValue } from 'firebase/database';
import { rtdb } from '@/lib/firebase';
import {
  query, orderBy, limit as fsLimit, getDocs, where, Timestamp,
} from 'firebase/firestore';
import { matchHistoryCol } from '@/lib/firebase/collections';
import {
  subscribeUserMatches, tsToMs as matchTsToMs,
} from '@/lib/firebase/services/matchHistory';
import type {
  MatchHistory, MatchPlayerSummary, MatchSolve,
} from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { awardAchievementIfNew } from '@/lib/points';
import { showToast } from '@/lib/toast';
import {
  IconUsers, IconCrown, IconTrophy, IconMedalGold, IconMedalSilver,
  IconMedalBronze, IconStar, IconDiamond, IconTarget, IconFire,
  IconRocket, IconDot, IconHourglass, IconFlag, IconGameController,
  IconBolt, IconChart, IconLock, MEDAL_GOLD,
} from '@/lib/icons';

// ── Theme ─────────────────────────────────────────────────────────────────
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
  warnDim:   'rgba(251,191,36,0.15)',
  danger:    '#ef4444',
  dangerDim: 'rgba(239,68,68,0.12)',
} as const;

// ── Events ────────────────────────────────────────────────────────────────
const EVENT_LABEL: Record<string, string> = {
  '333': '3x3', '222': '2x2', '444': '4x4', '555': '5x5',
  '666': '6x6', '777': '7x7',
  pyram: 'Pyra', skewb: 'Skewb', sq1: 'Sq-1', clock: 'Clock', minx: 'Mega',
};
const EVENT_NAME: Record<string, string> = {
  '333': '3x3x3', '222': '2x2x2', '444': '4x4x4', '555': '5x5x5',
  '666': '6x6x6', '777': '7x7x7',
  pyram: 'Pyraminx', skewb: 'Skewb', sq1: 'Square-1',
  clock: 'Clock', minx: 'Megaminx',
};
const eventLabel = (id: string): string => EVENT_LABEL[id] ?? id.toUpperCase();
const eventName  = (id: string): string => EVENT_NAME[id]  ?? id.toUpperCase();

// ── Formatting helpers ────────────────────────────────────────────────────
function fmtMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'DNF';
  const total = Math.round(ms);
  const m  = Math.floor(total / 60000);
  const s  = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  return `${s}.${String(cs).padStart(2, '0')}`;
}

function rankIcon(rank: number, size = 14): React.ReactNode {
  if (rank === 1) return <IconMedalGold size={size} />;
  if (rank === 2) return <IconMedalSilver size={size} />;
  if (rank === 3) return <IconMedalBronze size={size} />;
  return null;
}

function fmtSolveCell(s: MatchSolve): { text: string; isDNF: boolean; isPlus2: boolean } {
  if (s.penalty === 'dnf') return { text: 'DNF', isDNF: true, isPlus2: false };
  if (s.penalty === '+2')  return { text: `${fmtMs(s.ms + 2000)}+`, isDNF: false, isPlus2: true };
  return { text: fmtMs(s.ms), isDNF: false, isPlus2: false };
}

function initialOf(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// "2 цагийн өмнө" style relative timestamp.
function formatRelative(ms: number | null): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return 'Дөнгөж сая';
  const sec = Math.floor(diff / 1000);
  if (sec < 60)         return 'Дөнгөж сая';
  const min = Math.floor(sec / 60);
  if (min < 60)         return `${min} мин өмнө`;
  const hr = Math.floor(min / 60);
  if (hr < 24)          return `${hr} цагийн өмнө`;
  const day = Math.floor(hr / 24);
  if (day < 7)          return `${day} өдрийн өмнө`;
  const week = Math.floor(day / 7);
  if (week < 4)         return `${week} долоо хоногийн өмнө`;
  const month = Math.floor(day / 30);
  if (month < 12)       return `${month} сарын өмнө`;
  const year = Math.floor(day / 365);
  return `${year} жилийн өмнө`;
}

// ── Personal stats derivation ─────────────────────────────────────────────
interface PersonalStats {
  total: number;
  wins: number;
  winRate: number;
  bestAo5: number | null;
  mostPlayedEvent: string | null;
  maxStreak: number;
}

function derivePersonalStats(matches: MatchHistory[], uid: string): PersonalStats {
  if (!uid || matches.length === 0) {
    return { total: 0, wins: 0, winRate: 0, bestAo5: null, mostPlayedEvent: null, maxStreak: 0 };
  }
  let wins = 0;
  let bestAo5: number | null = null;
  const eventCounts = new Map<string, number>();

  // For win streak, walk matches in chronological order (oldest → newest).
  // subscribeUserMatches returns newest first, so reverse.
  const chronological = [...matches].reverse();
  let curStreak = 0;
  let maxStreak = 0;

  for (const m of chronological) {
    const me = m.players.find(p => p.uid === uid);
    if (!me) continue;
    const won = me.finalRank === 1;
    if (won) {
      wins += 1;
      curStreak += 1;
      if (curStreak > maxStreak) maxStreak = curStreak;
    } else {
      curStreak = 0;
    }
    for (const a of me.ao5s) {
      if (a == null) continue;
      if (bestAo5 === null || a < bestAo5) bestAo5 = a;
    }
    eventCounts.set(m.event, (eventCounts.get(m.event) ?? 0) + 1);
  }

  let mostPlayedEvent: string | null = null;
  let topCount = 0;
  for (const [ev, c] of eventCounts) {
    if (c > topCount) { topCount = c; mostPlayedEvent = ev; }
  }

  const total = matches.length;
  return {
    total,
    wins,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    bestAo5,
    mostPlayedEvent,
    maxStreak,
  };
}

// ── Per-event averages ────────────────────────────────────────────────────
interface EventAverage {
  event: string;
  avgAo5: number | null;
  count: number;
}

function deriveEventAverages(matches: MatchHistory[], uid: string): EventAverage[] {
  if (!uid) return [];
  const buckets = new Map<string, { sum: number; n: number; matchCount: number }>();
  for (const m of matches) {
    const me = m.players.find(p => p.uid === uid);
    if (!me) continue;
    const cur = buckets.get(m.event) ?? { sum: 0, n: 0, matchCount: 0 };
    cur.matchCount += 1;
    for (const a of me.ao5s) {
      if (a == null) continue;
      cur.sum += a;
      cur.n   += 1;
    }
    buckets.set(m.event, cur);
  }
  const out: EventAverage[] = [];
  for (const [event, b] of buckets) {
    out.push({ event, avgAo5: b.n > 0 ? b.sum / b.n : null, count: b.matchCount });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

// ── Achievements ──────────────────────────────────────────────────────────
// `iconKey` is a token rather than a node so the achievement list stays
// JSON-friendly (it's also serialized into toasts on unlock). The
// renderer maps the key to an SVG component at display time.
type AchievementIconKey = 'first_win' | 'streak' | 'rocket' | 'star' | 'diamond' | 'trophy';

interface Achievement {
  id: string;
  name: string;
  iconKey: AchievementIconKey;
  description: string;
  unlocked: boolean;
}

function deriveAchievements(s: PersonalStats): Achievement[] {
  return [
    { id: 'first_win',     name: 'Эхний хожил',        iconKey: 'first_win',
      description: 'Multiplayer-т эхний удаа хожих',  unlocked: s.wins >= 1 },
    { id: 'win_streak_5',  name: '5 дараалсан хожил',  iconKey: 'streak',
      description: '5 удаа дараалан хожих',           unlocked: s.maxStreak >= 5 },
    { id: 'sub_15_mp',     name: 'Sub-15 in MP',       iconKey: 'rocket',
      description: 'Multiplayer-т Ao5 < 15сек хийх',
      unlocked: s.bestAo5 !== null && s.bestAo5 < 15000 },
    { id: 'matches_10',    name: 'Туршлагатай',        iconKey: 'star',
      description: '10 тоглолт хийх',                  unlocked: s.total >= 10 },
    { id: 'matches_50',    name: 'Үнэнч тоглогч',      iconKey: 'diamond',
      description: '50 тоглолт хийх',                  unlocked: s.total >= 50 },
    { id: 'matches_100',   name: 'Чанарын тоглогч',    iconKey: 'trophy',
      description: '100 тоглолт хийх',                 unlocked: s.total >= 100 },
  ];
}

function renderAchievementIcon(
  key: AchievementIconKey,
  size: number,
  unlocked: boolean,
): React.ReactNode {
  // Color: gold-ish for unlocked, muted for locked. Diamond keeps its
  // own filled lavender look since it's the points tile.
  const color = unlocked ? MEDAL_GOLD : C.mutedDim;
  switch (key) {
    case 'first_win': return <IconMedalGold size={size} color={unlocked ? MEDAL_GOLD : C.mutedDim} />;
    case 'streak':    return <IconFire size={size} color={unlocked ? '#f97316' : C.mutedDim} />;
    case 'rocket':    return <IconRocket size={size} color={unlocked ? C.accent : C.mutedDim} />;
    case 'star':      return <IconStar size={size} color={color} />;
    case 'diamond':   return <IconDiamond size={size} color={unlocked ? C.accent : C.mutedDim} />;
    case 'trophy':    return <IconTrophy size={size} color={color} />;
  }
}

// ── Leaderboard ───────────────────────────────────────────────────────────
type LbPeriod = '7d' | '30d' | 'all';

interface LeaderboardEntry {
  uid: string;
  name: string;
  photoURL: string | null;
  athleteId: string | null;
  total: number;
  wins: number;
  winRate: number;
}

interface LeaderboardData {
  entries: LeaderboardEntry[];
  myRank: number | null;
  myEntry: LeaderboardEntry | null;
}

function aggregateLeaderboard(
  matches: MatchHistory[],
  cutoffMs: number | null,
  uid: string,
): LeaderboardData {
  const buckets = new Map<string, LeaderboardEntry>();
  for (const m of matches) {
    const playedMs = matchTsToMs(m.playedAt);
    if (cutoffMs !== null && (playedMs == null || playedMs < cutoffMs)) continue;
    for (const p of m.players) {
      let cur = buckets.get(p.uid);
      if (!cur) {
        cur = {
          uid: p.uid,
          name: p.name,
          photoURL: p.photoURL,
          athleteId: p.athleteId,
          total: 0,
          wins: 0,
          winRate: 0,
        };
        buckets.set(p.uid, cur);
      }
      cur.total += 1;
      if (p.finalRank === 1) cur.wins += 1;
      // Latest snapshot of name/photo wins (we walk newest-first below).
      // Since `matches` is already newest-first from caller, the FIRST one
      // we see for a uid is the freshest — only overwrite if we haven't.
    }
  }
  const all = [...buckets.values()];
  for (const e of all) {
    e.winRate = e.total > 0 ? Math.round((e.wins / e.total) * 100) : 0;
  }
  all.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.total - a.total;
  });

  let myRank: number | null = null;
  let myEntry: LeaderboardEntry | null = null;
  if (uid) {
    const idx = all.findIndex(e => e.uid === uid);
    if (idx >= 0) {
      myRank = idx + 1;
      myEntry = all[idx];
    }
  }
  return { entries: all.slice(0, 10), myRank, myEntry };
}

// ── Live activity hook ────────────────────────────────────────────────────
//
// Subscribes to `rooms/` and surfaces both aggregate counts and the full
// room/member detail the expanded panels need. We deliberately key
// everything by mp_user_id (the RTDB room.members key) — that's a
// localStorage-scoped random ID and NOT the Firebase auth uid, so any
// per-uid data we surface is the multiplayer identity, not the auth user.

export interface ActiveMember {
  /** RTDB key — the localStorage mp_user_id, NOT the Firebase auth uid. */
  uid: string;
  name: string;
  connected: boolean;
  lastHeartbeat: number;
  currentSolve: number;
  roundAverage: number | null;
  totalPoints: number;
  /** Set when the member joined while a race was already in progress. */
  queued?: boolean;
}

export interface ActiveRoom {
  /** Internal key — never displayed to the user. */
  code: string;
  status: 'waiting' | 'racing';
  event: string;
  round: number;
  maxRounds: number;
  hostUid: string;
  hostName: string;
  members: ActiveMember[];
  createdAt: number;
}

interface LiveActivity {
  activeRooms: number;
  totalPlayers: number;
  currentlyRacing: number;
  loaded: boolean;
  rooms: ActiveRoom[];
}

// Staleness thresholds — we don't trust the `connected` flag on its own
// because clients sometimes lose their `onDisconnect` handler (refresh
// before it registers, mobile app-switch killing the websocket without
// firing `onDisconnect`, etc.). Heartbeat age is the source of truth:
//
//   ≤ 15s — Online (counted in "Online хүн" + "Уралдаж байгаа").
//   ≤ 30s — Tolerated for the room itself; it stays in the active list
//           as long as at least one member is within this window.
//   > 60s — Abandoned. Member is hidden everywhere and a room with all
//           members past this threshold disappears from the hub.
//
// `lastHeartbeat === 0` is the "just joined, server hasn't written one
// yet" marker — treated as online. Same convention as the in-room
// connection-status checker.
const HB_ONLINE_MS    = 15_000;
const HB_ROOM_OK_MS   = 30_000;
const HB_ABANDONED_MS = 60_000;
// Auto-stale rooms older than this regardless of heartbeats. Mirrors the
// 24h ROOM_TTL_MS in the multiplayer page but tighter — the hub list is
// for "happening now", not "still technically alive".
const ROOM_AGE_CAP_MS = 6 * 60 * 60 * 1000;

function isMemberOnline(lastHeartbeat: number, now: number): boolean {
  if (lastHeartbeat === 0) return true;
  return (now - lastHeartbeat) <= HB_ONLINE_MS;
}
function isMemberRoomActive(lastHeartbeat: number, now: number): boolean {
  if (lastHeartbeat === 0) return true;
  return (now - lastHeartbeat) <= HB_ROOM_OK_MS;
}
function isMemberAbandoned(lastHeartbeat: number, now: number): boolean {
  if (lastHeartbeat === 0) return false;
  return (now - lastHeartbeat) > HB_ABANDONED_MS;
}

// Raw RTDB snapshot shape — narrow enough that the compute step doesn't
// need to repeat all the runtime guards.
type RawRoomMap = Record<string, {
  status?: string;
  event?: string;
  round?: number;
  maxRounds?: number;
  host?: string;
  createdAt?: number;
  members?: Record<string, {
    name?: string;
    connected?: boolean;
    lastHeartbeat?: number;
    currentSolve?: number;
    roundAverage?: number | null;
    totalPoints?: number;
    queued?: boolean;
  }>;
}> | null;

function deriveLiveActivity(val: RawRoomMap, now: number): Omit<LiveActivity, 'loaded'> {
  const rooms: ActiveRoom[] = [];
  let totalPlayers = 0;
  let currentlyRacing = 0;
  if (val) {
    for (const code of Object.keys(val)) {
      const room = val[code];
      if (!room) continue;
      // Only waiting/racing rooms are "active". 'results' is the
      // post-match screen — not visible in the hub. Anything else
      // (legacy, unknown) is dropped.
      const status = room.status;
      if (status !== 'waiting' && status !== 'racing') continue;
      // Hard age cap — older rooms are stale regardless of state.
      const createdAt = typeof room.createdAt === 'number' ? room.createdAt : 0;
      if (createdAt > 0 && (now - createdAt) > ROOM_AGE_CAP_MS) continue;

      const memberMap = room.members ?? {};
      const members: ActiveMember[] = [];
      for (const uid of Object.keys(memberMap)) {
        const m = memberMap[uid] ?? {};
        const lastHeartbeat = typeof m.lastHeartbeat === 'number' ? m.lastHeartbeat : 0;
        const explicitlyOffline = m.connected === false;
        // Drop members the client has explicitly marked offline OR
        // whose heartbeat puts them past the abandoned threshold.
        // The room-active threshold (30s) decides which members
        // KEEP a room visible; for inclusion in the per-member
        // lists we use the stricter 15s online check downstream.
        if (explicitlyOffline) continue;
        if (isMemberAbandoned(lastHeartbeat, now)) continue;
        members.push({
          uid,
          name: typeof m.name === 'string' && m.name.length > 0 ? m.name : 'Player',
          connected: true,
          lastHeartbeat,
          currentSolve: typeof m.currentSolve === 'number' ? m.currentSolve : 0,
          roundAverage: typeof m.roundAverage === 'number' ? m.roundAverage : null,
          totalPoints: typeof m.totalPoints === 'number' ? m.totalPoints : 0,
          queued: m.queued === true,
        });
      }
      if (members.length === 0) continue;
      // Need at least one member with a recent heartbeat (≤30s) for
      // the room to count as "alive". A room of survivors who all
      // went silent ~45s ago is dropped here even though they're
      // not yet at the 60s abandoned threshold.
      const anyAlive = members.some(m => isMemberRoomActive(m.lastHeartbeat, now));
      if (!anyAlive) continue;

      totalPlayers += members.filter(m => isMemberOnline(m.lastHeartbeat, now)).length;
      if (status === 'racing') {
        currentlyRacing += members.filter(m =>
          !m.queued && isMemberOnline(m.lastHeartbeat, now)
        ).length;
      }
      const hostUid = typeof room.host === 'string' ? room.host : '';
      const hostMember = members.find(m => m.uid === hostUid);
      rooms.push({
        code,
        status,
        event: typeof room.event === 'string' ? room.event : '333',
        round: typeof room.round === 'number' ? room.round : 1,
        maxRounds: typeof room.maxRounds === 'number' ? room.maxRounds : 1,
        hostUid,
        hostName: hostMember?.name ?? memberMap[hostUid]?.name ?? '',
        members,
        createdAt,
      });
    }
  }
  // Newest first feels right for "what's happening now".
  rooms.sort((a, b) => b.createdAt - a.createdAt);
  return { activeRooms: rooms.length, totalPlayers, currentlyRacing, rooms };
}

function useLiveActivity(): LiveActivity {
  // Two-stage state: raw RTDB snapshot kept in a ref-like state so we
  // can re-derive on every minute tick (heartbeat staleness changes
  // even when the snapshot doesn't), and the derived view that
  // components actually read.
  const [raw, setRaw] = useState<RawRoomMap>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const r = rtdbRef(rtdb, 'rooms');
    const unsub = onValue(
      r,
      (snap) => { setRaw(snap.val() as RawRoomMap); setLoaded(true); },
      ()    => { setLoaded(true); },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return useMemo<LiveActivity>(() => {
    const derived = deriveLiveActivity(raw, Date.now());
    return { ...derived, loaded };
    // tick intentionally included — it's a "now-changed" pulse so the
    // memo recomputes against a fresh Date.now() / heartbeat windows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, loaded, tick]);
}

// ── Leaderboard hook (with 5-min module-level cache) ──────────────────────
interface CachedLb { entries: MatchHistory[]; ts: number }
const LB_CACHE: Map<LbPeriod, CachedLb> = new Map();
const LB_CACHE_MS = 5 * 60 * 1000;

function useLeaderboardMatches(period: LbPeriod): { matches: MatchHistory[]; loaded: boolean } {
  const [matches, setMatches] = useState<MatchHistory[]>(
    () => LB_CACHE.get(period)?.entries ?? [],
  );
  const [loaded, setLoaded] = useState(() => {
    const c = LB_CACHE.get(period);
    return !!c && (Date.now() - c.ts) < LB_CACHE_MS;
  });

  useEffect(() => {
    let cancelled = false;
    const cached = LB_CACHE.get(period);
    if (cached && (Date.now() - cached.ts) < LB_CACHE_MS) {
      setMatches(cached.entries);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    (async () => {
      try {
        let q;
        if (period === 'all') {
          q = query(matchHistoryCol, orderBy('playedAt', 'desc'), fsLimit(300));
        } else {
          const days = period === '7d' ? 7 : 30;
          const cutoff = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);
          q = query(
            matchHistoryCol,
            where('playedAt', '>=', cutoff),
            orderBy('playedAt', 'desc'),
            fsLimit(500),
          );
        }
        const snap = await getDocs(q);
        const rows = snap.docs.map(d => d.data());
        if (cancelled) return;
        LB_CACHE.set(period, { entries: rows, ts: Date.now() });
        setMatches(rows);
        setLoaded(true);
      } catch (err) {
        console.error('[hub] leaderboard fetch', err);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [period]);

  return { matches, loaded };
}

// ── Avatar thumbnail (mirrors AthleteThumb in profile page) ───────────────
function Thumb({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
      color: '#fff', fontSize: size * 0.42, fontWeight: 800, lineHeight: 1,
      flexShrink: 0,
    }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : initialOf(name)}
    </span>
  );
}

// ── Section card wrapper ──────────────────────────────────────────────────
function Section({
  icon, title, action, children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: '1rem 1.1rem 1.1rem',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '0.5rem', marginBottom: '0.85rem',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.01em',
          color: C.text,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: C.accent,
          }}>{icon}</span>
          <span>{title}</span>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function StatTile({
  label, value, accent, mono, sublabel,
}: {
  label: string;
  value: string;
  accent?: string;
  mono?: boolean;
  sublabel?: string;
}) {
  return (
    <div style={{
      padding: '0.7rem 0.8rem', borderRadius: 12,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', gap: '0.2rem',
      minWidth: 0,
    }}>
      <div style={{
        fontSize: '0.62rem', color: C.muted, letterSpacing: '0.1em',
        textTransform: 'uppercase', fontWeight: 700,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.25rem', fontWeight: 800,
        color: accent ?? C.text,
        fontFamily: mono ? 'JetBrains Mono, monospace' : undefined,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.66rem', color: C.mutedDim, fontWeight: 600 }}>{sublabel}</div>
      )}
    </div>
  );
}

// ── Section: Live Activity ────────────────────────────────────────────────
//
// Three clickable counters that expand a detail panel beneath the card.
// Single-open accordion: clicking a different tile collapses the prior
// one; clicking the same tile collapses it.

type LivePanel = 'rooms' | 'online' | 'racing' | null;

function LiveActivityCard({ onJoinRoom }: { onJoinRoom?: (code: string) => void }) {
  const live = useLiveActivity();
  const [panel, setPanel] = useState<LivePanel>(null);
  const [openRoom, setOpenRoom] = useState<ActiveRoom | null>(null);
  // Per-row "Нэгдэх" target — opens the code-entry modal pre-scoped
  // to that specific room. Cleared when the modal closes or join
  // succeeds. We keep it separate from openRoom so the detail modal
  // and join modal don't fight over the same slot.
  const [joinTarget, setJoinTarget] = useState<ActiveRoom | null>(null);

  // Keep `openRoom` in sync with the live snapshot so the modal updates
  // its content as the underlying room mutates (members joining/leaving,
  // round flipping racing/results).
  useEffect(() => {
    if (!openRoom) return;
    const fresh = live.rooms.find(r => r.code === openRoom.code);
    if (!fresh) {
      // Room ended (status became 'results' or was deleted) — close.
      setOpenRoom(null);
      return;
    }
    if (fresh !== openRoom) setOpenRoom(fresh);
  }, [live.rooms, openRoom]);

  // Same freshness sync for the join-target room — if it disappears
  // (host closed it, all members went stale) we close the join modal.
  useEffect(() => {
    if (!joinTarget) return;
    const fresh = live.rooms.find(r => r.code === joinTarget.code);
    if (!fresh) { setJoinTarget(null); return; }
    if (fresh !== joinTarget) setJoinTarget(fresh);
  }, [live.rooms, joinTarget]);

  const togglePanel = (next: LivePanel) => {
    setPanel(curr => (curr === next ? null : next));
  };

  return (
    <Section
      icon={<IconDot size={12} color={C.success} />}
      title="Шууд тоглолт"
      action={
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontSize: '0.68rem', color: C.success, fontWeight: 700,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: C.success,
            boxShadow: `0 0 0 0 ${C.success}`,
            animation: 'mphPulse 1.6s ease-out infinite',
          }} />
          LIVE
        </span>
      }
    >
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '0.55rem',
      }}>
        <ClickableStatTile
          label="Идэвхтэй"
          value={live.loaded ? String(live.activeRooms) : '—'}
          accent={C.accent}
          active={panel === 'rooms'}
          onClick={() => togglePanel('rooms')}
        />
        <ClickableStatTile
          label="Online"
          value={live.loaded ? String(live.totalPlayers) : '—'}
          accent={C.success}
          active={panel === 'online'}
          onClick={() => togglePanel('online')}
        />
        <ClickableStatTile
          label="Уралдаж"
          value={live.loaded ? String(live.currentlyRacing) : '—'}
          accent={C.warn}
          active={panel === 'racing'}
          onClick={() => togglePanel('racing')}
        />
      </div>

      {panel === 'rooms' && (
        <ActiveRoomsPanel
          rooms={live.rooms}
          onOpen={setOpenRoom}
          onJoin={onJoinRoom ? setJoinTarget : undefined}
        />
      )}
      {panel === 'online' && (
        <OnlineUsersPanel rooms={live.rooms} mode="online" />
      )}
      {panel === 'racing' && (
        <OnlineUsersPanel rooms={live.rooms} mode="racing" />
      )}

      {openRoom && (
        <RoomDetailModal room={openRoom} onClose={() => setOpenRoom(null)} />
      )}

      {joinTarget && onJoinRoom && (
        <JoinByCodeModal
          room={joinTarget}
          onClose={() => setJoinTarget(null)}
          onJoin={(code) => {
            setJoinTarget(null);
            onJoinRoom(code);
          }}
        />
      )}

      <style>{`
        @keyframes mphPulse {
          0%   { box-shadow: 0 0 0 0 rgba(52,211,153,0.6); }
          70%  { box-shadow: 0 0 0 8px rgba(52,211,153,0); }
          100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
        }
      `}</style>
    </Section>
  );
}

function ClickableStatTile({
  label, value, accent, active, onClick,
}: {
  label: string; value: string; accent?: string;
  active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      style={{
        padding: '0.65rem 0.6rem', borderRadius: 12,
        background: active ? C.accentDim : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? C.borderHi : C.border}`,
        display: 'flex', flexDirection: 'column', gap: '0.18rem',
        minWidth: 0,
        color: C.text, fontFamily: 'inherit', cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '0.25rem',
      }}>
        {/* Tighter typography — short label words ("Идэвхтэй", "Online",
            "Уралдаж") fit in even the narrowest 3-col mobile layout
            without ellipsis. We deliberately drop the overflow:hidden
            cascade so a slightly-too-wide label wraps to a second line
            instead of being silently clipped. */}
        <span style={{
          fontSize: '0.58rem', color: C.muted, letterSpacing: '0.06em',
          textTransform: 'uppercase', fontWeight: 700,
          lineHeight: 1.2,
        }}>{label}</span>
        <span aria-hidden="true" style={{
          fontSize: '0.7rem', color: C.muted,
          transform: active ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
          flexShrink: 0,
        }}>▾</span>
      </div>
      <div style={{
        fontSize: '1.25rem', fontWeight: 800,
        color: accent ?? C.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </button>
  );
}

// ── Connection-status helper ──────────────────────────────────────────────
//
// Mirrors the multiplayer page's getConnectionStatus thresholds so the
// hub's connection dots match what players inside the room see.
const HEARTBEAT_GOOD_MS = 12000;
const HEARTBEAT_WEAK_MS = 25000;

function memberConnectionDot(m: ActiveMember, now: number): {
  color: string; label: string;
} {
  if (!m.connected) return { color: C.danger, label: 'Disconnected' };
  if (m.lastHeartbeat === 0) return { color: C.success, label: 'Online' };
  const age = now - m.lastHeartbeat;
  if (age <= HEARTBEAT_GOOD_MS) return { color: C.success, label: 'Online' };
  if (age <= HEARTBEAT_WEAK_MS) return { color: C.warn,    label: 'Сул' };
  return { color: C.danger, label: 'Disconnected' };
}

function statusLabel(status: 'waiting' | 'racing'): string {
  return status === 'racing' ? 'Уралдаж байна' : 'Хүлээж байна';
}
function StatusIcon({ status, size = 14 }: { status: 'waiting' | 'racing'; size?: number }) {
  return status === 'racing'
    ? <IconFlag size={size} color={C.warn} />
    : <IconHourglass size={size} color={C.muted} />;
}

// "5 мин өмнө эхэлсэн" / "10 мин өмнө үүссэн" — distinguishes racing
// from waiting since the room schema only exposes createdAt (no
// per-status timestamps).
function formatRoomAge(createdAtMs: number, status: 'waiting' | 'racing'): string {
  if (!createdAtMs) return '';
  const verb = status === 'racing' ? 'эхэлсэн' : 'үүссэн';
  const diff = Math.max(0, Date.now() - createdAtMs);
  const min = Math.floor(diff / 60000);
  if (min < 1) return `Дөнгөж сая ${verb}`;
  if (min < 60) return `${min} мин өмнө ${verb}`;
  const hr = Math.floor(min / 60);
  return `${hr} цагийн өмнө ${verb}`;
}

function panelStyle(): React.CSSProperties {
  return {
    marginTop: '0.85rem',
    background: 'rgba(255,255,255,0.02)',
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: '0.75rem',
    display: 'flex', flexDirection: 'column', gap: '0.5rem',
    animation: 'mphFade 0.18s ease-out',
  };
}

// ── Active rooms panel ────────────────────────────────────────────────────
function ActiveRoomsPanel({
  rooms, onOpen, onJoin,
}: {
  rooms: ActiveRoom[];
  onOpen: (r: ActiveRoom) => void;
  onJoin?: (r: ActiveRoom) => void;
}) {
  if (rooms.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={{ color: C.muted, fontSize: '0.86rem', textAlign: 'center' }}>
          Идэвхтэй өрөө байхгүй байна
        </div>
      </div>
    );
  }
  return (
    <div style={panelStyle()}>
      {rooms.map(r => (
        <ActiveRoomRow
          key={r.code}
          room={r}
          onOpen={() => onOpen(r)}
          onJoin={onJoin ? () => onJoin(r) : undefined}
        />
      ))}
      <style>{`
        @keyframes mphFade {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function ActiveRoomRow({ room, onOpen, onJoin }: {
  room: ActiveRoom;
  onOpen: () => void;
  onJoin?: () => void;
}) {
  const playerNames = room.members.slice(0, 3).map(m => m.name).join(', ');
  const extra = Math.max(0, room.members.length - 3);
  const hostName = room.hostName || '—';
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${C.border}`,
      borderRadius: 11,
      padding: '0.7rem 0.8rem',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.55rem',
        flexWrap: 'wrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden="true">
          <StatusIcon status={room.status} size={14} />
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 0.45rem', height: 22, borderRadius: 7,
          background: C.accentDim, border: `1px solid ${C.borderHi}`,
          fontSize: '0.7rem', fontWeight: 800, color: '#c4b5fd',
        }}>{eventLabel(room.event)}</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: C.text }}>
          {room.members.length} тоглогч
        </span>
        {room.status === 'racing' && (
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: C.warn }}>
            Round {room.round}/{room.maxRounds}
          </span>
        )}
        <span style={{
          marginLeft: 'auto',
          fontSize: '0.7rem', color: C.muted,
        }}>{formatRoomAge(room.createdAt, room.status)}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontSize: '0.78rem', color: C.text, fontWeight: 600,
        }}>
          <IconCrown size={13} color={MEDAL_GOLD} aria-hidden="true" />
          <span>{hostName}</span>
        </div>
        <div style={{
          fontSize: '0.74rem', color: C.muted,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {playerNames}{extra > 0 ? ` +${extra}` : ''}
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        gap: '0.4rem', flexWrap: 'wrap',
      }}>
        <button
          type="button"
          onClick={onOpen}
          style={{
            background: 'transparent', color: C.accent,
            border: `1px solid ${C.borderHi}`,
            borderRadius: 8, padding: '0.32rem 0.7rem',
            fontSize: '0.74rem', fontWeight: 700,
            fontFamily: 'inherit', cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >Дэлгэрэнгүй</button>
        {onJoin && (
          <button
            type="button"
            onClick={onJoin}
            style={{
              background: C.accent, color: '#0a0a0a',
              border: `1px solid ${C.accent}`,
              borderRadius: 8, padding: '0.32rem 0.75rem',
              fontSize: '0.74rem', fontWeight: 800,
              fontFamily: 'inherit', cursor: 'pointer',
              letterSpacing: '0.02em',
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
            }}
          >Нэгдэх <span aria-hidden="true">→</span></button>
        )}
      </div>
    </div>
  );
}

// ── Online / Racing users panel ───────────────────────────────────────────
function OnlineUsersPanel({
  rooms, mode,
}: { rooms: ActiveRoom[]; mode: 'online' | 'racing' }) {
  // Build a flat list — one row per (uid, room). The same mp_user_id can
  // (in theory) appear in multiple rooms if a user joined multiple in
  // different tabs, so de-duping by uid alone would lose information.
  // Keys are `${uid}@${roomCode}` to allow that without React warnings.
  //
  // Both modes apply the 15s heartbeat freshness gate at row-build time
  // (the upstream hook only filters at the 60s "abandoned" threshold so
  // that a room with one stale member still surfaces its alive ones).
  const now = Date.now();
  const rows: { member: ActiveMember; room: ActiveRoom }[] = [];
  for (const room of rooms) {
    if (mode === 'racing' && room.status !== 'racing') continue;
    for (const member of room.members) {
      if (!isMemberOnline(member.lastHeartbeat, now)) continue;
      if (mode === 'racing' && member.queued) continue;
      rows.push({ member, room });
    }
  }
  if (rows.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={{ color: C.muted, fontSize: '0.86rem', textAlign: 'center' }}>
          {mode === 'online'
            ? 'Online хүн байхгүй байна'
            : 'Одоогоор хэн ч уралдаагүй байна'}
        </div>
      </div>
    );
  }
  return (
    <div style={panelStyle()}>
      {rows.map(({ member, room }) => (
        <OnlineUserRow
          key={`${member.uid}@${room.code}`}
          member={member}
          room={room}
          now={now}
          mode={mode}
        />
      ))}
    </div>
  );
}

function OnlineUserRow({
  member, room, now, mode,
}: {
  member: ActiveMember; room: ActiveRoom; now: number;
  mode: 'online' | 'racing';
}) {
  const dot = memberConnectionDot(member, now);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0.7rem',
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${C.border}`,
      borderRadius: 11,
    }}>
      <Thumb name={member.name} url={null} size={32} />
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontSize: '0.86rem', fontWeight: 700, color: C.text,
          maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: dot.color, flexShrink: 0,
          }} />
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{member.name}</span>
        </div>
        <div style={{
          fontSize: '0.72rem', color: C.muted, marginTop: '0.1rem',
        }}>
          {mode === 'racing' ? (
            <>
              {eventLabel(room.event)} · Round {room.round}/{room.maxRounds}
              {' · '}
              <span style={{ color: C.text, fontWeight: 700 }}>
                Solve {Math.min(member.currentSolve + 1, 5)}/5
              </span>
            </>
          ) : (
            <>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                verticalAlign: 'middle',
              }}>
                <StatusIcon status={room.status} size={11} />
                {statusLabel(room.status)}
              </span>
              {' · '}{eventLabel(room.event)} өрөөнд
              {member.queued && <span style={{ color: C.warn }}>{' · '}queued</span>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Room detail modal ─────────────────────────────────────────────────────
function RoomDetailModal({
  room, onClose,
}: { room: ActiveRoom; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 1Hz tick so connection dots reflect heartbeat staleness while the
  // modal is open. Cheap (single setInterval, no re-fetch).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const sortedMembers = useMemo(() => {
    // Active members first (highest totalPoints), queued at the bottom.
    const active = room.members.filter(m => !m.queued)
      .slice()
      .sort((a, b) => b.totalPoints - a.totalPoints);
    const queued = room.members.filter(m => m.queued);
    return { active, queued };
  }, [room.members]);

  const showStandings = sortedMembers.active.some(m => m.totalPoints > 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520,
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 2rem)', overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.95rem 1rem',
          borderBottom: `1px solid ${C.border}`,
          gap: '0.6rem',
        }}>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              fontSize: '0.95rem', fontWeight: 800,
            }}>
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <StatusIcon status={room.status} size={16} />
              </span>
              <span>{statusLabel(room.status)}</span>
            </div>
            <div style={{ fontSize: '0.76rem', color: C.muted }}>
              {eventName(room.event)} · {room.maxRounds} раунд
              {room.status === 'racing' && (
                <> · Round {room.round} of {room.maxRounds}</>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Хаах"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >×</button>
        </header>

        <div style={{
          padding: '1rem', overflow: 'auto',
          display: 'flex', flexDirection: 'column', gap: '1rem',
        }}>
          <section>
            <SectionHeading>Тоглогчид</SectionHeading>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {sortedMembers.active.map(m => (
                <RoomDetailMemberRow
                  key={m.uid}
                  member={m}
                  isHost={m.uid === room.hostUid}
                  racing={room.status === 'racing'}
                  now={now}
                  queued={false}
                />
              ))}
              {sortedMembers.queued.length > 0 && (
                <>
                  <div style={{
                    fontSize: '0.66rem', fontWeight: 700, color: C.muted,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    marginTop: '0.4rem',
                  }}>Хүлээж байгаа</div>
                  {sortedMembers.queued.map(m => (
                    <RoomDetailMemberRow
                      key={m.uid}
                      member={m}
                      isHost={m.uid === room.hostUid}
                      racing={room.status === 'racing'}
                      now={now}
                      queued
                    />
                  ))}
                </>
              )}
            </div>
          </section>

          {showStandings && (
            <section>
              <SectionHeading>Эрэмбэ</SectionHeading>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {sortedMembers.active.map((m, i) => (
                  <div key={m.uid} style={{
                    display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.45rem 0.65rem',
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 9,
                    fontSize: '0.82rem',
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 6,
                      background: i === 0 ? 'rgba(251,191,36,0.16)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${C.border}`,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.7rem', fontWeight: 800,
                      color: i === 0 ? C.warn : C.text, flexShrink: 0,
                    }}>{i + 1}</span>
                    <span style={{
                      flex: '1 1 auto', minWidth: 0, fontWeight: 700,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{m.name}</span>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', color: C.text, fontWeight: 800,
                    }}>
                      {m.totalPoints}
                      <span style={{ color: C.muted, fontWeight: 600 }}> оноо</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Join-by-code modal (per active-room row) ──────────────────────────────
// The active rooms list shows everyone what's happening, but the codes
// stay private — joining still requires the code from the host. This
// modal is the gate: it pre-scopes to one room's context, the user
// types the code, and we compare locally before delegating to the
// existing join flow (which still handles mid-round queueing, etc.).
function JoinByCodeModal({
  room, onClose, onJoin,
}: {
  room: ActiveRoom;
  onClose: () => void;
  onJoin: (code: string) => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const onChange = (raw: string) => {
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(cleaned);
    if (error) setError('');
  };

  const submit = () => {
    if (code.length !== 6) return;
    if (code !== room.code.toUpperCase()) {
      setError('Код буруу байна');
      return;
    }
    onJoin(code);
  };

  const canSubmit = code.length === 6;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1600,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 2rem)', overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.95rem 1rem',
          borderBottom: `1px solid ${C.border}`,
          gap: '0.6rem',
        }}>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: C.text }}>
              Өрөөнд нэгдэх
            </div>
            <div style={{
              fontSize: '0.76rem', color: C.muted,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <span aria-hidden="true" style={{
                display: 'inline-flex', verticalAlign: 'middle', marginRight: '0.3rem',
              }}>
                <StatusIcon status={room.status} size={12} />
              </span>
              {eventLabel(room.event)} · Host: {room.hostName || '—'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Хаах"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >×</button>
        </header>

        <div style={{
          padding: '1rem',
          display: 'flex', flexDirection: 'column', gap: '0.85rem',
        }}>
          <div>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              marginBottom: '0.35rem',
            }}>
              <label
                htmlFor="mph-join-code"
                style={{
                  fontSize: '0.7rem', fontWeight: 700, color: C.muted,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >Өрөөний код</label>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.72rem', color: C.muted, fontWeight: 700,
              }}>{code.length} / 6</span>
            </div>
            <input
              id="mph-join-code"
              autoFocus
              value={code}
              onChange={e => onChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder="ABC123"
              maxLength={6}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: C.cardAlt, color: C.text,
                border: `1px solid ${error ? C.danger : C.border}`,
                borderRadius: 12, padding: '0.85rem 1rem',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '1.4rem', fontWeight: 800,
                letterSpacing: '0.25em', textAlign: 'center',
                outline: 'none',
              }}
            />
            <div style={{
              fontSize: '0.74rem', color: error ? C.danger : C.muted,
              marginTop: '0.4rem',
            }}>
              {error || 'Өрөөний эзэмшигчээс кодыг авна уу'}
            </div>
          </div>

          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '0.6rem 0.75rem',
            fontSize: '0.74rem', color: C.muted, lineHeight: 1.45,
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              verticalAlign: 'middle',
            }} aria-hidden="true">
              <IconLock size={12} />
            </span>{' '}Өрөө хувийн (private). Кодыг өрөөнд нэгдсэн хүнээс л авах боломжтой.
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem',
            marginTop: '0.2rem',
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: C.cardAlt, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 12,
                padding: '0.8rem 1rem', fontSize: '0.92rem', fontWeight: 800,
                fontFamily: 'inherit', cursor: 'pointer',
                letterSpacing: '0.02em',
              }}
            >Болих</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              style={{
                background: canSubmit ? C.accent : 'rgba(167,139,250,0.25)',
                color: canSubmit ? '#0a0a0a' : C.muted,
                border: 'none', borderRadius: 12,
                padding: '0.8rem 1rem', fontSize: '0.92rem', fontWeight: 800,
                fontFamily: 'inherit',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                letterSpacing: '0.02em',
              }}
            >Нэгдэх</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoomDetailMemberRow({
  member, isHost, racing, now, queued,
}: {
  member: ActiveMember; isHost: boolean; racing: boolean; now: number;
  queued: boolean;
}) {
  const dot = memberConnectionDot(member, now);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.55rem',
      padding: '0.55rem 0.7rem',
      background: queued ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      opacity: queued ? 0.6 : 1,
    }}>
      <Thumb name={member.name} url={null} size={32} />
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontSize: '0.86rem', fontWeight: 700, color: C.text,
          maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: dot.color, flexShrink: 0,
          }} />
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{member.name}</span>
          {isHost && <IconCrown size={12} color={MEDAL_GOLD} aria-hidden="true" />}
        </div>
        <div style={{
          fontSize: '0.72rem', color: C.muted, marginTop: '0.1rem',
        }}>
          {racing && !queued ? (
            <>
              <span style={{ color: C.text, fontWeight: 700 }}>
                Solve {Math.min(member.currentSolve + 1, 5)}/5
              </span>
              {member.roundAverage != null && (
                <>
                  {' · '}
                  Энэ round-н Ao5{' '}
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', color: C.text, fontWeight: 700,
                  }}>{fmtMs(member.roundAverage)}</span>
                </>
              )}
            </>
          ) : queued ? (
            'Дараагийн round-ыг хүлээж байна'
          ) : (
            'Бэлэн'
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section: Personal Stats ───────────────────────────────────────────────
// Surfaced when subscribeUserMatches errors out (most often: missing
// composite Firestore index). The hub's match-derived sections render
// this in place of their normal empty-state copy so users see the
// problem instead of "Анхны тоглолтоо хий!" misleadingly.
const MATCHES_ERROR_TEXT = 'Тоглолтын түүх ачааллагдаагүй';

function PersonalStatsCard({
  matches, loaded, error, uid, signedIn,
}: {
  matches: MatchHistory[];
  loaded: boolean;
  error: boolean;
  uid: string;
  signedIn: boolean;
}) {
  const stats = useMemo(() => derivePersonalStats(matches, uid), [matches, uid]);
  return (
    <Section icon={<IconChart size={18} />} title="Миний статистик">
      {!signedIn ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Нэвтэрч статистик харах
        </div>
      ) : error ? (
        <div style={{ color: C.danger, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          {MATCHES_ERROR_TEXT}
        </div>
      ) : !loaded ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Уншиж байна…
        </div>
      ) : stats.total === 0 ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Анхны тоглолтоо хий!
        </div>
      ) : (
        <div className="mph-stats-grid" style={{
          display: 'grid', gap: '0.55rem',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        }}>
          <StatTile label="Тоглолт"      value={String(stats.total)} />
          <StatTile label="Хожсон"        value={String(stats.wins)}  accent={C.success} />
          <StatTile label="Хожих хувь"    value={`${stats.winRate}%`} accent={C.accent} />
          <StatTile
            label="Хамгийн сайн Ao5"
            value={stats.bestAo5 != null ? fmtMs(stats.bestAo5) : '—'}
            mono
            accent={C.warn}
          />
          <StatTile
            label="Их тоглосон"
            value={stats.mostPlayedEvent ? eventLabel(stats.mostPlayedEvent) : '—'}
            sublabel={stats.mostPlayedEvent ? eventName(stats.mostPlayedEvent) : undefined}
          />
          <StatTile
            label="Хамгийн их streak"
            value={String(stats.maxStreak)}
            accent={stats.maxStreak >= 3 ? C.warn : undefined}
          />
        </div>
      )}
      <style>{`
        @media (max-width: 460px) {
          .mph-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </Section>
  );
}

// ── Section: Recent Matches ───────────────────────────────────────────────
function RecentMatchesCard({
  matches, loaded, error, uid, signedIn, onOpen,
}: {
  matches: MatchHistory[];
  loaded: boolean;
  error: boolean;
  uid: string;
  signedIn: boolean;
  onOpen: (m: MatchHistory) => void;
}) {
  const router = useRouter();
  const recent = matches.slice(0, 5);
  return (
    <Section
      icon="🕐"
      title="Сүүлийн тоглолтууд"
      action={
        signedIn && matches.length > 5 ? (
          <button
            type="button"
            onClick={() => router.push('/profile')}
            style={{
              background: 'transparent', color: C.accent,
              border: 'none', fontSize: '0.78rem', fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Бүгдийг харах →</button>
        ) : null
      }
    >
      {!signedIn ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Нэвтэрч тоглолтоо харах
        </div>
      ) : error ? (
        <div style={{ color: C.danger, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          {MATCHES_ERROR_TEXT}
        </div>
      ) : !loaded ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Уншиж байна…
        </div>
      ) : recent.length === 0 ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Анхны тоглолтоо хий!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {recent.map(m => (
            <RecentMatchRow key={m.id} match={m} uid={uid} onOpen={() => onOpen(m)} />
          ))}
        </div>
      )}
    </Section>
  );
}

function RecentMatchRow({
  match, uid, onOpen,
}: { match: MatchHistory; uid: string; onOpen: () => void }) {
  const me = match.players.find(p => p.uid === uid);
  const playedMs = matchTsToMs(match.playedAt);
  const rank = me?.finalRank ?? null;
  const myBestAo5 = useMemo(() => {
    if (!me) return null;
    let best: number | null = null;
    for (const a of me.ao5s) {
      if (a == null) continue;
      if (best === null || a < best) best = a;
    }
    return best;
  }, [me]);

  // Opponents preview "vs Bataa, Tuya (+2)"
  const others = match.players.filter(p => p.uid !== uid);
  const previewNames = others.slice(0, 2).map(p => p.name).join(', ');
  const extra = others.length - 2;
  const opponentsText = others.length === 0
    ? 'Дан тоглолт'
    : extra > 0
      ? `vs ${previewNames} (+${extra})`
      : `vs ${previewNames}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        width: '100%', textAlign: 'left',
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${C.border}`,
        borderRadius: 12, padding: '0.7rem 0.8rem',
        color: C.text, fontFamily: 'inherit', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '0.7rem',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = C.borderHi;
        e.currentTarget.style.background = 'rgba(124,58,237,0.06)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = C.border;
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 36, height: 36, borderRadius: 9,
        background: C.accentDim,
        border: `1px solid ${C.borderHi}`,
        fontSize: '0.78rem', fontWeight: 800, color: '#c4b5fd',
        flexShrink: 0,
      }}>
        {eventLabel(match.event)}
      </span>
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
          fontSize: '0.7rem', color: C.muted, fontWeight: 600,
          marginBottom: '0.18rem',
        }}>
          <span>{formatRelative(playedMs)}</span>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '60%',
          }}>{opponentsText}</span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
          fontSize: '0.82rem',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            fontWeight: 700,
            color: rank === 1 ? C.success : C.text,
          }}>
            {rankIcon(rank ?? 0)} {rank != null ? `${rank}-р байр` : '—'}
          </span>
          <span style={{
            color: C.muted, fontFamily: 'JetBrains Mono, monospace',
          }}>
            Ao5: <span style={{ color: C.text, fontWeight: 700 }}>
              {myBestAo5 != null ? fmtMs(myBestAo5) : '—'}
            </span>
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Section: Top Players (Leaderboard) ────────────────────────────────────
function LeaderboardCard({ uid }: { uid: string }) {
  const [period, setPeriod] = useState<LbPeriod>('7d');
  const { matches, loaded } = useLeaderboardMatches(period);
  const cutoff = useMemo(() => {
    if (period === 'all') return null;
    const days = period === '7d' ? 7 : 30;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  }, [period]);
  const lb = useMemo(
    () => aggregateLeaderboard(matches, cutoff, uid),
    [matches, cutoff, uid],
  );

  const tabs: { id: LbPeriod; label: string }[] = [
    { id: '7d',  label: '7 хоног' },
    { id: '30d', label: '30 хоног' },
    { id: 'all', label: 'Бүх цаг' },
  ];

  return (
    <Section icon={<IconTrophy size={18} color={MEDAL_GOLD} />} title="Шилдэг тоглогчид">
      <div style={{
        display: 'inline-flex', gap: '0.3rem',
        background: C.cardAlt, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '0.2rem',
        marginBottom: '0.85rem',
      }}>
        {tabs.map(t => {
          const active = t.id === period;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setPeriod(t.id)}
              style={{
                background: active ? C.accentDim : 'transparent',
                border: 'none',
                borderRadius: 8,
                padding: '0.4rem 0.7rem',
                fontSize: '0.74rem', fontWeight: 700,
                color: active ? C.accent : C.muted,
                cursor: 'pointer', fontFamily: 'inherit',
                letterSpacing: '0.02em',
              }}
            >{t.label}</button>
          );
        })}
      </div>

      {!loaded ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Уншиж байна…
        </div>
      ) : lb.entries.length === 0 ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Энэ хугацаанд тоглолт байхгүй
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {lb.entries.map((e, i) => (
              <LeaderboardRow
                key={e.uid}
                entry={e}
                rank={i + 1}
                isMe={uid !== '' && e.uid === uid}
              />
            ))}
          </div>
          {uid && lb.myRank !== null && lb.myRank > 10 && lb.myEntry && (
            <div style={{
              marginTop: '0.7rem', paddingTop: '0.7rem',
              borderTop: `1px dashed ${C.border}`,
            }}>
              <div style={{
                fontSize: '0.7rem', color: C.muted, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                marginBottom: '0.4rem',
              }}>
                Таны байр: #{lb.myRank}
              </div>
              <LeaderboardRow entry={lb.myEntry} rank={lb.myRank} isMe />
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function LeaderboardRow({
  entry, rank, isMe,
}: { entry: LeaderboardEntry; rank: number; isMe: boolean }) {
  const medal = rankIcon(rank, 16);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0.7rem',
      background: isMe ? C.accentDim : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isMe ? C.borderHi : C.border}`,
      borderRadius: 11,
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: 8,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: rank === 1 ? 'rgba(251,191,36,0.16)'
                  : rank === 2 ? 'rgba(229,231,235,0.10)'
                  : rank === 3 ? 'rgba(217,119,6,0.18)'
                  : 'rgba(255,255,255,0.05)',
        border: `1px solid ${C.border}`,
        fontSize: '0.78rem',
        fontWeight: 800, color: C.text, flexShrink: 0,
      }}>
        {medal ?? rank}
      </span>
      <Thumb name={entry.name} url={entry.photoURL} size={30} />
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontWeight: isMe ? 800 : 700, color: isMe ? '#c4b5fd' : C.text,
          fontSize: '0.88rem',
          maxWidth: '100%', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{entry.name}</span>
          {entry.athleteId && (
            <span title="Тамирчин" style={{ display: 'inline-flex' }}>
              <IconCrown size={13} color={MEDAL_GOLD} />
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: C.muted, marginTop: '0.1rem' }}>
          {entry.total} тоглолт, {entry.wins} хожсон
          <span style={{ color: C.mutedDim }}> · {entry.winRate}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Section: Event Averages ───────────────────────────────────────────────
function EventAveragesCard({
  matches, loaded, error, uid, signedIn,
}: {
  matches: MatchHistory[];
  loaded: boolean;
  error: boolean;
  uid: string;
  signedIn: boolean;
}) {
  const avgs = useMemo(() => deriveEventAverages(matches, uid), [matches, uid]);
  return (
    <Section icon={<IconTarget size={18} />} title="Event дундаж">
      {!signedIn ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Нэвтэрч дунджаа харах
        </div>
      ) : error ? (
        <div style={{ color: C.danger, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          {MATCHES_ERROR_TEXT}
        </div>
      ) : !loaded ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Уншиж байна…
        </div>
      ) : avgs.length === 0 ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Эхний тоглолтоо хийгээд харах
        </div>
      ) : (
        <div className="mph-event-grid" style={{
          display: 'grid', gap: '0.55rem',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        }}>
          {avgs.map(a => (
            <div key={a.event} style={{
              padding: '0.7rem 0.8rem', borderRadius: 12,
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: '0.25rem',
              minWidth: 0,
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 7,
                  background: C.accentDim, border: `1px solid ${C.borderHi}`,
                  fontSize: '0.7rem', fontWeight: 800, color: '#c4b5fd',
                }}>{eventLabel(a.event)}</span>
                <span style={{
                  fontSize: '0.78rem', fontWeight: 700, color: C.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{eventName(a.event)}</span>
              </div>
              <div style={{
                fontSize: '1.05rem', fontWeight: 800,
                fontFamily: 'JetBrains Mono, monospace', color: C.text,
              }}>
                {a.avgAo5 != null ? fmtMs(a.avgAo5) : '—'}
              </div>
              <div style={{ fontSize: '0.66rem', color: C.muted, fontWeight: 600 }}>
                {a.count} тоглолт
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`
        @media (max-width: 560px) {
          .mph-event-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </Section>
  );
}

// ── Section: Achievements ─────────────────────────────────────────────────
function AchievementsCard({
  matches, loaded, error, uid, signedIn,
}: {
  matches: MatchHistory[];
  loaded: boolean;
  error: boolean;
  uid: string;
  signedIn: boolean;
}) {
  const stats = useMemo(() => derivePersonalStats(matches, uid), [matches, uid]);
  const items = useMemo(() => deriveAchievements(stats), [stats]);
  const [openId, setOpenId] = useState<string | null>(null);
  const showLocked = signedIn && loaded && !error;

  return (
    <Section
      icon="🏅"
      title="Амжилтууд"
      action={
        showLocked ? (
          <span style={{ fontSize: '0.72rem', color: C.muted, fontWeight: 700 }}>
            {items.filter(i => i.unlocked).length}/{items.length}
          </span>
        ) : null
      }
    >
      {!signedIn ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Нэвтэрч амжилтаа харах
        </div>
      ) : error ? (
        <div style={{ color: C.danger, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          {MATCHES_ERROR_TEXT}
        </div>
      ) : !loaded ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Уншиж байна…
        </div>
      ) : (
        <div className="mph-ach-grid" style={{
          display: 'grid', gap: '0.55rem',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        }}>
          {items.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpenId(openId === a.id ? null : a.id)}
              style={{
                background: a.unlocked ? C.accentDim : 'rgba(255,255,255,0.02)',
                border: `1px solid ${a.unlocked ? C.borderHi : C.border}`,
                borderRadius: 12, padding: '0.7rem 0.5rem',
                cursor: 'pointer', fontFamily: 'inherit',
                color: C.text,
                opacity: a.unlocked ? 1 : 0.45,
                filter: a.unlocked ? undefined : 'grayscale(0.9)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '0.35rem',
                transition: 'opacity 0.15s',
              }}
              aria-label={a.name}
              title={a.description}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32,
              }} aria-hidden="true">
                {renderAchievementIcon(a.iconKey, 28, a.unlocked)}
              </span>
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, textAlign: 'center',
                color: a.unlocked ? C.text : C.muted,
                lineHeight: 1.2,
              }}>{a.name}</span>
              {openId === a.id && (
                <span style={{
                  fontSize: '0.66rem', color: C.muted, textAlign: 'center',
                  marginTop: '0.15rem', fontWeight: 600, lineHeight: 1.3,
                }}>{a.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <style>{`
        @media (min-width: 900px) {
          .mph-ach-grid { grid-template-columns: repeat(6, 1fr) !important; }
        }
      `}</style>
    </Section>
  );
}

// ── Section: How to Play (collapsible) ────────────────────────────────────
function HowToPlayCard() {
  const [open, setOpen] = useState(false);
  const steps: string[] = [
    'WCA-ийн стандартаар тоглоно',
    '1 Round = 5 solve → Ao5 (best/worst дроп)',
    'Хамгийн сайн Ao5-той хүн round хождог',
    'Олон round-той тэмцээнд хамгийн их хожсон нь түрүүлдэг',
    'DNF тоо нэгээс олон бол → DNF Ao5',
    'Disconnect = тэр solve DNF болно (round дунд орж ирвэл үргэлжлүүлэх боломжтой)',
  ];
  return (
    <section style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 16,
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none',
          padding: '1rem 1.1rem',
          color: C.text, fontFamily: 'inherit', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.85rem', fontWeight: 800,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', color: C.accent,
          }} aria-hidden="true">
            <IconGameController size={18} />
          </span>
          <span>Хэрхэн тоглох вэ?</span>
        </span>
        <span style={{
          fontSize: '1rem', color: C.muted,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }}>▾</span>
      </button>
      {open && (
        <div style={{
          padding: '0 1.1rem 1.1rem',
          display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              display: 'flex', gap: '0.7rem',
              alignItems: 'flex-start',
            }}>
              <span style={{
                flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, borderRadius: '50%',
                background: C.accentDim, color: C.accent,
                fontSize: '0.74rem', fontWeight: 800,
              }}>{i + 1}</span>
              <span style={{ fontSize: '0.86rem', color: C.text, lineHeight: 1.5 }}>
                {s}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Match detail modal ────────────────────────────────────────────────────
function MatchDetailModal({
  match, uid, onClose,
}: { match: MatchHistory; uid: string; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const playedMs = matchTsToMs(match.playedAt);
  const cellStyle: React.CSSProperties = {
    padding: '0.45rem 0.5rem', textAlign: 'center', whiteSpace: 'nowrap',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640,
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 2rem)', overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.95rem 1rem',
          borderBottom: `1px solid ${C.border}`,
          gap: '0.6rem',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '1rem', fontWeight: 800 }}>
              {eventName(match.event)} · {match.totalRounds} раунд
            </div>
            <div style={{ fontSize: '0.74rem', color: C.muted, marginTop: '0.15rem' }}>
              {formatRelative(playedMs)}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Хаах"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontFamily: 'inherit',
            }}
          >×</button>
        </header>

        <div style={{
          padding: '1rem', overflow: 'auto',
          display: 'flex', flexDirection: 'column', gap: '1rem',
        }}>
          <section>
            <SectionHeading>Эцсийн байр</SectionHeading>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {match.players.map(p => (
                <PlayerRow key={p.uid} player={p} isMe={p.uid === uid} />
              ))}
            </div>
          </section>

          {match.rounds.map(round => (
            <section key={round.roundNumber}>
              <SectionHeading>{round.roundName}</SectionHeading>
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem',
                }}>
                  <thead>
                    <tr style={{
                      color: C.muted, fontSize: '0.7rem',
                      letterSpacing: '0.05em', textTransform: 'uppercase',
                    }}>
                      <th style={cellStyle}>#</th>
                      <th style={{ ...cellStyle, textAlign: 'left' }}>Нэр</th>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <th key={i} style={cellStyle}>{i + 1}</th>
                      ))}
                      <th style={cellStyle}>Ao5</th>
                    </tr>
                  </thead>
                  <tbody>
                    {round.results.map(r => {
                      const isMe = r.uid === uid;
                      return (
                        <tr key={r.uid} style={{
                          background: isMe ? C.accentDim : undefined,
                          borderTop: `1px solid ${C.border}`,
                        }}>
                          <td style={{
                            ...cellStyle, fontWeight: 700,
                            color: r.rank === 1 ? C.success : C.text,
                          }}>{r.rank}</td>
                          <td style={{
                            ...cellStyle, textAlign: 'left',
                            fontWeight: isMe ? 700 : 600,
                            color: isMe ? '#c4b5fd' : C.text,
                          }}>{r.name}</td>
                          {Array.from({ length: 5 }).map((_, i) => {
                            const s = r.solves[i];
                            const cell = s ? fmtSolveCell(s) : { text: '—', isDNF: false, isPlus2: false };
                            return (
                              <td
                                key={i}
                                style={{
                                  ...cellStyle,
                                  fontFamily: 'JetBrains Mono, monospace',
                                  color: cell.isDNF ? C.danger
                                    : cell.isPlus2 ? C.warn
                                    : C.text,
                                }}
                              >{cell.text}</td>
                            );
                          })}
                          <td style={{
                            ...cellStyle,
                            fontFamily: 'JetBrains Mono, monospace',
                            fontWeight: 800,
                            color: r.ao5 == null ? C.danger : C.text,
                          }}>
                            {r.ao5 == null ? 'DNF' : fmtMs(r.ao5)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.66rem', fontWeight: 700, color: C.muted,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      marginBottom: '0.55rem',
    }}>{children}</div>
  );
}

function PlayerRow({ player, isMe }: { player: MatchPlayerSummary; isMe: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0.7rem',
      background: isMe ? C.accentDim : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isMe ? C.borderHi : C.border}`,
      borderRadius: 10,
    }}>
      <span style={{
        width: 26, height: 26, borderRadius: '50%',
        background: player.finalRank === 1 ? C.successDim : 'rgba(255,255,255,0.05)',
        border: `1px solid ${player.finalRank === 1 ? 'rgba(52,211,153,0.45)' : C.border}`,
        color: player.finalRank === 1 ? C.success : C.text,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.78rem', fontWeight: 800, flexShrink: 0,
      }}>{player.finalRank}</span>
      <Thumb name={player.name} url={player.photoURL} size={28} />
      <span style={{
        flex: '1 1 auto', minWidth: 0,
        fontWeight: isMe ? 800 : 600,
        color: isMe ? '#c4b5fd' : C.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{player.name}</span>
          {rankIcon(player.finalRank, 14)}
        </span>
      </span>
      <span style={{ fontSize: '0.78rem', color: C.muted, whiteSpace: 'nowrap' }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', color: C.text, fontWeight: 700,
        }}>{player.totalPoints}</span>{' '}оноо
      </span>
    </div>
  );
}

// ── Quick-actions header (replaces the old Lobby buttons) ────────────────
function QuickActions({
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {pendingRejoin && (
        <div style={{
          background: C.accentDim, border: `1px solid ${C.borderHi}`,
          borderRadius: 12, padding: '0.85rem 1rem',
          display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          <div style={{ fontSize: '0.78rem', color: C.muted, textAlign: 'center' }}>
            Та өрөөнд байсан{' '}
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', color: C.accent,
              fontWeight: 800, letterSpacing: '0.15em',
            }}>{pendingRejoin}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={onRejoin}
              style={{
                background: C.accent, color: '#0a0a0a',
                border: 'none', borderRadius: 10,
                padding: '0.7rem 1rem', fontSize: '0.92rem', fontWeight: 800,
                fontFamily: 'inherit', cursor: 'pointer',
                letterSpacing: '0.02em',
              }}
            >Буцах: {pendingRejoin}</button>
            <button
              type="button"
              onClick={onDismissRejoin}
              aria-label="Үл тоох"
              title="Үл тоох"
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
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: '0.7rem',
      }}>
        <button
          type="button"
          onClick={onCreate}
          style={{
            background: C.accent, color: '#0a0a0a',
            border: 'none', borderRadius: 12,
            padding: '0.95rem 1rem', fontSize: '1rem', fontWeight: 800,
            fontFamily: 'inherit', cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >Өрөө үүсгэх</button>
        <button
          type="button"
          onClick={onJoin}
          style={{
            background: C.cardAlt, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 12,
            padding: '0.95rem 1rem', fontSize: '1rem', fontWeight: 800,
            fontFamily: 'inherit', cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >Кодоор нэгдэх</button>
      </div>
    </div>
  );
}

// ── Main hub component ────────────────────────────────────────────────────
export default function MultiplayerHub({
  isMobile, pendingRejoin, onRejoin, onDismissRejoin, onCreate, onJoin, onJoinRoom,
}: {
  isMobile: boolean;
  pendingRejoin?: string;
  onRejoin?: () => void;
  onDismissRejoin?: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onJoinRoom?: (code: string) => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const signedIn = !!user;

  const [matches, setMatches] = useState<MatchHistory[]>([]);
  const [matchesLoaded, setMatchesLoaded] = useState(!signedIn);
  // Set when subscribeUserMatches' onError fires. The most common cause
  // is a missing composite Firestore index on
  //   matchHistory: playerUids (array-contains) + playedAt (desc)
  // — the SDK logs a console error with a one-click "create index"
  // link from the Firebase console. Wrapping the subscription so the
  // hub doesn't blank-render is the only thing we can do client-side.
  const [matchesError, setMatchesError] = useState(false);
  const [openMatch, setOpenMatch] = useState<MatchHistory | null>(null);

  useEffect(() => {
    if (!uid) {
      setMatches([]);
      setMatchesLoaded(true);
      setMatchesError(false);
      return;
    }
    setMatchesLoaded(false);
    setMatchesError(false);
    let unsub: (() => void) | null = null;
    try {
      // Composite index needed:
      //   matchHistory: playerUids (array-contains) + playedAt (desc)
      //
      // To create: open the Firebase console link printed in the
      // browser console error (it auto-fills the index spec), or add
      // it manually under Firestore → Indexes → Composite. Until the
      // index exists, this query fails with FAILED_PRECONDITION and we
      // surface "Тоглолтын түүх ачааллагдаагүй" rather than crash.
      unsub = subscribeUserMatches(uid, rows => {
        setMatches(rows);
        setMatchesLoaded(true);
        setMatchesError(false);
      }, {
        limit: 100,
        onError: err => {
          console.error('[hub] subscribeUserMatches', err);
          setMatches([]);
          setMatchesLoaded(true);
          setMatchesError(true);
        },
      });
    } catch (err) {
      // Synchronous failures (e.g. client init not ready) — same fate.
      console.error('[hub] subscribeUserMatches setup', err);
      setMatchesLoaded(true);
      setMatchesError(true);
    }
    return () => { if (unsub) unsub(); };
  }, [uid]);

  // Achievement reconciliation — when matches load (or change), compute
  // current unlocked achievements and award any that haven't been claimed
  // yet. The points service is idempotent on `achievementId`, so a brief
  // duplicate firing (e.g. matches list re-emits) is safe. We also track
  // attempted IDs in a session-scoped ref to skip the network round-trip
  // for IDs we've already tried this session.
  const achievementTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!uid || !matchesLoaded || matchesError) return;
    const stats = derivePersonalStats(matches, uid);
    const items = deriveAchievements(stats).filter(a => a.unlocked);
    if (items.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const a of items) {
        if (cancelled) return;
        if (achievementTriedRef.current.has(a.id)) continue;
        achievementTriedRef.current.add(a.id);
        try {
          const r = await awardAchievementIfNew(uid, a.id, a.name);
          if (r.awarded && !cancelled) {
            showToast({
              msg: `Амжилт нээгдлээ: ${a.name} +50 оноо`,
              tone: 'success',
            });
          }
        } catch (err) {
          console.warn('[points] achievement award failed', err);
          // Drop the dedupe entry so a future render can retry.
          achievementTriedRef.current.delete(a.id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [uid, matchesLoaded, matchesError, matches]);

  // Two-column desktop layout above 900px (matches the requirements'
  // breakpoint). Mobile gets one stacked column.
  const twoCol = !isMobile;

  return (
    <div style={{
      width: '100%',
      maxWidth: 960,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      paddingBottom: '2rem',
    }}>
      {/* Page heading */}
      <div style={{ textAlign: 'center', padding: '0.5rem 0 0.25rem' }}>
        <div style={{
          fontSize: 'clamp(1.5rem, 5vw, 2rem)',
          fontWeight: 800, letterSpacing: '-0.02em',
        }}>Multiplayer Racing</div>
        <div style={{ color: C.muted, fontSize: '0.85rem', marginTop: '0.4rem' }}>
          Найзуудтайгаа шууд тэмцээн
        </div>
      </div>

      {/* Section 1: Quick actions */}
      <Section icon={<IconBolt size={18} color={C.accent} />} title="Хурдан үйлдлүүд">
        <QuickActions
          isMobile={isMobile}
          pendingRejoin={pendingRejoin}
          onRejoin={onRejoin}
          onDismissRejoin={onDismissRejoin}
          onCreate={onCreate}
          onJoin={onJoin}
        />
      </Section>

      {/* Section 2: Live activity */}
      <LiveActivityCard onJoinRoom={onJoinRoom} />

      {/* Section 3 + 4: stats + recent (two-col on desktop) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: twoCol ? '1fr 1fr' : '1fr',
        gap: '1rem',
      }}>
        <PersonalStatsCard
          matches={matches}
          loaded={matchesLoaded}
          error={matchesError}
          uid={uid}
          signedIn={signedIn}
        />
        <RecentMatchesCard
          matches={matches}
          loaded={matchesLoaded}
          error={matchesError}
          uid={uid}
          signedIn={signedIn}
          onOpen={setOpenMatch}
        />
      </div>

      {/* Section 5: Leaderboard */}
      <LeaderboardCard uid={uid} />

      {/* Section 6: Event averages */}
      <EventAveragesCard
        matches={matches}
        loaded={matchesLoaded}
        error={matchesError}
        uid={uid}
        signedIn={signedIn}
      />

      {/* Section 7: Achievements */}
      <AchievementsCard
        matches={matches}
        loaded={matchesLoaded}
        error={matchesError}
        uid={uid}
        signedIn={signedIn}
      />

      {/* Section 8: How to play */}
      <HowToPlayCard />

      {openMatch && (
        <MatchDetailModal
          match={openMatch}
          uid={uid}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}
