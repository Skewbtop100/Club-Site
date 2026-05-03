import {
  doc,
  getDoc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { matchHistoryCol, matchHistoryDoc } from '@/lib/firebase/collections';
import type {
  MatchHistory,
  MatchPenalty,
  MatchPlayerSummary,
  MatchRound,
  MatchRoundResult,
  MatchSolve,
} from '@/lib/types';

const SOLVES_PER_ROUND = 5;

// ── Round-snapshot input shape ──────────────────────────────────────────
//
// The multiplayer page accumulates one of these per round into a host-local
// ref because per-round scrambles + solves get wiped on `nextRound` and
// can't be reconstructed from the final RTDB snapshot. Shapes mirror the
// RTDB schema (no Firestore Timestamps yet — those get attached when we
// write the matchHistory doc).
export interface RoundSnapshotInput {
  roundNumber: number;
  roundName: string;
  scrambles: string[];
  // Mirrors RoomData.solves: { uid: { solveIndex: { time, penalty, ... } } }
  solves: Record<string, Record<string, { time: number; penalty: 'ok' | '+2' | 'dnf' }>>;
  // Snapshot of room.members at round-end so we know who was actually in
  // the round (members can be kicked between rounds).
  membersAtRoundEnd: Record<string, { name: string; totalPoints?: number }>;
}

export interface SaveMatchHistoryInput {
  roomCode: string;
  event: string;
  hostId: string;
  // RTDB Date.now() epoch ms when the room was created — closest proxy
  // we have to "match start" without touching the existing RTDB schema.
  matchStartedAtMs: number;
  totalRounds: number;
  // Final-round membership snapshot (for finalRank + totalPoints). The
  // per-round membership lives inside each `pastRounds` entry.
  finalMembers: Record<string, { name: string; totalPoints?: number }>;
  pastRounds: RoundSnapshotInput[];
}

// ── Read helpers ────────────────────────────────────────────────────────

export function tsToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return null;
}

/**
 * Real-time subscription to matches the user played in. Newest first,
 * capped at `limit` (default 20). Requires the composite index documented
 * in collections.ts (playerUids array-contains + playedAt desc).
 */
export function subscribeUserMatches(
  uid: string,
  onData: (matches: MatchHistory[]) => void,
  options: { limit?: number; onError?: (err: Error) => void } = {},
): () => void {
  const q = query(
    matchHistoryCol,
    where('playerUids', 'array-contains', uid),
    orderBy('playedAt', 'desc'),
    fsLimit(options.limit ?? 20),
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(d => d.data())),
    (err) => options.onError?.(err),
  );
}

// ── Write ────────────────────────────────────────────────────────────────

/**
 * Persist a finished multiplayer match. Idempotent on `roomCode +
 * matchStartedAtMs` so accidental double-fires (e.g. a brief host
 * migration during the final transition) don't create duplicate rows.
 */
export async function saveMatchHistory(input: SaveMatchHistoryInput): Promise<string> {
  if (input.pastRounds.length === 0) {
    throw new Error('No round snapshots to save');
  }

  // Stable doc id — derived from room + start time so the same match can't
  // be written twice. setDoc with merge:false on existing data still
  // overwrites, but skipping the write when the doc already exists keeps
  // the first write authoritative (the original host's view wins).
  const id = `${input.roomCode}-${input.matchStartedAtMs}`;
  const ref = matchHistoryDoc(id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    console.log('[mp] match history already saved', id);
    return id;
  }

  // ── Build per-round results (with intra-round ranking) ───────────────
  const sortedRounds = input.pastRounds
    .slice()
    .sort((a, b) => a.roundNumber - b.roundNumber);

  const rounds: MatchRound[] = sortedRounds.map(round => {
    const ranked = rankRound(round);
    return {
      roundNumber: round.roundNumber,
      roundName: round.roundName,
      scrambles: round.scrambles,
      results: ranked,
    };
  });

  // ── Per-player rollups across all rounds ─────────────────────────────
  // Use the FINAL-round membership snapshot as the canonical player list
  // (matches what the Results screen shows). Members who left mid-match
  // appear in their per-round results but won't show up in the summary.
  const finalUids = Object.keys(input.finalMembers);
  const userSummaries = await fetchUserSummaries(finalUids);

  const players: MatchPlayerSummary[] = finalUids.map(uid => {
    const m = input.finalMembers[uid];
    const ao5s = rounds.map(r => r.results.find(rr => rr.uid === uid)?.ao5 ?? null);
    const roundsWon = rounds.filter(r => r.results.find(rr => rr.uid === uid)?.rank === 1).length;
    const bestSingle = computeBestSingle(rounds, uid);
    const profile = userSummaries.get(uid) ?? { photoURL: null, athleteId: null };
    return {
      uid,
      name: m.name,
      photoURL: profile.photoURL,
      athleteId: profile.athleteId,
      finalRank: 0, // assigned below after sort
      totalPoints: typeof m.totalPoints === 'number' ? m.totalPoints : 0,
      roundsWon,
      ao5s,
      bestSingle,
    };
  });

  // Final standings: by totalPoints desc, tie-break by roundsWon desc,
  // then by best single asc (lower better; nulls last).
  players.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.roundsWon !== a.roundsWon) return b.roundsWon - a.roundsWon;
    if (a.bestSingle === null && b.bestSingle === null) return 0;
    if (a.bestSingle === null) return 1;
    if (b.bestSingle === null) return -1;
    return a.bestSingle - b.bestSingle;
  });
  players.forEach((p, i) => { p.finalRank = i + 1; });

  // Winner — only when someone actually scored. A 0-point match (everyone
  // DNF'd) yields no winner; that's surfaced as `null` for the UI to
  // render as "—".
  const winner = players[0] && players[0].totalPoints > 0
    ? { uid: players[0].uid, name: players[0].name }
    : null;

  const finishedAtMs = Date.now();
  const doc: MatchHistory = {
    id,
    roomCode: input.roomCode,
    event: input.event,
    playedAt: Timestamp.fromMillis(input.matchStartedAtMs),
    finishedAt: serverTimestamp(),
    durationMs: Math.max(0, finishedAtMs - input.matchStartedAtMs),
    totalRounds: input.totalRounds,
    hostId: input.hostId,
    players,
    winner,
    rounds,
    playerUids: finalUids,
  };

  await setDoc(ref, doc);
  return id;
}

// ── Internal helpers ────────────────────────────────────────────────────

function effectiveSolveMs(solve: MatchSolve): number {
  if (solve.penalty === 'dnf') return Number.POSITIVE_INFINITY;
  return solve.penalty === '+2' ? solve.ms + 2000 : solve.ms;
}

// Mirrors `computeAo5` from the multiplayer page so we don't have to
// export that helper from a 4400-line file. WCA Ao5: drop best + worst,
// average the middle three. Returns null if 2+ DNFs.
function computeAo5(solves: MatchSolve[]): number | null {
  if (solves.length !== SOLVES_PER_ROUND) return null;
  const dnfs = solves.filter(s => s.penalty === 'dnf').length;
  if (dnfs >= 2) return null;
  const eff = solves.map(effectiveSolveMs).sort((a, b) => a - b);
  const middle = eff.slice(1, 4);
  if (middle.some(v => !Number.isFinite(v))) return null;
  return (middle[0] + middle[1] + middle[2]) / 3;
}

// Translate RTDB penalty enum ('ok' | '+2' | 'dnf') to the persisted form
// ('none' | '+2' | 'dnf'). Keeps the public schema spec-faithful while
// the runtime model is unchanged.
function persistPenalty(p: 'ok' | '+2' | 'dnf'): MatchPenalty {
  return p === 'ok' ? 'none' : p;
}

function collectFiveSolves(
  perUidSolves: Record<string, { time: number; penalty: 'ok' | '+2' | 'dnf' }> | undefined,
): MatchSolve[] {
  if (!perUidSolves) return [];
  const out: MatchSolve[] = [];
  for (let i = 0; i < SOLVES_PER_ROUND; i++) {
    const s = perUidSolves[String(i)];
    if (!s) continue;
    out.push({ ms: s.time, penalty: persistPenalty(s.penalty) });
  }
  return out;
}

function rankRound(round: RoundSnapshotInput): MatchRoundResult[] {
  const rows = Object.entries(round.membersAtRoundEnd).map(([uid, m]) => {
    const solves = collectFiveSolves(round.solves[uid]);
    const ao5 = solves.length === SOLVES_PER_ROUND ? computeAo5(solves) : null;
    return { uid, name: m.name, solves, ao5, rank: 0 };
  });
  // Lower Ao5 wins; nulls (DNF / incomplete) sink to the bottom in stable order.
  rows.sort((a, b) => {
    if (a.ao5 === null && b.ao5 === null) return 0;
    if (a.ao5 === null) return 1;
    if (b.ao5 === null) return -1;
    return a.ao5 - b.ao5;
  });
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function computeBestSingle(rounds: MatchRound[], uid: string): number | null {
  let best: number | null = null;
  for (const r of rounds) {
    const row = r.results.find(rr => rr.uid === uid);
    if (!row) continue;
    for (const s of row.solves) {
      if (s.penalty === 'dnf') continue;
      const eff = s.penalty === '+2' ? s.ms + 2000 : s.ms;
      if (best === null || eff < best) best = eff;
    }
  }
  return best;
}

// Fetch each player's photoURL + athleteId in parallel. Misses (no users
// doc, or read failure) are silently treated as null fields so a single
// flaky read doesn't block the whole save.
async function fetchUserSummaries(
  uids: string[],
): Promise<Map<string, { photoURL: string | null; athleteId: string | null }>> {
  const pairs = await Promise.all(uids.map(async uid => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) return [uid, { photoURL: null, athleteId: null }] as const;
      const data = snap.data() as Record<string, unknown>;
      return [uid, {
        photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
        athleteId: typeof data.athleteId === 'string' ? data.athleteId : null,
      }] as const;
    } catch {
      return [uid, { photoURL: null, athleteId: null }] as const;
    }
  }));
  return new Map(pairs);
}
