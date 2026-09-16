// ── How far through a round its ROSTER is ───────────────────────────────
// The numbers Раунд удирдах runs on: who is in a round, how many have
// finished it, how many have not, and how many submissions are still
// waiting for a judge.
//
// PURE. A roster and submissions in, counts and rows out — no Firestore, no
// clock — so it is unit-tested directly (tests/competition-fields/
// round-roster-progress.test.cjs) and the admin API can call it over data
// it has already fetched for other reasons.
//
// ── NOT round-progress.ts, WHICH IS A DIFFERENT QUESTION ────────────────
// That module counts SUBMISSIONS against "approved athletes x attempts per
// run" for AdminOverview's progress bars, and its own header lists the
// three approximations that costs: round 2+ over-counts because the
// qualifier list is not in its inputs, a round of cut-off runs can never
// reach 100%, and historical re-runs let `done` exceed `expected`. Two of
// those three are exactly what a control centre must not get wrong, so this
// is a separate module rather than an extension of that one — and named
// apart, because two modules called "round progress" meaning different
// things is how the wrong one gets called.
//
// ── IT DOES NOT DECIDE WHAT "FINISHED" MEANS ────────────────────────────
// rankJudgedStandings (live-view.ts) does, and this calls it. That matters
// more than it looks: "finished" is cutoff-aware — an athlete the cutoff
// stopped owes 2 attempts of 5, not 5 — and it is the same judgement the
// public standings and the qualifier already make. A second implementation
// here would eventually disagree with them, and the place it would surface
// is an admin being warned that a finished round is unfinished, or worse,
// not being warned when it is not.
//
// So the only rules this module owns are the two rankJudgedStandings has no
// opinion on, because it drops pending attempts before it starts:
//   * a submission still awaiting review, and
//   * an athlete on the roster who has filed nothing at all.

import { rankJudgedStandings, type JudgedSubmission, type RoundRules } from './live-view';

/** What an admin needs to know about one athlete in one round. */
export interface RosterProgressRow {
  uid: string;
  /** One per attempt slot: centiseconds, 'DNF' for a judge-rejected
   *  attempt, or null for a slot with nothing JUDGED in it — which covers
   *  both "not filed" and "filed, awaiting review". `pendingSlots` is what
   *  tells those two apart. */
  cells: (number | 'DNF' | null)[];
  /** Attempt slots (1-based) holding a submission a judge has not decided
   *  yet. */
  pendingSlots: number[];
  /** The bucket the filter tabs sort on.
   *
   *  `awaiting` WINS over the other two, deliberately: an athlete who has
   *  filed all five attempts with one unjudged is not something the admin
   *  can call complete, and not something the athlete can act on either —
   *  the only move is a judge's. Putting them under `incomplete` would have
   *  the admin chasing someone who has already done everything asked. */
  state: 'complete' | 'awaiting' | 'incomplete';
  /** The cutoff ended their round early. They are `complete` on fewer
   *  attempts than the format's count, which is correct and looks wrong —
   *  so the table says so. */
  cutOff: boolean;
  /** Judged attempts filed, of `expected`. For the "3/5" readout. */
  filed: number;
  /** How many this athlete OWES — the format's count, or the cutoff phase
   *  for someone the cutoff stopped. */
  expected: number;
}

export interface RosterProgress {
  /** Everyone eligible for the round: registered for the event (round 1) or
   *  advanced into it (round 2+). The CALLER resolves that — see
   *  eligibleAthletesForRound, whose rule the admin API reuses so this
   *  count and the athletes the scramble gate admits cannot disagree. */
  participants: number;
  /** Every attempt they owe is judged. Cutoff-aware. */
  complete: number;
  /** participants - complete, so the two always add up to the roster. An
   *  athlete waiting on a judge counts here: their round is not finished,
   *  whoever it is waiting on. */
  incomplete: number;
  /** Of the incomplete, how many have filed NOTHING — the difference
   *  between a round that has not started and one that is stuck. */
  notStarted: number;
  /** SUBMISSIONS awaiting review, not athletes: it is the judge's queue
   *  length for this round. */
  pendingSubmissions: number;
  /** ATHLETES with at least one submission awaiting review. */
  pendingAthletes: number;
  /** One row per roster member. Ordered awaiting, then incomplete, then
   *  complete — the admin's order of interest, not a ranking. */
  rows: RosterProgressRow[];
}

const STATE_ORDER: Record<RosterProgressRow['state'], number> = {
  awaiting: 0,
  incomplete: 1,
  complete: 2,
};

/**
 *  @param roster  uids eligible for this round, in any order.
 *  @param submissions  EVERY submission for this one event+round, all three
 *    statuses. Pending ones are counted here and dropped before ranking.
 *  @param rules  the round's format, attempt count, time limit and cutoff.
 */
export function roundRosterProgress(
  roster: string[],
  submissions: JudgedSubmission[],
  rules: RoundRules,
): RosterProgress {
  // `nameOf` is the identity, so `row.name` comes back as the uid and this
  // module never needs athlete names to count. It is also why nothing here
  // widens StandingRow, which is a wire type of the PUBLIC live view —
  // adding a field to that to serve the admin would publish it.
  const standings = rankJudgedStandings(submissions, rules, (uid) => uid, null);
  const byUid = new Map(standings.map((r) => [r.name, r]));

  const pendingByUid = new Map<string, number[]>();
  let pendingSubmissions = 0;
  for (const s of submissions) {
    if (s.status !== 'pending') continue;
    // Outside the format's slots: ignored, exactly as the rankers ignore
    // it, so a stale document cannot inflate a queue length.
    if (s.attempt < 1 || s.attempt > rules.attempts) continue;
    pendingSubmissions++;
    const slots = pendingByUid.get(s.uid);
    if (slots) slots.push(s.attempt);
    else pendingByUid.set(s.uid, [s.attempt]);
  }

  // The roster is the authority on WHO is in the round. A submission from
  // someone not on it is still counted in the judge's queue above — it is a
  // real thing awaiting review — but it gets no row and no place in the
  // participant totals, because round membership is not something a
  // submission gets to assert.
  const uids = [...new Set(roster)];

  const rows: RosterProgressRow[] = uids.map((uid) => {
    const row = byUid.get(uid);
    const pendingSlots = (pendingByUid.get(uid) ?? []).slice().sort((a, b) => a - b);
    const cells = row ? row.cells : Array.from({ length: rules.attempts }, () => null);
    const filed = cells.filter((c) => c !== null).length;
    // A cut-off athlete's later slots were nulled by the ranker, so their
    // filed count IS what they owed.
    const expected = row?.cutOff ? filed : rules.attempts;
    const state: RosterProgressRow['state'] =
      pendingSlots.length > 0 ? 'awaiting' : row?.hasResult ? 'complete' : 'incomplete';
    return { uid, cells, pendingSlots, state, cutOff: row?.cutOff ?? false, filed, expected };
  });

  rows.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.uid < b.uid ? -1 : 1));

  const complete = rows.filter((r) => r.state === 'complete').length;
  return {
    participants: uids.length,
    complete,
    incomplete: uids.length - complete,
    notStarted: rows.filter((r) => r.filed === 0 && r.pendingSlots.length === 0).length,
    pendingSubmissions,
    pendingAthletes: rows.filter((r) => r.pendingSlots.length > 0).length,
    rows,
  };
}
