// Types and constants for the coach Challenge system (docs/challenge-plan.md).
// Phase 2: coaches, rooms, room codes, memberships. Phase 3: challenges
// and assignments. Phase 4: sessions and the live pointer. Phase 5: the
// session record the history pages read.
//
// Shared by client code, server routes (lib/server/rooms.ts) and tests, so
// it must stay free of firebase / firebase-admin imports.

/** Room codes: 6 characters from an alphabet without look-alikes —
 *  no O/0 and no I/1/L (plan decision 19). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_NAME_MAX = 40;

export type MemberStatus = 'pending' | 'active' | 'removed';

/** coaches/{uid} — written only by the club admin. Admins are coaches
 *  automatically and need no document. */
export interface CoachDoc {
  uid: string;
  displayName: string;
  active: boolean;
  grantedBy: string;
  grantedAt: number | null;
}

/** rooms/{roomId} — written only by the server routes. */
export interface Room {
  id: string;
  name: string;
  coachUid: string;
  coachName: string;
  code: string;
  archived: boolean;
  createdAt: number | null;
}

/** rooms/{roomId}/members/{uid} — written only by the server routes.
 *  roomName / coachName are copied in so a student's "my rooms" list is a
 *  single collection-group query, readable even after removal (plan N4). */
export interface RoomMember {
  uid: string;
  roomId: string;
  roomName: string;
  coachName: string;
  displayName: string;
  photoURL: string | null;
  status: MemberStatus;
  requestedAt: number | null;
  decidedAt: number | null;
}

/** Upper-cases and drops spaces / dashes, so "abc-d23" → "ABCD23". */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '');
}

export function isRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Trimmed room name, or null when empty / too long. */
export function cleanRoomName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim().replace(/\s+/g, ' ');
  if (!name || name.length > ROOM_NAME_MAX) return null;
  return name;
}

export type MemberAction = 'approve' | 'reject' | 'remove';

// ── Phase 3: challenges and assignments ───────────────────────────────────

export type ChallengeMetric = 'single' | 'mo3' | 'ao5' | 'ao12' | 'ao25' | 'ao50' | 'ao100';
export type AssignmentStatus = 'assigned' | 'in-progress' | 'completed' | 'archived';

/** The template a challenge is made of (plan A3). Copied into every
 *  assignment so the student side never reads challenges/*. */
export interface ChallengeTemplate {
  event: string;
  metric: ChallengeMetric;
  /** Target in ms, a multiple of 10 (centiseconds); passing is strict "<". */
  targetMs: number;
  /** M — complete blocks in a row, 1 … 100. */
  streak: number;
  /** Coach's title, or the generated one ("2x2 Ao5 < 2.00 × 5"). */
  title: string;
  /** Optional note from the coach, '' when none. */
  note: string;
}

/** challenges/{id} — written only by the server routes (app/api/challenge/*). */
export interface Challenge extends ChallengeTemplate {
  id: string;
  coachUid: string;
  roomId: string;
  /** Set by the server at the first start (phase 4); then no edit/delete. */
  locked: boolean;
  duplicatedFrom: string | null;
  archived: boolean;
  createdAt: number | null;
}

/** challengeAssignments/{challengeId}_{studentUid} — server-written only. */
export interface ChallengeAssignment {
  id: string;
  challengeId: string;
  roomId: string;
  coachUid: string;
  studentUid: string;
  studentName: string;
  template: ChallengeTemplate;
  status: AssignmentStatus;
  /** false while the student's membership is 'removed' (plan decision 24):
   *  the coach's reads filter on it. Kept in step by lib/server/rooms.ts. */
  visibleToCoach: boolean;
  firstStartedAt: number | null;
  completedAt: number | null;
  assignedAt: number | null;
  /** Rolled up by the server when a session closes (phase 4). */
  daysTaken: number | null;
  sessionsCount: number;
  blocksAttempted: number;
  bestStreak: number;
  /** The running session, if any (cleared when it closes). The coach's
   *  page shows "Зогсоох" while activeEndsAt is still ahead. */
  activeSessionId: string | null;
  activeEndsAt: number | null;
}

// ── Phase 4: sessions and the student's live pointer ─────────────────────

export type SessionStatus = 'active' | 'ended' | 'auto-closed' | 'completed';
/** Who closed an 'ended' session (phase 5; absent on sessions closed
 *  before the field existed, and on the other statuses). */
export type SessionEndedBy = 'student' | 'coach';

/** challengeLive/{studentUid} — what the student's timer listens to.
 *  Server-written only; sessionId null = no running session. */
export interface ChallengeLive {
  sessionId: string | null;
  assignmentId: string | null;
  template: ChallengeTemplate | null;
  /** Epoch ms; null when no session. */
  endsAt: number | null;
}

/** What /api/challenge/solve (and the timer, locally) reports back. */
export interface SessionProgress {
  blocks: { resultMs: number | null; displayCs: number | null; pass: boolean }[];
  currentStreak: number;
  bestStreak: number;
  blocksAttempted: number;
  completed: boolean;
  inBlock: number;
  blockSize: number;
}

// ── Phase 5: history ──────────────────────────────────────────────────────

/** One stored solve in a session (only confirmed solves reach the server). */
export interface SessionSolve {
  seq: number;
  /** Raw timer ms, without the +2. */
  ms: number;
  penalty: 'none' | '+2' | 'dnf';
  comment?: string;
}

/** challengeSessions/{id} as the history pages read it. */
export interface ChallengeSessionRecord {
  id: string;
  assignmentId: string;
  studentUid: string;
  template: { event: string; metric: ChallengeMetric; targetMs: number; streak: number };
  /** Epoch ms. */
  startedAt: number;
  endsAt: number;
  endedAt: number | null;
  /** 'YYYY-MM-DD' (UB) at start. */
  ubDate: string;
  status: SessionStatus;
  endedBy: SessionEndedBy | null;
  solves: SessionSolve[];
  blocks: { resultMs: number | null; displayCs: number | null; pass: boolean }[];
  blocksAttempted: number;
  bestStreak: number;
}
