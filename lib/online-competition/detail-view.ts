// ── Public detail page: derived rows ────────────────────────────────────
// What the ТӨРЛҮҮД table and the ХУВААРЬ timeline show, as pure functions
// of the (already normalised) competition. No React, no Firestore, no
// clock — unit-tested in tests/competition-fields/detail-view.test.cjs,
// the same split the readiness checklist uses: derivable logic lives here,
// the component only lays it out.
//
// Every formatter is an EXISTING one — formatLabel (ao5.ts), fmtTimeLimit
// (time-utils.ts), fmtClock / scheduleTimings (schedule.ts),
// onlineCompEventLabel (events.ts). Nothing here formats a number itself,
// so the public page cannot render a limit or a time differently from the
// admin editor that set it.

import { formatLabel, resolveResultFormat } from './ao5';
import { onlineCompEventLabel } from './events';
import { fmtClock, minutesOfDay, scheduleTimings } from './schedule';
import { fmtTimeLimit } from './time-utils';
import type {
  OnlineCompetitionAdvancement,
  OnlineCompetitionEventConfig,
  OnlineCompetitionScheduleEntry,
} from './types';

/** "Раунд 1" / "Раунд 2" / "Финал". The last round of an event is its
 *  final — including a one-round event, whose only round IS the final.
 *  The same rule the admin Хуваарь editor's programme select uses, so a
 *  slot the admin picked as "3x3x3 · Финал" reads the same here. */
export function roundLabel(round: number, totalRounds: number): string {
  return round >= totalRounds ? 'Финал' : `Раунд ${round}`;
}

/** "Дээд 12 дараагийн раундад" / "Дээд 50% дараагийн раундад". */
export function advancementText(a: Pick<OnlineCompetitionAdvancement, 'method' | 'value'>): string {
  return a.method === 'percent' ? `Дээд ${a.value}% дараагийн раундад` : `Дээд ${a.value} дараагийн раундад`;
}

// ── ТӨРЛҮҮД ────────────────────────────────────────────────────────────

export interface EventRoundRow {
  /** Stable React key. */
  key: string;
  eventId: string;
  /** The event's label, set ONLY on its first round's row — later rounds
   *  leave the cell blank so the grouping reads down the column. */
  eventLabel: string | null;
  round: number;
  roundLabel: string;
  /** One format per EVENT on this platform, repeated on every row. The
   *  mockup's "Bo2 / Ao5" in a single cell implies a per-round format,
   *  which does not exist here — so none is invented. */
  format: string;
  /** Per event, repeated per row: "10:00" or "—". */
  limit: string;
  /** Per ROUND — cutoffs are keyed by round: "1:00" or "—". */
  cutoff: string;
  /** The plan for the transition OUT of this round. '' on the final
   *  round (there is no next round); "—" on a non-final round with no
   *  plan declared, which is a different fact from "no next round". */
  next: string;
}

export interface EventTable {
  rows: EventRoundRow[];
  /** Whether any row shows a limit / a cutoff — each explanatory block
   *  under the table appears only when its concept is actually in use. */
  usesLimit: boolean;
  usesCutoff: boolean;
}

export function eventRoundRows(events: OnlineCompetitionEventConfig[]): EventTable {
  const rows: EventRoundRow[] = [];
  let usesLimit = false;
  let usesCutoff = false;

  for (const e of events) {
    const total = Math.max(1, e.rounds);
    const format = formatLabel(resolveResultFormat(e.resultFormat));
    const limitCs = typeof e.timeLimitCs === 'number' && e.timeLimitCs > 0 ? e.timeLimitCs : null;
    if (limitCs !== null) usesLimit = true;

    for (let round = 1; round <= total; round++) {
      const cutoff = (e.cutoffs ?? []).find((c) => c.round === round);
      if (cutoff) usesCutoff = true;
      const plan = (e.advancement ?? []).find((a) => a.fromRound === round);
      rows.push({
        key: `${e.eventId}-${round}`,
        eventId: e.eventId,
        eventLabel: round === 1 ? e.label : null,
        round,
        roundLabel: roundLabel(round, total),
        format,
        limit: limitCs === null ? '—' : fmtTimeLimit(limitCs),
        cutoff: cutoff ? fmtTimeLimit(cutoff.cutoffCs) : '—',
        next: round >= total ? '' : plan ? advancementText(plan) : '—',
      });
    }
  }
  return { rows, usesLimit, usesCutoff };
}

// ── ХУВААРЬ ────────────────────────────────────────────────────────────

export interface ScheduleRow {
  key: string;
  /** "10:00", or null when the competition has no start time to anchor
   *  against — a clock reading midnight would be a wrong answer presented
   *  as a right one. */
  start: string | null;
  end: string | null;
  /**
   *  'round'  — a round of an event the competition is configured for.
   *  'stale'  — a round entry naming an event the competition no longer
   *             has, or a round beyond that event's count. Kept, see below.
   *  'other'  — the admin's own label (registration, a break, ...).
   */
  kind: 'round' | 'stale' | 'other';
  eventId: string | null;
  label: string;
  note: string | null;
}

export interface ScheduleView {
  rows: ScheduleRow[];
  /** True when a stored startMin disagrees with what the durations
   *  produce. The rows use the recomputed times either way; this exists
   *  so the page can say so in the console. */
  storedStartsDisagree: boolean;
}

/** The timeline, in array order.
 *
 *  TIMES ARE RECOMPUTED, NOT READ. Each row starts at the competition's
 *  startAt plus every preceding duration — the same accumulation the
 *  admin editor performs when it writes startMin. The stored startMin is
 *  a projection of exactly that, restamped on every save, so the two
 *  agree for any document the editor wrote. When they do NOT agree the
 *  document was edited some other way, and the recomputed times are the
 *  ones consistent with the rows the athlete is looking at: a stale
 *  startMin would put two rows at overlapping times or open a gap the
 *  durations do not contain. So the durations win, and the disagreement
 *  is reported rather than rendered.
 *
 *  A ROUND ENTRY FOR AN EVENT THE COMPETITION NO LONGER HAS is kept, as
 *  'stale': its time slot stays, because removing it would shift every
 *  later row earlier than the admin announced; its label is the event's
 *  catalogue name and round number, so the slot is still identifiable;
 *  and the page mutes it and drops the event icon, so it does not read as
 *  a round an athlete can enter. The admin editor already flags the same
 *  row amber — fixing it is the admin's call, not the renderer's. */
export function scheduleRows(
  entries: OnlineCompetitionScheduleEntry[],
  events: OnlineCompetitionEventConfig[],
  startAtMs: number | null,
): ScheduleView {
  const anchor = minutesOfDay(startAtMs);
  const timings = scheduleTimings(anchor, entries.map((e) => e.durationMin));
  const byId = new Map(events.map((e) => [e.eventId, e]));

  let storedStartsDisagree = false;
  const rows: ScheduleRow[] = entries.map((entry, i) => {
    if (anchor !== null && entry.startMin !== timings[i].startMin) storedStartsDisagree = true;
    const start = anchor === null ? null : fmtClock(timings[i].startMin);
    const end = anchor === null ? null : fmtClock(timings[i].endMin);
    const note = typeof entry.note === 'string' && entry.note.trim() ? entry.note.trim() : null;

    if (entry.kind === 'other') {
      return { key: entry.id, start, end, kind: 'other', eventId: null, label: entry.label ?? '', note };
    }

    const eventId = entry.eventId ?? '';
    const round = entry.round ?? 1;
    const event = byId.get(eventId);
    if (event && round <= event.rounds) {
      return {
        key: entry.id,
        start,
        end,
        kind: 'round',
        eventId,
        label: `${event.label} · ${roundLabel(round, event.rounds)}`,
        note,
      };
    }
    // Stale. No "Финал" — without the event's round count there is no way
    // to know which round was the last, so the number is all that is
    // honest.
    return {
      key: entry.id,
      start,
      end,
      kind: 'stale',
      eventId,
      label: `${onlineCompEventLabel(eventId)} · Раунд ${round}`,
      note,
    };
  });

  return { rows, storedStartsDisagree };
}
