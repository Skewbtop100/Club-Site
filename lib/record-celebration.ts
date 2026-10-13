// "New club record!" — what the Results Entry panel shows right after a
// result that breaks a club record (TR) or better is saved. Pure: finding
// the broken records and wording the card, so both can be unit-tested
// (scripts/test-record-celebration.ts). Imported relatively (not via '@/')
// so that script can compile it standalone.

import { fmtTime } from './time-utils';
import {
  computeLocalBadges, countable, isClubResult, toMillis,
  type BestResult, type ClubBests,
} from './club-bests';

/** Lowest to highest. PR alone is not celebrated. */
export type RecordLevel = 'TR' | 'NR' | 'CR' | 'WR';
const LEVELS: RecordLevel[] = ['TR', 'NR', 'CR', 'WR'];

export interface PreviousRecord {
  /** Centiseconds. */
  value: number;
  /** Who held it — both absent when unknown (a WCA threshold, an old summary). */
  holderId?: string;
  holderName?: string;
  /** When it was set, epoch ms — absent when unknown. */
  at?: number;
  /** Where it was set — absent when unknown. */
  competitionName?: string;
}

export interface RecordBreak {
  type: 'single' | 'average';
  level: RecordLevel;
  /** The new record, centiseconds. */
  value: number;
  /** What it replaced; absent when this is the first result of its kind. */
  previous?: PreviousRecord;
  /** When (epoch ms) this record was already lowered earlier in THIS
   *  competition, oldest first — for "2nd time today". Unknown times are 0. */
  earlierBreaks?: number[];
}

export interface Celebration {
  /** The highest level among `breaks` — picks the title. */
  level: RecordLevel;
  athleteId: string;
  athleteName: string;
  eventName: string;
  /** Single and/or average, single first. */
  breaks: RecordBreak[];
}

/** A national-or-higher record a value reaches, from the stored WCA record
 *  thresholds; the threshold itself is the previous record's value (its
 *  holder isn't stored). */
export interface WcaLevel { level: 'NR' | 'CR' | 'WR'; previousValue?: number }

export interface CelebrationInput {
  /** The result just saved. */
  saved: BestResult;
  /** The competition's results as the panel has them (with or without `saved`). */
  competitionResults: BestResult[];
  /** settings/clubBests — bests from before this competition; null = not available. */
  bests: ClubBests | null;
  clubAthleteIds: Set<string>;
  /** athleteId → full name. */
  athleteNames: Record<string, string>;
  eventName: string;
  /** This competition's name — shown when the previous record was set in it. */
  competitionName?: string;
  wca?: { single?: WcaLevel | null; average?: WcaLevel | null };
}

/**
 * The records `saved` breaks, or null when it breaks none.
 *
 * A value is a club record when the same chronological logic that puts the
 * TR badge on it says so (computeLocalBadges: beats or ties the club best
 * from before this competition and from its earlier rounds, and is the best
 * of its round). The record it replaces is the better of
 *   - the club record from before the competition (holder from the summary), and
 *   - the best other club result of this event already entered in this
 *     competition — so a record set earlier today is "the previous record",
 *     with today's holder.
 */
export function findCelebration(input: CelebrationInput): Celebration | null {
  const { saved, bests, clubAthleteIds, athleteNames } = input;
  const all = [...input.competitionResults.filter(r => r.id !== saved.id), saved];
  const badges = computeLocalBadges(all, bests, clubAthleteIds)[saved.id];
  const breaks: RecordBreak[] = [];

  for (const type of ['single', 'average'] as const) {
    const value = saved[type];
    const wca = input.wca?.[type] ?? null;
    if (!countable(value, saved.eventId) || (!badges?.[type].tr && !wca)) continue;

    if (wca) {
      breaks.push({
        type, value, level: wca.level,
        ...(wca.previousValue !== undefined ? { previous: { value: wca.previousValue } } : {}),
      });
      continue;
    }

    const k = type === 'single' ? 's' : 'a';
    const before = bests?.club[saved.eventId]?.[k];
    const holder = bests?.holders?.[saved.eventId]?.[k];
    // Other club results of this event already entered in this competition.
    const others = all.filter(r => r.id !== saved.id && r.eventId === saved.eventId && (r.round || 1) <= (saved.round || 1)
      && isClubResult(r, clubAthleteIds) && countable(r[type], r.eventId));

    // Best of them (the earliest when tied — that one set the record).
    const earlier = [...others]
      .sort((a, b) => (a[type] as number) - (b[type] as number) || toMillis(a.submittedAt) - toMillis(b.submittedAt))[0];
    // Each time the record was already lowered in this competition, in order.
    const earlierBreaks: number[] = [];
    let running = before;
    for (const r of [...others].sort((a, b) => toMillis(a.submittedAt) - toMillis(b.submittedAt))) {
      const v = r[type] as number;
      if (running === undefined || v < running) { earlierBreaks.push(toMillis(r.submittedAt)); running = v; }
    }

    // Dates: a record from BEFORE this competition carries its
    // competition's official date (from the summary). A record set earlier
    // in THIS competition is dated by when it was entered — it is "today's"
    // record, whatever official date the competition itself has.
    let previous: PreviousRecord | undefined;
    if (earlier && (before === undefined || (earlier[type] as number) < before)) {
      const at = toMillis(earlier.submittedAt);
      const name = athleteNames[earlier.athleteId] || earlier.athleteName;
      const comp = input.competitionName || earlier.competitionName;
      previous = {
        value: earlier[type] as number, holderId: earlier.athleteId,
        ...(name ? { holderName: name } : {}), ...(at > 0 ? { at } : {}), ...(comp ? { competitionName: comp } : {}),
      };
    } else if (before !== undefined) {
      previous = {
        value: before,
        ...(holder?.athleteId ? { holderId: holder.athleteId } : {}),
        ...(holder?.name ? { holderName: holder.name } : {}),
        ...(holder?.at ? { at: holder.at } : {}),
        ...(holder?.competitionName ? { competitionName: holder.competitionName } : {}),
      };
    }
    breaks.push({
      type, value, level: 'TR',
      ...(previous ? { previous } : {}),
      ...(earlierBreaks.length > 0 ? { earlierBreaks } : {}),
    });
  }

  if (breaks.length === 0) return null;
  return {
    level: LEVELS[Math.max(...breaks.map(b => LEVELS.indexOf(b.level)))],
    athleteId: saved.athleteId,
    athleteName: athleteNames[saved.athleteId] || saved.athleteName || saved.athleteId,
    eventName: input.eventName,
    breaks,
  };
}

// ── wording ──────────────────────────────────────────────────────────────────

/** The card's strings, from i18n ('celebrate.*'). */
export interface CelebrationStrings {
  /** Card title: "Шинэ клубын рекорд!" … */
  title: Record<RecordLevel, string>;
  /** Chip: "Клубын рекорд" … */
  levelName: Record<RecordLevel, string>;
  single: string;
  average: string;
  /** Panel labels: "Өмнөх" / "Шинэ". */
  previousLabel: string;
  newLabel: string;
  /** "өнөөдөр" */
  today: string;
  /** "сек" */
  seconds: string;
  /** "хоног" */
  daysUnit: string;
  /** "хадгалагдсан рекорд шинэчлэгдлээ" — under the day count. */
  daysCaption: string;
  /** "Өнөөдөр {n} дахь удаагаа шинэчлэгдлээ" */
  sameDay: string;
  /** "Өөрийн рекордыг ахиуллаа" */
  ownRecord: string;
  /** "Рекордтой тэнцлээ" */
  tied: string;
  /** "Энэ төрлийн анхны рекорд" */
  first: string;
}

export interface CelebrationItem {
  level: RecordLevel;
  type: 'single' | 'average';
  /** "Клубын рекорд · дундаж" (the card upper-cases it). */
  chip: string;
  /** The new record — always complete. */
  next: { label: string; value: string; name: string; when: string };
  /** The record it replaced. Only the parts that are known are present —
   *  a WCA threshold has a value and nothing else. Absent for a first record. */
  previous?: { label: string; value: string; name?: string; date?: string; competition?: string };
  /** "−0.17 сек" — a real improvement. */
  improvement?: string;
  /** "Рекордтой тэнцлээ" — in place of `improvement`. */
  tied?: string;
  /** The highlight: how long the old record stood (`days` + `unit`, with a
   *  caption), or a line of text alone when there is no day count to show. */
  stat?: { days?: number; unit?: string; caption: string };
  /** "Энэ төрлийн анхны рекорд" — in place of the whole comparison. */
  first?: string;
}

export interface CelebrationText {
  title: string;
  eventName: string;
  items: CelebrationItem[];
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const daysBetween = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
/** 2026.09.28 */
const dotDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The card's content, one item per broken record. Whatever isn't known is
 * left out rather than shown empty: no holder → no name; no date → no date
 * and no day count; no previous record at all → `first` and nothing else.
 *
 * The highlight (`stat`), in order of precedence:
 *   tie                      → none (nothing was renewed)
 *   own record, days known   → N хоног + "Өөрийн рекордыг ахиуллаа"
 *   own record, same day     → "Өөрийн рекордыг ахиуллаа"
 *   same day, someone else's → "Өнөөдөр N дахь удаагаа шинэчлэгдлээ"
 *   an earlier day           → N хоног + "хадгалагдсан рекорд шинэчлэгдлээ"
 *   date unknown             → none
 *
 * `now` = epoch ms (passed in so this stays pure).
 */
export function buildCelebrationText(c: Celebration, strings: CelebrationStrings, now: number): CelebrationText {
  return {
    title: strings.title[c.level],
    eventName: c.eventName,
    items: c.breaks.map((b): CelebrationItem => {
      const base = {
        level: b.level, type: b.type,
        chip: `${strings.levelName[b.level]} · ${b.type === 'single' ? strings.single : strings.average}`,
        next: { label: strings.newLabel, value: fmtTime(b.value), name: c.athleteName, when: strings.today },
      };
      const prev = b.previous;
      if (!prev) return { ...base, first: strings.first };

      const days = prev.at ? Math.max(0, daysBetween(prev.at, now)) : null;
      const previous = {
        label: strings.previousLabel,
        value: fmtTime(prev.value),
        ...(prev.holderName ? { name: prev.holderName } : {}),
        ...(days !== null ? { date: days === 0 ? strings.today : dotDay(prev.at!) } : {}),
        ...(prev.competitionName ? { competition: prev.competitionName } : {}),
      };

      const diff = prev.value - b.value;
      if (diff <= 0) return { ...base, previous, tied: strings.tied };

      const own = !!prev.holderId && prev.holderId === c.athleteId;
      // Times the record was lowered today, this one included.
      const timesToday = (b.earlierBreaks ?? []).filter(t => t > 0 && daysBetween(t, now) === 0).length + 1;
      const stat =
        own ? { ...(days !== null && days >= 1 ? { days, unit: strings.daysUnit } : {}), caption: strings.ownRecord }
        : days === null ? undefined
        : days === 0 ? { caption: strings.sameDay.replace('{n}', String(Math.max(2, timesToday))) }
        : { days, unit: strings.daysUnit, caption: strings.daysCaption };

      return {
        ...base, previous,
        // Under a minute it is plainly seconds; a longer gap is already "m:ss.xx".
        improvement: `−${fmtTime(diff)}${diff < 6000 ? ` ${strings.seconds}` : ''}`,
        ...(stat ? { stat } : {}),
      };
    }),
  };
}
