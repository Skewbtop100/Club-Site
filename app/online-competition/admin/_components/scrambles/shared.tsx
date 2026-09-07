'use client';

import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';

// Helpers shared by the four tabs of the Холилт ба групп workspace.
//
// Styling rule for this whole directory, same as the rest of the admin
// section: literal inline styles or `.oc-*` classes from theme.css only —
// never a Tailwind class assembled at runtime, and never a spacing utility
// that globals.css's unlayered `* { margin: 0; padding: 0 }` reset would
// silently zero.

/** The competition's own label for an event, falling back to the raw id
 *  for anything imported that the competition isn't configured for. */
export function eventLabel(competition: OnlineCompetitionAdminView | null, eventId: string): string {
  return competition?.events.find((e) => e.eventId === eventId)?.label ?? eventId.toUpperCase();
}

/** Short code for the 30px icon square, e.g. "333" -> "333". */
export function eventCode(eventId: string): string {
  return eventId.toUpperCase().slice(0, 5);
}

export function roundTitle(
  competition: OnlineCompetitionAdminView | null,
  eventId: string,
  round: number,
): string {
  return `${eventLabel(competition, eventId)} · Раунд ${round}`;
}

export interface EventChoice {
  eventId: string;
  label: string;
  count: number;
}

/** Event filter chips, shared by the Холилт and Групп tabs. */
export function EventChips({
  choices,
  value,
  onChange,
}: {
  choices: EventChoice[];
  value: string | null;
  onChange: (eventId: string) => void;
}) {
  return (
    <div className="oc-sc-chiprow">
      {choices.map((c) => (
        <button
          key={c.eventId}
          type="button"
          className={`oc-sc-chip${c.eventId === value ? ' oc-sc-chip-active' : ''}`}
          aria-pressed={c.eventId === value}
          onClick={() => onChange(c.eventId)}
        >
          {c.label}
          <span className="oc-sc-chipcount">{c.count}</span>
        </button>
      ))}
    </div>
  );
}
