// ── Competition fees ────────────────────────────────────────────────────
// Formatting and totals for the Төлбөр tab, and the one function the
// public registration page will need when it lands. Pure: no React, no
// Firestore, no clock — unit-tested directly
// (tests/competition-fields/fees.test.cjs).
//
// The money model is deliberately small:
//   baseFeeMnt              what every registrant pays
//   events[].surchargeMnt   what ONE event adds on top; null = included
// There is no payment STATUS here and no per-athlete record. This module
// answers "what does it cost", never "who has paid".

import type { OnlineCompetitionEventConfig } from './types';

/** "15 000₮".
 *
 *  Written out rather than delegated to `toLocaleString`/`Intl.NumberFormat`
 *  with an mn-MN locale, for two reasons. Grouping separators vary by
 *  runtime and ICU build — Node without full-icu, an older browser and a
 *  current one do not agree on what mn-MN produces, and some emit a
 *  narrow no-break space that looks like a normal one until it is copied
 *  into a bank transfer. And a fee is a number the admin reads back
 *  against what they typed, so it must render identically everywhere and
 *  be assertable in a test. The separator here is a plain U+0020.
 *
 *  There was no existing money formatter in the codebase to reuse — the
 *  only number formatting anywhere is a bare `points.toLocaleString()` in
 *  app/profile/page.tsx, which is not a currency and not shared. */
export function formatMnt(amount: number): string {
  const rounded = Math.trunc(Math.abs(amount));
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${amount < 0 ? '-' : ''}${grouped}₮`;
}

/** A number > 0, or null. Everything else — 0, negative, fractional, NaN,
 *  a string, absent — reads as null, i.e. "included in the base fee".
 *  Read-side only: the WRITE path refuses those rather than coercing (see
 *  validateCompetitionInput), so this is what protects a reader from a
 *  document written before the field existed or edited by hand. */
export function surchargeOf(event: Pick<OnlineCompetitionEventConfig, 'surchargeMnt'>): number | null {
  const raw = event.surchargeMnt;
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

export interface FeeTotals {
  /** The base fee alone: what an athlete pays entering only included
   *  events. Equals baseFeeMnt, or 0 when it is unset. */
  minMnt: number;
  /** Base plus EVERY surcharge — the ceiling, for an athlete who enters
   *  everything. */
  maxMnt: number;
  /** Events with no surcharge, in configured order. */
  includedEventIds: string[];
  /** Events that cost extra, in configured order, with the amount. */
  surcharged: { eventId: string; surchargeMnt: number }[];
}

export function competitionFeeTotals(
  baseFeeMnt: number | null,
  events: Pick<OnlineCompetitionEventConfig, 'eventId' | 'surchargeMnt'>[],
): FeeTotals {
  const base = typeof baseFeeMnt === 'number' && baseFeeMnt > 0 ? Math.trunc(baseFeeMnt) : 0;
  const includedEventIds: string[] = [];
  const surcharged: { eventId: string; surchargeMnt: number }[] = [];
  for (const event of events) {
    const surcharge = surchargeOf(event);
    if (surcharge === null) includedEventIds.push(event.eventId);
    else surcharged.push({ eventId: event.eventId, surchargeMnt: surcharge });
  }
  return {
    minMnt: base,
    maxMnt: base + surcharged.reduce((sum, s) => sum + s.surchargeMnt, 0),
    includedEventIds,
    surcharged,
  };
}

/** What ONE athlete owes, given the events they picked.
 *
 *  This is the function the public registration page needs, and it is
 *  here — tested — to make the claim concrete rather than promised: an
 *  OnlineRegistration already stores `events: string[]`, so the athlete's
 *  total is this call and nothing more. NOTHING CALLS IT YET; the public
 *  fee breakdown is a later changeset.
 *
 *  Chosen events not configured on the competition are ignored rather than
 *  charged the base twice or crashing — a registration can outlive an
 *  event the admin later removed.
 *
 *  Returns the base even for an empty selection: registering IS the thing
 *  the base fee buys, and a zero total for an athlete who registered would
 *  be wrong the moment they add an event. */
export function athleteFeeMnt(
  baseFeeMnt: number | null,
  events: Pick<OnlineCompetitionEventConfig, 'eventId' | 'surchargeMnt'>[],
  chosenEventIds: string[],
): number {
  const chosen = new Set(chosenEventIds);
  const base = typeof baseFeeMnt === 'number' && baseFeeMnt > 0 ? Math.trunc(baseFeeMnt) : 0;
  return events.reduce(
    (sum, event) => (chosen.has(event.eventId) ? sum + (surchargeOf(event) ?? 0) : sum),
    base,
  );
}
