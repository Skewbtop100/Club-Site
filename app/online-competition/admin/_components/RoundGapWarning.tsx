import type { CSSProperties } from 'react';

// ── "This competition is live but no round is open" ──────────────────────
// Commit 30eecd3 made a live round a hard precondition for solving: with
// no roundState doc, resolveRoundAccess returns 'no-live-round', the
// scramble route answers 409, and the athlete gets a blocked screen —
// while the admin saw a perfectly normal-looking competition. This is the
// marker that closes that gap, shown wherever an admin might otherwise
// walk past it.
//
// Styling reuses the admin panel's existing amber warning treatment,
// `.oc-sc-warn` in theme.css (border #3A3018 / background #14100A /
// color #E0A020, already used by the scramble import tabs) rather than
// introducing a second amber — deliberately NOT the volt accent, which
// reads as a normal, healthy state everywhere else in this panel.

export const ROUND_GAP_TEXT = 'Раунд нээгээгүй — тамирчид эвлүүлэлт хийж чадахгүй';

export interface RoundGapEvent {
  eventId: string;
  label: string;
}

export default function RoundGapWarning({
  events,
  style,
}: {
  /** Configured events with no live round. Renders nothing when empty, so
   *  callers can pass the API's list straight through without guarding. */
  events: RoundGapEvent[];
  style?: CSSProperties;
}) {
  if (events.length === 0) return null;
  return (
    <div
      className="oc-sc-warn"
      style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', ...style }}
    >
      <span aria-hidden>▲</span>
      <span>{ROUND_GAP_TEXT}</span>
      <span style={{ color: '#8A6A28' }}>· {events.map((e) => e.label).join(', ')}</span>
    </div>
  );
}
