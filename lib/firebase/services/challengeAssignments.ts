// Challenge assignments (docs/challenge-plan.md, phase 3) — client reads.
// Written only by app/api/challenge/* (see services/challenges.ts).
//   Student: their own assignments, live on the hub (one query).
//   Coach:   the room's assignments, live, filtered on visibleToCoach — the
//            rules hide a removed student's assignments from the coach.
import {
  collection, onSnapshot, orderBy, query, where, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';
import type { AssignmentStatus, ChallengeAssignment, ChallengeMetric } from '@/lib/types/challenge';

const tsToMs = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);

function toAssignment(id: string, d: Record<string, unknown>): ChallengeAssignment {
  const t = (d.template ?? {}) as Record<string, unknown>;
  return {
    id,
    challengeId: String(d.challengeId ?? ''),
    roomId: String(d.roomId ?? ''),
    coachUid: String(d.coachUid ?? ''),
    studentUid: String(d.studentUid ?? ''),
    studentName: String(d.studentName ?? ''),
    template: {
      event: String(t.event ?? ''),
      metric: t.metric as ChallengeMetric,
      targetMs: Number(t.targetMs ?? 0),
      streak: Number(t.streak ?? 0),
      title: String(t.title ?? ''),
      note: String(t.note ?? ''),
    },
    status: (d.status as AssignmentStatus) ?? 'assigned',
    visibleToCoach: d.visibleToCoach === true,
    firstStartedAt: tsToMs(d.firstStartedAt),
    completedAt: tsToMs(d.completedAt),
    assignedAt: tsToMs(d.assignedAt),
    daysTaken: typeof d.daysTaken === 'number' ? d.daysTaken : null,
    sessionsCount: Number(d.sessionsCount ?? 0),
    blocksAttempted: Number(d.blocksAttempted ?? 0),
    bestStreak: Number(d.bestStreak ?? 0),
    activeSessionId: typeof d.activeSessionId === 'string' ? d.activeSessionId : null,
    activeEndsAt: tsToMs(d.activeEndsAt),
  };
}

/** Student: my assignments, newest first, live while the hub is open
 *  (index: challengeAssignments(studentUid, assignedAt desc)). */
export function subscribeMyAssignments(
  uid: string,
  onData: (rows: ChallengeAssignment[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, COL.CHALLENGE_ASSIGNMENTS), where('studentUid', '==', uid), orderBy('assignedAt', 'desc')),
    (snap) => onData(snap.docs.map(d => toAssignment(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

/** Coach: every visible assignment in one room, live while the room page
 *  is open (4b) — so a start, an end or a completion shows without a
 *  refresh. An assignment changes only a few times per session (start,
 *  close, completion), never per solve. */
export function subscribeRoomAssignments(
  roomId: string,
  coachUid: string,
  onData: (rows: ChallengeAssignment[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(db, COL.CHALLENGE_ASSIGNMENTS),
      where('roomId', '==', roomId), where('coachUid', '==', coachUid), where('visibleToCoach', '==', true),
    ),
    (snap) => onData(snap.docs.map(d => toAssignment(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

/** Status words shown to coach and student (phase 3 only ever shows
 *  "Оноогдсон"; the others arrive with phase 4). */
export const ASSIGNMENT_STATUS_TEXT: Record<AssignmentStatus, string> = {
  assigned: 'Оноогдсон',
  'in-progress': 'Идэвхтэй',
  completed: 'Биелсэн',
  archived: 'Архивласан',
};
