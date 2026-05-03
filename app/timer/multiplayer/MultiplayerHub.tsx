'use client';

// Multiplayer hub — replaces the bare-bones lobby with a community page:
// quick actions, live activity, personal stats, recent matches, leaderboard,
// event averages, achievements, how-to-play. The Create/Join callbacks the
// host page passes in are the same ones that previously fed the Lobby.

import { useCallback, useEffect, useMemo, useState } from 'react';
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

function rankIcon(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
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
interface Achievement {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
}

function deriveAchievements(s: PersonalStats): Achievement[] {
  return [
    { id: 'first_win',     name: 'Эхний хожил',        icon: '🎖',
      description: 'Multiplayer-т эхний удаа хожих',  unlocked: s.wins >= 1 },
    { id: 'win_streak_5',  name: '5 дараалсан хожил',  icon: '🔥',
      description: '5 удаа дараалан хожих',           unlocked: s.maxStreak >= 5 },
    { id: 'sub_15_mp',     name: 'Sub-15 in MP',       icon: '🚀',
      description: 'Multiplayer-т Ao5 < 15сек хийх',
      unlocked: s.bestAo5 !== null && s.bestAo5 < 15000 },
    { id: 'matches_10',    name: 'Туршлагатай',        icon: '⭐',
      description: '10 тоглолт хийх',                  unlocked: s.total >= 10 },
    { id: 'matches_50',    name: 'Үнэнч тоглогч',      icon: '💎',
      description: '50 тоглолт хийх',                  unlocked: s.total >= 50 },
    { id: 'matches_100',   name: 'Чанарын тоглогч',    icon: '🏆',
      description: '100 тоглолт хийх',                 unlocked: s.total >= 100 },
  ];
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
interface LiveActivity {
  activeRooms: number;
  totalPlayers: number;
  currentlyRacing: number;
  loaded: boolean;
}

function useLiveActivity(): LiveActivity {
  const [data, setData] = useState<LiveActivity>({
    activeRooms: 0, totalPlayers: 0, currentlyRacing: 0, loaded: false,
  });
  useEffect(() => {
    const r = rtdbRef(rtdb, 'rooms');
    const unsub = onValue(r, (snap) => {
      let activeRooms = 0;
      let totalPlayers = 0;
      let currentlyRacing = 0;
      const val = snap.val() as Record<string, {
        status?: string;
        members?: Record<string, { connected?: boolean }>;
      }> | null;
      if (val) {
        for (const code of Object.keys(val)) {
          const room = val[code];
          if (!room) continue;
          const status = room.status;
          if (status !== 'waiting' && status !== 'racing') continue;
          activeRooms += 1;
          const members = room.members ?? {};
          const memberCount = Object.values(members).filter(m => m && m.connected !== false).length;
          totalPlayers += memberCount;
          if (status === 'racing') currentlyRacing += memberCount;
        }
      }
      setData({ activeRooms, totalPlayers, currentlyRacing, loaded: true });
    }, () => {
      setData(d => ({ ...d, loaded: true }));
    });
    return () => unsub();
  }, []);
  return data;
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
  icon: string;
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
          <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{icon}</span>
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
function LiveActivityCard() {
  const live = useLiveActivity();
  return (
    <Section
      icon="🟢"
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
        <StatTile
          label="Идэвхтэй өрөө"
          value={live.loaded ? String(live.activeRooms) : '—'}
          accent={C.accent}
        />
        <StatTile
          label="Online хүн"
          value={live.loaded ? String(live.totalPlayers) : '—'}
          accent={C.success}
        />
        <StatTile
          label="Тоглож байгаа"
          value={live.loaded ? String(live.currentlyRacing) : '—'}
          accent={C.warn}
        />
      </div>
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

// ── Section: Personal Stats ───────────────────────────────────────────────
function PersonalStatsCard({
  matches, loaded, uid, signedIn,
}: {
  matches: MatchHistory[];
  loaded: boolean;
  uid: string;
  signedIn: boolean;
}) {
  const stats = useMemo(() => derivePersonalStats(matches, uid), [matches, uid]);
  return (
    <Section icon="📊" title="Миний статистик">
      {!signedIn ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Нэвтэрч статистик харах
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
  matches, loaded, uid, signedIn, onOpen,
}: {
  matches: MatchHistory[];
  loaded: boolean;
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
    <Section icon="🏆" title="Шилдэг тоглогчид">
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
  const medal = rankIcon(rank);
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
        fontSize: medal ? '1rem' : '0.78rem',
        fontWeight: 800, color: C.text, flexShrink: 0,
      }}>
        {medal || rank}
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
          {entry.athleteId && <span title="Тамирчин" style={{ fontSize: '0.85rem' }}>👑</span>}
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
  matches, loaded, uid, signedIn,
}: {
  matches: MatchHistory[];
  loaded: boolean;
  uid: string;
  signedIn: boolean;
}) {
  const avgs = useMemo(() => deriveEventAverages(matches, uid), [matches, uid]);
  return (
    <Section icon="🎯" title="Event дундаж">
      {!signedIn ? (
        <div style={{ color: C.muted, fontSize: '0.88rem', padding: '0.4rem 0' }}>
          Нэвтэрч дунджаа харах
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
  matches, loaded, uid, signedIn,
}: {
  matches: MatchHistory[];
  loaded: boolean;
  uid: string;
  signedIn: boolean;
}) {
  const stats = useMemo(() => derivePersonalStats(matches, uid), [matches, uid]);
  const items = useMemo(() => deriveAchievements(stats), [stats]);
  const [openId, setOpenId] = useState<string | null>(null);
  const showLocked = signedIn && loaded;

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
              <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>
                {a.unlocked ? a.icon : '🔒'}
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
          <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>🎮</span>
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
        {player.name}{rankIcon(player.finalRank) && ` ${rankIcon(player.finalRank)}`}
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
  isMobile, pendingRejoin, onRejoin, onDismissRejoin, onCreate, onJoin,
}: {
  isMobile: boolean;
  pendingRejoin?: string;
  onRejoin?: () => void;
  onDismissRejoin?: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const signedIn = !!user;

  const [matches, setMatches] = useState<MatchHistory[]>([]);
  const [matchesLoaded, setMatchesLoaded] = useState(!signedIn);
  const [openMatch, setOpenMatch] = useState<MatchHistory | null>(null);

  useEffect(() => {
    if (!uid) {
      setMatches([]);
      setMatchesLoaded(true);
      return;
    }
    setMatchesLoaded(false);
    const unsub = subscribeUserMatches(uid, rows => {
      setMatches(rows);
      setMatchesLoaded(true);
    }, {
      limit: 100,
      onError: err => {
        console.error('[hub] subscribeUserMatches', err);
        setMatchesLoaded(true);
      },
    });
    return () => unsub();
  }, [uid]);

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
      <Section icon="⚡" title="Хурдан үйлдлүүд">
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
      <LiveActivityCard />

      {/* Section 3 + 4: stats + recent (two-col on desktop) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: twoCol ? '1fr 1fr' : '1fr',
        gap: '1rem',
      }}>
        <PersonalStatsCard
          matches={matches}
          loaded={matchesLoaded}
          uid={uid}
          signedIn={signedIn}
        />
        <RecentMatchesCard
          matches={matches}
          loaded={matchesLoaded}
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
        uid={uid}
        signedIn={signedIn}
      />

      {/* Section 7: Achievements */}
      <AchievementsCard
        matches={matches}
        loaded={matchesLoaded}
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
