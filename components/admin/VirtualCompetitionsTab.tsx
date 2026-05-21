'use client';

import { useEffect, useRef, useState } from 'react';
import {
  subscribeAllCompetitions,
  createVirtualCompetition,
  updateVirtualCompetition,
  deleteVirtualCompetition,
  publishVirtualCompetition,
  closeVirtualCompetition,
  getRounds,
  addRound,
  deleteRound as svcDeleteRound,
  updateRound,
  importHistoricalResults,
} from '@/lib/firebase/services/virtual-competitions';
import type { VirtualCompetition, VirtualRound, HistoricalResult } from '@/lib/firebase/services/virtual-competitions';
import { WCA_EVENTS, getEvent } from '@/lib/wca-events';
import { useAuth } from '@/lib/auth-context';

// ─── Round format labels ──────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  avg5: 'Ao5', mo3: 'Mo3', bo3: 'Bo3', bo1: 'Bo1',
};

// ─── WCA Scramble Export Parser ───────────────────────────────────────────────

// Ordered longest-first to prevent prefix collisions, e.g. "3x3x3 One-Handed"
// must be checked before "3x3x3 Cube".
const WCA_EVENT_NAMES: [string, string][] = [
  ['3x3x3 One-Handed', '333oh'],
  ['3x3 One-Handed', '333oh'],
  ['3x3x3 Blindfolded', '333bf'],
  ['4x4x4 Blindfolded', '444bf'],
  ['5x5x5 Blindfolded', '555bf'],
  ['3x3x3 Multi-Blind', '333mbf'],
  ['3x3x3 Fewest Moves', '333fm'],
  ['3x3 Fewest Moves', '333fm'],
  ['3x3x3 Cube', '333'],
  ['2x2x2 Cube', '222'],
  ['4x4x4 Cube', '444'],
  ['5x5x5 Cube', '555'],
  ['6x6x6 Cube', '666'],
  ['7x7x7 Cube', '777'],
  ['Pyraminx', 'pyram'],
  ['Megaminx', 'minx'],
  ['Skewb', 'skewb'],
  ['Square-1', 'sq1'],
  ['Clock', 'clock'],
  ['FMC', '333fm'],
];

// Round label (lowercased) → sort priority. Lower = earlier round.
// "Final" is always 99 so it becomes the highest round number for its event.
const ROUND_PRIORITY: Record<string, number> = {
  'first round': 1,
  'second round': 2,
  'third round': 3,
  'semi final': 4,
  'semifinal': 4,
  'semi-final': 4,
  'final': 99,
};

interface ParsedGroup {
  name: string;
  scrambles: string[];
  extraScrambles: string[];
}

interface ParsedRound {
  eventId: string;
  eventName: string;
  roundLabel: string;
  roundNumber: number;
  groups: ParsedGroup[];
  allScrambles: string[];
}

interface BulkParseResult {
  rounds: ParsedRound[];
  byEvent: Record<string, ParsedRound[]>;
  parseErrors: string[];
  warnings: string[];
}

function tryMatchEventHeader(
  line: string,
): { eventId: string; eventName: string; roundLabel: string } | null {
  const trimmed = line.trim();
  for (const [name, id] of WCA_EVENT_NAMES) {
    if (trimmed.startsWith(name)) {
      const rest = trimmed.slice(name.length).trim();
      if (rest.length > 0 && !/^\d+$/.test(rest)) {
        return { eventId: id, eventName: name, roundLabel: rest };
      }
    }
  }
  return null;
}

// Parses a scramble data line in tab-separated or space-separated WCA export format.
function tryParseScrambleLine(line: string): {
  groupLetter: string | null;
  isExtra: boolean;
  scramble: string;
} | null {
  let groupLetter: string | null = null;
  let indexRaw: string;
  let scramble: string;

  if (line.includes('\t')) {
    const cols = line.split('\t');
    if (cols.length < 3) return null;
    const col0 = cols[0].trim();
    const col1 = cols[1].trim();
    const col2 = cols.slice(2).join(' ').trim();
    if (!col2 || !col1) return null;
    groupLetter = /^[A-Z]$/.test(col0) ? col0 : null;
    indexRaw = col1;
    scramble = col2;
  } else {
    const m = line.match(/^([A-Z])?\s{1,}(Extra\s+\d+|\d+)\s{2,}(.+)$/);
    if (!m) return null;
    groupLetter = m[1] ?? null;
    indexRaw = m[2].trim();
    scramble = m[3].trim();
  }

  if (!scramble) return null;
  const isExtra = /^Extra\s+\d+$/i.test(indexRaw);
  if (!isExtra && !/^\d+$/.test(indexRaw)) return null;

  return { groupLetter, isExtra, scramble };
}

// State-machine parser for WCA scramble export text.
// WCA exports are reverse-ordered (Final first, First round last), so rounds are
// sorted by ROUND_PRIORITY after parsing and assigned sequential 1-based numbers.
function parseWcaExport(rawText: string, competitionEvents: string[]): BulkParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  interface RawRound {
    eventId: string;
    eventName: string;
    roundLabel: string;
    groups: ParsedGroup[];
  }

  const rawRounds: RawRound[] = [];
  let cur: RawRound | null = null;
  let curGroup: ParsedGroup | null = null;

  const flushGroup = () => {
    if (curGroup && cur) { cur.groups.push(curGroup); curGroup = null; }
  };
  const flushRound = () => {
    flushGroup();
    if (cur) { rawRounds.push(cur); cur = null; }
  };

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (/^Group\s+#\s+Scramble/i.test(line.trim())) continue;

    const header = tryMatchEventHeader(line);
    if (header) {
      flushRound();
      cur = { ...header, groups: [] };
      continue;
    }

    if (!cur) continue;

    const parsed = tryParseScrambleLine(line);
    if (!parsed) continue;

    if (parsed.groupLetter && parsed.groupLetter !== (curGroup as ParsedGroup | null)?.name) {
      flushGroup();
      curGroup = { name: parsed.groupLetter, scrambles: [], extraScrambles: [] };
    } else if (!curGroup) {
      curGroup = { name: 'A', scrambles: [], extraScrambles: [] };
    }

    if (parsed.isExtra) curGroup!.extraScrambles.push(parsed.scramble);
    else curGroup!.scrambles.push(parsed.scramble);
  }
  flushRound();

  if (rawRounds.length === 0) {
    errors.push(
      'Таньж болохуйц формат олдсонгүй. WCA scramble export форматаар оруулна уу. ' +
      'Жишээ: "3x3x3 Cube Final" гэсэн мөрүүд байх ёстой.',
    );
    return { rounds: [], byEvent: {}, parseErrors: errors, warnings };
  }

  const byEventRaw = new Map<string, RawRound[]>();
  for (const r of rawRounds) {
    const list = byEventRaw.get(r.eventId) ?? [];
    list.push(r);
    byEventRaw.set(r.eventId, list);
  }

  const allRounds: ParsedRound[] = [];
  const byEvent: Record<string, ParsedRound[]> = {};

  for (const [eventId, evRounds] of byEventRaw) {
    const sorted = [...evRounds].sort(
      (a, b) =>
        (ROUND_PRIORITY[a.roundLabel.toLowerCase()] ?? 50) -
        (ROUND_PRIORITY[b.roundLabel.toLowerCase()] ?? 50),
    );

    const parsedForEvent: ParsedRound[] = sorted.map((r, idx) => ({
      eventId: r.eventId,
      eventName: r.eventName,
      roundLabel: r.roundLabel,
      roundNumber: idx + 1,
      groups: r.groups,
      allScrambles: r.groups.flatMap((g) => g.scrambles),
    }));

    allRounds.push(...parsedForEvent);
    byEvent[eventId] = parsedForEvent;

    if (!competitionEvents.includes(eventId)) {
      warnings.push(eventId);
    }
  }

  return { rounds: allRounds, byEvent, parseErrors: errors, warnings };
}

// Parses WCA export text scoped to a single event.
function parseEventRounds(
  text: string,
  eventId: string,
): { rounds: ParsedRound[]; error: string | null } {
  const result = parseWcaExport(text, [eventId]);
  const rounds = result.byEvent[eventId] ?? [];
  if (rounds.length === 0) {
    if (result.parseErrors.length > 0) return { rounds: [], error: result.parseErrors[0] };
    if (result.rounds.length > 0) {
      const ev = getEvent(eventId);
      return {
        rounds: [],
        error: `${ev?.name ?? eventId}-н холилт олдсонгүй. Зөв төрлийн холилт тавина уу.`,
      };
    }
    return {
      rounds: [],
      error: 'Таньж болохуйц формат олдсонгүй. WCA scramble export форматаар оруулна уу.',
    };
  }
  return { rounds, error: null };
}

// ─── WCA Results Parser ───────────────────────────────────────────────────────

// Parses a WCA time string like "5.55", "1:23.45", "DNF", "(5.55)".
// Returns { ms, penalty } or null if unparseable.
function parseWcaTimeStr(raw: string): { ms: number; penalty: 'none' | 'dnf' } | null {
  const s = raw.replace(/[()]/g, '').trim();
  if (!s) return null;
  if (/^(DNF|DNS)$/i.test(s)) return { ms: -1, penalty: 'dnf' };
  const m = s.match(/^(?:(\d+):)?(\d{1,2})\.(\d{2})$/);
  if (!m) return null;
  const mins = parseInt(m[1] ?? '0', 10);
  const secs = parseInt(m[2], 10);
  const cs   = parseInt(m[3], 10); // centiseconds
  return { ms: (mins * 60 + secs) * 1000 + cs * 10, penalty: 'none' };
}

function looksLikeTime(token: string): boolean {
  const s = token.replace(/[()]/g, '').trim();
  return /^(DNF|DNS)$/i.test(s) || /^(?:\d+:)?\d{1,2}\.\d{2}$/.test(s);
}

// Formats ms back to display string ("5.55", "1:23.45", "DNF").
function formatMs(ms: number): string {
  if (ms < 0) return 'DNF';
  const totalSecs = Math.floor(ms / 1000);
  const cs = Math.round((ms % 1000) / 10);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins > 0) return `${mins}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  return `${secs}.${String(cs).padStart(2, '0')}`;
}

interface ResultRow {
  rank: number;
  name: string;
  best: number;
  bestPenalty: 'none' | 'dnf';
  average: number;
  averagePenalty: 'none' | 'dnf';
  solves: Array<{ ms: number; penalty: 'none' | 'dnf' }>;
}

// Parses one athlete result row from a WCA results export.
// Handles both tab-separated (copied from WCA website table) and
// space-padded formats. Returns null if the line is not a results row.
function parseResultLine(line: string): ResultRow | null {
  if (line.includes('\t')) {
    const cols = line.split('\t').map((s) => s.trim());
    const rank = parseInt(cols[0], 10);
    if (!rank || isNaN(rank) || cols.length < 3) return null;
    const name = cols[1];
    if (!name) return null;
    const bestParsed = parseWcaTimeStr(cols[2]);
    if (!bestParsed) return null;
    const avgParsed = cols[3] ? parseWcaTimeStr(cols[3]) : null;
    // Remaining cols after avg: skip non-time (NR, country), collect time tokens
    const solves = cols
      .slice(4)
      .filter(looksLikeTime)
      .map((s) => parseWcaTimeStr(s) ?? { ms: -1, penalty: 'dnf' as const });
    return {
      rank, name,
      best: bestParsed.ms, bestPenalty: bestParsed.penalty,
      average: avgParsed?.ms ?? -1, averagePenalty: avgParsed?.penalty ?? 'dnf',
      solves,
    };
  } else {
    // Space-separated: rank at start, then name up to first time-like token
    const leadMatch = line.match(/^\s*(\d+)\s+/);
    if (!leadMatch) return null;
    const rank = parseInt(leadMatch[1], 10);
    if (isNaN(rank)) return null;
    const rest = line.slice(leadMatch[0].length);
    const tokens = rest.split(/\s+/).filter((s) => s.length > 0);
    let firstTimeIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (looksLikeTime(tokens[i])) { firstTimeIdx = i; break; }
    }
    if (firstTimeIdx < 1) return null; // need at least one name token before first time
    const name = tokens.slice(0, firstTimeIdx).join(' ');
    const bestParsed = parseWcaTimeStr(tokens[firstTimeIdx]);
    if (!bestParsed) return null;
    const avgParsed = tokens[firstTimeIdx + 1] ? parseWcaTimeStr(tokens[firstTimeIdx + 1]) : null;
    // After best + avg, filter to time-like tokens (skips representing, NR, etc.)
    const solves = tokens
      .slice(firstTimeIdx + 2)
      .filter(looksLikeTime)
      .map((s) => parseWcaTimeStr(s) ?? { ms: -1, penalty: 'dnf' as const });
    return {
      rank, name,
      best: bestParsed.ms, bestPenalty: bestParsed.penalty,
      average: avgParsed?.ms ?? -1, averagePenalty: avgParsed?.penalty ?? 'dnf',
      solves,
    };
  }
}

// State-machine parser for WCA competition results text, scoped to one event.
// Returns a map of roundLabel → HistoricalResult[] for rounds matching eventId.
function parseWcaResults(
  rawText: string,
  eventId: string,
): { byRoundLabel: Record<string, HistoricalResult[]>; parseErrors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byRoundLabel: Record<string, HistoricalResult[]> = {};

  let curLabel: string | null = null;
  let curResults: HistoricalResult[] = [];

  const flush = () => {
    if (curLabel !== null) { byRoundLabel[curLabel] = curResults; curResults = []; curLabel = null; }
  };

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (/^\s*#\s/.test(line)) continue; // column header row: "# Name  Best  Average..."

    const header = tryMatchEventHeader(line);
    if (header) {
      flush();
      if (header.eventId === eventId) {
        curLabel = header.roundLabel;
      } else if (!warnings.includes(header.eventId)) {
        warnings.push(header.eventId);
      }
      continue;
    }

    if (curLabel === null) continue;

    const row = parseResultLine(line);
    if (!row) continue;

    curResults.push({
      athleteName: row.name,
      times: row.solves.map((s) => s.ms),
      penalties: row.solves.map((s) => s.penalty),
      best: row.best,
      average: row.average,
      rank: row.rank,
    });
  }
  flush();

  if (Object.keys(byRoundLabel).length === 0) {
    errors.push(
      warnings.length > 0
        ? 'Энэ төрлийн үр дүн олдсонгүй. Зөв төрлийн үр дүн тавина уу.'
        : 'Таньж болохуйц формат олдсонгүй. WCA үр дүний форматаар оруулна уу.',
    );
  }

  return { byRoundLabel, parseErrors: errors, warnings };
}

// Case-insensitive round name matching. "Second round" matches "Second Round".
function matchRoundByLabel(label: string, rounds: VirtualRound[]): VirtualRound | null {
  const norm = (s: string) =>
    s.toLowerCase().trim()
      .replace(/\s+/g, ' ')
      .replace(/\b1st\b/g, 'first')
      .replace(/\b2nd\b/g, 'second')
      .replace(/\b3rd\b/g, 'third');
  const nl = norm(label);
  return rounds.find((r) => norm(r.roundName) === nl) ?? null;
}

// ─── WCA Schedule Bulk Advancement Parser ────────────────────────────────────

interface ParsedAdvancement {
  eventId: string;
  eventName: string;
  roundName: string;
  advancementType: 'fixed' | 'percentage' | 'final';
  advancementValue?: number;
}

interface BulkAdvResult {
  byEvent: Record<string, ParsedAdvancement[]>;
  parseErrors: string[];
  notInComp: string[];
}

const KNOWN_ROUND_LABELS = [
  'first round', 'second round', 'third round',
  'quarter final', 'semi final', 'semifinal', 'semi-final', 'final',
  '1st round', '2nd round', '3rd round',
  'round 1', 'round 2', 'round 3', 'round 4',
];

// Parses the "Proceed" column text.
// "Top 48 advance to next round" → fixed:48
// "Top 25%" → percentage:25
// empty → final
function parseProceedCell(text: string): {
  advancementType: 'fixed' | 'percentage' | 'final';
  advancementValue?: number;
} {
  const t = text.trim();
  if (!t) return { advancementType: 'final' };
  const fixedM = t.match(/top\s+(\d+)\s+advance/i);
  if (fixedM) return { advancementType: 'fixed', advancementValue: parseInt(fixedM[1], 10) };
  const pctM = t.match(/top\s+(\d+)\s*%/i) ?? t.match(/\b(\d+)\s*%\b.*advance/i);
  if (pctM) return { advancementType: 'percentage', advancementValue: parseInt(pctM[1], 10) };
  return { advancementType: 'final' };
}

// Parses a WCA schedule table (tab-separated or 2+-space-separated).
//
// KEY INVARIANT: the WCA schedule puts the event name only on the FIRST row of
// each event group. Continuation rows have an empty event column (tab mode:
// cols[0]=""; space mode: leading whitespace collapses to cols[0]=""). We track
// currentEvent across these continuation rows explicitly.
//
// Column layout (standard WCA export):
//   0: Event name (or empty for continuation rows)
//   1: Round name
//   2: Format
//   3: Time limit
//   4: Cutoff (may be empty)
//   5: Proceed   ← what we care about
//
// We use "last non-empty column" for Proceed so the parser works whether or not
// the Cutoff column is populated.
function parseScheduleTable(rawText: string, competitionEvents: string[]): BulkAdvResult {
  const byEvent: Record<string, ParsedAdvancement[]> = {};
  const parseErrors: string[] = [];
  const notInComp: string[] = [];
  const useTabMode = rawText.includes('\t');

  let currentEventId: string | null = null;
  let currentEventName: string | null = null;

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    // Skip header row (contains both "Event" and "Round" as column headers)
    if (/^\s*Event\b/i.test(line) && /\bRound\b/i.test(line)) continue;

    // Unified split: tabs take priority; fall back to 2+ spaces.
    // Both produce cols[0]="" for continuation rows (empty event column or indented line).
    const rawCols = (useTabMode ? line.split('\t') : line.split(/\s{2,}/)).map((c) => c.trim());
    if (rawCols.length < 2) continue;

    const firstCol = rawCols[0] ?? '';
    const firstColLower = firstCol.toLowerCase();
    const isEmptyFirst = firstCol === '';
    const isRoundName = KNOWN_ROUND_LABELS.some((r) => r === firstColLower);

    let roundCell: string;

    if (isEmptyFirst) {
      // Tab-style continuation: cols[0] is empty, cols[1] is the round name.
      roundCell = rawCols[1] ?? '';
      // CRITICAL: do NOT update currentEvent here.
    } else if (isRoundName) {
      // Space-padded continuation: line not indented but starts with a round label.
      roundCell = firstCol;
      // CRITICAL: do NOT update currentEvent here.
    } else {
      // New event row: firstCol should be an event name.
      let foundId: string | null = null;
      let foundName: string | null = null;
      for (const [name, id] of WCA_EVENT_NAMES) {
        if (firstColLower.startsWith(name.toLowerCase())) {
          foundId = id;
          foundName = name;
          break;
        }
      }
      if (!foundId) continue; // unrecognized first column — skip
      currentEventId = foundId;
      currentEventName = foundName;
      if (!competitionEvents.includes(foundId) && !notInComp.includes(foundId)) {
        notInComp.push(foundId);
      }
      roundCell = rawCols[1] ?? '';
    }

    if (!currentEventId || !currentEventName) continue;

    // Reject unrecognized round labels to avoid false positives from other columns.
    const roundLower = roundCell.trim().toLowerCase();
    if (!KNOWN_ROUND_LABELS.some((r) => r === roundLower)) continue;

    // Proceed = last non-empty column (WCA always puts Proceed last; time-limit/cutoff come before).
    const proceedCell = [...rawCols].reverse().find((c) => c !== '') ?? '';
    // Guard: if only 1 meaningful column, last non-empty IS the round name itself → no proceed.
    const effectiveProceed = proceedCell.toLowerCase() === roundLower ? '' : proceedCell;

    const adv = parseProceedCell(effectiveProceed);
    const roundNameFormatted = roundCell.trim().replace(/\b\w/g, (c) => c.toUpperCase());

    console.log('[bulk-adv]', currentEventId, roundNameFormatted, '->', adv.advancementType, adv.advancementValue ?? '(final)');

    if (!byEvent[currentEventId]) byEvent[currentEventId] = [];
    const already = byEvent[currentEventId].some(
      (r) => r.roundName.toLowerCase() === roundNameFormatted.toLowerCase(),
    );
    if (!already) {
      byEvent[currentEventId].push({
        eventId: currentEventId,
        eventName: currentEventName,
        roundName: roundNameFormatted,
        ...adv,
      });
    }
  }

  if (Object.keys(byEvent).length === 0) {
    parseErrors.push('Таньж болохуйц формат олдсонгүй. WCA schedule хүснэгтийг хуулж тавина уу.');
  }

  return { byEvent, parseErrors, notInComp };
}

// ─── Comp form types ──────────────────────────────────────────────────────────

interface CompFormState {
  name: string;
  date: string;
  location: string;
  description: string;
  imageUrl: string;
  events: string[];
}

const EMPTY_FORM: CompFormState = {
  name: '', date: '', location: '', description: '', imageUrl: '', events: [],
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function VirtualCompetitionsTab() {
  const { user } = useAuth();

  // ── Comp list / selection ────────────────────────────────────────────────
  const [comps, setComps] = useState<VirtualCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<CompFormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // ── Rounds ───────────────────────────────────────────────────────────────
  const [rounds, setRounds] = useState<VirtualRound[]>([]);
  const [roundsLoading, setRoundsLoading] = useState(false);

  // ── Subscriptions / effects ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeAllCompetitions((data) => {
      setComps(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!selectedId || selectedId === 'new') {
      setRounds([]);
      return;
    }
    setRoundsLoading(true);
    getRounds(selectedId)
      .then((data) => { setRounds(data); setRoundsLoading(false); })
      .catch(() => setRoundsLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (!menuOpen) return;
    function handler() { setMenuOpen(null); }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function showToast(type: 'success' | 'error', text: string) { setToast({ type, text }); }

  async function refreshRounds() {
    if (!selectedId || selectedId === 'new') return;
    try { setRounds(await getRounds(selectedId)); } catch { /* ignore */ }
  }

  // ── Comp handlers ────────────────────────────────────────────────────────
  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setSelectedId('new');
  }

  function openEdit(comp: VirtualCompetition) {
    setForm({
      name: comp.name, date: comp.date,
      location: comp.location ?? '',
      description: comp.description ?? '',
      imageUrl: comp.imageUrl ?? '',
      events: [...comp.events],
    });
    setErrors({});
    setSelectedId(comp.id);
  }

  function backToList() { setSelectedId(null); setErrors({}); setSaving(false); }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim() || form.name.trim().length < 3) e.name = 'Нэр 3-аас дээш тэмдэгт байх ёстой';
    if (!form.date || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) e.date = 'Огноо шаардлагатай (YYYY-MM-DD)';
    if (form.events.length === 0) e.events = 'Ядаж нэг төрөл сонгоно уу';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function buildPayload() {
    return {
      name: form.name.trim(), date: form.date, events: form.events,
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.imageUrl.trim() ? { imageUrl: form.imageUrl.trim() } : {}),
    };
  }

  async function handleSave() {
    if (!validate() || !user) return;
    setSaving(true);
    try {
      if (selectedId === 'new') {
        const newId = await createVirtualCompetition(buildPayload(), user.uid);
        setSelectedId(newId);
        showToast('success', 'Тэмцээн амжилттай үүслээ');
      } else if (selectedId) {
        await updateVirtualCompetition(selectedId, buildPayload());
        showToast('success', 'Өөрчлөлт хадгалагдлаа');
      }
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setSaving(false); }
  }

  async function handlePublish() {
    if (!selectedId || selectedId === 'new' || !validate()) return;
    setSaving(true);
    try {
      await updateVirtualCompetition(selectedId, buildPayload());
      await publishVirtualCompetition(selectedId);
      showToast('success', 'Тэмцээн амжилттай зарлагдлаа');
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setSaving(false); }
  }

  async function handleClose() {
    if (!selectedId || selectedId === 'new') return;
    setSaving(true);
    try {
      await closeVirtualCompetition(selectedId);
      showToast('success', 'Тэмцээн хаагдлаа');
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setSaving(false); }
  }

  async function handleDeleteComp(compId: string) {
    setSaving(true);
    try {
      await deleteVirtualCompetition(compId);
      showToast('success', 'Тэмцээн устгагдлаа');
      setDeleteConfirm(null);
      if (selectedId === compId) setSelectedId(null);
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setSaving(false); }
  }

  async function quickAction(action: 'publish' | 'close', compId: string) {
    setMenuOpen(null);
    try {
      if (action === 'publish') { await publishVirtualCompetition(compId); showToast('success', 'Тэмцээн зарлагдлаа'); }
      else { await closeVirtualCompetition(compId); showToast('success', 'Тэмцээн хаагдлаа'); }
    } catch (err) { showToast('error', 'Алдаа: ' + String(err)); }
  }

  function toggleEvent(eventId: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(eventId) ? f.events.filter((e) => e !== eventId) : [...f.events, eventId],
    }));
    if (errors.events) setErrors((p) => ({ ...p, events: '' }));
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const currentComp = selectedId && selectedId !== 'new' ? (comps.find((c) => c.id === selectedId) ?? null) : null;
  const canPublish = !!currentComp && currentComp.status === 'draft'
    && form.name.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(form.date) && form.events.length > 0;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedId !== null) {
    const isNew = selectedId === 'new';
    const status = currentComp?.status ?? null;

    return (
      <div>
        {toast && <ToastBar type={toast.type} text={toast.text} />}

        <button
          onClick={backToList}
          style={{
            background: 'none', border: 'none', color: 'var(--muted)',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem',
            fontWeight: 600, display: 'inline-flex', alignItems: 'center',
            gap: '0.3rem', padding: '0 0 1.1rem', transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
        >
          ← Жагсаалт руу буцах
        </button>

        {/* ── Basic info card ── */}
        <div className="card">
          <div className="card-title">
            <span className="title-accent" />
            {isNew ? 'Шинэ виртуал тэмцээн' : 'Тэмцээн засварлах'}
          </div>

          {!isNew && status && (
            <div style={{ marginBottom: '1.1rem' }}><StatusPill status={status} /></div>
          )}

          <div className="form-grid-2">
            <div className="form-group">
              <label>Нэр</label>
              <input type="text" value={form.name} placeholder="Mongolian Open 2024"
                onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); if (errors.name) setErrors((p) => ({ ...p, name: '' })); }}
                style={errors.name ? { borderColor: 'rgba(239,68,68,0.7)' } : {}} />
              {errors.name && <FieldError text={errors.name} />}
            </div>
            <div className="form-group">
              <label>Огноо</label>
              <input type="text" value={form.date} placeholder="2024-08-15" maxLength={10}
                onChange={(e) => { setForm((f) => ({ ...f, date: e.target.value })); if (errors.date) setErrors((p) => ({ ...p, date: '' })); }}
                style={errors.date ? { borderColor: 'rgba(239,68,68,0.7)' } : {}} />
              {errors.date && <FieldError text={errors.date} />}
            </div>
            <div className="form-group">
              <label>Газар</label>
              <input type="text" value={form.location} placeholder="Улаанбаатар"
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Зураг URL</label>
              <input type="text" value={form.imageUrl} placeholder="https://res.cloudinary.com/..."
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} />
            </div>
          </div>

          <div className="form-group">
            <label>Тайлбар</label>
            <textarea value={form.description} placeholder="Тэмцээний товч тайлбар..." rows={3}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '0.55rem 0.75rem', borderRadius: '8px',
                background: 'var(--input-bg, rgba(255,255,255,0.04))',
                border: '1px solid var(--input-border, rgba(255,255,255,0.1))',
                color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.88rem',
                resize: 'vertical', outline: 'none',
              }} />
          </div>

          <div className="form-group">
            <label>Төрлүүд</label>
            {errors.events && <FieldError text={errors.events} />}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.4rem', marginTop: '0.35rem' }}>
              {WCA_EVENTS.map((ev) => {
                const active = form.events.includes(ev.id);
                return (
                  <button key={ev.id} type="button" onClick={() => toggleEvent(ev.id)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', gap: '0.2rem', padding: '0.5rem 0.3rem',
                      borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${active ? 'rgba(124,58,237,0.55)' : 'rgba(255,255,255,0.07)'}`,
                      background: active ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.02)',
                      color: active ? '#c4b5fd' : 'var(--muted)', transition: 'all 0.12s',
                    }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.03em' }}>{ev.short}</span>
                    {active && <span style={{ fontSize: '0.6rem', color: '#a78bfa', lineHeight: 1 }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
              {form.events.length} төрөл сонгогдсон
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '0.5rem 0 1.1rem' }} />

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-sm-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Хадгалж байна...' : 'Хадгалах'}
            </button>
            {!isNew && status === 'draft' && (
              <button onClick={handlePublish} disabled={saving || !canPublish}
                style={{
                  padding: '0.42rem 0.95rem', borderRadius: '8px', fontSize: '0.83rem',
                  fontWeight: 700, fontFamily: 'inherit',
                  cursor: saving || !canPublish ? 'not-allowed' : 'pointer',
                  background: canPublish ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.05)',
                  border: `1px solid ${canPublish ? 'rgba(34,197,94,0.5)' : 'rgba(34,197,94,0.15)'}`,
                  color: canPublish ? '#4ade80' : 'rgba(74,222,128,0.35)', transition: 'all 0.15s',
                }}>
                Зарлах
              </button>
            )}
            {!isNew && status === 'published' && (
              <button onClick={handleClose} disabled={saving}
                style={{
                  padding: '0.42rem 0.95rem', borderRadius: '8px', fontSize: '0.83rem',
                  fontWeight: 700, fontFamily: 'inherit',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
                  color: '#fbbf24', transition: 'all 0.15s',
                }}>
                Хаах
              </button>
            )}
            {!isNew && currentComp && (
              <button onClick={() => setDeleteConfirm({ id: currentComp.id, name: currentComp.name })}
                disabled={saving} className="btn-delete" style={{ marginLeft: 'auto' }}>
                Устгах
              </button>
            )}
          </div>
        </div>

        {/* ── Edit section (existing comps only) ── */}
        {!isNew && (
          <EventEditSection
            events={form.events}
            rounds={rounds}
            loading={roundsLoading}
            compId={selectedId}
            onRefresh={refreshRounds}
            onToast={showToast}
          />
        )}

        {/* Comp delete modal */}
        {deleteConfirm && (
          <ConfirmModal
            title="Тэмцээн устгах"
            body={<><strong style={{ color: 'var(--text)' }}>{deleteConfirm.name}</strong> тэмцээнийг устгахдаа итгэлтэй байна уу? Энэ үйлдлийг буцаах боломжгүй.</>}
            confirmLabel="Устгах"
            danger saving={saving}
            onConfirm={() => handleDeleteComp(deleteConfirm.id)}
            onCancel={() => setDeleteConfirm(null)}
          />
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <div>
      {toast && <ToastBar type={toast.type} text={toast.text} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.1rem' }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>Виртуал тэмцээн</div>
        <button className="btn-sm-primary" onClick={openCreate}>+ Шинээр үүсгэх</button>
      </div>
      {loading ? (
        <div className="spinner-row">Ачааллаж байна…<span className="spinner-ring" /></div>
      ) : comps.length === 0 ? (
        <div className="empty-state">Одоогоор виртуал тэмцээн байхгүй байна.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {comps.map((comp) => (
            <CompCard key={comp.id} comp={comp}
              isMenuOpen={menuOpen === comp.id}
              onMenuToggle={(e) => { e.stopPropagation(); setMenuOpen((p) => p === comp.id ? null : comp.id); }}
              onEdit={() => { setMenuOpen(null); openEdit(comp); }}
              onPublish={() => quickAction('publish', comp.id)}
              onClose={() => quickAction('close', comp.id)}
              onDelete={() => { setMenuOpen(null); setDeleteConfirm({ id: comp.id, name: comp.name }); }}
            />
          ))}
        </div>
      )}
      {deleteConfirm && (
        <ConfirmModal
          title="Тэмцээн устгах"
          body={<><strong style={{ color: 'var(--text)' }}>{deleteConfirm.name}</strong> тэмцээнийг устгахдаа итгэлтэй байна уу?</>}
          confirmLabel="Устгах"
          danger saving={saving}
          onConfirm={() => handleDeleteComp(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── EventEditSection ─────────────────────────────────────────────────────────

function EventEditSection({
  events,
  rounds,
  loading,
  compId,
  onRefresh,
  onToast,
}: {
  events: string[];
  rounds: VirtualRound[];
  loading: boolean;
  compId: string;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', text: string) => void;
}) {
  const [selectedEvent, setSelectedEvent] = useState<string>(() => events[0] ?? '');
  const [activeTab, setActiveTab] = useState<'scrambles' | 'results' | 'advancement'>('scrambles');
  const [showBulkModal, setShowBulkModal] = useState(false);

  useEffect(() => {
    if (events.length > 0 && !events.includes(selectedEvent)) {
      setSelectedEvent(events[0]);
      setActiveTab('scrambles');
    }
  }, [events, selectedEvent]);

  const TAB_LABELS: { id: 'scrambles' | 'results' | 'advancement'; label: string }[] = [
    { id: 'scrambles', label: 'Холилт' },
    { id: 'results',   label: 'Үр дүн' },
    { id: 'advancement', label: 'Тохиргоо' },
  ];

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{
        fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '1rem',
      }}>
        Холилт, Үр дүн, Тохиргоо
      </div>

      {loading ? (
        <div className="spinner-row">Ачааллаж байна…<span className="spinner-ring" /></div>
      ) : events.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
          Эхлээд төрөл сонгоно уу
        </div>
      ) : (
        <>
          {/* Event selector pills */}
          <div style={{
            display: 'flex', gap: '0.4rem', overflowX: 'auto',
            paddingBottom: '0.75rem', scrollbarWidth: 'none',
          }}>
            {events.map((evId) => {
              const ev = getEvent(evId);
              const active = evId === selectedEvent;
              return (
                <button
                  key={evId}
                  onClick={() => { setSelectedEvent(evId); setActiveTab('scrambles'); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    padding: '0.3rem 0.75rem', borderRadius: '999px',
                    fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600,
                    flexShrink: 0, cursor: 'pointer', transition: 'all 0.12s',
                    border: `1px solid ${active ? 'rgba(167,139,250,0.6)' : 'rgba(255,255,255,0.12)'}`,
                    background: active ? 'rgba(124,58,237,0.22)' : 'rgba(255,255,255,0.03)',
                    color: active ? '#c4b5fd' : 'var(--muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: '0.7rem',
                    background: active ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.08)',
                    padding: '0.05rem 0.3rem', borderRadius: '4px',
                  }}>{ev?.short ?? evId}</span>
                  <span>{ev?.name ?? evId}</span>
                  <span style={{ fontSize: '0.68rem', color: active ? 'rgba(196,181,253,0.7)' : 'rgba(255,255,255,0.3)' }}>
                    ({rounds.filter((r) => r.eventId === evId).length})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Tab bar */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            marginBottom: '1rem',
          }}>
            {TAB_LABELS.map(({ id, label }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  style={{
                    padding: '0.45rem 1rem', background: 'none', border: 'none',
                    borderBottom: active ? '2px solid #a78bfa' : '2px solid transparent',
                    marginBottom: '-1px',
                    fontFamily: 'inherit', fontSize: '0.84rem',
                    fontWeight: active ? 700 : 400,
                    color: active ? '#c4b5fd' : 'var(--muted)',
                    cursor: 'pointer', transition: 'color 0.12s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Bulk advancement button — Тохиргоо tab only */}
          {activeTab === 'advancement' && (
            <div style={{ marginBottom: '0.8rem' }}>
              <button
                onClick={() => setShowBulkModal(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.42rem 0.85rem', borderRadius: '8px',
                  fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600,
                  background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)',
                  color: '#c4b5fd', cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.18)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.1)')}
              >
                📋 Бүх раундын тохиргоо хуулж тавих
              </button>
            </div>
          )}

          {/* Tab content — remount on event change to reset state */}
          {selectedEvent && (
            <EventPasteSection
              key={selectedEvent}
              eventId={selectedEvent}
              compId={compId}
              existingRounds={rounds.filter((r) => r.eventId === selectedEvent)}
              onRefresh={onRefresh}
              onToast={onToast}
              activeTab={activeTab}
            />
          )}

          {showBulkModal && (
            <BulkAdvancementModal
              compId={compId}
              rounds={rounds}
              events={events}
              onClose={() => setShowBulkModal(false)}
              onToast={onToast}
              onRefresh={onRefresh}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── EventPasteSection ────────────────────────────────────────────────────────

type AdvEdit = { type: 'fixed' | 'percentage' | 'final'; value: string };

function EventPasteSection({
  eventId,
  compId,
  existingRounds,
  onRefresh,
  onToast,
  activeTab,
}: {
  eventId: string;
  compId: string;
  existingRounds: VirtualRound[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', text: string) => void;
  activeTab: 'scrambles' | 'results' | 'advancement';
}) {
  const ev = getEvent(eventId);

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preview'>('idle');
  const [parsedRounds, setParsedRounds] = useState<ParsedRound[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // ── Results paste state ──────────────────────────────────────────────────
  const [resultsText, setResultsText] = useState('');
  const [resultsPhase, setResultsPhase] = useState<'idle' | 'preview'>('idle');
  const [parsedResultsByLabel, setParsedResultsByLabel] = useState<Record<string, HistoricalResult[]>>({});
  const [resultsParseError, setResultsParseError] = useState<string | null>(null);
  const [resultsSaving, setResultsSaving] = useState(false);
  const [confirmResultsReplace, setConfirmResultsReplace] = useState(false);

  // ── Advancement edit state ────────────────────────────────────────────────
  const [advEdits, setAdvEdits] = useState<Record<string, AdvEdit>>({});
  const [advSaving, setAdvSaving] = useState(false);
  const [advErrors, setAdvErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, AdvEdit> = {};
    for (const r of existingRounds) {
      init[r.id] = {
        type: r.advancementType,
        value: r.advancementValue != null ? String(r.advancementValue) : '',
      };
    }
    setAdvEdits(init);
    setAdvErrors({});
  }, [existingRounds]);

  function handleAnalyze() {
    if (!text.trim()) return;
    const result = parseEventRounds(text, eventId);
    if (result.error) {
      setParseError(result.error);
      setParsedRounds([]);
      return;
    }
    setParseError(null);
    setParsedRounds(result.rounds);
    setPhase('preview');
  }

  function handleCreateClick() {
    console.log('[paste] handleCreateClick', { eventId, existingCount: existingRounds.length, parsedCount: parsedRounds.length });
    if (existingRounds.length > 0) {
      console.log('[paste] → showing confirmReplace modal');
      setConfirmReplace(true);
    } else {
      console.log('[paste] → calling doCreate directly');
      void doCreate();
    }
  }

  async function doCreate() {
    console.log('[paste] doCreate start', { compId, eventId, parsedCount: parsedRounds.length, existingCount: existingRounds.length });
    setConfirmReplace(false);
    setSaving(true);
    try {
      for (const r of existingRounds) {
        console.log('[paste] deleting existing round', r.id);
        await svcDeleteRound(compId, r.id);
      }
      const maxRound = Math.max(...parsedRounds.map((r) => r.roundNumber));
      for (const round of parsedRounds) {
        const isFinal = round.roundNumber === maxRound;
        const payload = {
          eventId: round.eventId,
          roundNumber: round.roundNumber,
          roundName: round.roundLabel,
          format: 'avg5' as const,
          advancementType: (isFinal ? 'final' : 'fixed') as 'final' | 'fixed',
          ...(isFinal ? {} : { advancementValue: 8 }),
          scrambles: round.allScrambles,
          ...(round.groups.length > 0 ? { groups: round.groups } : {}),
          historicalResults: [] as [],
        };
        console.log('[paste] addRound payload', payload);
        await addRound(compId, payload);
        console.log('[paste] addRound OK for round', round.roundNumber);
      }
      console.log('[paste] all rounds created — showing toast');
      onToast('success', `${parsedRounds.length} раунд үүсгэгдэв`);
      setText('');
      setPhase('idle');
      setParsedRounds([]);
      await onRefresh();
    } catch (err) {
      console.error('[paste] doCreate ERROR', err);
      onToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function doDeleteAll() {
    setConfirmDeleteAll(false);
    setSaving(true);
    try {
      for (const r of existingRounds) {
        await svcDeleteRound(compId, r.id);
      }
      onToast('success', 'Раундууд устгагдлаа');
      await onRefresh();
    } catch (err) {
      onToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  // ── Results paste handlers ────────────────────────────────────────────────
  function handleResultsAnalyze() {
    if (!resultsText.trim()) return;
    const result = parseWcaResults(resultsText, eventId);
    if (result.parseErrors.length > 0) {
      setResultsParseError(result.parseErrors[0]);
      setParsedResultsByLabel({});
      return;
    }
    setResultsParseError(null);
    setParsedResultsByLabel(result.byRoundLabel);
    setResultsPhase('preview');
  }

  function handleResultsCreateClick() {
    const hasExisting = Object.keys(parsedResultsByLabel).some((label) => {
      const round = matchRoundByLabel(label, existingRounds);
      return round != null && round.historicalResults.length > 0;
    });
    if (hasExisting) {
      setConfirmResultsReplace(true);
    } else {
      void doSaveResults();
    }
  }

  async function doSaveResults() {
    setConfirmResultsReplace(false);
    setResultsSaving(true);
    let saved = 0;
    let skipped = 0;
    try {
      for (const [label, results] of Object.entries(parsedResultsByLabel)) {
        const round = matchRoundByLabel(label, existingRounds);
        if (!round) { skipped++; continue; }
        await importHistoricalResults(compId, round.id, results);
        saved++;
      }
      onToast(
        'success',
        `${saved} раундад үр дүн хадгалагдлаа${skipped > 0 ? ` (${skipped} тохирохгүй)` : ''}`,
      );
      setResultsText('');
      setResultsPhase('idle');
      setParsedResultsByLabel({});
      await onRefresh();
    } catch (err) {
      onToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setResultsSaving(false);
    }
  }

  // ── Advancement handlers ──────────────────────────────────────────────────

  function applyAutoSuggest() {
    const sorted = [...existingRounds].sort((a, b) => a.roundNumber - b.roundNumber);
    const total = sorted.length;
    const next = { ...advEdits };
    sorted.forEach((r, i) => {
      const isLast = i === total - 1;
      if (isLast) {
        next[r.id] = { type: 'final', value: '' };
      } else {
        const lbl = r.roundName.toLowerCase();
        if (lbl.includes('first')) {
          next[r.id] = { type: 'percentage', value: '75' };
        } else if (lbl.includes('semi')) {
          next[r.id] = { type: 'fixed', value: '12' };
        } else {
          next[r.id] = { type: 'fixed', value: '25' };
        }
      }
    });
    setAdvEdits(next);
    setAdvErrors({});
  }

  async function handleAdvSave() {
    const errs: Record<string, string> = {};
    for (const r of existingRounds) {
      const edit = advEdits[r.id];
      if (!edit) continue;
      if (edit.type === 'fixed') {
        const n = parseInt(edit.value, 10);
        if (isNaN(n) || n < 0 || !Number.isInteger(n)) errs[r.id] = 'Эерэг бүхэл тоо оруулна уу';
      } else if (edit.type === 'percentage') {
        const n = parseInt(edit.value, 10);
        if (isNaN(n) || n < 1 || n > 100) errs[r.id] = '1-100 хооронд тоо оруулна уу';
      }
    }
    if (Object.keys(errs).length > 0) { setAdvErrors(errs); return; }
    setAdvErrors({});
    setAdvSaving(true);
    try {
      const changed = existingRounds.filter((r) => {
        const edit = advEdits[r.id];
        if (!edit) return false;
        if (edit.type !== r.advancementType) return true;
        return edit.value !== (r.advancementValue != null ? String(r.advancementValue) : '');
      });
      await Promise.all(
        changed.map((r) => {
          const edit = advEdits[r.id]!;
          const val = edit.type !== 'final' ? parseInt(edit.value, 10) : undefined;
          const updates: Partial<import('@/lib/firebase/services/virtual-competitions').VirtualRound> = {
            advancementType: edit.type,
          };
          if (val != null) updates.advancementValue = val;
          return updateRound(compId, r.id, updates);
        }),
      );
      onToast('success', `${changed.length} раундын тохиргоо хадгалагдлаа`);
      await onRefresh();
    } catch (err) {
      onToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAdvSaving(false);
    }
  }

  const advDirty = existingRounds.some((r) => {
    const edit = advEdits[r.id];
    if (!edit) return false;
    if (edit.type !== r.advancementType) return true;
    return edit.value !== (r.advancementValue != null ? String(r.advancementValue) : '');
  });

  const sortedRounds = [...existingRounds].sort((a, b) => a.roundNumber - b.roundNumber);

  return (
    <>
      {/* ── Холилт tab ── */}
      {activeTab === 'scrambles' && (
        <div>
          {/* Existing rounds (idle) */}
          {phase === 'idle' && sortedRounds.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              {sortedRounds.map((r) => {
                const groupCount = r.groups?.length ?? 0;
                const scrambleCount = groupCount > 0
                  ? r.groups!.reduce((sum, g) => sum + g.scrambles.length, 0)
                  : r.scrambles.length;
                return (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.4rem 0.55rem', marginBottom: '0.3rem',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.065)',
                    borderRadius: '7px', fontSize: '0.82rem',
                  }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)', flex: 1 }}>
                      Раунд {r.roundNumber} · {r.roundName}
                    </span>
                    <span style={{
                      padding: '0.05rem 0.35rem',
                      background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)',
                      borderRadius: '4px', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0,
                    }}>
                      {FORMAT_LABELS[r.format] ?? r.format}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.75rem', flexShrink: 0 }}>
                      {groupCount > 1 ? `${groupCount} груп · ` : ''}{scrambleCount} холилт
                    </span>
                  </div>
                );
              })}
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '0.65rem 0' }} />
            </div>
          )}

          {/* Paste area (idle) */}
          {phase === 'idle' && (
            <>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); setParseError(null); }}
                rows={10}
                placeholder={`${ev?.name ?? eventId} раундын холилтыг WCA export форматаар энд хуулна уу.\n\nЖишээ:\n3x3x3 Cube Final\nGroup\t#\tScramble\nA\t1\tF U2 F D L2 ...\n\t2\tD2 L' F' R2 ...`}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '0.6rem 0.75rem', borderRadius: '8px',
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${parseError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.77rem',
                  resize: 'vertical', outline: 'none', lineHeight: 1.6,
                  marginBottom: '0.55rem',
                }}
              />
              {parseError && (
                <div style={{
                  padding: '0.45rem 0.65rem', borderRadius: '7px', marginBottom: '0.55rem',
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  color: '#f87171', fontSize: '0.8rem', lineHeight: 1.5,
                }}>{parseError}</div>
              )}
              <button
                onClick={handleAnalyze}
                disabled={!text.trim()}
                style={{
                  width: '100%', padding: '0.48rem 1rem', borderRadius: '8px',
                  fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700,
                  background: text.trim() ? 'rgba(124,58,237,0.7)' : 'rgba(124,58,237,0.2)',
                  border: '1px solid rgba(124,58,237,0.9)',
                  color: text.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                  cursor: text.trim() ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s',
                }}
              >
                Шинжлэх →
              </button>
            </>
          )}

          {/* Preview */}
          {phase === 'preview' && (
            <>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                  {parsedRounds.length} раунд олдлоо
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {parsedRounds.map((r) => {
                    const groupCount = r.groups.length;
                    const groupLabel = groupCount > 1 ? `${groupCount} груп, ` : '';
                    const extraCount = r.groups.reduce((sum, g) => sum + g.extraScrambles.length, 0);
                    const extraLabel = extraCount > 0 ? ` + ${extraCount} extra` : '';
                    return (
                      <div key={r.roundNumber} style={{
                        padding: '0.45rem 0.65rem', borderRadius: '7px',
                        background: 'rgba(34,197,94,0.06)',
                        border: '1px solid rgba(34,197,94,0.2)',
                        fontSize: '0.82rem',
                      }}>
                        <span style={{ fontWeight: 600, color: '#4ade80' }}>
                          Раунд {r.roundNumber} · {r.roundLabel}
                        </span>
                        <span style={{ color: 'var(--muted)', marginLeft: '0.5rem' }}>
                          — {groupLabel}{r.allScrambles.length} холилт{extraLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setPhase('idle')}
                  style={{
                    flex: 1, padding: '0.45rem 0.75rem', borderRadius: '8px',
                    fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--text)', cursor: 'pointer',
                  }}
                >
                  ← Буцах
                </button>
                <button
                  onClick={handleCreateClick}
                  disabled={saving}
                  style={{
                    flex: 2, padding: '0.45rem 0.75rem', borderRadius: '8px',
                    fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700,
                    background: saving ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.7)',
                    border: '1px solid rgba(34,197,94,0.8)',
                    color: saving ? 'rgba(255,255,255,0.3)' : '#fff',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {saving
                    ? 'Үүсгэж байна...'
                    : existingRounds.length > 0
                      ? `✓ Солих (${parsedRounds.length} раунд)`
                      : `✓ Үүсгэх (${parsedRounds.length} раунд)`}
                </button>
              </div>
            </>
          )}

          {/* Delete all */}
          {existingRounds.length > 0 && phase === 'idle' && (
            <div style={{ marginTop: '0.9rem', textAlign: 'right' }}>
              <button
                onClick={() => setConfirmDeleteAll(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.75rem', color: '#f87171',
                  padding: 0, textDecoration: 'underline',
                }}
              >
                Бүгдийг устгах
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Үр дүн tab ── */}
      {activeTab === 'results' && (
        <div>
          {existingRounds.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              Эхлээд холилт оруулна уу
            </div>
          ) : (
            <>
              {resultsPhase === 'idle' && existingRounds.some((r) => r.historicalResults.length > 0) && (
                <div style={{
                  fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.6rem',
                  padding: '0.35rem 0.6rem', borderRadius: '6px',
                  background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.18)',
                }}>
                  Одоо: {sortedRounds
                    .filter((r) => r.historicalResults.length > 0)
                    .map((r) => `${r.roundName} (${r.historicalResults.length})`)
                    .join(', ')}
                </div>
              )}
              {resultsPhase === 'idle' && (
                <>
                  <textarea
                    value={resultsText}
                    onChange={(e) => { setResultsText(e.target.value); setResultsParseError(null); }}
                    rows={9}
                    placeholder={
                      '3x3x3 Cube Final\n#  Name                  Best  Average  Solves\n' +
                      '1  Gegeenbileg N.         5.55  7.09     8.58 (5.55) 6.92 5.78 (10.56)\n\n' +
                      '3x3x3 Cube Second round\n...'
                    }
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0.6rem 0.75rem', borderRadius: '8px',
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${resultsParseError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.77rem',
                      resize: 'vertical', outline: 'none', lineHeight: 1.6,
                      marginBottom: '0.55rem',
                    }}
                  />
                  {resultsParseError && (
                    <div style={{
                      padding: '0.45rem 0.65rem', borderRadius: '7px', marginBottom: '0.55rem',
                      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                      color: '#f87171', fontSize: '0.8rem', lineHeight: 1.5,
                    }}>{resultsParseError}</div>
                  )}
                  <button
                    onClick={handleResultsAnalyze}
                    disabled={!resultsText.trim()}
                    style={{
                      width: '100%', padding: '0.48rem 1rem', borderRadius: '8px',
                      fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700,
                      background: resultsText.trim() ? 'rgba(124,58,237,0.7)' : 'rgba(124,58,237,0.2)',
                      border: '1px solid rgba(124,58,237,0.9)',
                      color: resultsText.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                      cursor: resultsText.trim() ? 'pointer' : 'not-allowed',
                      transition: 'background 0.15s',
                    }}
                  >
                    Шинжлэх →
                  </button>
                </>
              )}
              {resultsPhase === 'preview' && (
                <>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                      Шинжлэлийн үр дүн
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {Object.entries(parsedResultsByLabel).map(([label, athletes]) => {
                        const matchedRound = matchRoundByLabel(label, existingRounds);
                        const example = athletes[0];
                        return (
                          <div key={label} style={{
                            padding: '0.5rem 0.65rem', borderRadius: '7px', fontSize: '0.82rem',
                            background: matchedRound ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.07)',
                            border: `1px solid ${matchedRound ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.25)'}`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                              <span style={{ fontSize: '0.75rem' }}>{matchedRound ? '✓' : '⚠'}</span>
                              <span style={{ fontWeight: 700, color: matchedRound ? '#4ade80' : '#fbbf24' }}>
                                {label}
                              </span>
                              <span style={{ color: 'var(--muted)' }}>— {athletes.length} тамирчин</span>
                              {!matchedRound && (
                                <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>· тохирох раунд олдсонгүй</span>
                              )}
                            </div>
                            {example && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', paddingLeft: '1.1rem' }}>
                                Жишээ: {example.athleteName} — {formatMs(example.best)}/{formatMs(example.average)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => setResultsPhase('idle')}
                      style={{
                        flex: 1, padding: '0.45rem 0.75rem', borderRadius: '8px',
                        fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                        color: 'var(--text)', cursor: 'pointer',
                      }}
                    >
                      ← Буцах
                    </button>
                    <button
                      onClick={handleResultsCreateClick}
                      disabled={resultsSaving}
                      style={{
                        flex: 2, padding: '0.45rem 0.75rem', borderRadius: '8px',
                        fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700,
                        background: resultsSaving ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.7)',
                        border: '1px solid rgba(34,197,94,0.8)',
                        color: resultsSaving ? 'rgba(255,255,255,0.3)' : '#fff',
                        cursor: resultsSaving ? 'not-allowed' : 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      {resultsSaving
                        ? 'Хадгалж байна...'
                        : `✓ Хадгалах (${Object.values(parsedResultsByLabel).reduce((s, a) => s + a.length, 0)} тамирчин)`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Тохиргоо tab ── */}
      {activeTab === 'advancement' && (
        <div>
          {sortedRounds.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              Эхлээд холилт оруулна уу
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
                <div style={{
                  fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: 'var(--muted)',
                }}>
                  Раундын тохиргоо
                </div>
                <button
                  onClick={applyAutoSuggest}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: '0.72rem', color: '#a78bfa',
                    padding: 0, textDecoration: 'underline',
                  }}
                >
                  Автомат тооцоо
                </button>
              </div>
              {sortedRounds.map((r) => {
                const edit = advEdits[r.id] ?? { type: r.advancementType, value: r.advancementValue != null ? String(r.advancementValue) : '' };
                const err = advErrors[r.id];
                return (
                  <div key={r.id} style={{
                    padding: '0.6rem 0.7rem', marginBottom: '0.4rem',
                    border: '1px solid rgba(255,255,255,0.065)', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.015)',
                  }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.35rem' }}>
                      {r.roundName}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                      Дараагийн шатанд орох тоо:
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      {(['fixed', 'percentage', 'final'] as const).map((opt) => {
                        const selected = edit.type === opt;
                        const label = opt === 'fixed' ? 'Тоогоор' : opt === 'percentage' ? 'Хувиар' : 'Final';
                        return (
                          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              checked={selected}
                              onChange={() => setAdvEdits((prev) => ({
                                ...prev,
                                [r.id]: { type: opt, value: opt === 'final' ? '' : (prev[r.id]?.value ?? '') },
                              }))}
                              style={{ accentColor: '#a78bfa', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.8rem', color: selected ? '#c4b5fd' : 'var(--muted)' }}>
                              {label}
                            </span>
                            {opt !== 'final' && (
                              <input
                                type="number"
                                value={selected ? edit.value : ''}
                                disabled={!selected}
                                onChange={(e) => {
                                  if (!selected) return;
                                  setAdvEdits((prev) => ({ ...prev, [r.id]: { type: opt, value: e.target.value } }));
                                  if (advErrors[r.id]) setAdvErrors((prev) => ({ ...prev, [r.id]: '' }));
                                }}
                                style={{
                                  width: '3.5rem', padding: '0.2rem 0.35rem', borderRadius: '5px',
                                  background: selected ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                                  border: `1px solid ${err && selected ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                                  color: selected ? 'var(--text)' : 'rgba(255,255,255,0.2)',
                                  fontFamily: 'inherit', fontSize: '0.82rem', outline: 'none',
                                }}
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                    {err && (
                      <div style={{ fontSize: '0.72rem', color: '#f87171', marginTop: '0.3rem' }}>{err}</div>
                    )}
                  </div>
                );
              })}
              {advDirty && (
                <button
                  onClick={() => void handleAdvSave()}
                  disabled={advSaving}
                  style={{
                    marginTop: '0.3rem', width: '100%', padding: '0.45rem 1rem', borderRadius: '8px',
                    fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700,
                    background: advSaving ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.7)',
                    border: '1px solid rgba(124,58,237,0.9)',
                    color: advSaving ? 'rgba(255,255,255,0.3)' : '#fff',
                    cursor: advSaving ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {advSaving ? 'Хадгалж байна...' : 'Хадгалах'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {confirmReplace && (
        <ConfirmModal
          title="Раундуудыг солих"
          body={<>Одоогийн <strong style={{ color: 'var(--text)' }}>{existingRounds.length}</strong> раундыг устгаад шинэ <strong style={{ color: 'var(--text)' }}>{parsedRounds.length}</strong> раунд үүсгэх үү?</>}
          confirmLabel="Солих"
          danger
          saving={saving}
          onConfirm={() => void doCreate()}
          onCancel={() => setConfirmReplace(false)}
        />
      )}
      {confirmDeleteAll && (
        <ConfirmModal
          title="Бүх раунд устгах"
          body={<><strong style={{ color: 'var(--text)' }}>{ev?.name ?? eventId}</strong>-н бүх раундыг устгах уу?</>}
          confirmLabel="Устгах"
          danger
          saving={saving}
          onConfirm={() => void doDeleteAll()}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}
      {confirmResultsReplace && (
        <ConfirmModal
          title="Үр дүн солих"
          body={<>Энэ раундад өмнөх үр дүн байна. Шинээр сольж бичих үү?</>}
          confirmLabel="Тийм"
          danger
          saving={resultsSaving}
          onConfirm={() => void doSaveResults()}
          onCancel={() => setConfirmResultsReplace(false)}
        />
      )}
    </>
  );
}

// ─── BulkAdvancementModal ─────────────────────────────────────────────────────

function BulkAdvancementModal({
  compId,
  rounds,
  events,
  onClose,
  onToast,
  onRefresh,
}: {
  compId: string;
  rounds: VirtualRound[];
  events: string[];
  onClose: () => void;
  onToast: (type: 'success' | 'error', text: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preview'>('idle');
  const [parsed, setParsed] = useState<BulkAdvResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleAnalyze() {
    if (!text.trim()) return;
    const result = parseScheduleTable(text, events);
    if (result.parseErrors.length > 0) {
      setParseError(result.parseErrors[0]);
      setParsed(null);
      return;
    }
    setParseError(null);
    setParsed(result);
    setPhase('preview');
  }

  async function handleApply() {
    if (!parsed) return;
    setSaving(true);
    try {
      const updates: Array<Promise<void>> = [];
      let matched = 0;
      let skipped = 0;
      for (const [eventId, advRows] of Object.entries(parsed.byEvent)) {
        if (!events.includes(eventId)) { skipped += advRows.length; continue; }
        const eventRounds = rounds.filter((r) => r.eventId === eventId);
        for (const adv of advRows) {
          const round = matchRoundByLabel(adv.roundName, eventRounds);
          if (!round) { skipped++; continue; }
          const u: { advancementType: 'fixed' | 'percentage' | 'final'; advancementValue?: number } = {
            advancementType: adv.advancementType,
          };
          if (adv.advancementValue != null) u.advancementValue = adv.advancementValue;
          updates.push(updateRound(compId, round.id, u));
          matched++;
        }
      }
      await Promise.all(updates);
      onToast(
        'success',
        `${matched} раундын тохиргоо шинэчлэгдлээ ✓${skipped > 0 ? ` (${skipped} тохирохгүй)` : ''}`,
      );
      await onRefresh();
      onClose();
    } catch (err) {
      onToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  // Count how many rounds will actually be updated (in comp + matched)
  const totalApplicable = parsed
    ? Object.entries(parsed.byEvent)
        .filter(([eventId]) => events.includes(eventId))
        .reduce((sum, [eventId, advRows]) => {
          const eventRounds = rounds.filter((r) => r.eventId === eventId);
          return sum + advRows.filter((adv) => matchRoundByLabel(adv.roundName, eventRounds) !== null).length;
        }, 0)
    : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card, #1a1730)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '14px', padding: '1.75rem',
          maxWidth: '580px', width: '100%', maxHeight: '85vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.1rem', flexShrink: 0 }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>Раундын тохиргоог бүлэгээр оруулах</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1.2rem', lineHeight: 1, padding: '0.1rem 0.3rem' }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {phase === 'idle' && (
            <>
              <div style={{ fontSize: '0.83rem', color: 'var(--muted)', marginBottom: '0.85rem', lineHeight: 1.55 }}>
                WCA-н тэмцээний schedule хүснэгтийг хуулж тавина. Бүх төрөл, раундын advancement тохиргоо автоматаар тогтоно.
              </div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); setParseError(null); }}
                rows={14}
                placeholder={
                  'Event\tRound\tFormat\tTime limit\tCutoff\tProceed\n' +
                  '3x3x3 Cube\tFirst round\tAo5\t2:00.00\t\tTop 48 advance to next round\n' +
                  '\tSecond round\tAo5\t1:00.00\t\tTop 16 advance to next round\n' +
                  '\tFinal\tAo5\t1:00.00\t\t'
                }
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '0.6rem 0.75rem', borderRadius: '8px',
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${parseError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.75rem',
                  resize: 'vertical', outline: 'none', lineHeight: 1.6,
                  marginBottom: '0.55rem',
                }}
              />
              {parseError && (
                <div style={{
                  padding: '0.45rem 0.65rem', borderRadius: '7px', marginBottom: '0.55rem',
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  color: '#f87171', fontSize: '0.8rem', lineHeight: 1.5,
                }}>
                  {parseError}
                </div>
              )}
              <button
                onClick={handleAnalyze}
                disabled={!text.trim()}
                style={{
                  width: '100%', padding: '0.5rem 1rem', borderRadius: '8px',
                  fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700,
                  background: text.trim() ? 'rgba(124,58,237,0.7)' : 'rgba(124,58,237,0.2)',
                  border: '1px solid rgba(124,58,237,0.9)',
                  color: text.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                  cursor: text.trim() ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s',
                }}
              >
                Шинжлэх →
              </button>
            </>
          )}

          {phase === 'preview' && parsed && (
            <>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.6rem' }}>
                Шинжлэлийн үр дүн
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {Object.entries(parsed.byEvent).map(([eventId, advRows]) => {
                  const inComp = events.includes(eventId);
                  const ev = getEvent(eventId);
                  const eventRounds = rounds.filter((r) => r.eventId === eventId);
                  const rowStatuses = advRows.map((adv) => {
                    const matchedRound = matchRoundByLabel(adv.roundName, eventRounds);
                    const differentFromCurrent =
                      matchedRound != null && (
                        matchedRound.advancementType !== adv.advancementType ||
                        (adv.advancementValue != null &&
                          matchedRound.advancementValue !== adv.advancementValue)
                      );
                    return { adv, matchedRound, differentFromCurrent };
                  });
                  const hasWarning = !inComp || rowStatuses.some((s) => !s.matchedRound);

                  return (
                    <div key={eventId} style={{
                      padding: '0.55rem 0.7rem', borderRadius: '8px',
                      border: `1px solid ${hasWarning ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.2)'}`,
                      background: hasWarning ? 'rgba(245,158,11,0.04)' : 'rgba(34,197,94,0.04)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.85rem' }}>{hasWarning ? '⚠' : '✓'}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: hasWarning ? '#fbbf24' : '#4ade80' }}>
                          {ev?.name ?? eventId}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                          — {advRows.length} раунд
                        </span>
                      </div>
                      {!inComp && (
                        <div style={{ fontSize: '0.72rem', color: '#fbbf24', paddingLeft: '1.3rem', marginBottom: '0.2rem' }}>
                          Энэ төрлийн раунд тэмцээнд оруулаагүй
                        </div>
                      )}
                      {rowStatuses.map(({ adv, matchedRound, differentFromCurrent }) => {
                        const advLabel =
                          adv.advancementType === 'final'
                            ? 'Final round'
                            : adv.advancementType === 'fixed'
                              ? `Top ${adv.advancementValue} advance`
                              : `Top ${adv.advancementValue}%`;
                        return (
                          <div key={adv.roundName} style={{
                            fontSize: '0.77rem',
                            color: !matchedRound ? '#fbbf24' : differentFromCurrent ? '#c4b5fd' : 'var(--muted)',
                            paddingLeft: '1.3rem', lineHeight: 1.6,
                          }}>
                            {adv.roundName} → {advLabel}
                            {!matchedRound && ' ⚠ раунд олдсонгүй'}
                            {matchedRound && differentFromCurrent && ' ↺ солино'}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {parsed.notInComp.length > 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                    ⚠ Тэмцээнд оруулаагүй: {parsed.notInComp.map((id) => getEvent(id)?.name ?? id).join(', ')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {phase === 'preview' && parsed && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexShrink: 0 }}>
            <button
              onClick={() => setPhase('idle')}
              style={{
                flex: 1, padding: '0.5rem 0.75rem', borderRadius: '8px',
                fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--text)', cursor: 'pointer',
              }}
            >
              ← Буцах
            </button>
            <button
              onClick={() => void handleApply()}
              disabled={saving || totalApplicable === 0}
              style={{
                flex: 2, padding: '0.5rem 0.75rem', borderRadius: '8px',
                fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700,
                background: saving || totalApplicable === 0 ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.7)',
                border: '1px solid rgba(34,197,94,0.8)',
                color: saving || totalApplicable === 0 ? 'rgba(255,255,255,0.3)' : '#fff',
                cursor: saving || totalApplicable === 0 ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {saving ? 'Хадгалж байна...' : `✓ Үүсгэх (${totalApplicable} раунд)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CompCard ─────────────────────────────────────────────────────────────────

function CompCard({ comp, isMenuOpen, onMenuToggle, onEdit, onPublish, onClose, onDelete }: {
  comp: VirtualCompetition;
  isMenuOpen: boolean;
  onMenuToggle: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onPublish: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '12px', padding: '0.9rem 1.1rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{comp.name}</span>
          <StatusPill status={comp.status} />
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
          {comp.date} · {comp.events.length} төрөл · {comp.participantCount ?? 0} оролцогч
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
        <button className="btn-edit" onClick={onEdit}>Засах</button>
        <div style={{ position: 'relative' }} onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={onMenuToggle}
            style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '7px', color: 'var(--muted)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1, padding: '0.3rem 0.55rem',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}>
            ⋮
          </button>
          {isMenuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 5px)', right: 0, zIndex: 200,
              background: 'var(--card, #1e1b2e)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '10px', padding: '0.3rem', boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
              minWidth: '130px',
            }}>
              <MenuAction label="Засах" onClick={onEdit} />
              {comp.status === 'draft' && <MenuAction label="Зарлах" onClick={onPublish} color="#4ade80" />}
              {comp.status === 'published' && <MenuAction label="Хаах" onClick={onClose} color="#fbbf24" />}
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '0.2rem 0.3rem' }} />
              <MenuAction label="Устгах" onClick={onDelete} color="#f87171" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuAction({ label, onClick, color }: { label: string; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '0.38rem 0.65rem', borderRadius: '7px',
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: '0.83rem', fontWeight: 600,
        color: color ?? 'var(--text)', transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
      {label}
    </button>
  );
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  draft:     { bg: 'rgba(100,116,139,0.25)', color: '#94a3b8', label: 'DRAFT' },
  published: { bg: 'rgba(34,197,94,0.2)',    color: '#4ade80', label: 'PUBLISHED' },
  closed:    { bg: 'rgba(245,158,11,0.2)',   color: '#fbbf24', label: 'CLOSED' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span style={{
      display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: '999px',
      fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em',
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

function ConfirmModal({ title, body, confirmLabel, danger, saving, onConfirm, onCancel }: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card, #1a1730)',
          border: `1px solid ${danger ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: '14px', padding: '1.75rem',
          maxWidth: '420px', width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        }}>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.1rem' }}>
          <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{danger ? '⚠️' : '❓'}</span>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>{title}</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--muted)', lineHeight: 1.55 }}>{body}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{
              padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.88rem',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            Болих
          </button>
          <button onClick={onConfirm} disabled={saving}
            style={{
              padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.88rem',
              fontFamily: 'inherit', fontWeight: 700,
              background: danger
                ? (saving ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.82)')
                : 'rgba(124,58,237,0.7)',
              border: `1px solid ${danger ? 'rgba(239,68,68,0.85)' : 'rgba(124,58,237,0.9)'}`,
              color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
            }}>
            {saving ? 'Түр хүлээнэ үү...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ToastBar ─────────────────────────────────────────────────────────────────

function ToastBar({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 2000,
      padding: '0.7rem 1.1rem', borderRadius: '10px', fontSize: '0.88rem', fontWeight: 600,
      background: type === 'success' ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)',
      border: `1px solid ${type === 'success' ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}`,
      color: type === 'success' ? '#4ade80' : '#f87171',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', pointerEvents: 'none',
    }}>
      {type === 'success' ? '✓ ' : '✕ '}{text}
    </div>
  );
}

// ─── FieldError ───────────────────────────────────────────────────────────────

function FieldError({ text }: { text: string }) {
  return <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.25rem' }}>{text}</div>;
}
