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
  /** Who held it — absent when unknown (a WCA threshold, an old summary). */
  holderName?: string;
  /** When it was set, epoch ms — absent when unknown. */
  at?: number;
}

export interface RecordBreak {
  type: 'single' | 'average';
  level: RecordLevel;
  /** The new record, centiseconds. */
  value: number;
  /** What it replaced; absent when this is the first result of its kind. */
  previous?: PreviousRecord;
}

export interface Celebration {
  /** The highest level among \`breaks\` — picks the title. */
  level: RecordLevel;
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
  /** The competition's results as the panel has them (with or without \`saved\`). */
  competitionResults: BestResult[];
  /** settings/clubBests — bests from before this competition; null = not available. */
  bests: ClubBests | null;
  clubAthleteIds: Set<string>;
  /** athleteId → full name. */
  athleteNames: Record<string, string>;
  eventName: string;
  wca?: { single?: WcaLevel | null; average?: WcaLevel | null };
}

/**
 * The records \`saved\` breaks, or null when it breaks none.
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
    // Best other club result of this event in this competition so far (the
    // earliest of them when tied — that one set the record).
    const earlier = all
      .filter(r => r.id !== saved.id && r.eventId === saved.eventId && (r.round || 1) <= (saved.round || 1)
        && isClubResult(r, clubAthleteIds) && countable(r[type], r.eventId))
      .sort((a, b) => (a[type] as number) - (b[type] as number) || toMillis(a.submittedAt) - toMillis(b.submittedAt))[0];
    const before = bests?.club[saved.eventId]?.[k];
    const holder = bests?.holders?.[saved.eventId]?.[k];

    let previous: PreviousRecord | undefined;
    if (earlier && (before === undefined || (earlier[type] as number) < before)) {
      const at = toMillis(earlier.submittedAt);
      const name = athleteNames[earlier.athleteId] || earlier.athleteName;
      previous = { value: earlier[type] as number, ...(name ? { holderName: name } : {}), ...(at > 0 ? { at } : {}) };
    } else if (before !== undefined) {
      previous = { value: before, ...(holder?.name ? { holderName: holder.name } : {}), ...(holder?.at ? { at: holder.at } : {}) };
    }
    breaks.push({ type, value, level: 'TR', ...(previous ? { previous } : {}) });
  }

  if (breaks.length === 0) return null;
  return {
    level: LEVELS[Math.max(...breaks.map(b => LEVELS.indexOf(b.level)))],
    athleteName: athleteNames[saved.athleteId] || saved.athleteName || saved.athleteId,
    eventName: input.eventName,
    breaks,
  };
}

// ── wording ──────────────────────────────────────────────────────────────────

/** The card's strings, from i18n ('celebrate.*'). */
export interface CelebrationStrings {
  title: Record<RecordLevel, string>;
  single: string;
  average: string;
  /** "Өмнөх рекорд:" */
  previous: string;
  /** "өнөөдөр" */
  today: string;
  /** "{n} хоногийн дараа шинэчлэгдлээ" */
  afterDays: string;
  /** "Шинэчлэгдлээ" — same day, or date unknown. */
  renewed: string;
  /** "Өмнөх рекордтой тэнцлээ" */
  tied: string;
  /** "Энэ төрлийн анхны рекорд" — nothing to compare with. */
  first: string;
}

export interface CelebrationText {
  title: string;
  items: {
    level: RecordLevel;
    /** "Tergel Batzorig — 2x2x2 дундаж 2.63" */
    headline: string;
    /** "Өмнөх рекорд: 2.80 — Bold Dorj, 2026-09-01"; absent when there was none. */
    previous?: string;
    /** "12 хоногийн дараа шинэчлэгдлээ (−0.17)" */
    gap: string;
  }[];
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The card's text. Whatever isn't known is left out rather than guessed: no
 * holder → just the previous value; no date → no "N days later"; no previous
 * record at all → "first record" in place of both lines.
 * `now` = epoch ms (passed in so this stays pure).
 */
export function buildCelebrationText(c: Celebration, strings: CelebrationStrings, now: number): CelebrationText {
  return {
    title: strings.title[c.level],
    items: c.breaks.map(b => {
      const headline = `${c.athleteName} — ${c.eventName} ${b.type === 'single' ? strings.single : strings.average} ${fmtTime(b.value)}`;
      const prev = b.previous;
      if (!prev) return { level: b.level, headline, gap: strings.first };

      const days = prev.at ? Math.round((startOfDay(now) - startOfDay(prev.at)) / 86400000) : null;
      const when = days === null ? '' : days <= 0 ? strings.today : isoDay(prev.at!);
      const who = [prev.holderName, when].filter(Boolean).join(', ');
      const previous = `${strings.previous} ${fmtTime(prev.value)}${who ? ` — ${who}` : ''}`;

      const diff = prev.value - b.value;
      const gap = diff <= 0
        ? strings.tied
        : `${days !== null && days >= 1 ? strings.afterDays.replace('{n}', String(days)) : strings.renewed} (−${fmtTime(diff)})`;
      return { level: b.level, headline, previous, gap };
    }),
  };
}
