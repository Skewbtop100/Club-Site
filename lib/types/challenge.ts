// Types and constants for the coach Challenge system (docs/challenge-plan.md).
// Phase 2 covers coaches, rooms, room codes and memberships only.
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
