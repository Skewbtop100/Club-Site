// ── Opening a round, and what that says about the competition ───────────
// Server-only (firebase-admin). Split out of the admin-rounds route so the
// transaction can be run against the emulator in
// tests/competition-fields/roundtrip.test.cjs — the route itself imports
// next/server and cannot be loaded in a test process.
//
// WHY THE COMPETITION MOVES TOO: there were two independent notions of
// "live" and nothing kept them in step. `roundState/{event}_{round}` said a
// round was open; `competition.status` said whether the competition was
// happening. Every athlete-facing surface reads the second — the hub's
// grouping, the dashboard's card choice, everything — so a competition
// with an open round still read as "удахгүй", and an approved athlete had
// no way to reach their own live round except by typing the solve URL.
//
// Opening a round is the act that makes a competition live. Doing it in
// the same transaction is what keeps the two answers from disagreeing
// again, and it needs no new round-trip on any public surface.

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { roundKey } from './scrambles';
import { normalizeCompetitionStatus } from './admin-competitions';
import type { OnlineCompetitionStatus } from './types';
import type { RoundStatus } from './rounds';

export class RoundOpenError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'RoundOpenError';
    this.status = status;
  }
}

export interface OpenRoundResult {
  status: RoundStatus;
  /** The competition's status before this open, and after it. Equal when
   *  nothing moved. The route hands both to the admin UI so the side
   *  effect can be reported rather than discovered. */
  competitionStatusBefore: OnlineCompetitionStatus;
  competitionStatusAfter: OnlineCompetitionStatus;
  /** True when this open is what announced the competition. */
  announcedLive: boolean;
}

/** Opens one round, and announces the competition if it was still
 *  upcoming.
 *
 *  ── WHAT EACH COMPETITION STATUS DOES ──
 *  upcoming → LIVE. The transition this exists for.
 *  live     → unchanged. The ordinary case for rounds 2..N.
 *  draft    → REFUSED. A draft is unannounced: it is absent from the
 *             public site entirely (fetchAllCompetitions filters it out,
 *             and firestore.rules denies reading it). Publishing a
 *             competition is a deliberate act with its own button and its
 *             own readiness checks — having it happen as a side effect of
 *             opening a round would put an unfinished competition in front
 *             of athletes with nobody having decided to.
 *  finished → REFUSED. Reopening a round on a finished competition is
 *             either a correction or a mistake, and they look identical
 *             from here. Refusing names the choice: an admin who means it
 *             sets the status back first, which is one click and leaves a
 *             trace. Before this, it silently opened a round on a
 *             competition the public site still showed as over.
 *
 *  Closing a round deliberately does NOT move the competition back. A
 *  competition is finished when an admin says so — the last round closing
 *  is how a competition ENDS, not how it is decided to have ended, and
 *  results still need judging after it. */
export async function openRound(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<OpenRoundResult> {
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const key = roundKey(eventId, round);

  return db.runTransaction(async (tx) => {
    // ── every read first ──
    const compSnap = await tx.get(compRef);
    if (!compSnap.exists) throw new RoundOpenError('Тэмцээн олдсонгүй.', 404);
    const before = normalizeCompetitionStatus(compSnap.get('status'));

    // Round 2+ needs the previous round's qualifiers: that doc defines who
    // may attempt this one, so without it the round would be live with
    // nobody eligible.
    if (round > 1) {
      const prev = await tx.get(compRef.collection('qualifiers').doc(roundKey(eventId, round - 1)));
      if (!prev.exists) {
        throw new RoundOpenError(
          `${round - 1}-р раунд шалгаруулаагүй байна. Эхлээд өмнөх раундаа шалгаруулна уу.`,
        );
      }
    }

    if (before === 'draft') {
      throw new RoundOpenError(
        'Ноорог тэмцээний раундыг нээх боломжгүй. Эхлээд тэмцээнээ зарлана уу.',
      );
    }
    if (before === 'finished') {
      throw new RoundOpenError(
        'Дууссан тэмцээний раундыг нээх боломжгүй. Үргэлжлүүлэх бол эхлээд тэмцээний статусыг өөрчилнө үү.',
      );
    }

    // ── writes ──
    tx.set(
      compRef.collection('roundState').doc(key),
      {
        eventId,
        round,
        status: 'live' satisfies RoundStatus,
        openedAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const after: OnlineCompetitionStatus = before === 'upcoming' ? 'live' : before;
    if (after !== before) {
      // mergeFields, not a whole-document write: this transaction knows
      // about one field of the competition and must not carry the rest of
      // it back.
      tx.set(compRef, { status: after }, { mergeFields: ['status'] });
    }

    return {
      status: 'live' as RoundStatus,
      competitionStatusBefore: before,
      competitionStatusAfter: after,
      announcedLive: after !== before,
    };
  });
}
