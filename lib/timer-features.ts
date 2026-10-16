// Feature switches for the timer app (/timer and its sub-routes).
//
// Flip a flag to `true` to re-open that section. While a flag is `false`:
//   - every entry point inside the timer app shows the item disabled with
//     an "Удахгүй" label and clicking it only shows a toast;
//   - direct visits to the section's routes render the "Удахгүй" screen
//     from its route layout instead of the real page, so none of the
//     section's code (Firebase reads, Realtime DB listeners) ever runs.
// The section's pages, routes and Firebase logic are untouched.
export const TIMER_FEATURES = {
  /** Multiplayer racing — /timer/multiplayer */
  racing: false,
  /** Virtual competitions — /timer/competitions/** */
  competition: false,
  /** Coach challenges — /timer/challenge/** (docs/challenge-plan.md).
   *  Phase 2: coaches, rooms and join requests. */
  challenge: true,
} as const satisfies Record<string, boolean>;

export type TimerFeature = keyof typeof TIMER_FEATURES;

/** Toast text shown when a closed section's entry point is clicked. */
export const COMING_SOON_TOAST = 'Удахгүй нээгдэнэ';
