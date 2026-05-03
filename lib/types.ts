export interface Athlete {
  id: string;
  athleteId?: string;
  name: string;
  lastName?: string;
  wcaId?: string;
  birthDate?: string;
  imageUrl?: string;
  // Set when an authenticated user has been linked to this athlete
  // (via /admin/users manual link or by approving an athleteRequest).
  // Cleared back to null on unlink. Drives the "available for claim"
  // filter in the Profile page selection modal.
  ownerId?: string | null;
}

// ── Multiplayer match history ────────────────────────────────────────────
//
// Persisted at the end of a multiplayer match (final round → results).
// `playerUids` is duplicated alongside the players[] objects so we can
// index `playerUids array-contains uid` for "matches I played in"
// queries — Firestore can't index across array-of-objects fields.
export type MatchPenalty = 'none' | '+2' | 'dnf';

export interface MatchSolve {
  ms: number;
  penalty: MatchPenalty;
}

export interface MatchPlayerSummary {
  uid: string;
  name: string;
  photoURL: string | null;
  athleteId: string | null;
  finalRank: number;
  totalPoints: number;
  roundsWon: number;
  ao5s: (number | null)[];
  bestSingle: number | null;
}

export interface MatchRoundResult {
  uid: string;
  name: string;
  solves: MatchSolve[];
  ao5: number | null;
  rank: number;
}

export interface MatchRound {
  roundNumber: number;
  roundName: string;
  scrambles: string[];
  results: MatchRoundResult[];
}

export interface MatchHistory {
  id: string;
  roomCode: string;
  event: string;
  // Stored as Firestore Timestamps; use a coercer when reading.
  playedAt: unknown;
  finishedAt: unknown;
  durationMs: number;
  totalRounds: number;
  hostId: string;
  players: MatchPlayerSummary[];
  winner: { uid: string; name: string } | null;
  rounds: MatchRound[];
  playerUids: string[];
}

// ── Point transactions ───────────────────────────────────────────────────
//
// Append-only ledger of every point award/deduction. Each row carries
// `balanceAfter` so the user's running balance at any historical moment
// can be reconstructed without scanning the whole table. `reason` is the
// machine-readable kind (must match a key in points.getEarnRules), while
// `description` is the human-readable string shown in the UI.
export type PointReason =
  | 'daily_login'
  | 'solve'
  | 'pb_set'
  | 'mp_played'
  | 'mp_won'
  | 'achievement'
  | 'athlete_linked'
  | 'admin_grant';

export interface PointTransaction {
  id: string;
  uid: string;
  amount: number;            // positive = earn, negative = spend
  reason: PointReason | string;
  description: string;
  // serverTimestamp at write time. Read with tsToMs().
  timestamp: unknown;
  balanceAfter: number;
  metadata?: Record<string, unknown>;
}

export type AthleteRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AthleteRequest {
  id: string;
  uid: string;
  userDisplayName: string;
  userEmail: string;
  userPhotoURL: string | null;
  athleteId: string;
  athleteName: string;
  status: AthleteRequestStatus;
  // serverTimestamp() values; null while the writing client awaits the
  // server round-trip. Read with helpers that coerce to ms.
  requestedAt: unknown;
  resolvedAt: unknown;
  resolvedBy: string | null;
  rejectReason: string | null;
}

export interface CompetitionAthlete {
  id: string;
  name: string;
  events: string[];
}

export interface AdvancementConfig {
  type: 'fixed' | 'percent';
  value: number;
}

export interface EventConfig {
  rounds: number;
  groups: number;
  advancement?: Record<string, AdvancementConfig>;
}

export interface Competition {
  id: string;
  name: string;
  status: 'upcoming' | 'live' | 'finished';
  date?: string | { toDate: () => Date };
  clubDate?: string | { toDate: () => Date };
  country?: string;
  imageUrl?: string;
  events?: Record<string, boolean>;
  athletes?: CompetitionAthlete[];
  eventConfig?: Record<string, EventConfig>;
  roundStatus?: Record<string, 'complete' | 'ongoing'>;
  finishedAt?: { toDate: () => Date } | string | number;
}

export interface Result {
  id: string;
  status: string;
  source?: string;
  eventId: string;
  athleteId: string;
  athleteName?: string;
  competitionId: string;
  competitionName?: string;
  single: number | null;
  average: number | null;
  solves?: (number | null)[];
  round?: number;
  group?: number;
  country?: string;
  submittedAt?: unknown;
  /** True when this is an auto-created next-round placeholder awaiting solves. */
  isPlaceholder?: boolean;
}

export interface WcaRecordEntry {
  value: number;
}

export interface WcaRecordType {
  WR?: WcaRecordEntry;
  CR?: WcaRecordEntry;
  NR?: WcaRecordEntry;
}

export interface WcaRecordDoc {
  single?: WcaRecordType;
  average?: WcaRecordType;
}

export type WcaRecords = Record<string, WcaRecordDoc>;
export type EventVisibility = Record<string, 'auto' | 'show' | 'hide'>;
