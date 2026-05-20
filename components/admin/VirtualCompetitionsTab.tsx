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

    if (parsed.groupLetter) {
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

        {/* ── Scramble section (existing comps only) ── */}
        {!isNew && (
          <ScrambleSection
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

// ─── ScrambleSection ──────────────────────────────────────────────────────────

function ScrambleSection({
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
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="card-title" style={{ marginBottom: '1rem' }}>
        <span className="title-accent" />Холилт оруулах
      </div>

      {loading ? (
        <div className="spinner-row">Ачааллаж байна…<span className="spinner-ring" /></div>
      ) : events.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
          Төрөл сонгогдоогүй байна. Дээрх Үндсэн мэдээлэлд төрөл сонго.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {events.map((eventId) => (
            <EventPasteSection
              key={eventId}
              eventId={eventId}
              compId={compId}
              existingRounds={rounds.filter((r) => r.eventId === eventId)}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── EventPasteSection ────────────────────────────────────────────────────────

function EventPasteSection({
  eventId,
  compId,
  existingRounds,
  onRefresh,
  onToast,
}: {
  eventId: string;
  compId: string;
  existingRounds: VirtualRound[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', text: string) => void;
}) {
  const ev = getEvent(eventId);

  // Collapsed when no rounds (nothing to show), expanded when rounds exist
  const [collapsed, setCollapsed] = useState(existingRounds.length === 0);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preview'>('idle');
  const [parsedRounds, setParsedRounds] = useState<ParsedRound[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Results paste state ──────────────────────────────────────────────────
  const [resultsText, setResultsText] = useState('');
  const [resultsPhase, setResultsPhase] = useState<'idle' | 'preview'>('idle');
  const [parsedResultsByLabel, setParsedResultsByLabel] = useState<Record<string, HistoricalResult[]>>({});
  const [resultsParseError, setResultsParseError] = useState<string | null>(null);
  const [resultsSaving, setResultsSaving] = useState(false);
  const [confirmResultsReplace, setConfirmResultsReplace] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

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

  const sortedRounds = [...existingRounds].sort((a, b) => a.roundNumber - b.roundNumber);

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', overflow: 'visible' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.025)', borderRadius: collapsed ? '10px' : '10px 10px 0 0' }}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: '0.55rem',
            padding: '0.65rem 0.9rem', background: 'none',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            color: 'var(--text)', textAlign: 'left',
          }}
        >
          <span style={{
            display: 'inline-block', lineHeight: 1,
            fontSize: '0.6rem', color: 'var(--muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}>▼</span>
          <span style={{ fontWeight: 700, fontSize: '0.88rem', flex: 1 }}>
            {ev?.name ?? eventId}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', flexShrink: 0 }}>
            {existingRounds.length} раунд
          </span>
        </button>
        {existingRounds.length > 0 && (
          <div ref={menuRef} style={{ position: 'relative', marginRight: '0.6rem' }} onPointerDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => setMenuOpen((p) => !p)}
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '7px', color: 'var(--muted)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: 1, padding: '0.25rem 0.5rem',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
            >
              ⋮
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200,
                background: 'var(--card, #1e1b2e)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '10px', padding: '0.3rem', boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                minWidth: '145px',
              }}>
                <MenuAction
                  label="Бүгдийг устгах"
                  onClick={() => { setMenuOpen(false); setConfirmDeleteAll(true); }}
                  color="#f87171"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: '0.75rem 0.9rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Existing rounds list (idle phase only) */}
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

          {/* Paste area (idle phase) */}
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

          {/* Preview phase */}
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

          {/* ── Results section ── */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: '1rem', paddingTop: '0.85rem' }}>
            <div style={{
              fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.65rem',
            }}>
              Үр дүн
            </div>

            {existingRounds.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                Эхлээд холилт оруулна уу
              </div>
            ) : (
              <>
                {/* Existing results summary (idle phase) */}
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

                {/* Textarea (idle phase) */}
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

                {/* Preview phase */}
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
