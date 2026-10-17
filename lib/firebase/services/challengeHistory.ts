// Challenge history (docs/challenge-plan.md, phase 5) — client reads only,
// all ONE-TIME (no listeners). Every query carries the filters the rules
// need to prove each result readable:
//   student — studentUid == me (always allowed, removed included, N4);
//   coach   — coachUid == me && visibleToCoach == true (a removed
//             student's documents are never delivered, decision 24).
// Reads per page view:
//   history page          1 (assignment) + up to 10 (one sessions page);
//                         each "Цааш үзэх" up to 10 more. A session doc
//                         carries its solves, so the block / solve detail
//                         costs nothing extra.
//   coach, one student    1 (membership) + that student's assignments here.
//   coach, one challenge  1 (challenge) + its visible assignments.
import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, Timestamp, where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';
import { toAssignment } from '@/lib/firebase/services/challengeAssignments';
import { toChallenge } from '@/lib/firebase/services/challenges';
import type {
  Challenge, ChallengeAssignment, ChallengeMetric, ChallengeSessionRecord, SessionEndedBy, SessionSolve, SessionStatus,
} from '@/lib/types/challenge';

export const SESSIONS_PAGE = 10;
const SESSIONS = 'challengeSessions';
const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);

function toSession(id: string, d: Record<string, unknown>): ChallengeSessionRecord {
  const t = (d.template ?? {}) as Record<string, unknown>;
  const solves = Array.isArray(d.solves) ? d.solves as Record<string, unknown>[] : [];
  return {
    id,
    assignmentId: String(d.assignmentId ?? ''),
    studentUid: String(d.studentUid ?? ''),
    template: {
      event: String(t.event ?? ''), metric: t.metric as ChallengeMetric,
      targetMs: Number(t.targetMs ?? 0), streak: Number(t.streak ?? 0),
    },
    startedAt: ms(d.startedAt) ?? 0,
    endsAt: ms(d.endsAt) ?? 0,
    endedAt: ms(d.endedAt),
    ubDate: String(d.ubDate ?? ''),
    status: (d.status as SessionStatus) ?? 'ended',
    endedBy: d.endedBy === 'student' || d.endedBy === 'coach' ? d.endedBy as SessionEndedBy : null,
    solves: solves.map((x): SessionSolve => ({
      seq: Number(x.seq ?? 0), ms: Number(x.ms ?? 0),
      penalty: x.penalty === '+2' || x.penalty === 'dnf' ? x.penalty : 'none',
      ...(typeof x.comment === 'string' && x.comment ? { comment: x.comment } : {}),
    })),
    blocks: Array.isArray(d.blocks) ? d.blocks as ChallengeSessionRecord['blocks'] : [],
    blocksAttempted: Number(d.blocksAttempted ?? 0),
    bestStreak: Number(d.bestStreak ?? 0),
  };
}

/** One assignment (the student's own, or a visible one of the coach's);
 *  null when it doesn't exist or this account may not read it. */
export async function fetchAssignment(id: string): Promise<ChallengeAssignment | null> {
  try {
    const snap = await getDoc(doc(db, COL.CHALLENGE_ASSIGNMENTS, id));
    return snap.exists() ? toAssignment(snap.id, snap.data()) : null;
  } catch {
    return null; // permission denied = hidden (e.g. a removed student, for the coach)
  }
}

export type SessionsCursor = QueryDocumentSnapshot | null;
export interface SessionsPage { rows: ChallengeSessionRecord[]; next: SessionsCursor }

/**
 * One page of an assignment's sessions, newest first.
 * Indexes: challengeSessions(assignmentId, studentUid, startedAt desc) for
 * the student, (assignmentId, coachUid, visibleToCoach, startedAt desc) for
 * the coach.
 */
export async function fetchSessionsPage(
  a: Pick<ChallengeAssignment, 'id' | 'studentUid' | 'coachUid'>,
  viewer: 'student' | 'coach',
  after: SessionsCursor,
): Promise<SessionsPage> {
  const who = viewer === 'student'
    ? [where('studentUid', '==', a.studentUid)]
    : [where('coachUid', '==', a.coachUid), where('visibleToCoach', '==', true)];
  const snap = await getDocs(query(
    collection(db, SESSIONS),
    where('assignmentId', '==', a.id), ...who,
    orderBy('startedAt', 'desc'),
    ...(after ? [startAfter(after)] : []),
    limit(SESSIONS_PAGE),
  ));
  const rows = snap.docs.map(d => toSession(d.id, d.data()));
  return { rows, next: snap.docs.length === SESSIONS_PAGE ? snap.docs[snap.docs.length - 1] : null };
}

/** Coach: one student's assignments in one room (equality only, no
 *  composite index). Hidden while the student is removed. */
export async function fetchStudentAssignments(roomId: string, coachUid: string, studentUid: string): Promise<ChallengeAssignment[]> {
  const snap = await getDocs(query(
    collection(db, COL.CHALLENGE_ASSIGNMENTS),
    where('roomId', '==', roomId), where('coachUid', '==', coachUid),
    where('visibleToCoach', '==', true), where('studentUid', '==', studentUid),
  ));
  return snap.docs.map(d => toAssignment(d.id, d.data()))
    .sort((x, y) => (y.assignedAt ?? 0) - (x.assignedAt ?? 0));
}

/** Coach: one challenge and its visible assignments (equality only). */
export async function fetchChallengeOverview(challengeId: string, coachUid: string):
  Promise<{ challenge: Challenge; rows: ChallengeAssignment[] } | null> {
  const c = await getDoc(doc(db, COL.CHALLENGES, challengeId)).catch(() => null);
  if (!c?.exists()) return null;
  const snap = await getDocs(query(
    collection(db, COL.CHALLENGE_ASSIGNMENTS),
    where('challengeId', '==', challengeId), where('coachUid', '==', coachUid), where('visibleToCoach', '==', true),
  ));
  return { challenge: toChallenge(c.id, c.data()), rows: snap.docs.map(d => toAssignment(d.id, d.data())) };
}
