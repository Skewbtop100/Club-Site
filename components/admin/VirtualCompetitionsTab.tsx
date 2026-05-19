'use client';

import { useEffect, useRef, useState } from 'react';
import { Scrambow } from 'scrambow';
import {
  subscribeAllCompetitions,
  createVirtualCompetition,
  updateVirtualCompetition,
  deleteVirtualCompetition,
  publishVirtualCompetition,
  closeVirtualCompetition,
  getRounds,
  addRound,
  updateRound,
  deleteRound as svcDeleteRound,
} from '@/lib/firebase/services/virtual-competitions';
import type { VirtualCompetition, VirtualRound } from '@/lib/firebase/services/virtual-competitions';
import { WCA_EVENTS, getEvent } from '@/lib/wca-events';
import { useAuth } from '@/lib/auth-context';

// ─── Scramble helpers ─────────────────────────────────────────────────────────
// Maps WCA event IDs to Scrambow puzzle types. OH/BLD/MBF share their
// base puzzle's scramble type.
const SCRAMBOW_TYPE: Record<string, string> = {
  '333': '333', '222': '222', '444': '444', '555': '555',
  '666': '666', '777': '777',
  '333oh': '333', '333bf': '333', '444bf': '444', '555bf': '555',
  '333mbf': '333', '333fm': '333fm',
  'pyram': 'pyram', 'skewb': 'skewb', 'sq1': 'sq1',
  'clock': 'clock', 'minx': 'minx',
};

function generateScrambles(eventId: string, count: number): string[] {
  const type = SCRAMBOW_TYPE[eventId] ?? '333';
  try {
    return new Scrambow().setType(type).get(count).map((s) =>
      (s?.scramble_string ?? '').replace(/[ \t]+/g, ' ').trim(),
    );
  } catch {
    return Array(count).fill('');
  }
}

// ─── Round types / helpers ────────────────────────────────────────────────────

const FORMAT_SOLVE_COUNT: Record<string, number> = {
  avg5: 5, mo3: 3, bo3: 3, bo1: 1,
};

const FORMAT_LABELS: Record<string, string> = {
  avg5: 'Ao5', mo3: 'Mo3', bo3: 'Bo3', bo1: 'Bo1',
};

const ROUND_NAME_PRESETS: Record<number, string> = {
  1: 'First Round',
  2: 'Second Round',
  3: 'Semifinal',
  4: 'Final',
};

interface RoundFormState {
  roundNumber: number;
  roundName: string;
  format: 'avg5' | 'mo3' | 'bo1' | 'bo3';
  advancementType: 'fixed' | 'percentage' | 'final';
  advancementValue: number;
  scrambles: string[];
}

function emptyRoundForm(roundNumber: number): RoundFormState {
  const count = FORMAT_SOLVE_COUNT.avg5;
  return {
    roundNumber,
    roundName: ROUND_NAME_PRESETS[roundNumber] ?? `Round ${roundNumber}`,
    format: 'avg5',
    advancementType: 'final',
    advancementValue: 8,
    scrambles: Array(count).fill(''),
  };
}

function roundFormFromExisting(r: VirtualRound): RoundFormState {
  return {
    roundNumber: r.roundNumber,
    roundName: r.roundName,
    format: r.format,
    advancementType: r.advancementType,
    advancementValue: r.advancementValue ?? 8,
    scrambles: [...r.scrambles],
  };
}

function validateRoundForm(
  form: RoundFormState,
  eventId: string,
  allRounds: VirtualRound[],
  editingId: string | null,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (form.roundName.trim().length < 2) e.roundName = 'Нэр 2-оос дээш тэмдэгт байх ёстой';
  if (!Number.isInteger(form.roundNumber) || form.roundNumber < 1)
    e.roundNumber = 'Дугаар 1-ээс их бүхэл тоо байх ёстой';
  else if (allRounds.some((r) => r.eventId === eventId && r.roundNumber === form.roundNumber && r.id !== editingId))
    e.roundNumber = 'Энэ раунд дугаар аль хэдийн байна';
  if (form.scrambles.some((s) => !s.trim())) e.scrambles = 'Бүх холилтыг оруулна уу';
  if (form.advancementType !== 'final') {
    if (!form.advancementValue || form.advancementValue <= 0)
      e.advancementValue = 'Шилжилтийн утга 0-ээс их байна';
    if (form.advancementType === 'percentage' && form.advancementValue > 100)
      e.advancementValue = 'Хувь 100-аас хэтрэхгүй';
  }
  return e;
}

// ─── WCA Bulk Import Parser ───────────────────────────────────────────────────

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
  roundLabel: string;   // original label, e.g. "Final", "Second round"
  roundNumber: number;  // assigned after sorting by priority
  groups: ParsedGroup[];
  allScrambles: string[]; // all group main scrambles flattened
}

interface BulkParseResult {
  rounds: ParsedRound[];
  byEvent: Record<string, ParsedRound[]>; // eventId → rounds (sorted by roundNumber)
  parseErrors: string[];
  warnings: string[];   // event IDs found in import but not in competition's events
}

// Tries to match a line as a round header, e.g. "3x3x3 Cube Final"
function tryMatchEventHeader(
  line: string,
): { eventId: string; eventName: string; roundLabel: string } | null {
  const trimmed = line.trim();
  for (const [name, id] of WCA_EVENT_NAMES) {
    if (trimmed.startsWith(name)) {
      const rest = trimmed.slice(name.length).trim();
      // rest must be non-empty and not a bare number (to avoid false matches)
      if (rest.length > 0 && !/^\d+$/.test(rest)) {
        return { eventId: id, eventName: name, roundLabel: rest };
      }
    }
  }
  return null;
}

// Parses a scramble data line in tab-separated or space-separated WCA export format:
//   Tab:   "A\t1\tscramble"  |  "\t2\tscramble"  |  "\tExtra 1\tscramble"
//   Space: "A  1  scramble"  |  "   2  scramble"  |  "   Extra 1  scramble"
// Returns null when the line doesn't match.
function tryParseScrambleLine(line: string): {
  groupLetter: string | null;
  isExtra: boolean;
  scramble: string;
} | null {
  let groupLetter: string | null = null;
  let indexRaw: string;
  let scramble: string;

  if (line.includes('\t')) {
    // Tab-separated: col[0]=group letter or empty, col[1]=index, col[2+]=scramble
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
    // Space-separated: optional capital letter + 1+ spaces + (number | "Extra N") + 2+ spaces + scramble
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
//
// WCA exports are reverse-ordered (Final first, First round last), so each
// event's rounds are sorted by ROUND_PRIORITY after parsing and then assigned
// sequential 1-based round numbers (First round=1, Final=highest).
//
// competitionEvents is used only to populate the warnings list — rounds for
// events not in the competition are still parsed so the preview can flag them.
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
    if (/^Group\s+#\s+Scramble/i.test(line.trim())) continue; // skip column header

    const header = tryMatchEventHeader(line);
    if (header) {
      flushRound();
      cur = { ...header, groups: [] };
      continue;
    }

    if (!cur) continue;

    const parsed = tryParseScrambleLine(line);
    if (!parsed) continue;

    if (parsed.groupLetter) {
      // New group letter — flush previous group and start a new one
      flushGroup();
      curGroup = { name: parsed.groupLetter, scrambles: [], extraScrambles: [] };
    } else if (!curGroup) {
      // No group letter seen yet — implicit single group "A"
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

  // Group by event, sort by priority, assign 1-based round numbers
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
  const [collapsedEvents, setCollapsedEvents] = useState<Set<string>>(new Set());
  const [editingRound, setEditingRound] = useState<{
    eventId: string;
    roundId: string | null;
    form: RoundFormState;
  } | null>(null);
  const [roundSaving, setRoundSaving] = useState(false);
  const [roundErrors, setRoundErrors] = useState<Record<string, string>>({});
  const [roundDeleteConfirm, setRoundDeleteConfirm] = useState<{
    roundId: string;
    label: string;
  } | null>(null);

  // ── Bulk paste ───────────────────────────────────────────────────────────
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  // ── Subscriptions / effects ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeAllCompetitions((data) => {
      setComps(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Load rounds when a real comp is selected
  useEffect(() => {
    if (!selectedId || selectedId === 'new') {
      setRounds([]);
      setCollapsedEvents(new Set());
      return;
    }
    setRoundsLoading(true);
    getRounds(selectedId)
      .then((data) => { setRounds(data); setRoundsLoading(false); })
      .catch(() => setRoundsLoading(false));
  }, [selectedId]);

  // Close ⋮ menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler() { setMenuOpen(null); }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  // Toast auto-dismiss
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

  // ── Round handlers ───────────────────────────────────────────────────────
  function openAddRound(eventId: string) {
    const existing = rounds.filter((r) => r.eventId === eventId);
    const nextNum = existing.length > 0 ? Math.max(...existing.map((r) => r.roundNumber)) + 1 : 1;
    setEditingRound({ eventId, roundId: null, form: emptyRoundForm(nextNum) });
    setRoundErrors({});
  }

  function openEditRound(round: VirtualRound) {
    setEditingRound({ eventId: round.eventId, roundId: round.id, form: roundFormFromExisting(round) });
    setRoundErrors({});
  }

  function updateRoundForm(updates: Partial<RoundFormState>) {
    setEditingRound((prev) => prev ? { ...prev, form: { ...prev.form, ...updates } } : null);
  }

  function updateScramble(index: number, value: string) {
    setEditingRound((prev) => {
      if (!prev) return null;
      const scrambles = [...prev.form.scrambles];
      scrambles[index] = value;
      return { ...prev, form: { ...prev.form, scrambles } };
    });
  }

  function handleFormatChange(format: 'avg5' | 'mo3' | 'bo1' | 'bo3') {
    const newCount = FORMAT_SOLVE_COUNT[format];
    setEditingRound((prev) => {
      if (!prev) return null;
      const scrambles = Array.from({ length: newCount }, (_, i) => prev.form.scrambles[i] ?? '');
      return { ...prev, form: { ...prev.form, format, scrambles } };
    });
  }

  function handleGenerateScrambles() {
    if (!editingRound) return;
    const count = FORMAT_SOLVE_COUNT[editingRound.form.format] ?? 5;
    const generated = generateScrambles(editingRound.eventId, count);
    setEditingRound((prev) => prev ? { ...prev, form: { ...prev.form, scrambles: generated } } : null);
  }

  async function saveRound() {
    if (!editingRound || !selectedId) return;
    const errs = validateRoundForm(editingRound.form, editingRound.eventId, rounds, editingRound.roundId);
    setRoundErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setRoundSaving(true);
    try {
      const { form: f, eventId, roundId } = editingRound;
      const data = {
        eventId,
        roundNumber: f.roundNumber,
        roundName: f.roundName,
        format: f.format,
        advancementType: f.advancementType,
        ...(f.advancementType !== 'final' ? { advancementValue: f.advancementValue } : {}),
        scrambles: f.scrambles,
        historicalResults: rounds.find((r) => r.id === roundId)?.historicalResults ?? [],
      };

      if (roundId === null) {
        await addRound(selectedId, data);
        showToast('success', 'Раунд нэмэгдлээ');
      } else {
        await updateRound(selectedId, roundId, data);
        showToast('success', 'Раунд хадгалагдлаа');
      }
      setEditingRound(null);
      setCollapsedEvents((prev) => { const n = new Set(prev); n.delete(eventId); return n; });
      await refreshRounds();
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setRoundSaving(false); }
  }

  async function handleDeleteRound(roundId: string) {
    if (!selectedId) return;
    setRoundSaving(true);
    try {
      await svcDeleteRound(selectedId, roundId);
      showToast('success', 'Раунд устгагдлаа');
      setRoundDeleteConfirm(null);
      await refreshRounds();
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setRoundSaving(false); }
  }

  // Creates rounds from a bulk parse result. Only processes events that are in
  // the competition's selected events. Stores groups (when multiple exist) plus
  // a flat scrambles array for backwards-compatible display.
  async function handleBulkCreate(parseResult: BulkParseResult) {
    if (!selectedId || selectedId === 'new') return;
    setBulkSaving(true);
    let created = 0;
    try {
      for (const [eventId, eventRounds] of Object.entries(parseResult.byEvent)) {
        if (!form.events.includes(eventId)) continue;
        const maxRound = Math.max(...eventRounds.map((r) => r.roundNumber));
        for (const round of eventRounds) {
          const isFinal = round.roundNumber === maxRound;
          await addRound(selectedId, {
            eventId: round.eventId,
            roundNumber: round.roundNumber,
            roundName: round.roundLabel,
            format: 'avg5',
            advancementType: isFinal ? 'final' : 'fixed',
            advancementValue: isFinal ? undefined : 8,
            scrambles: round.allScrambles,
            groups: round.groups.length > 0 ? round.groups : undefined,
            historicalResults: [],
          });
          created++;
        }
      }
      showToast('success', `${created} раунд үүсгэгдэв`);
      setBulkPasteOpen(false);
      await refreshRounds();
    } catch (err) {
      showToast('error', 'Алдаа: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setBulkSaving(false); }
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

        {/* ── Rounds section (existing comps only) ── */}
        {!isNew && (
          <RoundsSection
            events={form.events}
            rounds={rounds}
            loading={roundsLoading}
            collapsedEvents={collapsedEvents}
            onToggleCollapse={(evId) =>
              setCollapsedEvents((prev) => { const n = new Set(prev); n.has(evId) ? n.delete(evId) : n.add(evId); return n; })
            }
            onAddRound={openAddRound}
            onEditRound={openEditRound}
            onDeleteRound={(r) => setRoundDeleteConfirm({ roundId: r.id, label: `R${r.roundNumber} · ${r.roundName}` })}
            onBulkPaste={() => setBulkPasteOpen(true)}
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

        {/* Round edit modal */}
        {editingRound && (
          <RoundModal
            eventId={editingRound.eventId}
            roundId={editingRound.roundId}
            form={editingRound.form}
            errors={roundErrors}
            saving={roundSaving}
            onFormChange={updateRoundForm}
            onFormatChange={handleFormatChange}
            onScrambleChange={updateScramble}
            onGenerateScrambles={handleGenerateScrambles}
            onSave={saveRound}
            onClose={() => setEditingRound(null)}
          />
        )}

        {/* Round delete modal */}
        {roundDeleteConfirm && (
          <ConfirmModal
            title="Раунд устгах"
            body={<><strong style={{ color: 'var(--text)' }}>{roundDeleteConfirm.label}</strong> раундыг устгахдаа итгэлтэй байна уу?</>}
            confirmLabel="Устгах"
            danger saving={roundSaving}
            onConfirm={() => handleDeleteRound(roundDeleteConfirm.roundId)}
            onCancel={() => setRoundDeleteConfirm(null)}
          />
        )}

        {/* Bulk paste modal */}
        {bulkPasteOpen && (
          <BulkPasteModal
            competitionEvents={form.events}
            saving={bulkSaving}
            onCreate={handleBulkCreate}
            onClose={() => setBulkPasteOpen(false)}
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

// ─── RoundsSection ────────────────────────────────────────────────────────────

function RoundsSection({
  events, rounds, loading, collapsedEvents,
  onToggleCollapse, onAddRound, onEditRound, onDeleteRound, onBulkPaste,
}: {
  events: string[];
  rounds: VirtualRound[];
  loading: boolean;
  collapsedEvents: Set<string>;
  onToggleCollapse: (eventId: string) => void;
  onAddRound: (eventId: string) => void;
  onEditRound: (round: VirtualRound) => void;
  onDeleteRound: (round: VirtualRound) => void;
  onBulkPaste: () => void;
}) {
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      {/* Card header with bulk paste button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          <span className="title-accent" />Раундууд
        </div>
        {!loading && events.length > 0 && (
          <button
            onClick={onBulkPaste}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.38rem 0.8rem', borderRadius: '8px',
              background: 'rgba(124,58,237,0.08)',
              border: '1px solid rgba(124,58,237,0.28)',
              color: '#a78bfa', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600,
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.16)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.08)')}
          >
            📋 Bulk paste
          </button>
        )}
      </div>

      {loading ? (
        <div className="spinner-row">Ачааллаж байна…<span className="spinner-ring" /></div>
      ) : events.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
          Төрөл сонгогдоогүй байна. Дээрх Үндсэн мэдээлэлд төрөл сонго.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {events.map((eventId) => {
            const ev = getEvent(eventId);
            const eventRounds = rounds
              .filter((r) => r.eventId === eventId)
              .sort((a, b) => a.roundNumber - b.roundNumber);
            const isCollapsed = collapsedEvents.has(eventId);

            return (
              <div key={eventId} style={{
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '10px', overflow: 'hidden',
              }}>
                {/* Event header row */}
                <button
                  onClick={() => onToggleCollapse(eventId)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.65rem 0.9rem', background: 'rgba(255,255,255,0.025)',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    color: 'var(--text)', textAlign: 'left',
                  }}
                >
                  <span style={{
                    display: 'inline-block', lineHeight: 1,
                    fontSize: '0.6rem', color: 'var(--muted)',
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                  }}>▼</span>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', flex: 1 }}>
                    {ev?.name ?? eventId}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)', flexShrink: 0 }}>
                    {eventRounds.length} раунд
                  </span>
                </button>

                {/* Rounds list */}
                {!isCollapsed && (
                  <div style={{ padding: '0.5rem 0.9rem 0.75rem' }}>
                    {eventRounds.length === 0 ? (
                      <div style={{ fontSize: '0.81rem', color: 'var(--muted)', fontStyle: 'italic', marginBottom: '0.55rem' }}>
                        Энэ төрөлд раунд байхгүй байна.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.55rem' }}>
                        {eventRounds.map((r) => (
                          <RoundCard key={r.id} round={r}
                            onEdit={() => onEditRound(r)}
                            onDelete={() => onDeleteRound(r)}
                          />
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => onAddRound(eventId)}
                      style={{
                        width: '100%', padding: '0.38rem 0.8rem',
                        borderRadius: '8px', cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600,
                        background: 'rgba(124,58,237,0.07)',
                        border: '1px dashed rgba(124,58,237,0.35)',
                        color: '#a78bfa', transition: 'background 0.12s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.14)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.07)')}
                    >
                      + Шинэ раунд нэмэх
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── RoundCard ────────────────────────────────────────────────────────────────

function RoundCard({
  round, onEdit, onDelete,
}: {
  round: VirtualRound;
  onEdit: () => void;
  onDelete: () => void;
}) {
  function advText() {
    if (round.advancementType === 'final') return 'Эцсийн раунд';
    if (round.advancementType === 'fixed') return `${round.advancementValue} хүн шилжинэ`;
    return `${round.advancementValue}% шилжинэ`;
  }

  const groupCount = round.groups?.length ?? 0;
  const scrambleCount = groupCount > 0
    ? round.groups!.reduce((sum, g) => sum + g.scrambles.length, 0)
    : round.scrambles.length;
  const groupLabel = groupCount > 1 ? `${groupCount} груп · ` : '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.5rem 0.65rem',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.065)',
      borderRadius: '8px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text)' }}>
          Раунд {round.roundNumber} · {round.roundName}
        </div>
        <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginTop: '0.1rem' }}>
          <span style={{
            display: 'inline-block', padding: '0.05rem 0.35rem',
            background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: '4px', fontSize: '0.68rem', fontWeight: 700, marginRight: '0.35rem',
          }}>
            {FORMAT_LABELS[round.format] ?? round.format}
          </span>
          {advText()} · {groupLabel}{scrambleCount} холилт
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
        <button className="btn-edit" onClick={onEdit}>Засах</button>
        <button className="btn-delete" onClick={onDelete}>Устгах</button>
      </div>
    </div>
  );
}

// ─── RoundModal ───────────────────────────────────────────────────────────────

function RoundModal({
  eventId, roundId, form, errors, saving,
  onFormChange, onFormatChange, onScrambleChange, onGenerateScrambles, onSave, onClose,
}: {
  eventId: string;
  roundId: string | null;
  form: RoundFormState;
  errors: Record<string, string>;
  saving: boolean;
  onFormChange: (updates: Partial<RoundFormState>) => void;
  onFormatChange: (format: 'avg5' | 'mo3' | 'bo1' | 'bo3') => void;
  onScrambleChange: (index: number, value: string) => void;
  onGenerateScrambles: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const ev = getEvent(eventId);
  const solveCount = FORMAT_SOLVE_COUNT[form.format] ?? 5;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '2rem 1rem',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card, #1a1730)',
          border: '1px solid rgba(124,58,237,0.3)',
          borderRadius: '14px', padding: '1.5rem',
          width: '100%', maxWidth: '520px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          marginBottom: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.3rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>
              {roundId ? 'Раунд засах' : 'Шинэ раунд нэмэх'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
              {ev?.name ?? eventId}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '7px', color: 'var(--muted)', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1, padding: '0.3rem 0.6rem',
          }}>✕</button>
        </div>

        {/* Number + Name */}
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '0.75rem', marginBottom: '0.85rem' }}>
          <div className="form-group">
            <label style={FIELD_LABEL_STYLE}>Дугаар</label>
            <input type="number" min={1} step={1} value={form.roundNumber}
              onChange={(e) => onFormChange({ roundNumber: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              style={errors.roundNumber ? { borderColor: 'rgba(239,68,68,0.7)' } : {}} />
            {errors.roundNumber && <FieldError text={errors.roundNumber} />}
          </div>
          <div className="form-group">
            <label style={FIELD_LABEL_STYLE}>Нэр</label>
            <input type="text" value={form.roundName} placeholder="First Round"
              onChange={(e) => onFormChange({ roundName: e.target.value })}
              style={errors.roundName ? { borderColor: 'rgba(239,68,68,0.7)' } : {}} />
            {errors.roundName && <FieldError text={errors.roundName} />}
          </div>
        </div>

        {/* Format */}
        <div className="form-group" style={{ marginBottom: '0.85rem' }}>
          <label style={FIELD_LABEL_STYLE}>Формат</label>
          <select value={form.format}
            onChange={(e) => onFormatChange(e.target.value as 'avg5' | 'mo3' | 'bo1' | 'bo3')}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.5rem 0.75rem', borderRadius: '8px',
              background: 'var(--input-bg, rgba(255,255,255,0.04))',
              border: '1px solid var(--input-border, rgba(255,255,255,0.1))',
              color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.88rem',
            }}>
            <option value="avg5">Ao5 — Average of 5 (5 холилт)</option>
            <option value="mo3">Mo3 — Mean of 3 (3 холилт)</option>
            <option value="bo3">Bo3 — Best of 3 (3 холилт)</option>
            <option value="bo1">Bo1 — Best of 1 (1 холилт)</option>
          </select>
        </div>

        {/* Advancement */}
        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <label style={FIELD_LABEL_STYLE}>Шилжилт</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.3rem' }}>
            {([
              { type: 'final',      label: 'Эцсийн раунд (шилжилт байхгүй)', suffix: null },
              { type: 'fixed',      label: 'Тооны хязгаар',                  suffix: 'хүн' },
              { type: 'percentage', label: 'Хувь',                           suffix: '%' },
            ] as const).map(({ type, label, suffix }) => (
              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="radio" name="adv" checked={form.advancementType === type}
                  onChange={() => onFormChange({ advancementType: type })}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ fontSize: '0.85rem', flex: 1 }}>{label}</span>
                {type !== 'final' && form.advancementType === type && (
                  <>
                    <input type="number" min={1} max={type === 'percentage' ? 100 : 9999}
                      value={form.advancementValue}
                      onChange={(e) => onFormChange({ advancementValue: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      style={{
                        width: '4.5rem', padding: '0.22rem 0.4rem', borderRadius: '6px', textAlign: 'center',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                        color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.85rem',
                      }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)', flexShrink: 0 }}>{suffix}</span>
                  </>
                )}
              </label>
            ))}
          </div>
          {errors.advancementValue && <FieldError text={errors.advancementValue} />}
        </div>

        {/* Scrambles */}
        <div className="form-group" style={{ marginBottom: '1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
            <label style={FIELD_LABEL_STYLE}>Холилтууд ({solveCount} ширхэг)</label>
            <button type="button" onClick={onGenerateScrambles}
              style={{
                background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)',
                borderRadius: '6px', color: '#a78bfa', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '0.75rem', fontWeight: 600,
                padding: '0.18rem 0.6rem', transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(124,58,237,0.1)')}>
              ⟳ Үүсгэх scramble
            </button>
          </div>
          {errors.scrambles && <FieldError text={errors.scrambles} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {Array.from({ length: solveCount }, (_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                <span style={{
                  width: '1.2rem', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700,
                  color: 'var(--muted)', lineHeight: '2rem', textAlign: 'right',
                }}>
                  {i + 1}
                </span>
                <textarea
                  value={form.scrambles[i] ?? ''}
                  onChange={(e) => onScrambleChange(i, e.target.value)}
                  rows={2}
                  placeholder={`Холилт ${i + 1}…`}
                  style={{
                    flex: 1, padding: '0.38rem 0.55rem', borderRadius: '6px',
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${errors.scrambles && !(form.scrambles[i] ?? '').trim()
                      ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.77rem',
                    resize: 'vertical', outline: 'none', lineHeight: 1.55,
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <button className="btn-sm-primary" onClick={onSave} disabled={saving}
          style={{ width: '100%' }}>
          {saving ? 'Хадгалж байна...' : roundId ? 'Хадгалах' : 'Раунд үүсгэх'}
        </button>
      </div>
    </div>
  );
}

// ─── BulkPasteModal ───────────────────────────────────────────────────────────

function BulkPasteModal({
  competitionEvents,
  saving,
  onCreate,
  onClose,
}: {
  competitionEvents: string[];
  saving: boolean;
  onCreate: (result: BulkParseResult) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [text, setText] = useState('');
  const [parseResult, setParseResult] = useState<BulkParseResult | null>(null);

  function handleParse() {
    if (!text.trim()) return;
    const result = parseWcaExport(text, competitionEvents);
    setParseResult(result);
    if (result.rounds.length > 0) setStep('preview');
  }

  const MODAL_STYLE: React.CSSProperties = {
    background: 'var(--card, #1a1730)',
    border: '1px solid rgba(124,58,237,0.3)',
    borderRadius: '14px', padding: '1.5rem',
    width: '100%', maxWidth: '600px',
    boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
    marginBottom: 'auto',
  };

  const OVERLAY_STYLE: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1100,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '2rem 1rem', overflowY: 'auto',
  };

  if (step === 'input') {
    const hasError = parseResult?.parseErrors && parseResult.parseErrors.length > 0 && parseResult.rounds.length === 0;

    return (
      <div onClick={onClose} style={OVERLAY_STYLE}>
        <div onClick={(e) => e.stopPropagation()} style={MODAL_STYLE}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Bulk paste — Тэмцээний холилтыг оруулах</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
                WCA export format-аар бүх төрөл, раунд, группын холилтыг хуулж энд тавина.
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '7px', color: 'var(--muted)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1, padding: '0.3rem 0.6rem',
              flexShrink: 0, marginLeft: '0.75rem',
            }}>✕</button>
          </div>

          {/* Textarea */}
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setParseResult(null); }}
            rows={14}
            placeholder={
              '3x3x3 Cube Final\nGroup\t#\tScramble\nA\t1\tF U2 F D L2 D R D\' U2 F U2 R2 B2 U2 B L2 F U2 L\'\n\t2\tD2 L\' F\' R2 F\' D2 R2 B2 U2 F D\' R B L\' R D\' L U\' R\n...\n\n3x3x3 Cube Second round\n...'
            }
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.65rem 0.75rem', borderRadius: '8px',
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${hasError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
              color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.77rem',
              resize: 'vertical', outline: 'none', lineHeight: 1.6,
              marginBottom: '0.65rem',
            }}
          />

          {hasError && parseResult?.parseErrors.map((err, i) => (
            <div key={i} style={{
              padding: '0.55rem 0.75rem', borderRadius: '7px', marginBottom: '0.65rem',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171', fontSize: '0.82rem', lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>{err}</div>
          ))}

          <button
            onClick={handleParse}
            disabled={!text.trim()}
            style={{
              width: '100%', padding: '0.55rem 1rem', borderRadius: '8px',
              fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 700,
              background: text.trim() ? 'rgba(124,58,237,0.7)' : 'rgba(124,58,237,0.2)',
              border: '1px solid rgba(124,58,237,0.9)',
              color: text.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
              cursor: text.trim() ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            Шинжлэх →
          </button>
        </div>
      </div>
    );
  }

  // ── Preview step ──────────────────────────────────────────────────────────
  const result = parseResult!;
  const totalRoundsToCreate = Object.entries(result.byEvent)
    .filter(([eventId]) => competitionEvents.includes(eventId))
    .reduce((sum, [, rounds]) => sum + rounds.length, 0);

  return (
    <div onClick={onClose} style={OVERLAY_STYLE}>
      <div onClick={(e) => e.stopPropagation()} style={MODAL_STYLE}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.1rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Шинжлэлийн үр дүн</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
              {totalRoundsToCreate} раунд үүсгэгдэнэ
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '7px', color: 'var(--muted)', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1, padding: '0.3rem 0.6rem',
            flexShrink: 0, marginLeft: '0.75rem',
          }}>✕</button>
        </div>

        {/* Per-event preview rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.2rem' }}>

          {/* Events in competition */}
          {competitionEvents.map((eventId) => {
            const ev = getEvent(eventId);
            const evName = ev?.name ?? eventId;
            const evRounds = result.byEvent[eventId];

            if (!evRounds || evRounds.length === 0) {
              return (
                <div key={eventId} style={{
                  padding: '0.6rem 0.8rem', borderRadius: '8px',
                  background: 'rgba(245,158,11,0.07)',
                  border: '1px solid rgba(245,158,11,0.2)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span style={{ fontSize: '0.9rem' }}>⚠</span>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fbbf24' }}>
                      {evName}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>— олдсонгүй</span>
                  </div>
                </div>
              );
            }

            return (
              <div key={eventId} style={{
                padding: '0.6rem 0.8rem', borderRadius: '8px',
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>✅</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#4ade80' }}>
                    {evName}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    — {evRounds.length} раунд олдлоо
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', paddingLeft: '1.55rem' }}>
                  {evRounds.map((r) => {
                    const groupCount = r.groups.length;
                    const groupLabel = groupCount > 1 ? `${groupCount} груп, ` : '';
                    const extraCount = r.groups.reduce((sum, g) => sum + g.extraScrambles.length, 0);
                    const extraLabel = extraCount > 0 ? ` + ${extraCount} extra` : '';
                    return (
                      <div key={r.roundNumber} style={{ fontSize: '0.79rem', color: 'var(--muted)' }}>
                        • {r.roundLabel} ({groupLabel}{r.allScrambles.length} холилт{extraLabel})
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Events found in import but not in competition */}
          {result.warnings.map((eventId) => {
            const ev = getEvent(eventId);
            const evName = ev?.name ?? eventId;
            const evRounds = result.byEvent[eventId] ?? [];
            return (
              <div key={`extra-${eventId}`} style={{
                padding: '0.6rem 0.8rem', borderRadius: '8px',
                background: 'rgba(100,116,139,0.08)',
                border: '1px solid rgba(100,116,139,0.2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>ℹ</span>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#94a3b8' }}>
                    {evName}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    — {evRounds.length} раунд · тэмцээнд байхгүй тул оруулагдахгүй
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button
            onClick={() => setStep('input')}
            style={{
              flex: 1, padding: '0.5rem 1rem', borderRadius: '8px',
              fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text)', cursor: 'pointer',
            }}
          >
            ← Буцах
          </button>
          <button
            onClick={() => onCreate(result)}
            disabled={saving || totalRoundsToCreate === 0}
            style={{
              flex: 2, padding: '0.5rem 1rem', borderRadius: '8px',
              fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 700,
              background: totalRoundsToCreate > 0 && !saving
                ? 'rgba(34,197,94,0.7)' : 'rgba(34,197,94,0.2)',
              border: '1px solid rgba(34,197,94,0.8)',
              color: totalRoundsToCreate > 0 && !saving ? '#fff' : 'rgba(255,255,255,0.3)',
              cursor: totalRoundsToCreate > 0 && !saving ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Үүсгэж байна...' : `✓ Үүсгэх (${totalRoundsToCreate} раунд)`}
          </button>
        </div>
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

// ─── Style constants ──────────────────────────────────────────────────────────

const FIELD_LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--muted)',
  display: 'block', marginBottom: '0.35rem',
};
