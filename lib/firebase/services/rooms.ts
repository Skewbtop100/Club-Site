// Coach rooms (docs/challenge-plan.md, phase 2) — client side.
//
// Reads go straight to Firestore (rules allow exactly these queries).
// Every write goes through app/api/rooms/* with the caller's ID token; the
// rules refuse all client writes to rooms, members and roomCodes.
import {
  collection, collectionGroup, doc, getDoc, getDocs, onSnapshot, query, where,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';
import type { MemberAction, MemberStatus, Room, RoomMember } from '@/lib/types/challenge';

function tsToMs(v: unknown): number | null {
  return v instanceof Timestamp ? v.toMillis() : null;
}

function toRoom(id: string, d: Record<string, unknown>): Room {
  return {
    id,
    name: String(d.name ?? ''),
    coachUid: String(d.coachUid ?? ''),
    coachName: String(d.coachName ?? ''),
    code: String(d.code ?? ''),
    archived: d.archived === true,
    createdAt: tsToMs(d.createdAt),
  };
}

function toMember(d: Record<string, unknown>): RoomMember {
  return {
    uid: String(d.uid ?? ''),
    roomId: String(d.roomId ?? ''),
    roomName: String(d.roomName ?? ''),
    coachName: String(d.coachName ?? ''),
    displayName: String(d.displayName ?? ''),
    photoURL: typeof d.photoURL === 'string' ? d.photoURL : null,
    status: (d.status as MemberStatus) ?? 'pending',
    requestedAt: tsToMs(d.requestedAt),
    decidedAt: tsToMs(d.decidedAt),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────

/** Rooms the user coaches (one query). Newest first, archived hidden. */
export async function fetchCoachRooms(uid: string): Promise<Room[]> {
  const snap = await getDocs(query(collection(db, COL.ROOMS), where('coachUid', '==', uid)));
  return snap.docs
    .map(d => toRoom(d.id, d.data()))
    .filter(r => !r.archived)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** The user's own memberships in every room (one collection-group query). */
export async function fetchMyMemberships(uid: string): Promise<RoomMember[]> {
  const snap = await getDocs(query(collectionGroup(db, COL.ROOM_MEMBERS), where('uid', '==', uid)));
  return snap.docs
    .map(d => toMember(d.data()))
    .sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0));
}

/** The user's own membership in one room (readable even when removed). */
export async function fetchMyMembership(roomId: string, uid: string): Promise<RoomMember | null> {
  const snap = await getDoc(doc(db, COL.ROOMS, roomId, COL.ROOM_MEMBERS, uid));
  return snap.exists() ? toMember(snap.data()) : null;
}

export async function fetchRoom(roomId: string): Promise<Room | null> {
  const snap = await getDoc(doc(db, COL.ROOMS, roomId));
  return snap.exists() ? toRoom(snap.id, snap.data()) : null;
}

/** Pending + active members of a room the user coaches — live only while
 *  the room page is open (plan B2: listener only on that tab). */
export function subscribeRoomMembers(
  roomId: string,
  onData: (members: RoomMember[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, COL.ROOMS, roomId, COL.ROOM_MEMBERS),
    where('status', 'in', ['pending', 'active']),
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(d => toMember(d.data()))),
    (err) => onError?.(err),
  );
}

// ── Writes (server routes) ──────────────────────────────────────────────

export class RoomsApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function post<T>(route: string, body: object): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new RoomsApiError(401, 'unauthenticated');
  const res = await fetch(`/api/rooms/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new RoomsApiError(res.status, typeof data.error === 'string' ? data.error : 'server-error');
  return data as T;
}

export const createRoom = (name: string) =>
  post<{ roomId: string; code: string; name: string }>('create', { name });
export const renameRoom = (roomId: string, name: string) =>
  post<{ name: string }>('rename', { roomId, name });
export const regenerateRoomCode = (roomId: string) =>
  post<{ code: string }>('regenerate-code', { roomId });
export const joinRoomByCode = (code: string) =>
  post<{ roomId: string; roomName: string; status: MemberStatus }>('join', { code });
export const decideMember = (roomId: string, uid: string, action: MemberAction) =>
  post<{ status: MemberStatus | 'deleted' }>('member', { roomId, uid, action });

/** Mongolian message for an API error code. */
export function roomsErrorText(e: unknown): string {
  const code = e instanceof RoomsApiError ? e.code : '';
  switch (code) {
    case 'bad-code':        return 'Код буруу байна. 6 тэмдэгт оруулна уу.';
    case 'no-room':         return 'Ийм кодтой өрөө олдсонгүй.';
    case 'own-room':        return 'Энэ бол таны өөрийн өрөө.';
    case 'bad-name':        return 'Өрөөний нэр 1–40 тэмдэгт байна.';
    case 'not-coach':       return 'Зөвхөн coach өрөө үүсгэнэ.';
    case 'not-room-coach':  return 'Энэ өрөөг зөвхөн түүний coach удирдана.';
    case 'no-member':       return 'Сурагч олдсонгүй.';
    case 'not-pending':     return 'Хүсэлт аль хэдийн шийдэгдсэн байна.';
    case 'not-active':      return 'Сурагч өрөөнд байхгүй байна.';
    case 'unauthenticated': return 'Эхлээд нэвтэрнэ үү.';
    case 'not-configured':  return 'Сервер тохируулагдаагүй байна.';
    default:                return 'Алдаа гарлаа. Дахин оролдоно уу.';
  }
}
