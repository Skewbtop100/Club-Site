// ── How far through a round the judging queue is ────────────────────────
// Pure — no Firestore, no React — so the arithmetic behind the admin
// overview's progress bars is unit-tested directly
// (tests/competition-fields/round-progress.test.cjs).
//
// WHY IT EXISTS AS A MODULE: the arithmetic was inline in AdminOverview
// and was wrong in a way nobody could see. It counted submissions whose
// `round` field equalled the competition round — but `round` is the
// ATTEMPT INDEX 1-5, not a round — so "Раунд 1" counted everyone's first
// attempt, "Раунд 2" counted everyone's second, attempts 3-5 were never
// counted at all, and a single-round Ao5 with ten athletes showed a full
// bar at 10/10 with four fifths of the solves still missing.

import { attemptsForFormat, resolveResultFormat, type ResultFormat } from './ao5';

/** Only the fields this needs, so the caller can pass an admin view, a
 *  stored document, or a fixture. */
export interface ProgressEvent {
  eventId: string;
  label: string;
  /** How many competition rounds this event is configured for. */
  rounds: number;
  resultFormat?: ResultFormat;
}

export interface ProgressSubmission {
  event: string;
  /** The COMPETITION round — not the attempt index. */
  competitionRound: number;
}

export interface ProgressRegistration {
  status: string;
  events: string[];
}

export interface RoundProgressRow {
  key: string;
  label: string;
  eventId: string;
  round: number;
  /** Attempt submissions filed for this event+round. */
  done: number;
  /** How many there would be if every approved athlete solved the whole
   *  round. 0 when nobody is approved for the event. */
  expected: number;
  /** 0-100, capped — `done` can legitimately exceed `expected` (see the
   *  note on the denominator below), and a bar past its own end is worse
   *  than a full one. */
  pct: number;
}

/** One row per event+round that has at least one submission.
 *
 *  THE DENOMINATOR is approved athletes registered for the event, times
 *  the attempts one run of that event's format takes — 5 for an Ao5, 3 for
 *  an Mo3. That is the number of submissions a fully-solved round
 *  produces, which is what `done` counts, so the two are finally the same
 *  unit. It is still an approximation, in three known ways:
 *
 *    · Round 2+ over-counts. Only the athletes who qualified are expected
 *      to solve it, and the qualifier list is not part of this data.
 *    · A cut-off run legitimately files fewer attempts than the format
 *      takes, so a round full of cut-off runs can never reach 100%.
 *    · An athlete who re-ran the flow before attempts became immutable can
 *      leave more submissions in a slot than the run needed, which is why
 *      `done` may exceed `expected` and why pct is capped.
 *
 *  Rows with no submissions at all are omitted, as before: a round nobody
 *  has started is not progress, it is absence. */
export function roundProgressRows(
  events: ProgressEvent[],
  submissions: ProgressSubmission[],
  registrations: ProgressRegistration[],
): RoundProgressRow[] {
  const rows: RoundProgressRow[] = [];
  for (const ev of events) {
    const athletes = registrations.filter((r) => r.status === 'approved' && r.events.includes(ev.eventId)).length;
    const perRun = attemptsForFormat(resolveResultFormat(ev.resultFormat));
    const expected = athletes * perRun;
    for (let round = 1; round <= ev.rounds; round += 1) {
      const done = submissions.filter((s) => s.event === ev.eventId && s.competitionRound === round).length;
      if (done === 0) continue;
      rows.push({
        key: `${ev.eventId}-${round}`,
        label: `${ev.label} · Раунд ${round}`,
        eventId: ev.eventId,
        round,
        done,
        expected,
        pct: expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : 0,
      });
    }
  }
  return rows;
}
