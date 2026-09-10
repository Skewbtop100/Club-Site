// ── The featured competition ────────────────────────────────────────────
// Which competition, if any, the hub's banner shows. Pure — plain numbers
// in, one candidate or null out, no Firestore types and no clock of its
// own (the caller passes `nowMs`) — so it is unit-tested directly.
//
// Two rules here are load-bearing and easy to get wrong by being helpful:
//
//   GATE ON `featured`, NEVER on the banner copy. featuredHeading,
//   featuredCtaLabel and featuredUntil deliberately SURVIVE the flag being
//   switched off — the admin form hides them but never clears them, so
//   unticking and re-ticking restores what was typed (see the field
//   comments in types.ts). A non-empty heading therefore says nothing
//   about whether to show a banner, and treating it as a signal would
//   resurrect a banner the admin took down.
//
//   PICK DETERMINISTICALLY. writeCompetitionDoc enforces exclusivity in a
//   transaction, so two featured competitions should be impossible — but
//   "should be impossible" is exactly the state that must not render
//   whichever document Firestore happened to return first, because that
//   makes the hub flicker between two banners on reload with nothing in
//   the logs.

/** Only what the choice depends on. Timestamps arrive as epoch-ms, so
 *  this module needs neither firebase/firestore nor firebase-admin and
 *  serves the public hub and any server caller alike. */
export interface FeaturedCandidate {
  id: string;
  /** Strictly `true` to count. Absent/undefined is not featured. */
  featured?: boolean;
  /** When the banner stops showing. null = NO EXPIRY, show indefinitely
   *  — a banner with no declared end is a banner the admin has not chosen
   *  to end, and quietly hiding it would be inventing a policy. */
  featuredUntilMs: number | null;
  /** Tie-break only; null sorts last. */
  createdAtMs: number | null;
}

/** The competition whose banner the hub should render, or null.
 *
 *  `nowMs` is passed in rather than read from the clock so the expiry
 *  boundary is testable and so a caller can render a consistent frame.
 *
 *  Drafts are NOT filtered here: the public fetch already excludes them
 *  (fetchAllCompetitions queries `status != 'draft'`), and re-filtering on
 *  a status this module would have to be told about would put a second,
 *  weaker copy of that rule somewhere it could drift. */
export function pickFeatured<T extends FeaturedCandidate>(list: T[], nowMs: number): T | null {
  const eligible = list.filter(
    (c) =>
      // Strict `=== true`: a truthy string or a 1 in a hand-edited
      // document is not a decision the admin made in the form.
      c.featured === true &&
      // Expired is "in the past", so an expiry exactly at this instant
      // still shows — a banner should not blink out mid-second.
      (c.featuredUntilMs === null || c.featuredUntilMs >= nowMs),
  );
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  // More than one survived the exclusivity transaction. Newest first: the
  // transaction clears every other flag when one is set, so if two remain,
  // the later-created one is the one the admin most recently acted on. The
  // id tie-break makes the order total, which is the whole point — the
  // same data must produce the same banner on every load.
  return eligible
    .slice()
    .sort((a, b) => (b.createdAtMs ?? -Infinity) - (a.createdAtMs ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}
