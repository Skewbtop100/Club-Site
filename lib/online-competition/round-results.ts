import type { Firestore } from 'firebase-admin/firestore';
import { computeAo5, effectiveAttemptTime, type AttemptTime } from './ao5';
import { normalizeRoundStatus, type RoundRanking, type RoundStateDoc } from './rounds';

// ── Ranking a competition round's results ───────────────────────────────
// Server-only. Turns approved submissions into the ordered standings the
// qualifier selection works from.
//
// ── How a submission is attributed to a competition round ──────────
// By the `competitionRound` field on the document, matched directly in
// the query below. Two separate fields, deliberately not merged:
//   `round`            — the ATTEMPT index 1-5 within one run
//   `competitionRound` — the competition round that run belongs to
// The solve flow resolves competitionRound once per run from the same
// round-access gate that admits the athlete, so the stored value can
// never disagree with the round they were actually let into.
//
// This replaced a createdAt time-window rule (a round took everything
// created between its own openedAt and the next round's). That INFERRED
// the round instead of recording it, and broke three ways: re-opening a
// round rewrote openedAt and silently re-attributed already-judged work;
// a round that was never opened had no start bound and swallowed
// everything; and nothing separated two runs inside one window. None of
// that applies to a field written at submission time.

const ATTEMPTS_PER_ROUND = 5;

interface ApprovedAttempt {
  attempt: number;
  createdAt: number;
  time: AttemptTime;
}

/** Same effective-time rule as athleteStats/seasonPoints: a judge's +2
 *  adds 200cs, a DNF is a DNF, and a REJECTED attempt is a DNF whatever
 *  it claims. One shared implementation (ao5.ts) — this used to be a local
 *  copy, and the rule is now status-dependent enough that three copies of
 *  it was the bug. */
function effectiveTime(data: FirebaseFirestore.DocumentData): AttemptTime {
  return effectiveAttemptTime({
    status: data.status === 'approved' || data.status === 'rejected' ? data.status : 'pending',
    reportedTime: typeof data.reportedTime === 'number' ? data.reportedTime : 0,
    isDnf: data.isDnf === true,
    penalty: data.penalty ?? null,
  });
}

export async function fetchRoundStates(
  db: Firestore,
  competitionId: string,
): Promise<Map<string, RoundStateDoc>> {
  const snap = await db
    .collection('onlineCompetitions')
    .doc(competitionId)
    .collection('roundState')
    .get();
  const out = new Map<string, RoundStateDoc>();
  for (const d of snap.docs) {
    const data = d.data();
    out.set(d.id, {
      status: normalizeRoundStatus(data.status),
      openedAt: data.openedAt?.toMillis?.() ?? null,
      qualifierMethod: data.qualifierMethod ?? null,
      qualifierValue: typeof data.qualifierValue === 'number' ? data.qualifierValue : null,
    });
  }
  return out;
}

/** One athlete's finished round. Same shape as RoundRanking except that
 *  `ao5` may be null, meaning a DNF average (2+ DNFs among the five). */
export interface RoundResult {
  uid: string;
  displayName: string;
  /** null = DNF average. Such an athlete finished the round but cannot be
   *  ranked or qualified. */
  ao5: number | null;
  attempts: number;
}

/** Everyone who FINISHED this event+round — all five attempts approved —
 *  including athletes whose average is a DNF, sorted best first with the
 *  DNF averages last.
 *
 *  Split out of rankRoundResults so the round-finalised notification can
 *  address athletes the ranking deliberately drops: a DNF average is not a
 *  placement, but it is still a completed round the athlete should hear
 *  about. One sort lives here and here only, so a notification's placement
 *  number can never disagree with the standings the qualifier used. */
export async function collectRoundResults(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<RoundResult[]> {
  const snap = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    // JUDGED, not approved. A judge-assigned DNF writes status:'rejected'
    // (review/route.ts), so an approved-only query silently dropped that
    // attempt, left the athlete with 4 of 5 slots, and the completeness
    // check below then removed them from the standings altogether — when
    // WCA says one DNF is simply the worst attempt, dropped, leaving a
    // perfectly valid Ao5. A rejected attempt now enters the set as a DNF.
    //
    // PENDING is still excluded, which is what keeps "complete" meaning
    // "fully judged": an athlete with an unjudged attempt is not ranked.
    //
    // No new composite index: `in` over two values expands to the same
    // equality shape this query already used.
    .where('status', 'in', ['approved', 'rejected'])
    .where('competitionRound', '==', round)
    .get();

  const byUid = new Map<string, ApprovedAttempt[]>();
  for (const d of snap.docs) {
    const data = d.data();
    if (data.event !== eventId) continue;
    // Still read — but only for the oldest-per-slot rule below, never for
    // deciding which round this attempt belongs to.
    const createdAt = data.createdAt?.toMillis?.() ?? 0;
    const attempt = typeof data.round === 'number' ? data.round : 0;
    if (attempt < 1 || attempt > ATTEMPTS_PER_ROUND) continue;
    const uid = data.uid;
    if (typeof uid !== 'string') continue;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid)!.push({ attempt, createdAt, time: effectiveTime(data) });
  }

  const results: RoundResult[] = [];
  for (const [uid, attempts] of byUid) {
    // An athlete can re-run the solve flow, leaving several judged
    // submissions in one attempt slot. Take the OLDEST per slot — the same
    // "first run counts" rule the review grid surfaces — so the ranking is
    // deterministic rather than depending on read order.
    //
    // Now that rejected attempts are visible here, this has teeth it did
    // not have before: if run 1 was judged DNF and run 2 approved, the
    // OLDEST is the rejected one, so the slot is a DNF. That is the point
    // of "first run counts" — re-running until a solve passes must not be
    // a way to erase a DNF. It does mean a rejection is final for that
    // slot; there is no "voided, please resubmit" verdict in the schema
    // (review/route.ts offers approve / +2 / DNF only).
    const bySlot = new Map<number, ApprovedAttempt>();
    for (const a of attempts) {
      const existing = bySlot.get(a.attempt);
      if (!existing || a.createdAt < existing.createdAt) bySlot.set(a.attempt, a);
    }
    // Judged attempts, not approved ones — see the query above.
    if (bySlot.size < ATTEMPTS_PER_ROUND) continue;
    const times: AttemptTime[] = [];
    for (let i = 1; i <= ATTEMPTS_PER_ROUND; i++) times.push(bySlot.get(i)!.time);
    // A DNF average is kept here (ao5: null) and dropped by
    // rankRoundResults below — it is a finished round, just not a
    // rankable one.
    const { ao5 } = computeAo5(times);
    results.push({ uid, displayName: uid.slice(0, 10), ao5, attempts: bySlot.size });
  }

  // Best first, DNF averages last. rankRoundResults filters this list
  // without re-sorting, so placement indices are identical in both.
  results.sort((a, b) => {
    if (a.ao5 === null && b.ao5 === null) return a.uid.localeCompare(b.uid);
    if (a.ao5 === null) return 1;
    if (b.ao5 === null) return -1;
    return a.ao5 - b.ao5 || a.uid.localeCompare(b.uid);
  });

  if (results.length > 0) {
    const docs = await db.getAll(
      ...results.map((r) => db.collection('onlineParticipants').doc(r.uid)),
    );
    const nameByUid = new Map(docs.map((d) => [d.id, (d.data()?.displayName as string | undefined) ?? '']));
    for (const r of results) r.displayName = nameByUid.get(r.uid) || r.uid.slice(0, 10);
  }

  return results;
}

/** Standings for one event+round, best Ao5 first.
 *
 *  Only athletes with all five attempts JUDGED AND a real (non-DNF) Ao5
 *  are ranked — everyone else is simply absent, which is what makes them
 *  non-qualifying by construction rather than by a separate rule. The
 *  filter preserves collectRoundResults' order, so the Nth entry here is
 *  the Nth place there too. */
export async function rankRoundResults(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<RoundRanking[]> {
  const results = await collectRoundResults(db, competitionId, eventId, round);
  return results
    .filter((r): r is RoundResult & { ao5: number } => r.ao5 !== null)
    .map(({ uid, displayName, ao5, attempts }) => ({ uid, displayName, ao5, attempts }));
}
