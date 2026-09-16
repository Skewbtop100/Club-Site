// ── practiceRuns, server side ───────────────────────────────────────────
// The only writer of the collection. Client writes are denied outright by
// firestore.rules, which is what makes the ten-run cap real: rules cannot
// count, so a cap enforced there would be a cap enforced nowhere.
//
// Everything here uses the Admin SDK and is reached only through the
// practice routes, which authorise first.

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  PRACTICE_RUN_LIMIT,
  normalizePracticeStatus,
  practiceAllowance,
  practiceExpiryMs,
  practiceReviewValid,
  spendsAllowance,
  type PracticeDecision,
  type PracticeRunStatus,
} from './practice';

export const PRACTICE_COLLECTION = 'practiceRuns';

export class PracticeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** One run, as the athlete and the admin both read it. */
export interface PracticeRunView {
  id: string;
  uid: string;
  event: string;
  /** The scramble the athlete was shown — generated client-side, stored so
   *  an admin can check the solve against it. Without it the review question
   *  ("did they apply THIS scramble") is unanswerable. */
  scramble: string;
  /** Centiseconds, or null when the athlete never typed one. A run that
   *  recorded and was abandoned at the keypad is still filed — the video
   *  exists and an admin will still look at it — so the time is nullable
   *  rather than the run being dropped. */
  timeCs: number | null;
  isDnf: boolean;
  videoKey: string;
  status: PracticeRunStatus;
  /** Why it was refused. Only ever set with status 'incorrect'. */
  reason: string | null;
  createdAtMs: number | null;
  reviewedAtMs: number | null;
  /** When the video is due to be deleted, for telling the athlete. */
  expiresAtMs: number | null;
}

function toView(id: string, d: Record<string, unknown>): PracticeRunView {
  const ms = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;
  const status = normalizePracticeStatus(d.status);
  const createdAtMs = ms(d.createdAt);
  const reviewedAtMs = ms(d.reviewedAt);
  return {
    id,
    uid: typeof d.uid === 'string' ? d.uid : '',
    event: typeof d.event === 'string' ? d.event : '',
    scramble: typeof d.scramble === 'string' ? d.scramble : '',
    timeCs: typeof d.timeCs === 'number' ? d.timeCs : null,
    isDnf: d.isDnf === true,
    videoKey: typeof d.videoKey === 'string' ? d.videoKey : '',
    status,
    reason: typeof d.reason === 'string' && d.reason.trim() ? d.reason.trim() : null,
    createdAtMs,
    reviewedAtMs,
    expiresAtMs: practiceExpiryMs({ status, createdAtMs, reviewedAtMs }),
  };
}

/** Every run this athlete has, newest first.
 *
 *  A single-field equality on `uid` — the automatic index, the same shape
 *  fetchMyFiledAttempts already relies on in production. Sorted here rather
 *  than with an orderBy, which would need a composite index for the sake of
 *  at most ten documents. */
export async function listAthletePracticeRuns(db: Firestore, uid: string): Promise<PracticeRunView[]> {
  const snap = await db.collection(PRACTICE_COLLECTION).where('uid', '==', uid).get();
  return snap.docs
    .map((d) => toView(d.id, d.data()))
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
}

/** Files one run and spends one of the athlete's ten.
 *
 *  THE CAP IS ENFORCED IN A TRANSACTION, and that is the reason this is a
 *  server route at all. Two tabs each reading "9 used" and both filing would
 *  otherwise make eleven; the read of the athlete's runs and the write of
 *  the new one have to be one atomic step. firestore.rules cannot do it —
 *  rules cannot count — so the collection is closed to clients entirely.
 *
 *  createdAt is the SERVER's clock (FieldValue.serverTimestamp), never the
 *  client's: the retention sweep dates everything off it, and a
 *  client-chosen creation time is how the competition sweep once deleted
 *  things early. */
export async function filePracticeRun(
  db: Firestore,
  input: { uid: string; event: string; scramble: string; timeCs: number | null; isDnf: boolean; videoKey: string },
): Promise<{ id: string; remaining: number }> {
  const col = db.collection(PRACTICE_COLLECTION);
  const ref = col.doc();

  const remaining = await db.runTransaction(async (tx) => {
    // ── every read first ──
    const mine = await tx.get(col.where('uid', '==', input.uid));
    const statuses = mine.docs.map((d) => normalizePracticeStatus(d.get('status')));
    const allowance = practiceAllowance(statuses);
    if (allowance.atLimit) {
      throw new PracticeError(
        `Туршилтын ${PRACTICE_RUN_LIMIT} бичлэг бүгд ашиглагдсан.`,
        409,
      );
    }

    tx.set(ref, {
      uid: input.uid,
      event: input.event,
      scramble: input.scramble,
      timeCs: input.timeCs,
      isDnf: input.isDnf,
      videoKey: input.videoKey,
      status: 'pending' satisfies PracticeRunStatus,
      reason: null,
      createdAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
    });
    // The run just filed spends one, unless a redo (it cannot be, on
    // create — a run is born pending).
    return allowance.remaining - 1;
  });

  return { id: ref.id, remaining };
}

/** The admin's decision.
 *
 *  reviewedAt is the server's clock for the same reason createdAt is: the
 *  7-day retention clock starts here.
 *
 *  A REASON IS ONLY EVER STORED WITH A REFUSAL. Deciding 'correct' or 'redo'
 *  clears any reason a previous refusal left, so a run cannot read as
 *  approved while still carrying why it was once refused. */
export async function reviewPracticeRun(
  db: Firestore,
  runId: string,
  decision: PracticeDecision,
  reason: string | null,
): Promise<PracticeRunView> {
  if (!practiceReviewValid(decision, reason)) {
    throw new PracticeError('Татгалзах шалтгааныг бичнэ үү.', 400);
  }
  const ref = db.collection(PRACTICE_COLLECTION).doc(runId);
  const after = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new PracticeError('Бичлэг олдсонгүй.', 404);
    const text = decision === 'incorrect' && typeof reason === 'string' ? reason.trim() : null;
    tx.update(ref, {
      status: decision,
      reason: text,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return { ...snap.data(), status: decision, reason: text } as Record<string, unknown>;
  });
  // reviewedAt is resolved by the server after the transaction commits, so
  // the view below reports the write rather than re-reading for one field.
  return toView(runId, { ...after, reviewedAt: Timestamp.now() });
}

/** Every run awaiting a decision, oldest first — a queue is worked from its
 *  head. Single-field equality on `status`, automatic index. */
export async function listPracticeQueue(db: Firestore, status: 'pending' | 'all'): Promise<PracticeRunView[]> {
  const col = db.collection(PRACTICE_COLLECTION);
  const snap = status === 'pending' ? await col.where('status', '==', 'pending').get() : await col.get();
  const rows = snap.docs.map((d) => toView(d.id, d.data()));
  return status === 'pending'
    ? rows.sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0))
    : rows.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
}

/** Names for a list of uids, for the admin screen. Reuses the participant
 *  documents rather than storing a name on the run: a name stored at file
 *  time would go stale, and the admin needs the athlete they know. */
export async function practiceAthleteNames(
  db: Firestore,
  uids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(uids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const docs = await db.getAll(...unique.map((u) => db.collection('onlineParticipants').doc(u)));
  return new Map(
    docs.map((d) => {
      const data = (d.data() ?? {}) as Record<string, unknown>;
      const approved = [data.approvedLastName, data.approvedFirstName]
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .join(' ')
        .trim();
      const live = [data.lastName, data.firstName]
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .join(' ')
        .trim();
      const display = typeof data.displayName === 'string' ? data.displayName.trim() : '';
      return [d.id, approved || live || display || d.id.slice(0, 10)];
    }),
  );
}

export { spendsAllowance };
