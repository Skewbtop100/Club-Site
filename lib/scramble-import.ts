// Pure parser + helpers for WCA scrambles pasted into a competition
// (CompetitionsTab) and shown during results entry (ResultsEntryTab).
// Dependency-free apart from the event list, and imported relatively (not
// via '@/') so scripts/test-scramble-import.ts can compile it standalone.

import { WCA_EVENTS, getEvent } from './wca-events';
import type { ScrambleGroup, ScrambleSets, ScrambleSource } from './types';

export interface ParsedRound {
  eventId: string;
  /** Round number as the project stores it (1-based, the Final being the
   *  event's last round), as a string map key. */
  roundId: string;
  /** Round name as written in the pasted header, e.g. "Final". */
  roundName: string;
  /** Group letter ("A", "B", …) → scrambles. */
  groups: Record<string, ScrambleGroup>;
}

/** A round as named in the paste: an explicit number, or a name whose number
 *  depends on how many rounds the event has. */
export type RoundRef = number | 'semi' | 'final';

interface Block {
  eventId: string;
  round: RoundRef;
  roundName: string;
  groups: Record<string, ScrambleGroup>;
}

const ROUND_SUFFIX_RE = /^(.*?)\s+(first\s+round|second\s+round|third\s+round|semi[\s-]*final|final|round\s*(\d+))$/i;
const GROUP_HEADER_RE = /^group\s+#\s+scramble$/i;
// A group letter must be a single A–Z followed by whitespace and a number, so
// scrambles that start with a face letter (Pyraminx "L R' …", Clock "UR1+ …")
// or a wide move ("3Rw2 …") are never mistaken for a group/number column.
const GROUP_LINE_RE = /^([A-Z])\s+(\d+)\s+(\S.*)$/;
const EXTRA_LINE_RE = /^Extra\s+(\d+)\s+(\S.*)$/i;
const NUM_LINE_RE   = /^(\d+)\s+(\S.*)$/;

/** Events run with 3 attempts (Mo3/Bo3); everything else is 5 (Ao5) —
 *  including 3x3 Blindfolded, which moved from Bo3 to Ao5. The project stores
 *  no per-round format, so this is only used for the count warning. */
const THREE_ATTEMPT_EVENTS = new Set(['666', '777', '333fm', '444bf', '555bf', '333mbf']);

function expectedScrambleCount(eventId: string): number {
  return THREE_ATTEMPT_EVENTS.has(eventId) ? 3 : 5;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const EVENT_BY_NAME: Record<string, string> = {};
for (const ev of WCA_EVENTS) {
  EVENT_BY_NAME[normalizeName(ev.name)] = ev.id;
  EVENT_BY_NAME[normalizeName(ev.name.replace(/ Cube$/, ''))] = ev.id;
  EVENT_BY_NAME[normalizeName(ev.short)] = ev.id;
  EVENT_BY_NAME[ev.id] = ev.id;
}

export function startsWithEventName(line: string): boolean {
  const lower = line.toLowerCase();
  return WCA_EVENTS.some(ev => {
    const name = ev.name.toLowerCase();
    return lower === name || (lower.startsWith(name) && /\s/.test(lower[name.length]));
  });
}

function parseRoundRef(text: string, roundNumber: string | undefined): RoundRef {
  const s = text.toLowerCase();
  if (roundNumber) return Number(roundNumber);
  if (s.startsWith('first')) return 1;
  if (s.startsWith('second')) return 2;
  if (s.startsWith('third')) return 3;
  return s.startsWith('semi') ? 'semi' : 'final';
}

/** A "<Event name> <Round name>" header line (shared with
 *  lib/results-import.ts). null when the line doesn't end in a round name;
 *  `eventId` is null when it does but the event isn't recognised. */
export function parseRoundHeader(line: string): { eventId: string | null; round: RoundRef; roundName: string } | null {
  const header = ROUND_SUFFIX_RE.exec(line);
  if (!header) return null;
  return {
    eventId: EVENT_BY_NAME[normalizeName(header[1])] ?? null,
    round: parseRoundRef(header[2], header[3]),
    roundName: header[2],
  };
}

/** Total rounds implied by the round names pasted for one event — only used
 *  when the caller has no eventConfig to say how many rounds there really are. */
export function inferTotalRounds(refs: RoundRef[]): number {
  const base = Math.max(0, ...refs.filter((r): r is number => typeof r === 'number'));
  if (refs.includes('semi')) return base + 2;
  return refs.includes('final') ? base + 1 : base;
}

export function resolveRound(ref: RoundRef, totalRounds: number): number | null {
  const n = ref === 'final' ? totalRounds : ref === 'semi' ? totalRounds - 1 : ref;
  return n >= 1 && n <= totalRounds ? n : null;
}

/**
 * Parse text copied from WCA/TNoodle scramble pages into per-round scramble
 * sets. Never throws: anything unrecognised becomes a warning and that block
 * is skipped.
 *
 * `eventConfig` is the competition's event config (only the events it
 * actually runs). It decides which round number "Final"/"Semi Final" mean;
 * without it, round numbers are inferred from the rounds present in the text.
 */
export function parseWcaScrambles(
  text: string,
  eventConfig?: Record<string, { rounds: number }>,
): { sets: ParsedRound[]; warnings: string[] } {
  const warnings: string[] = [];
  const blocks: Block[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let block: Block | null = null;         // null before the first header and inside a skipped block
  let group: ScrambleGroup | null = null;
  let lastList: string[] | null = null;   // list holding the scramble a continuation line belongs to
  let warnedOrphan = false;

  lines.forEach((line, i) => {
    if (GROUP_HEADER_RE.test(line)) return;

    const header = ROUND_SUFFIX_RE.exec(line);
    if (header || startsWithEventName(line) || GROUP_HEADER_RE.test(lines[i + 1] || '')) {
      block = null; group = null; lastList = null;
      warnedOrphan = true; // lines of a skipped block are covered by its own warning
      if (!header) {
        warnings.push(`"${line}": үе танигдсангүй — алгаслаа.`);
        return;
      }
      const eventId = EVENT_BY_NAME[normalizeName(header[1])];
      if (!eventId) {
        warnings.push(`"${line}": төрөл танигдсангүй — алгаслаа.`);
        return;
      }
      block = { eventId, round: parseRoundRef(header[2], header[3]), roundName: header[2], groups: {} };
      blocks.push(block);
      return;
    }

    if (!block) {
      if (!warnedOrphan) {
        warnings.push(`"${line}": гарчиггүй мөр — алгаслаа.`);
        warnedOrphan = true;
      }
      return;
    }
    const cur: Block = block;
    const openGroup = (letter: string) => (cur.groups[letter] ??= { main: [], extra: [] });

    const groupLine = GROUP_LINE_RE.exec(line);
    if (groupLine) {
      group = openGroup(groupLine[1]);
      group.main.push(groupLine[3]);
      lastList = group.main;
      return;
    }
    const extraLine = EXTRA_LINE_RE.exec(line);
    if (extraLine) {
      group ??= openGroup('A');
      group.extra.push(extraLine[2]);
      lastList = group.extra;
      return;
    }
    const numLine = NUM_LINE_RE.exec(line);
    if (numLine) {
      group ??= openGroup('A');
      group.main.push(numLine[2]);
      lastList = group.main;
      return;
    }
    // Anything else continues the previous scramble (Megaminx spans lines).
    if (lastList && lastList.length > 0) lastList[lastList.length - 1] += '\n' + line;
  });

  const sets: ParsedRound[] = [];
  for (const b of blocks) {
    const label = `${getEvent(b.eventId)?.name ?? b.eventId} ${b.roundName}`;

    let totalRounds: number;
    if (eventConfig) {
      const cfg = eventConfig[b.eventId];
      if (!cfg) {
        warnings.push(`${label}: энэ төрөл тэмцээнд идэвхжээгүй байна — алгаслаа.`);
        continue;
      }
      totalRounds = cfg.rounds;
    } else {
      totalRounds = inferTotalRounds(blocks.filter(x => x.eventId === b.eventId).map(x => x.round));
    }
    const round = resolveRound(b.round, totalRounds);
    if (round === null) {
      warnings.push(`${label}: тэмцээний тохиргоонд ийм үе алга (нийт ${totalRounds} үе) — алгаслаа.`);
      continue;
    }

    const letters = Object.keys(b.groups);
    if (letters.length === 0) {
      warnings.push(`${label}: холилт олдсонгүй — алгаслаа.`);
      continue;
    }
    const expected = expectedScrambleCount(b.eventId);
    for (const letter of letters) {
      const count = b.groups[letter].main.length;
      if (count !== expected) {
        warnings.push(`${label}, ${letter} бүлэг: ${count} холилт байна (${expected} байх ёстой).`);
      }
    }

    const parsed: ParsedRound = { eventId: b.eventId, roundId: String(round), roundName: b.roundName, groups: b.groups };
    const dupeIdx = sets.findIndex(s => s.eventId === parsed.eventId && s.roundId === parsed.roundId);
    if (dupeIdx >= 0) {
      warnings.push(`${label}: давхар орсон байна — сүүлийнхийг нь авлаа.`);
      sets[dupeIdx] = parsed;
    } else {
      sets.push(parsed);
    }
  }

  return { sets, warnings };
}

/** Merge an import into the stored sets: each parsed event+round block
 *  replaces that block wholesale; every other event/round is left untouched. */
export function mergeScrambleSets(existing: ScrambleSets | undefined, parsed: ParsedRound[]): ScrambleSets {
  const merged: ScrambleSets = { ...(existing || {}) };
  for (const p of parsed) {
    merged[p.eventId] = { ...(merged[p.eventId] || {}), [p.roundId]: p.groups };
  }
  return merged;
}

/** Group number as the entry panel stores it (1, 2, …) → scramble-set key ("A", "B", …). */
export function groupLetter(group: number): string {
  return String.fromCharCode(64 + group);
}

/**
 * Group numbers to offer for a round: the union of the event's configured
 * groups (1..configuredCount) and the groups its imported scrambles actually
 * have, ascending (A, B, C, …). So a round configured with 1 group but
 * imported with A–I offers all nine; with no import it's just the config.
 */
export function groupOptions(configuredCount: number, imported?: Record<string, ScrambleGroup>): number[] {
  const groups = new Set<number>();
  for (let n = 1; n <= Math.max(1, configuredCount); n++) groups.add(n);
  for (const letter of Object.keys(imported || {})) {
    if (/^[A-Z]$/.test(letter)) groups.add(letter.charCodeAt(0) - 64);
  }
  return [...groups].sort((a, b) => a - b);
}

/** The scramble for a solve slot, honouring an extra if one was swapped in.
 *  Empty string when the group has nothing for that slot. */
export function scrambleFor(group: ScrambleGroup, solveIdx: number, source: ScrambleSource = 'main'): string {
  if (source !== 'main') {
    const extra = group.extra[Number(source.slice('extra'.length)) - 1];
    if (extra) return extra;
  }
  return group.main[solveIdx] || '';
}

/** Next extra not yet used by any solve of this attempt (Extra 1, then
 *  Extra 2, …), or null when none are left. */
export function nextExtraSource(group: ScrambleGroup, used: ScrambleSource[]): ScrambleSource | null {
  for (let n = 1; n <= group.extra.length; n++) {
    const source: ScrambleSource = `extra${n}`;
    if (!used.includes(source)) return source;
  }
  return null;
}
