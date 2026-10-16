// Server side of challenge sessions (docs/challenge-plan.md, phase 4a): the
// coach starts and stops, the student submits confirmed solves, comments,
// and ends early. Every write to challengeSessions/*, challengeLive/* and
// the assignment's progress happens here (Admin SDK, app/api/challenge/*);
// the rules give clients no write access at all.
//
// The server is the authority: it scores with the same pure computeProgress
// the timer uses (lib/challenge-progress.ts), runs the sanity checks
// (lib/challenge.ts), and enforces the end time lazily — any action on a
// session whose endsAt has passed closes it ('auto-closed') first. A closed
// session never continues: the next one starts from 0 (A6), and only
// complete blocks ever count (decision 5).
import {
  FieldValue, Timestamp,
  type DocumentData, type DocumentReference, type Firestore, type Transaction,
} from 'firebase-admin/firestore';
import { adminDb, isCoachUid } from './firebase-admin';
import { serverNow } from './clock';
import { RoomError } from './rooms';
import { SOLVE_MAX_MS, sanityCheck, type SanityReason } from '../challenge';
import { computeProgress, daysTaken, ubDate, validateEndsAt } from '../challenge-progress';
import type { SessionStatus } from '../types/challenge';

const ID_RE = /^[A-Za-z0-9_-]{1,160}$/;
const COMMENT_MAX = 280; // the timer's comment box limit
const EMPTY_LIVE = { sessionId: null, assignmentId: null, template: null, endsAt: null };

const toMs = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : 0);

function idOf(v: unknown): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new RoomError(400, 'bad-request');
  return v;
}

interface StoredSolve { seq: number; ms: number; penalty: 'none' | '+2' | 'dnf'; stoppedAt: number; comment?: string }

/** Session + the docs a close touches, read inside the transaction. */
interface CloseCtx {
  sessionRef: DocumentReference;
  session: DocumentData;
  assignmentRef: DocumentReference;
  assignment: DocumentData;
  liveRef: DocumentReference;
  live: DocumentData | undefined;
}

async function readCloseCtx(db: Firestore, tx: Transaction, sessionRef: DocumentReference, session: DocumentData): Promise<CloseCtx> {
  const assignmentRef = db.doc(`challengeAssignments/${session.assignmentId}`);
  const liveRef = db.doc(`challengeLive/${session.studentUid}`);
  const [a, l] = await Promise.all([tx.get(assignmentRef), tx.get(liveRef)]);
  return { sessionRef, session, assignmentRef, assignment: a.data() ?? {}, liveRef, live: l.data() };
}

/**
 * Closes a session inside `tx` (writes only — reads were done by
 * readCloseCtx): marks it, rolls its complete blocks and best streak up into
 * the assignment, and clears the student's pointer if it still points here.
 * `completed` also writes the completion fields (A8).
 */
/** What the student's celebration screen shows (4b). */
export interface CompletionResult {
  completedUbDate: string;
  daysTaken: number;
  sessionsCount: number;
  blocksAttempted: number;
  bestStreak: number;
}

function closeInTx(
  tx: Transaction, c: CloseCtx, status: Exclude<SessionStatus, 'active'>, nowMs: number,
): CompletionResult | null {
  const now = Timestamp.fromMillis(nowMs);
  tx.update(c.sessionRef, { status, endedAt: now });
  const a = c.assignment;
  const update: Record<string, unknown> = {
    blocksAttempted: (a.blocksAttempted ?? 0) + (c.session.blocksAttempted ?? 0),
    bestStreak: Math.max(a.bestStreak ?? 0, c.session.bestStreak ?? 0),
  };
  if (a.activeSessionId === c.sessionRef.id) { update.activeSessionId = null; update.activeEndsAt = null; }
  let result: CompletionResult | null = null;
  if (status === 'completed') {
    const done = ubDate(nowMs);
    result = {
      completedUbDate: done,
      daysTaken: daysTaken(a.firstStartedUbDate ?? done, done),
      sessionsCount: a.sessionsCount ?? 1,
      blocksAttempted: update.blocksAttempted as number,
      bestStreak: update.bestStreak as number,
    };
    Object.assign(update, {
      status: 'completed', completedAt: now, completedUbDate: done, daysTaken: result.daysTaken,
    });
  }
  tx.update(c.assignmentRef, update);
  if (c.live?.sessionId === c.sessionRef.id) tx.set(c.liveRef, EMPTY_LIVE);
  return result;
}

// ── start (coach) ────────────────────────────────────────────────────────

/**
 * Coach presses "Эхлүүлэх" for one student's assignment. Refused if the
 * student already has a running session (decision 8 — any challenge, any
 * room); a second session the same day is fine once the first has closed
 * (decision 15). The first start locks the challenge (decision 9).
 */
export async function startSession(callerUid: string, body: Record<string, unknown>): Promise<{ sessionId: string; endsAt: number }> {
  const assignmentId = idOf(body.assignmentId);
  const nowMs = serverNow();
  const end = validateEndsAt(nowMs, body.endsAt);
  if ('error' in end) throw new RoomError(400, end.error);
  const db = adminDb();
  const assignmentRef = db.doc(`challengeAssignments/${assignmentId}`);
  const first = await assignmentRef.get();
  if (!first.exists) throw new RoomError(404, 'no-assignment');
  if (first.get('coachUid') !== callerUid) throw new RoomError(403, 'not-challenge-coach');
  if (!(await isCoachUid(callerUid))) throw new RoomError(403, 'not-coach');

  const sessionRef = db.collection('challengeSessions').doc();
  await db.runTransaction(async (tx) => {
    const aSnap = await tx.get(assignmentRef);
    const a = aSnap.data()!;
    const studentUid = a.studentUid as string;
    const challengeRef = db.doc(`challenges/${a.challengeId}`);
    const memberRef = db.doc(`rooms/${a.roomId}/members/${studentUid}`);
    const liveRef = db.doc(`challengeLive/${studentUid}`);
    const [challenge, member, live] = await Promise.all([tx.get(challengeRef), tx.get(memberRef), tx.get(liveRef)]);
    if (!challenge.exists) throw new RoomError(404, 'no-challenge');
    if (a.status === 'completed') throw new RoomError(409, 'completed');
    if (a.status === 'archived') throw new RoomError(409, 'archived');
    if (member.get('status') !== 'active') throw new RoomError(409, 'not-active-member');

    // A pointer to a still-running session blocks; an expired one is closed
    // here first (lazy end-time enforcement).
    let stale: CloseCtx | null = null;
    const runningId = live.get('sessionId');
    if (typeof runningId === 'string' && runningId) {
      const runRef = db.doc(`challengeSessions/${runningId}`);
      const run = await tx.get(runRef);
      if (run.exists && run.get('status') === 'active') {
        if (toMs(run.get('endsAt')) > nowMs) throw new RoomError(409, 'student-busy');
        stale = await readCloseCtx(db, tx, runRef, run.data()!);
      }
    }

    const t = a.template as Record<string, unknown>;
    const template = { event: t.event, metric: t.metric, targetMs: t.targetMs, streak: t.streak, title: t.title, note: t.note ?? '' };
    const endsAt = Timestamp.fromMillis(end.endsAtMs);
    const now = Timestamp.fromMillis(nowMs);

    if (stale) {
      closeInTx(tx, stale, 'auto-closed', nowMs);
      // closeInTx may have rolled stats into THIS assignment; keep them.
      if (stale.assignmentRef.path === assignmentRef.path) {
        a.blocksAttempted = (a.blocksAttempted ?? 0) + (stale.session.blocksAttempted ?? 0);
        a.bestStreak = Math.max(a.bestStreak ?? 0, stale.session.bestStreak ?? 0);
      }
    }
    tx.create(sessionRef, {
      assignmentId, challengeId: a.challengeId, roomId: a.roomId, coachUid: a.coachUid, studentUid,
      template, startedAt: now, endsAt, ubDate: ubDate(nowMs),
      status: 'active', endedAt: null,
      solves: [], blocks: [], currentStreak: 0, bestStreak: 0, blocksAttempted: 0, flags: [],
      visibleToCoach: true,
    });
    tx.set(liveRef, { sessionId: sessionRef.id, assignmentId, template, endsAt });
    tx.update(challengeRef, { locked: true });
    const firstStart = a.firstStartedAt == null;
    tx.update(assignmentRef, {
      status: 'in-progress',
      ...(firstStart ? { firstStartedAt: now, firstStartedUbDate: ubDate(nowMs) } : {}),
      sessionsCount: (a.sessionsCount ?? 0) + 1,
      ...(stale && stale.assignmentRef.path === assignmentRef.path
        ? { blocksAttempted: a.blocksAttempted, bestStreak: a.bestStreak } : {}),
      activeSessionId: sessionRef.id, activeEndsAt: endsAt,
    });
  });
  return { sessionId: sessionRef.id, endsAt: end.endsAtMs };
}

// ── solve (student) ──────────────────────────────────────────────────────

function progressOf(session: DocumentData, solves: StoredSolve[]) {
  return computeProgress(session.template, solves);
}

/**
 * One CONFIRMED solve (decision 4) from the student's timer. Strict order
 * by `seq`; resending an identical solve is a no-op (network retries).
 * Refused: someone else's session, a closed or expired one (closed here),
 * anything but an on-screen timer solve, and solves failing the sanity
 * checks — those are logged in `flags` and answered 409 too-fast /
 * too-close ("Цаг хэт хурдан байна").
 */
export async function submitSolve(callerUid: string, body: Record<string, unknown>) {
  const sessionId = idOf(body.sessionId);
  const { seq, ms, penalty, stoppedAt, input } = body;
  if (input !== 'timer') throw new RoomError(400, 'bad-input');
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) throw new RoomError(400, 'bad-seq');
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms <= 0 || ms > SOLVE_MAX_MS) throw new RoomError(400, 'bad-time');
  if (penalty !== 'none' && penalty !== '+2' && penalty !== 'dnf') throw new RoomError(400, 'bad-penalty');
  if (typeof stoppedAt !== 'number' || !Number.isFinite(stoppedAt)) throw new RoomError(400, 'bad-request');
  const db = adminDb();
  const sessionRef = db.doc(`challengeSessions/${sessionId}`);

  type Outcome =
    | { kind: 'ok'; progress: ReturnType<typeof computeProgress>; status: SessionStatus; result?: CompletionResult | null }
    | { kind: 'refused'; reason: SanityReason }
    | { kind: 'closed' };
  const nowMs = serverNow();
  const out: Outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) throw new RoomError(404, 'no-session');
    const s = snap.data()!;
    if (s.studentUid !== callerUid) throw new RoomError(403, 'not-your-session');
    const solves = (s.solves ?? []) as StoredSolve[];

    // Retry of a solve the server already has → same answer, no write.
    if (seq <= solves.length) {
      const had = solves[seq - 1];
      if (had.ms === ms && had.penalty === penalty && had.stoppedAt === stoppedAt) {
        return { kind: 'ok', progress: progressOf(s, solves), status: s.status };
      }
      throw new RoomError(409, 'bad-seq');
    }
    if (s.status !== 'active') throw new RoomError(409, 'not-active');
    if (nowMs >= toMs(s.endsAt)) {
      closeInTx(tx, await readCloseCtx(db, tx, sessionRef, s), 'auto-closed', nowMs);
      return { kind: 'closed' };
    }
    if (seq !== solves.length + 1) throw new RoomError(409, 'bad-seq');

    const prev = solves.length ? solves[solves.length - 1] : null;
    const totalBefore = solves.reduce((a, x) => a + x.ms, 0);
    const reason = sanityCheck(s.template.event, { ms, stoppedAt }, prev, totalBefore, nowMs - toMs(s.startedAt));
    if (reason) {
      tx.update(sessionRef, { flags: FieldValue.arrayUnion({ seq, ms, reason, at: nowMs }) });
      return { kind: 'refused', reason };
    }

    const next: StoredSolve[] = [...solves, { seq, ms, penalty, stoppedAt }];
    const progress = progressOf(s, next);
    const ctx = progress.completed ? await readCloseCtx(db, tx, sessionRef, s) : null;
    tx.update(sessionRef, {
      solves: [...solves, { seq, ms, penalty, stoppedAt, receivedAt: Timestamp.fromMillis(nowMs) }],
      blocks: progress.blocks,
      currentStreak: progress.currentStreak,
      bestStreak: progress.bestStreak,
      blocksAttempted: progress.blocksAttempted,
    });
    if (ctx) {
      ctx.session = { ...s, blocksAttempted: progress.blocksAttempted, bestStreak: progress.bestStreak };
      const result = closeInTx(tx, ctx, 'completed', nowMs);
      return { kind: 'ok', progress, status: 'completed', result };
    }
    return { kind: 'ok', progress, status: 'active' };
  });

  if (out.kind === 'refused') throw new RoomError(409, out.reason);
  if (out.kind === 'closed') throw new RoomError(409, 'ended');
  return {
    progress: out.progress, status: out.status, completed: out.status === 'completed',
    // The celebration screen's numbers (only on the completing solve).
    result: out.result ?? null,
  };
}

// ── comment (student) ────────────────────────────────────────────────────

/** Set or clear the comment on one of the caller's own solves (N7). Time
 *  and penalty are untouched. Allowed after the session has closed. */
export async function commentSolve(callerUid: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const sessionId = idOf(body.sessionId);
  const { seq, comment } = body;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) throw new RoomError(400, 'bad-seq');
  if (typeof comment !== 'string' || comment.trim().length > COMMENT_MAX) throw new RoomError(400, 'bad-comment');
  const db = adminDb();
  const ref = db.doc(`challengeSessions/${sessionId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new RoomError(404, 'no-session');
    if (snap.get('studentUid') !== callerUid) throw new RoomError(403, 'not-your-session');
    const solves = [...(snap.get('solves') ?? [])] as (StoredSolve & Record<string, unknown>)[];
    const i = solves.findIndex(x => x.seq === seq);
    if (i < 0) throw new RoomError(404, 'no-solve');
    const { comment: _old, ...rest } = solves[i];
    const text = comment.trim();
    solves[i] = text ? { ...rest, comment: text } : rest;
    tx.update(ref, { solves });
  });
  return { ok: true };
}

// ── end (student or coach) ───────────────────────────────────────────────

/**
 * "Өнөөдрийг дуусгах" (student) or "Зогсоох" (coach). Past the end time it
 * closes as 'auto-closed' (the timer calls this when it opens on an
 * expired pointer). The unfinished block is simply never scored. Ending a
 * session that is already closed is a no-op.
 */
export async function endSession(callerUid: string, body: Record<string, unknown>): Promise<{ status: SessionStatus }> {
  const sessionId = idOf(body.sessionId);
  const db = adminDb();
  const ref = db.doc(`challengeSessions/${sessionId}`);
  const nowMs = serverNow();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new RoomError(404, 'no-session');
    const s = snap.data()!;
    if (s.studentUid !== callerUid && s.coachUid !== callerUid) throw new RoomError(403, 'not-your-session');
    if (s.status !== 'active') return { status: s.status as SessionStatus };
    const status = nowMs >= toMs(s.endsAt) ? 'auto-closed' : 'ended';
    closeInTx(tx, await readCloseCtx(db, tx, ref, s), status, nowMs);
    return { status };
  });
}

// ── daily cleanup (Vercel cron, 4b) ──────────────────────────────────────

/**
 * Closes every session still marked active whose end time has passed —
 * students who never came back to the timer (decision 20; the lazy end in
 * every route handles the rest). Same close as everywhere else:
 * 'auto-closed', only complete blocks rolled up (decision 5), pointer
 * cleared; unconfirmed solves never reached the server (N3). Each session
 * is re-checked inside its own transaction, so running twice — or racing a
 * student's own "end" — closes nothing twice.
 */
export async function closeStaleSessions(): Promise<{ closed: number; checked: number }> {
  const db = adminDb();
  const nowMs = serverNow();
  // Index: challengeSessions(status, endsAt).
  const stale = await db.collection('challengeSessions')
    .where('status', '==', 'active')
    .where('endsAt', '<=', Timestamp.fromMillis(nowMs))
    .get();
  let closed = 0;
  for (const d of stale.docs) {
    const didClose = await db.runTransaction(async (tx) => {
      const snap = await tx.get(d.ref);
      const s = snap.data();
      if (!s || s.status !== 'active' || toMs(s.endsAt) > nowMs) return false;
      closeInTx(tx, await readCloseCtx(db, tx, d.ref, s), 'auto-closed', nowMs);
      return true;
    });
    if (didClose) closed++;
  }
  return { closed, checked: stale.size };
}
