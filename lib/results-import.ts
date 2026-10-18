// Pure parser for results copied from WCA results pages, one or more
// "<Event> <Round>" blocks. Used by the staged import (StagedImportPanel);
// the older single-round "Import External Results" has its own, differently
// laid-out parser in ResultsEntryTab and is untouched by this file.
// Imported relatively (not via '@/') so scripts/test-results-import.ts can
// compile it standalone.

import { getEvent } from './wca-events';
import { calcAo5, calcMo3, bestOf } from './results-entry-helpers';
import {
  parseRoundHeader, startsWithEventName, inferTotalRounds, resolveRound,
  type RoundRef,
} from './scramble-import';

export interface ParsedResultRow {
  name: string;
  /** Name in local script, from a trailing "(…)" on the pasted name; '' if none. */
  localName: string;
  /** "Representing" column; '' when the page left it empty. */
  country: string;
  /** Centiseconds, in attempt order; -1 = DNF, -2 = DNS. As many as were given. */
  solves: number[];
  /** Recomputed from `solves`, not taken from the pasted Best/Average. */
  single: number;
  average: number | null;
}

export interface ParsedResultRound {
  eventId: string;
  /** Round number as the project stores it, as a string key. */
  roundId: string;
  roundName: string;
  rows: ParsedResultRow[];
}

interface Block {
  eventId: string;
  round: RoundRef;
  roundName: string;
  rows: ParsedResultRow[];
}

const COLUMN_HEADER_RE = /^#\s+Name\b/i;
// Regional/national record markers that sit in their own column after Best/Average.
const RECORD_MARKER_RE = /^(WR|CR|NR|PR|AfR|AsR|ER|NAR|OcR|SAR)$/;

/**
 * One pasted time → centiseconds, in the project's encoding (-1 DNF, -2 DNS).
 * Digits are read as written and anything past the hundredths is TRUNCATED,
 * never rounded. null when it isn't a time at all.
 */
export function parseResultTime(raw: string): number | null {
  const s = raw.trim().replace(/^\(/, '').replace(/\)$/, '').trim();
  const u = s.toUpperCase();
  if (u === 'DNF') return -1;
  if (u === 'DNS') return -2;
  const m = /^(?:(\d+):)?(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  const cs = parseInt(m[3].slice(0, 2).padEnd(2, '0'), 10);
  return (m[1] ? parseInt(m[1], 10) * 6000 : 0) + parseInt(m[2], 10) * 100 + cs;
}

/** Average as the site stores it for an imported row: Ao5 for 5 solves, mean
 *  of 3 for 3 solves, none otherwise. */
export function importedAverage(solves: number[]): number | null {
  if (solves.length === 5) return calcAo5(solves);
  if (solves.length === 3) return calcMo3(solves);
  return null;
}

function splitName(raw: string): { name: string; localName: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(raw);
  if (!m || !m[1].trim()) return { name: raw.trim(), localName: '' };
  return { name: m[1].trim(), localName: m[2].trim() };
}

/**
 * Parse results copied from WCA results pages. Never throws: anything
 * unrecognised becomes a warning and that block/row is skipped.
 *
 * `eventConfig` is the competition's event config (only the events it runs)
 * and decides which round number "Final"/"Semi Final" mean — same rule as
 * parseWcaScrambles.
 */
export function parseWcaResults(
  text: string,
  eventConfig?: Record<string, { rounds: number }>,
): { rounds: ParsedResultRound[]; warnings: string[] } {
  const warnings: string[] = [];
  const blocks: Block[] = [];
  // Not trimmed at the start: a leading tab is an empty "#" cell.
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  let block: Block | null = null;
  let label = '';
  let warnedOrphan = false;

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (COLUMN_HEADER_RE.test(line)) return;

    const header = parseRoundHeader(line);
    if (header || startsWithEventName(line) || COLUMN_HEADER_RE.test((lines[i + 1] || '').trim())) {
      block = null;
      warnedOrphan = true; // rows of a skipped block are covered by its own warning
      if (!header) {
        warnings.push(`"${line}": раунд танигдсангүй — алгаслаа.`);
        return;
      }
      if (!header.eventId) {
        warnings.push(`"${line}": төрөл танигдсангүй — алгаслаа.`);
        return;
      }
      block = { eventId: header.eventId, round: header.round, roundName: header.roundName, rows: [] };
      label = `${getEvent(header.eventId)?.name ?? header.eventId} ${header.roundName}`;
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

    // Columns: one or more tabs (the empty record/Representing columns just
    // collapse); pasted-through-a-spreadsheet text falls back to 2+ spaces.
    const cells = (rawLine.includes('\t') ? rawLine.split(/\t+/) : rawLine.trim().split(/\s{2,}/))
      .map(c => c.trim()).filter(Boolean);
    if (/^\d+$/.test(cells[0] || '')) cells.shift(); // position; ties may leave it blank
    if (cells.length < 2) {
      warnings.push(`${label}: "${line}" мөр танигдсангүй — алгаслаа.`);
      return;
    }
    const { name, localName } = splitName(cells[0]);
    const solveTokens = cells[cells.length - 1].split(/\s+/);
    const solves = solveTokens.map(parseResultTime);
    if (!name || solves.some(v => v === null)) {
      warnings.push(`${label}: "${line}" мөр танигдсангүй — алгаслаа.`);
      return;
    }

    // Between name and solves: Best, Average, record markers, Representing.
    const pasted: number[] = [];
    let country = '';
    for (const cell of cells.slice(1, -1)) {
      const time = parseResultTime(cell);
      if (time !== null) pasted.push(time);
      else if (!RECORD_MARKER_RE.test(cell)) country = cell;
    }

    const clean = solves as number[];
    const single = bestOf(clean);
    const average = importedAverage(clean);
    // DNS and DNF are the same "no result" for a pasted Best/Average.
    const same = (a: number | null, b: number) => (a !== null && a < 0 && b < 0) || a === b;
    if (pasted.length >= 1 && !same(single, pasted[0])) {
      warnings.push(`${label}, ${name}: хамгийн сайн нь таарахгүй байна (буулгасан болон тооцоолсон утга зөрүүтэй) — гүйцэтгэлүүдээс тооцоолсныг авлаа.`);
    }
    if (pasted.length >= 2 && average !== null && !same(average, pasted[1])) {
      warnings.push(`${label}, ${name}: дундаж нь таарахгүй байна (буулгасан болон тооцоолсон утга зөрүүтэй) — гүйцэтгэлүүдээс тооцоолсныг авлаа.`);
    }
    if (clean.length !== 5 && clean.length !== 3) {
      warnings.push(`${label}, ${name}: ${clean.length} гүйцэтгэл байна (3 эсвэл 5 байх ёстой) — дундаж тооцоологдохгүй.`);
    }

    block.rows.push({ name, localName, country, solves: clean, single, average });
  });

  const rounds: ParsedResultRound[] = [];
  for (const b of blocks) {
    const blockLabel = `${getEvent(b.eventId)?.name ?? b.eventId} ${b.roundName}`;
    let totalRounds: number;
    if (eventConfig) {
      const cfg = eventConfig[b.eventId];
      if (!cfg) {
        warnings.push(`${blockLabel}: энэ төрөл тэмцээнд идэвхжээгүй байна — алгаслаа.`);
        continue;
      }
      totalRounds = cfg.rounds;
    } else {
      totalRounds = inferTotalRounds(blocks.filter(x => x.eventId === b.eventId).map(x => x.round));
    }
    const round = resolveRound(b.round, totalRounds);
    if (round === null) {
      warnings.push(`${blockLabel}: тэмцээний тохиргоонд ийм раунд алга (нийт ${totalRounds} раунд) — алгаслаа.`);
      continue;
    }
    if (b.rows.length === 0) {
      warnings.push(`${blockLabel}: үр дүн олдсонгүй — алгаслаа.`);
      continue;
    }
    const parsed: ParsedResultRound = { eventId: b.eventId, roundId: String(round), roundName: b.roundName, rows: b.rows };
    const dupeIdx = rounds.findIndex(r => r.eventId === parsed.eventId && r.roundId === parsed.roundId);
    if (dupeIdx >= 0) {
      warnings.push(`${blockLabel}: давхар орсон байна — сүүлийнхийг нь авлаа.`);
      rounds[dupeIdx] = parsed;
    } else {
      rounds.push(parsed);
    }
  }

  return { rounds, warnings };
}
