// Coach challenges (docs/challenge-plan.md, phase 3) — client side, coach.
//
// Reads go straight to Firestore (rules: a challenge is read by its coach
// only). Every write goes through app/api/challenge/* with the caller's ID
// token; the rules refuse all client writes, and the server refuses edit /
// delete once a challenge has been started (locked).
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';
import { postApi, roomsErrorText, RoomsApiError } from '@/lib/firebase/services/rooms';
import type { Challenge, ChallengeMetric } from '@/lib/types/challenge';

function toChallenge(id: string, d: Record<string, unknown>): Challenge {
  return {
    id,
    coachUid: String(d.coachUid ?? ''),
    roomId: String(d.roomId ?? ''),
    event: String(d.event ?? ''),
    metric: d.metric as ChallengeMetric,
    targetMs: Number(d.targetMs ?? 0),
    streak: Number(d.streak ?? 0),
    title: String(d.title ?? ''),
    note: String(d.note ?? ''),
    locked: d.locked === true,
    duplicatedFrom: typeof d.duplicatedFrom === 'string' ? d.duplicatedFrom : null,
    archived: d.archived === true,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : null,
  };
}

/** The coach's challenges in one room (one query), newest first. */
export async function fetchRoomChallenges(roomId: string, coachUid: string): Promise<Challenge[]> {
  const snap = await getDocs(query(
    collection(db, COL.CHALLENGES),
    where('coachUid', '==', coachUid), where('roomId', '==', roomId),
  ));
  return snap.docs
    .map(d => toChallenge(d.id, d.data()))
    .filter(c => !c.archived)
    .sort((a, b) => (b.createdAt ?? Date.now()) - (a.createdAt ?? Date.now()));
}

/** What the coach form sends; the server validates it again. */
export interface TemplateInput {
  event: string;
  metric: ChallengeMetric;
  targetMs: number;
  streak: number;
  title: string;
  note: string;
}

export const createChallenge = (roomId: string, t: TemplateInput) =>
  postApi<{ challengeId: string; title: string }>('challenge/create', { roomId, ...t });
export const updateChallenge = (challengeId: string, t: TemplateInput) =>
  postApi<{ title: string }>('challenge/update', { challengeId, ...t });
export const deleteChallenge = (challengeId: string) =>
  postApi<{ deleted: number }>('challenge/delete', { challengeId });
export const duplicateChallenge = (challengeId: string) =>
  postApi<{ challengeId: string }>('challenge/duplicate', { challengeId });
export const assignChallenge = (challengeId: string, uids: string[]) =>
  postApi<{ assigned: string[]; skipped: string[] }>('challenge/assign', { challengeId, uids });
export const unassignChallenge = (challengeId: string, uid: string) =>
  postApi<{ ok: true }>('challenge/unassign', { challengeId, uid });

/** Mongolian message for a challenge API error code. */
export function challengeErrorText(e: unknown): string {
  const code = e instanceof RoomsApiError ? e.code : '';
  switch (code) {
    case 'bad-event':           return 'Төрлөө сонгоно уу.';
    case 'bad-metric':          return 'Хэмжүүрээ сонгоно уу.';
    case 'bad-target':          return 'Зорилтот цаг буруу байна. Жишээ: 2.00 эсвэл 1:05.30';
    case 'bad-streak':          return 'Дараалан хэдэн удаа: 1–100 бүхэл тоо.';
    case 'bad-title':           return 'Гарчиг 60 тэмдэгтээс ихгүй байна.';
    case 'bad-note':            return 'Тэмдэглэл 300 тэмдэгтээс ихгүй байна.';
    case 'locked':              return 'Энэ challenge эхэлсэн тул засах, устгах боломжгүй. «Хуулбарлах»-ыг ашиглана уу.';
    case 'started':             return 'Сурагч аль хэдийн эхэлсэн тул хасах боломжгүй.';
    case 'no-challenge':        return 'Challenge олдсонгүй.';
    case 'no-assignment':       return 'Оноолт олдсонгүй.';
    case 'no-students':         return 'Дор хаяж нэг сурагч сонгоно уу.';
    case 'too-many':            return 'Хэт олон сурагч сонгосон байна.';
    case 'not-active-member':   return 'Сонгосон сурагч өрөөнд идэвхтэй гишүүн биш байна.';
    case 'not-challenge-coach': return 'Энэ challenge-ийг зөвхөн түүний багш удирдана.';
    case 'end-too-soon':        return 'Дуусах цаг одооноос дор хаяж 10 минутын дараа байна.';
    case 'end-too-late':        return 'Дуусах цаг хамгийн оройдоо 23:59.';
    case 'end-other-day':       return 'Дуусах цаг өнөөдөр (Улаанбаатарын цагаар) байна.';
    case 'bad-end-time':        return 'Дуусах цаг буруу байна.';
    case 'student-busy':        return 'Энэ сурагч өөр challenge-ийг яг одоо хийж байна.';
    case 'completed':           return 'Энэ challenge аль хэдийн биелсэн.';
    case 'too-fast':
    case 'too-close':           return 'Цаг хэт хурдан байна';
    case 'ended':
    case 'not-active':          return 'Session дууссан байна.';
    default:                    return roomsErrorText(e);
  }
}
