// ── Committing a cut, and undoing a round ───────────────────────────────
// Server-only (firebase-admin). Split out of the qualify and admin-rounds
// routes (which import next/server and cannot load in a test process) so
// both guards run against the emulator in
// tests/competition-fields/round-guards.test.cjs.
//
// ── THE HOLE ──
// ШАЛГАРУУЛАХ could be committed again at any time. Round N+1's access is
// decided by round N's qualifiers doc, read on EVERY scramble request, so
// re-running round N's cut while N+1 was under way rewrote who was allowed
// to be in the round they were already solving — mid-round, athletes were
// told "Та энэ раундад шалгараагүй".
//
// ── THE RULE ──
// A cut is fixed once the round it feeds has STARTED (roundHasStarted).
// Redoing one is still possible, deliberately and visibly: close the next
// round, and if nothing has been filed in it, resetRound returns it to
// "never opened" — after which the earlier cut may be committed again.

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { roundKey } from './scrambles';
import type { QualifierMethod, RoundStatus } from './rounds';

export class RoundCutError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'RoundCutError';
    this.status = status;
  }
}

/** Has this round been started — so that the cut feeding it is fixed?
 *
 *  EXACTLY: a roundState document exists AND (its status is anything other
 *  than 'closed', OR it carries an openedAt). So 'live' and 'done' are
 *  started, a round that was opened and closed again is started, and a
 *  document with a missing or unrecognised status is started too — that
 *  last is failing closed: a state nobody can read is not proof the round
 *  never ran. Only "no document" and a document resetRound left behind
 *  ('closed', no openedAt) are not started. */
export function roundHasStarted(state: Record<string, unknown> | undefined): boolean {
  if (!state) return false;
  return state.status !== 'closed' || (state.openedAt !== undefined && state.openedAt !== null);
}

export interface CommitRoundCutInput {
  competitionId: string;
  eventId: string;
  round: number;
  method: QualifierMethod;
  value: number;
  qualifierUids: string[];
}

/** Persists round N's qualifiers and ends round N — refused once round N+1
 *  has started. The check and both writes are one transaction, so an admin
 *  opening N+1 in another tab at the same moment cannot slip between them.
 *  Any read that fails throws, and nothing is written. */
export async function commitRoundCut(db: Firestore, input: CommitRoundCutInput): Promise<void> {
  const { competitionId, eventId, round, method, value, qualifierUids } = input;
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const key = roundKey(eventId, round);

  await db.runTransaction(async (tx) => {
    const [compSnap, nextSnap] = await tx.getAll(
      compRef,
      compRef.collection('roundState').doc(roundKey(eventId, round + 1)),
    );
    if (!compSnap.exists) throw new RoundCutError('Тэмцээн олдсонгүй.', 404);
    if (nextSnap.exists && roundHasStarted(nextSnap.data())) {
      throw new RoundCutError(
        `${round + 1}-р раунд аль хэдийн эхэлсэн тул ${round}-р раундын шалгаруулалтыг дахин хийх боломжгүй. ` +
          `Дахин шалгаруулах бол ${round + 1}-р раундыг хааж, «БУЦААХ» дарж нээгээгүй төлөвт оруулна уу ` +
          `(тухайн раундад оролдлого бүртгэгдээгүй үед л боломжтой).`,
      );
    }

    tx.set(compRef.collection('qualifiers').doc(key), {
      eventId,
      round,
      uids: qualifierUids,
      qualifiedAt: FieldValue.serverTimestamp(),
    });
    // Advancing a round also ends it — there is no state where a round has
    // produced qualifiers but is still accepting attempts.
    tx.set(
      compRef.collection('roundState').doc(key),
      {
        eventId,
        round,
        status: 'done' satisfies RoundStatus,
        qualifierMethod: method,
        qualifierValue: value,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

/** БУЦААХ — returns a round to "never opened", so the cut before it can be
 *  redone. Refused, each with the admin's next step:
 *    · the round is live            → close it first;
 *    · the NEXT round has started   → reset that one first (a chain is
 *                                     undone from the end);
 *    · anything is filed in it      → those attempts are real results;
 *                                     they are removed per athlete in the
 *                                     review grid, deliberately, first;
 *    · it never started             → nothing to undo.
 *  On success: status 'closed', openedAt and the applied cut removed, and
 *  this round's own qualifiers doc deleted (a cut of a round with nothing
 *  filed in it selected nobody). Fails closed: a failed read throws before
 *  anything is written. */
export async function resetRound(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<{ status: RoundStatus }> {
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const key = roundKey(eventId, round);
  const stateRef = compRef.collection('roundState').doc(key);

  // Outside the transaction, like round-open's readiness check: it is a
  // query over athletes' submissions, and holding locks on those while a
  // DIFFERENT event's round is live would stall its filings. The round is
  // not live (checked below, in the transaction), so nothing new can be
  // served into it meanwhile.
  const filed = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .where('event', '==', eventId)
    .where('competitionRound', '==', round)
    .count()
    .get();
  const filedCount = filed.data().count;
  if (filedCount > 0) {
    throw new RoundCutError(
      `${round}-р раундад ${filedCount} оролдлого бүртгэгдсэн тул буцаах боломжгүй. ` +
        `Эдгээр нь жинхэнэ дүн — буцаах шаардлагатай бол шүүгчийн хэсгээс тамирчин бүрийн оролдлогыг эхлээд устгана уу.`,
    );
  }

  await db.runTransaction(async (tx) => {
    const [compSnap, stateSnap, nextSnap] = await tx.getAll(
      compRef,
      stateRef,
      compRef.collection('roundState').doc(roundKey(eventId, round + 1)),
    );
    if (!compSnap.exists) throw new RoundCutError('Тэмцээн олдсонгүй.', 404);
    if (!stateSnap.exists || !roundHasStarted(stateSnap.data())) {
      throw new RoundCutError(`${round}-р раунд нээгдээгүй байна — буцаах зүйл алга.`, 400);
    }
    if (stateSnap.get('status') === 'live') {
      throw new RoundCutError(`${round}-р раунд нээлттэй байна. Эхлээд «РАУНД ХААХ» дарна уу.`);
    }
    if (nextSnap.exists && roundHasStarted(nextSnap.data())) {
      throw new RoundCutError(
        `${round + 1}-р раунд эхэлсэн байна. Эхлээд ${round + 1}-р раундыг буцаана уу.`,
      );
    }

    tx.set(
      stateRef,
      {
        eventId,
        round,
        status: 'closed' satisfies RoundStatus,
        openedAt: FieldValue.delete(),
        qualifierMethod: FieldValue.delete(),
        qualifierValue: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.delete(compRef.collection('qualifiers').doc(key));
  });

  return { status: 'closed' };
}
