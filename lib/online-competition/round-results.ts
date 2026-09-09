import type { Firestore } from 'firebase-admin/firestore';
import {
  attemptsForFormat,
  computeResult,
  cutoffPhaseFor,
  effectiveAttemptTime,
  resolveResultFormat,
  type AttemptTime,
  type ResultFormat,
} from './ao5';
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

/** The event's scoring format, from the competition document.
 *
 *  A NEW READ. collectRoundResults previously touched onlineSubmissions
 *  and nothing else; how a round is scored lives on the competition, so
 *  there is no way to derive it from the submissions alone. One document
 *  read per call, which is cheap next to the submissions query it already
 *  runs. (The qualify route separately fetches the same document to check
 *  existence — a duplicate read, kept rather than threading the format
 *  through every caller as a parameter each one could get wrong.)
 *
 *  Falls back to 'ao5' for an event with no stored format, or a
 *  competition/event that cannot be found — resolveResultFormat's rule,
 *  and what every competition ran before formats existed. */
async function eventScoringRules(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<{ format: ResultFormat; timeLimitCs: number | null; cutoffCs: number | null }> {
  const snap = await db.collection('onlineCompetitions').doc(competitionId).get();
  const events = snap.get('events');
  if (!Array.isArray(events)) return { format: 'ao5', timeLimitCs: null, cutoffCs: null };
  const event = (events as Record<string, unknown>[]).find((e) => e?.eventId === eventId);
  // The cutoff is PER ROUND, so pick out this round's entry.
  const cutoffs = Array.isArray(event?.cutoffs) ? (event.cutoffs as Record<string, unknown>[]) : [];
  const forRound = cutoffs.find((c) => c?.round === round);
  return {
    format: resolveResultFormat(event?.resultFormat),
    // null = no limit, for a legacy event and for a missing competition.
    timeLimitCs: typeof event?.timeLimitCs === 'number' ? event.timeLimitCs : null,
    cutoffCs: typeof forRound?.cutoffCs === 'number' ? forRound.cutoffCs : null,
  };
}

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
function effectiveTime(data: FirebaseFirestore.DocumentData, timeLimitCs: number | null): AttemptTime {
  return effectiveAttemptTime({
    status: data.status === 'approved' || data.status === 'rejected' ? data.status : 'pending',
    reportedTime: typeof data.reportedTime === 'number' ? data.reportedTime : 0,
    isDnf: data.isDnf === true,
    penalty: data.penalty ?? null,
  }, timeLimitCs);
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
  /** The round's RANKING VALUE: an average for ao5/mo3, the BEST SINGLE
   *  for bo3/bo2/bo1 — those formats have no average at all. null = a DNF
   *  result; such an athlete finished the round but cannot be ranked or
   *  qualified.
   *
   *  Renamed from `ao5`, which was already a lie for Mo3 and meaningless
   *  for Bo-N. Free to rename: this type and RoundRanking are in-memory
   *  only, and their one wire shape (QualifyResponse) is consumed solely
   *  by RoundsManager in this repo. The `ao5` keys that ARE stored —
   *  onlineParticipants.stats[event].ao5 and the registration doc's
   *  results.{event}.ao5 — are untouched here; renaming those is a data
   *  migration and belongs with step E. */
  value: number | null;
  /** Best single among this round's attempts, or null if every attempt was
   *  a DNF. Carried separately because it is the WCA TIE-BREAK: equal
   *  averages are separated by the better single. For a bo-N round it is
   *  the same number as `value`. */
  best: number | null;
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
  const { format: resultFormat, timeLimitCs, cutoffCs } = await eventScoringRules(
    db,
    competitionId,
    eventId,
    round,
  );
  const attemptsPerRound = attemptsForFormat(resultFormat);
  // Non-null only when this round has a cutoff AND the format has an
  // established phase for one (cutoffPhaseFor — ao5/bo3 only).
  const phase = cutoffCs !== null ? cutoffPhaseFor(resultFormat) : null;

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
    // Slots beyond this format's count are ignored. Step B's lock means
    // a judged event's format cannot change, so this should never fire —
    // it is here so stale data degrades to "ignored" rather than to a
    // fabricated set.
    if (attempt < 1 || attempt > attemptsPerRound) continue;
    const uid = data.uid;
    if (typeof uid !== 'string') continue;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid)!.push({ attempt, createdAt, time: effectiveTime(data, timeLimitCs) });
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
    // ── THE CUTOFF, DERIVED SERVER-SIDE ──
    //
    // Whether an athlete was cut off is COMPUTED here from their judged
    // times, never read from a flag the client wrote. That is what closes
    // the redo hole: an athlete who fails the cutoff, presses Дахин and
    // runs the full count leaves submissions in slots 3..N, but those
    // slots are simply never consulted — the cutoff phase is decided from
    // slots 1..phase, which "first run counts" (oldest-per-slot above)
    // pins to their original run. There is nothing to tamper with and
    // nothing to keep in sync, and it survives a page reload because it
    // was never client state to begin with.
    //
    // It also means the JUDGED time decides, not the self-reported one the
    // athlete saw. A +2 that pushes their only sub-cutoff attempt over
    // retroactively cuts them off and discards attempts they should not
    // have had — which is the correct WCA answer, if a harsh one.
    const cutOff =
      phase !== null &&
      // every attempt of the phase must be judged before this can be decided
      Array.from({ length: phase }, (_, i) => bySlot.get(i + 1)).every((a) => a !== undefined) &&
      // ...and none of them beat the cutoff (STRICTLY better is required)
      Array.from({ length: phase }, (_, i) => bySlot.get(i + 1)!.time).every(
        (t) => t === 'DNF' || t >= cutoffCs!,
      );

    // Complete means "every attempt owed", and a cut-off athlete owes only
    // the phase. Anyone else still owes the full count.
    const owed = cutOff ? phase! : attemptsPerRound;
    if (bySlot.size < owed) continue;

    const times: AttemptTime[] = [];
    for (let i = 1; i <= owed; i++) times.push(bySlot.get(i)!.time);

    // The tie-break single, independent of format: the fastest attempt
    // that was not a DNF.
    const finished = times.filter((t): t is number => t !== 'DNF');
    const best = finished.length > 0 ? Math.min(...finished) : null;

    // A cut-off athlete's partial set NEVER reaches computeResult. That is
    // structural, not a guard: computeResult's ao5 branch is deliberately
    // unlength-guarded for step-A compatibility, so handing it two attempts
    // returns sum/3 over a one-element slice — a plausible-looking average
    // FASTER than either attempt. A cutoff result is a single, so there is
    // no average to compute and the averaging path is not entered at all.
    //
    // value === null is also what makes them unadvanceable: selectQualifiers
    // filters on exactly that, so the "may not advance" decision needs no
    // second rule. They still rank, below every athlete with a result,
    // ordered on `best` — the mixed-round sort below.
    const value = cutOff ? null : computeResult(times, resultFormat).value;

    // `owed`, not bySlot.size: the attempts that COUNTED toward this
    // result. They are the same number for everyone except a cut-off
    // athlete who then re-ran the round — their extra slots exist but took
    // no part, and reporting 5 there would describe a five-attempt result
    // that was never computed.
    results.push({ uid, displayName: uid.slice(0, 10), value, best, attempts: owed });
  }

  // WCA MIXED-ROUND ORDER:
  //   1. everyone WITH a result ranks above everyone without one
  //   2. among those, by result ascending
  //   3. ties, and everyone WITHOUT a result, by BEST SINGLE ascending
  //   4. uid, purely for determinism
  //
  // Steps 3 and 4 are shared deliberately: the same key that breaks a tie
  // between two equal averages also orders the athletes who have no
  // average at all. That is exactly WCA's rule — a competitor with no
  // average is ranked on their single, below everyone who has one — and
  // writing it once means the two can never drift apart.
  //
  // `value` already means the right thing per format (an average for
  // ao5/mo3, the best single for bo-N), so one sort serves all five.
  //
  // An athlete whose every attempt DNF'd has NO single either (best ===
  // null) and sorts to the very bottom, below the DNF-average athletes who
  // at least completed something. WCA ranks them too — last, tied with
  // each other — rather than omitting them; only a competitor who never
  // started is unranked, and this platform has no DNS concept.
  results.sort((a, b) => {
    const aHas = a.value !== null;
    const bHas = b.value !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.value !== b.value) return a.value! - b.value!;
    if (a.best === null && b.best === null) return a.uid.localeCompare(b.uid);
    if (a.best === null) return 1;
    if (b.best === null) return -1;
    if (a.best !== b.best) return a.best - b.best;
    return a.uid.localeCompare(b.uid);
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

/** Standings for one event+round, best result first.
 *
 *  EVERY athlete who finished the round appears, including those with a
 *  DNF result — they are ranked below everyone with a result, ordered by
 *  their best single (see the sort above). Only athletes who have NOT had
 *  every attempt judged are absent; those are incomplete, not unranked.
 *
 *  This used to drop DNF-result athletes entirely, so they finished a
 *  round with no placement at all. That diverged from WCA, and it made
 *  non-qualification an accident of absence rather than a rule: because
 *  they were not in the list, no cut could reach them. They are in the
 *  list now, so selectQualifiers (rounds.ts) states that rule explicitly
 *  instead of relying on the omission.
 *
 *  Preserves collectRoundResults' order exactly — this is now a projection
 *  with no filter, so the Nth entry here is the Nth place there. */
export async function rankRoundResults(
  db: Firestore,
  competitionId: string,
  eventId: string,
  round: number,
): Promise<RoundRanking[]> {
  const results = await collectRoundResults(db, competitionId, eventId, round);
  return results.map(({ uid, displayName, value, best, attempts }) => ({
    uid,
    displayName,
    value,
    best,
    attempts,
  }));
}
