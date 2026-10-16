// Challenge sessions (docs/challenge-plan.md, phase 4a) — client side.
//   Student: listens to challengeLive/{me} (the only listener the timer
//            adds: 1 read on open, then 1 per start / end / completion),
//            posts confirmed solves, comments, ends early.
//   Coach:   starts ("Эхлүүлэх") and stops ("Зогсоох").
// All writes are app/api/challenge/* routes; rules refuse client writes.
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
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
}) => postApi<{ progress: SessionProgress; status: SessionStatus; completed: boolean }>(
  'challenge/solve', { ...b, input: 'timer' });
export const commentChallengeSolve = (sessionId: string, seq: number, comment: string) =>
  postApi<{ ok: true }>('challenge/comment', { sessionId, seq, comment });
