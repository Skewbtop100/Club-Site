// Challenge sessions (docs/challenge-plan.md, phases 4a–4b) — client side.
//   Student: listens to challengeLive/{me} (the only listener the timer
//            adds: 1 read on open, then 1 per start / end / completion),
//            posts confirmed solves, comments, ends early.
//   Coach:   starts ("Эхлүүлэх") and stops ("Зогсоох"); the live view
//            listens to the room's running sessions (4b).
// All writes are app/api/challenge/* routes; rules refuse client writes.
import { collection, doc, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { postApi } from '@/lib/firebase/services/rooms';
import type {
  ChallengeLive, ChallengeMetric, SessionProgress, SessionStatus,
} from '@/lib/types/challenge';

export function subscribeChallengeLive(
  uid: string,
  onData: (live: ChallengeLive | null) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, 'challengeLive', uid),
    (snap) => {
      const d = snap.data();
      if (!d || typeof d.sessionId !== 'string' || !d.template) { onData(null); return; }
      const t = d.template as Record<string, unknown>;
      onData({
        sessionId: d.sessionId,
        assignmentId: String(d.assignmentId ?? ''),
        template: {
          event: String(t.event ?? ''), metric: t.metric as ChallengeMetric,
          targetMs: Number(t.targetMs ?? 0), streak: Number(t.streak ?? 0),
          title: String(t.title ?? ''), note: String(t.note ?? ''),
        },
        endsAt: d.endsAt instanceof Timestamp ? d.endsAt.toMillis() : null,
      });
    },
    (err) => onError?.(err),
  );
}

export const startChallengeSession = (assignmentId: string, endsAt: number) =>
  postApi<{ sessionId: string; endsAt: number }>('challenge/start', { assignmentId, endsAt });
export const endChallengeSession = (sessionId: string) =>
  postApi<{ status: SessionStatus }>('challenge/end', { sessionId });
export const submitChallengeSolve = (b: {
  sessionId: string; seq: number; ms: number; penalty: 'none' | '+2' | 'dnf'; stoppedAt: number;
}) => postApi<{ progress: SessionProgress; status: SessionStatus; completed: boolean; result: CompletionResult | null }>(
  'challenge/solve', { ...b, input: 'timer' });

/** The completing solve's answer — what the celebration screen shows. */
export interface CompletionResult {
  completedUbDate: string;
  daysTaken: number;
  sessionsCount: number;
  blocksAttempted: number;
  bestStreak: number;
}
export const commentChallengeSolve = (sessionId: string, seq: number, comment: string) =>
  postApi<{ ok: true }>('challenge/comment', { sessionId, seq, comment });

// ── Coach live view (4b) ──────────────────────────────────────────────────

/** One running session as the coach's live view shows it. */
export interface LiveSession {
  id: string;
  assignmentId: string;
  studentUid: string;
  template: { event: string; metric: ChallengeMetric; targetMs: number; streak: number; title: string };
  solvesCount: number;
  blocks: { resultMs: number | null; displayCs: number | null; pass: boolean }[];
  currentStreak: number;
  endsAt: number;
  /** Solves the sanity checks refused (time + reason). */
  flags: { seq: number; ms: number; reason: 'too-fast' | 'too-close'; at: number }[];
}

/**
 * The coach's running sessions in one room, live while the room page is
 * open (plan B2: the session doc changes once per confirmed solve, so this
 * costs about 1 read per solve per student). The filters on coachUid and
 * visibleToCoach are what the rules require: a removed student's session is
 * never delivered. Index: challengeSessions(roomId, status).
 */
export function subscribeRoomLiveSessions(
  roomId: string,
  coachUid: string,
  onData: (rows: LiveSession[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'challengeSessions'),
    where('roomId', '==', roomId), where('coachUid', '==', coachUid),
    where('visibleToCoach', '==', true), where('status', '==', 'active'),
  );
  return onSnapshot(q, (snap) => onData(snap.docs.map(d => {
    const x = d.data();
    const t = (x.template ?? {}) as Record<string, unknown>;
    return {
      id: d.id,
      assignmentId: String(x.assignmentId ?? ''),
      studentUid: String(x.studentUid ?? ''),
      template: {
        event: String(t.event ?? ''), metric: t.metric as ChallengeMetric, targetMs: Number(t.targetMs ?? 0),
        streak: Number(t.streak ?? 0), title: String(t.title ?? ''),
      },
      solvesCount: Array.isArray(x.solves) ? x.solves.length : 0,
      blocks: Array.isArray(x.blocks) ? x.blocks : [],
      currentStreak: Number(x.currentStreak ?? 0),
      endsAt: x.endsAt instanceof Timestamp ? x.endsAt.toMillis() : 0,
      flags: Array.isArray(x.flags) ? x.flags : [],
    };
  })), (err) => onError?.(err));
}
