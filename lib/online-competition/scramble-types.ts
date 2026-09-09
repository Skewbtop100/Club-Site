// Local copy of the cstimer_module event-type mapping (see lib/scramble.ts's
// CSTIMER_SCRAMBLE_TYPE) — trimmed to common WCA events. Kept as a separate
// copy, not an import, so this feature stays decoupled from club-specific
// files. Server-side only: cstimer_module never ships in the client bundle.
export const ONLINE_COMP_SCRAMBLE_TYPE = {
  '333':   { type: '333' },
  '222':   { type: '222so' },
  '444':   { type: '444wca' },
  '555':   { type: '555wca', len: 60 },
  '666':   { type: '666wca', len: 80 },
  '777':   { type: '777wca', len: 100 },
  '333oh': { type: '333' },
  pyram:   { type: 'pyrso', len: 10 },
  skewb:   { type: 'skbso' },
  sq1:     { type: 'sqrs' },
  clock:   { type: 'clkwca' },
  minx:    { type: 'mgmp', len: 70 },
  // `satisfies`, not a `Record<string, …>` annotation: it still checks
  // every value against the shape, but KEEPS the literal key types, so
  // `keyof typeof` below is the real set of scrambleable event ids rather
  // than `string`. That is what lets ONLINE_COMP_EVENTS (./events.ts) be
  // checked against this list at compile time instead of by comment.
} satisfies Record<string, { type: string; len?: number }>;

/** The event ids this route can actually generate a scramble for. */
export type ScrambleableEventId = keyof typeof ONLINE_COMP_SCRAMBLE_TYPE;

/** Config for an arbitrary (untrusted) event id, or undefined if this
 *  build cannot scramble it. The widening cast lives here, once, rather
 *  than at the call site: with literal keys the object cannot be indexed
 *  by a plain `string`, and callers legitimately hold one (an event id
 *  off a query string or a stored competition doc). */
export function scrambleConfigFor(eventId: string): { type: string; len?: number } | undefined {
  return (ONLINE_COMP_SCRAMBLE_TYPE as Record<string, { type: string; len?: number } | undefined>)[eventId];
}
