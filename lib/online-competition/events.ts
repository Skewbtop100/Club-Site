import type { ScrambleableEventId } from './scramble-types';

// ── The events an online competition may be configured with ─────────────
// Lives here, not inside a form component: the previous list was five
// entries hardcoded in CompetitionForm.tsx, which meant deleting that file
// deleted the only event picker in the product. It is shared data, so it
// lives in a shared module.
//
// ── Why these ten, and not more ──────────────────────────────────────────
// Every event here is a genuine WCA average-of-5. That is not a
// preference, it is what the platform can actually run: the Ao5 rule and
// the five-attempt count are hardcoded in seven places (computeAo5 in
// ao5.ts, ATTEMPTS_PER_ROUND in round-results.ts, the >= 5 guards in
// athleteStats.ts and seasonPoints.ts, TOTAL_ATTEMPTS on the solve page,
// SCRAMBLES_PER_GROUP for the TNoodle import, and the length === 5 branch
// in summaryStats.ts). An event whose real format is not Ao5 would be
// silently run as one.
//
// DELIBERATELY EXCLUDED — do not "fix" this by adding them:
//
//   666, 777    Scrambleable, and they would work mechanically. Excluded
//               because both are MEAN of 3 in real WCA, so offering them
//               here would run them as a five-attempt Ao5 — a
//               non-standard result presented as a standard one. Add them
//               when per-event format support is real, not before.
//
//   333bf,      Not Ao5, not five attempts, and their results are not the
//   444bf,      same shape (blindfolded events are best-of-3; FMC is a
//   555bf,      written solution; multi-blind is a single attempt scored
//   333mbf,     on cubes-solved). None of them fit a video-recorded
//   333fm       five-solve flow. These are not an oversight.
//
// ── The compile-time check ───────────────────────────────────────────────
// `id` is typed ScrambleableEventId — the literal union of the keys of
// ONLINE_COMP_SCRAMBLE_TYPE — so an event listed here that the scramble
// route cannot generate is a BUILD ERROR, not a runtime 400 that an
// athlete discovers mid-competition. (Configuring an unsupported event
// would otherwise produce a competition nobody can solve: the scramble
// route answers `Unsupported event` with a 400.)
//
// The check runs one way, which is the direction that matters: everything
// offered is scrambleable. The reverse is deliberately not enforced —
// 666/777 are scrambleable and intentionally absent.

export interface OnlineCompEvent {
  id: ScrambleableEventId;
  /** Mongolian display label, stored redundantly onto each competition's
   *  events[] entry (see OnlineCompetitionEventConfig) so renaming one
   *  here never rewrites history on existing competitions. */
  label: string;
}

export const ONLINE_COMP_EVENTS: OnlineCompEvent[] = [
  { id: '333', label: '3x3x3' },
  { id: '222', label: '2x2x2' },
  { id: '444', label: '4x4x4' },
  { id: '555', label: '5x5x5' },
  { id: '333oh', label: '3x3x3 нэг гар' },
  { id: 'pyram', label: 'Пирамид' },
  { id: 'skewb', label: 'Skewb' },
  { id: 'sq1', label: 'Square-1' },
  { id: 'clock', label: 'Clock' },
  { id: 'minx', label: 'Мегаминкс' },
];

/** Label for an event id, falling back to the id itself. A competition may
 *  hold an event this build no longer offers (the list shrank, or the doc
 *  predates it) — such a row must still render as itself rather than
 *  blank. */
export function onlineCompEventLabel(eventId: string): string {
  return ONLINE_COMP_EVENTS.find((e) => e.id === eventId)?.label ?? eventId.toUpperCase();
}
