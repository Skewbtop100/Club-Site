import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DEFAULT_COMPETITION_FORMAT } from './types';
import { validateQualifierInput } from './rounds';
import { RESULT_FORMATS, cutoffPhaseFor, resolveResultFormat, type ResultFormat } from './ao5';
import { parseVideoUrl } from './video-url';
import { MAX_BLOCKS_PER_SECTION, MAX_SCHEDULE_ENTRIES, MAX_SECTIONS } from './types';
import type { OnlineCompetitionAdvancement, OnlineCompetitionCutoff } from './types';
import type {
  OnlineCompetitionBlock,
  OnlineCompetitionBlockType,
  OnlineCompetitionScheduleEntry,
  OnlineCompetitionScheduleKind,
  OnlineCompetitionSection,
} from './types';
import type { OnlineCompetitionEventConfig, OnlineCompetitionStatus, OnlineCompetitionWriteInput } from './types';

// Server-only validation + Firestore-doc-shaping helpers shared by
// app/api/online-competition/admin-competitions/route.ts (list, create)
// and .../admin-competitions/[id]/route.ts (get, update). The admin
// create/edit form does its own client-side validation with Mongolian
// error messages (app/online-competition/admin/_components/
// CompetitionEditor.tsx) — this is a lighter server-side sanity check
// against a malformed/malicious payload, not a duplicate of every UI rule.

// MUST list every member of OnlineCompetitionStatus. A value missing here
// is not rejected — normalizeCompetitionStatus below falls through to
// 'upcoming', so omitting 'draft' would make a draft competition read back
// as a public one. Kept in step with the identical list in data.ts (the
// client half, deliberately duplicated — this file imports firebase-admin)
// and with STATUS_OPTIONS in the admin form.
const VALID_STATUSES: OnlineCompetitionStatus[] = ['draft', 'upcoming', 'live', 'finished'];

export type ValidationResult =
  | { ok: true; data: OnlineCompetitionWriteInput }
  | { ok: false; error: string };

/** Validates one event's planned advancement rows.
 *
 *  The method/value rules are NOT restated here — validateQualifierInput
 *  (rounds.ts) is the same function the qualify route validates a real cut
 *  with, so a plan that would be rejected at qualify time is rejected at
 *  save time, in the same words. Only the two things it cannot know are
 *  checked locally: that the method is one of the two, and that fromRound
 *  is a transition this event actually has.
 *
 *  Absent/empty is valid — a single-round event has no transitions, and a
 *  competition created before this field existed has none stored. */
function parseAdvancement(
  raw: unknown,
  rounds: number,
): { ok: true; value: OnlineCompetitionAdvancement[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'advancement must be an array' };

  const out: OnlineCompetitionAdvancement[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'invalid advancement entry' };
    const a = entry as Record<string, unknown>;

    if (a.method !== 'count' && a.method !== 'percent') {
      return { ok: false, error: 'invalid advancement method' };
    }
    if (typeof a.value !== 'number') {
      return { ok: false, error: 'advancement value must be a number' };
    }
    // The qualify route's own rules: > 0, integer for a count, <= 100 for
    // a percent. Its Mongolian message is passed straight through.
    const invalid = validateQualifierInput(a.method, a.value);
    if (invalid) return { ok: false, error: invalid };

    // A transition cuts FROM round N INTO round N+1, so the last round an
    // event has cannot be a `fromRound` — there is nothing after it.
    if (typeof a.fromRound !== 'number' || !Number.isInteger(a.fromRound)) {
      return { ok: false, error: 'advancement fromRound must be an integer' };
    }
    if (a.fromRound < 1 || a.fromRound > rounds - 1) {
      return { ok: false, error: `advancement fromRound ${a.fromRound} is out of range for ${rounds} round(s)` };
    }
    if (seen.has(a.fromRound)) {
      return { ok: false, error: `duplicate advancement for round ${a.fromRound}` };
    }
    seen.add(a.fromRound);

    out.push({ fromRound: a.fromRound, method: a.method, value: a.value });
  }

  out.sort((x, y) => x.fromRound - y.fromRound);
  return { ok: true, value: out };
}

/** Validates one event's per-round cutoffs.
 *
 *  Refused when the format has no established cutoff phase (see
 *  cutoffPhaseFor) — storing a cutoff the scorer will ignore is worse than
 *  refusing it, because the admin would believe a round was gated when it
 *  was not. */
function parseCutoffs(
  raw: unknown,
  rounds: number,
  format: ResultFormat,
): { ok: true; value: OnlineCompetitionCutoff[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'cutoffs must be an array' };
  if (raw.length > 0 && cutoffPhaseFor(format) === null) {
    return { ok: false, error: `cutoff is not supported for format ${format}` };
  }

  const out: OnlineCompetitionCutoff[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'invalid cutoff entry' };
    const c = entry as Record<string, unknown>;
    if (typeof c.round !== 'number' || !Number.isInteger(c.round) || c.round < 1 || c.round > rounds) {
      return { ok: false, error: `cutoff round ${String(c.round)} is out of range for ${rounds} round(s)` };
    }
    if (typeof c.cutoffCs !== 'number' || !Number.isInteger(c.cutoffCs) || c.cutoffCs <= 0) {
      return { ok: false, error: 'cutoffCs must be a positive integer' };
    }
    if (seen.has(c.round)) return { ok: false, error: `duplicate cutoff for round ${c.round}` };
    seen.add(c.round);
    out.push({ round: c.round, cutoffCs: c.cutoffCs });
  }
  out.sort((a, b) => a.round - b.round);
  return { ok: true, value: out };
}

// ── sections[] / sections[].blocks[] ───────────────────────
// This is the third nested structure to go through validateCompetitionInput,
// and the field-by-field rebuild above has now silently dropped a field
// TWICE (advancement, then nearly resultFormat). A nested structure doubles
// the surface: a dropped section field and a dropped block field are two
// separate ways to lose data with no error.
//
// So this pair does NOT rebuild by naming fields inline. Both levels are
// driven by a MANIFEST of allowed keys, and a key that is not in the
// manifest is a REJECTED WRITE, not a dropped field. That inverts the
// trap: the failure mode of forgetting to list a new field is now a loud
// 400 at save time — the admin sees it, and so does whoever added the
// field — instead of a value that vanishes on reload with no trace.
//
// Adding a block field means adding it to BLOCK_PAYLOAD_FIELDS and to
// OnlineCompetitionBlock. Forget the first and the save fails loudly;
// forget the second and tsc fails. There is no quiet path.

/** Every key a SECTION may carry. Anything else is refused. */
const SECTION_FIELDS = ['id', 'title', 'blocks'] as const;

/** Every key a BLOCK may carry, keyed by type, PLUS how each is parsed.
 *  `required` payload fields must be present and non-empty; optional ones
 *  may be absent. A key belonging to a DIFFERENT type is what makes a
 *  block "type does not match its payload" — checked against the union of
 *  all types' fields, so {type:'text', videoUrl:...} is refused rather
 *  than quietly stored with an ignored videoUrl. */
const BLOCK_PAYLOAD_FIELDS: Record<
  OnlineCompetitionBlockType,
  { key: 'text' | 'imageUrl' | 'imagePublicId' | 'videoUrl'; required: boolean }[]
> = {
  // '' is legal for text: a block added and not yet typed into renders as
  // nothing and is a normal intermediate state. An image or video block
  // with no payload is NOT — it is a slot that can never render — so
  // those are required and non-empty.
  text: [{ key: 'text', required: true }],
  image: [
    { key: 'imageUrl', required: true },
    { key: 'imagePublicId', required: false },
  ],
  video: [{ key: 'videoUrl', required: true }],
};

const BLOCK_TYPES = Object.keys(BLOCK_PAYLOAD_FIELDS) as OnlineCompetitionBlockType[];
/** Union of every payload key across every type — the "does this block
 *  carry another type's payload" test. Derived, never restated. */
const ALL_PAYLOAD_KEYS = new Set<string>(BLOCK_TYPES.flatMap((t) => BLOCK_PAYLOAD_FIELDS[t].map((f) => f.key)));

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Non-empty string after trimming, or null. */
function requiredString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function parseBlock(raw: unknown, where: string): ParseResult<OnlineCompetitionBlock> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${where}: invalid block` };
  }
  const b = raw as Record<string, unknown>;

  const type = b.type;
  if (typeof type !== 'string' || !BLOCK_TYPES.includes(type as OnlineCompetitionBlockType)) {
    return { ok: false, error: `${where}: unknown block type ${JSON.stringify(b.type)}` };
  }
  const blockType = type as OnlineCompetitionBlockType;

  const id = requiredString(b.id);
  if (id === null) return { ok: false, error: `${where}: block id is required` };

  const allowed = BLOCK_PAYLOAD_FIELDS[blockType];
  const allowedKeys = new Set<string>(['id', 'type', ...allowed.map((f) => f.key)]);
  for (const key of Object.keys(b)) {
    // undefined is how a client spells an absent optional; treat a key
    // explicitly set to undefined as absent rather than as junk.
    if (b[key] === undefined) continue;
    if (allowedKeys.has(key)) continue;
    // A payload key belonging to another type is the "type does not match
    // its payload" case, and says so in those words.
    if (ALL_PAYLOAD_KEYS.has(key)) {
      return { ok: false, error: `${where}: a ${blockType} block cannot carry ${key}` };
    }
    return { ok: false, error: `${where}: unknown block field ${key}` };
  }

  // Built key by key FROM THE MANIFEST — the only place a payload field is
  // written, so there is no second list to keep in step. Absent optionals
  // are left off entirely rather than set to undefined: Firestore refuses
  // an undefined value, and `imagePublicId` in the document would then be
  // a key that sometimes exists holding nothing.
  const out: OnlineCompetitionBlock = { id, type: blockType };
  for (const field of allowed) {
    const value = b[field.key];
    if (value === undefined || value === null) {
      if (field.required) return { ok: false, error: `${where}: a ${blockType} block requires ${field.key}` };
      continue;
    }
    if (typeof value !== 'string') return { ok: false, error: `${where}: ${field.key} must be a string` };
    // `text` is the one field allowed to be empty, and is stored VERBATIM
    // — trimming an admin's paragraph would eat their deliberate spacing.
    if (field.key === 'text') {
      out.text = value;
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      if (field.required) return { ok: false, error: `${where}: a ${blockType} block requires ${field.key}` };
      continue;
    }
    if (field.key === 'videoUrl') {
      // The SAME parser the editor shows the id back with, so a url the
      // editor accepted can never be refused here, or the reverse.
      if (parseVideoUrl(trimmed) === null) {
        return { ok: false, error: `${where}: ${trimmed} is not a YouTube or Vimeo video url` };
      }
      out.videoUrl = trimmed;
      continue;
    }
    if (field.key === 'imageUrl') out.imageUrl = trimmed;
    if (field.key === 'imagePublicId') out.imagePublicId = trimmed;
  }
  return { ok: true, value: out };
}

/** Absent/null/[] -> []. Every other malformation is refused. */
function parseSections(raw: unknown): ParseResult<OnlineCompetitionSection[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'sections must be an array' };
  if (raw.length > MAX_SECTIONS) {
    return { ok: false, error: `at most ${MAX_SECTIONS} sections are allowed (got ${raw.length})` };
  }

  const out: OnlineCompetitionSection[] = [];
  const seenSectionIds = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const where = `section ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `${where}: invalid section` };
    }
    const sec = entry as Record<string, unknown>;
    for (const key of Object.keys(sec)) {
      if (sec[key] === undefined) continue;
      if (!(SECTION_FIELDS as readonly string[]).includes(key)) {
        return { ok: false, error: `${where}: unknown section field ${key}` };
      }
    }

    const id = requiredString(sec.id);
    if (id === null) return { ok: false, error: `${where}: section id is required` };
    // Duplicate ids would make two sections one identity: React renders
    // them under one key, and a reorder would move whichever it found
    // first — the exact failure ids exist to prevent.
    if (seenSectionIds.has(id)) return { ok: false, error: `${where}: duplicate section id ${id}` };
    seenSectionIds.add(id);

    const title = requiredString(sec.title);
    if (title === null) return { ok: false, error: `${where}: section title is required` };

    const rawBlocks = sec.blocks;
    if (rawBlocks !== undefined && rawBlocks !== null && !Array.isArray(rawBlocks)) {
      return { ok: false, error: `${where}: blocks must be an array` };
    }
    const blockList: unknown[] = Array.isArray(rawBlocks) ? rawBlocks : [];
    if (blockList.length > MAX_BLOCKS_PER_SECTION) {
      return {
        ok: false,
        error: `${where}: at most ${MAX_BLOCKS_PER_SECTION} blocks are allowed (got ${blockList.length})`,
      };
    }

    const blocks: OnlineCompetitionBlock[] = [];
    const seenBlockIds = new Set<string>();
    for (const [bIndex, rawBlock] of blockList.entries()) {
      const parsed = parseBlock(rawBlock, `${where} block ${bIndex + 1}`);
      if (!parsed.ok) return parsed;
      if (seenBlockIds.has(parsed.value.id)) {
        return { ok: false, error: `${where}: duplicate block id ${parsed.value.id}` };
      }
      seenBlockIds.add(parsed.value.id);
      blocks.push(parsed.value);
    }

    // ARRAY ORDER IS THE ORDER, at both levels. Nothing is sorted here —
    // unlike advancement and cutoffs, which have a natural key to sort by,
    // the admin's chosen order is the only order there is, and sorting
    // would silently rearrange their page.
    out.push({ id, title, blocks });
  }
  return { ok: true, value: out };
}

/** Stored sections, read defensively for the two GET mappers.
 *
 *  The mirror of parseSections, and deliberately the OPPOSITE stance: a
 *  write is refused when it is malformed, but a READ must never 500 on a
 *  document — hand-edited, half-migrated or written by an older client —
 *  or the admin cannot open the competition to fix it. So this DROPS what
 *  it cannot understand instead of throwing, and supplies a positional
 *  fallback id for a section or block stored without one.
 *
 *  That fallback is deterministic (`s2`, `s2-b3`) rather than random: the
 *  editor saves back whatever it read, and a fresh random id on every GET
 *  would make each save look like a wholesale replacement of the page. */
export function normalizeStoredSections(raw: unknown): OnlineCompetitionSection[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionSection[] = [];
  for (const [index, entry] of (raw as unknown[]).entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const sec = entry as Record<string, unknown>;
    const title = typeof sec.title === 'string' ? sec.title : '';
    // A section with no title cannot be shown as a tab and cannot be saved
    // back (the title is required), so it is dropped rather than handed to
    // the editor as an unsaveable row.
    if (!title.trim()) continue;
    const id = typeof sec.id === 'string' && sec.id.trim() ? sec.id.trim() : `s${index + 1}`;

    const blocks: OnlineCompetitionBlock[] = [];
    const rawBlocks = Array.isArray(sec.blocks) ? (sec.blocks as unknown[]) : [];
    for (const [bIndex, rawBlock] of rawBlocks.entries()) {
      if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) continue;
      const b = rawBlock as Record<string, unknown>;
      if (typeof b.type !== 'string' || !BLOCK_TYPES.includes(b.type as OnlineCompetitionBlockType)) continue;
      const type = b.type as OnlineCompetitionBlockType;
      const block: OnlineCompetitionBlock = {
        id: typeof b.id === 'string' && b.id.trim() ? b.id.trim() : `${id}-b${bIndex + 1}`,
        type,
      };
      // Same manifest the write path uses, so a field readable here is a
      // field writable there — one list, two directions.
      for (const field of BLOCK_PAYLOAD_FIELDS[type]) {
        const value = b[field.key];
        if (typeof value !== 'string') continue;
        if (field.key === 'text') block.text = value;
        else if (field.key === 'imageUrl') block.imageUrl = value;
        else if (field.key === 'imagePublicId') block.imagePublicId = value;
        else if (field.key === 'videoUrl') block.videoUrl = value;
      }
      // A media block whose payload did not survive is a slot that renders
      // nothing; a text block legitimately has none yet.
      if (type === 'image' && !block.imageUrl) continue;
      if (type === 'video' && !block.videoUrl) continue;
      if (type === 'text' && block.text === undefined) block.text = '';
      blocks.push(block);
    }
    out.push({ id, title, blocks });
  }
  return out;
}

/** Stored events, read defensively for the two GET mappers.
 *
 *  Lived in BOTH route files as an identical copy until the fee fields
 *  landed — which meant the field-by-field rebuild trap had FOUR sites
 *  per per-event field (two writers' worth of validate + two readers'
 *  worth of this), and the two readers are the pair the compiler cannot
 *  help with, since every field on OnlineCompetitionEventConfig is
 *  optional for legacy docs. One copy, imported twice.
 *
 *  Read-side stance, the same as normalizeStoredSections: coerce and
 *  default rather than refuse, because a GET that 500s on an odd document
 *  is a document the admin cannot open to fix. */
export function normalizeStoredEvents(raw: unknown): OnlineCompetitionEventConfig[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((e) => ({
    eventId: typeof e?.eventId === 'string' ? e.eventId : '',
    label: typeof e?.label === 'string' ? e.label : '',
    rounds: typeof e?.rounds === 'number' ? e.rounds : 1,
    resultFormat: resolveResultFormat(e?.resultFormat),
    // null = no limit. Never defaulted to a real value.
    timeLimitCs: typeof e?.timeLimitCs === 'number' ? e.timeLimitCs : null,
    // Per-round cutoffs; absent/empty means none anywhere.
    cutoffs: Array.isArray(e?.cutoffs) ? (e.cutoffs as OnlineCompetitionEventConfig['cutoffs']) : [],
    advancement: Array.isArray(e?.advancement) ? (e.advancement as OnlineCompetitionEventConfig['advancement']) : [],
    // null = included in the base fee, which is also what a non-positive
    // or fractional stored value reads as (surchargeOf's rule) — the write
    // path refuses those, so this only catches a hand-edited document.
    surchargeMnt:
      typeof e?.surchargeMnt === 'number' && Number.isInteger(e.surchargeMnt) && e.surchargeMnt > 0
        ? e.surchargeMnt
        : null,
  }));
}

/** Every key an EVENT may carry. Anything else is refused rather than
 *  dropped — see the note at the events loop. */
const EVENT_FIELDS = [
  'eventId',
  'label',
  'rounds',
  'resultFormat',
  'timeLimitCs',
  'cutoffs',
  'advancement',
  'surchargeMnt',
] as const;

/** A per-event surcharge in whole tugrik, on top of baseFeeMnt.
 *
 *  Absent/null = included in the base fee. A PRESENT value must be a
 *  positive integer: 0 is refused because "included" already has a
 *  spelling (null), and two representations of one fact is exactly the
 *  ambiguity every reader would then have to handle. */
function parseSurcharge(raw: unknown): ParseResult<number | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'surchargeMnt must be a number' };
  }
  if (!Number.isInteger(raw)) return { ok: false, error: 'surchargeMnt must be a whole number of tugrik' };
  if (raw === 0) {
    return { ok: false, error: 'surchargeMnt of 0 is not allowed — omit it to include the event in the base fee' };
  }
  if (raw < 0) return { ok: false, error: 'surchargeMnt must be greater than 0' };
  return { ok: true, value: raw };
}

// ── schedule[] ──────────────────────────────────────────────────────────
// The fourth structure through this file, and the third to use the
// manifest: an unregistered key is a REFUSED WRITE naming the field, not a
// value that vanishes on reload.
//
// Here the manifest is per-KIND, exactly like BLOCK_PAYLOAD_FIELDS — a
// 'round' entry and an 'other' entry carry different payloads, and a key
// belonging to the other kind is what "kind does not match its payload"
// means. `note` is on both kinds, so it is listed on both rather than
// special-cased.

/** Keys every schedule entry carries whatever its kind. */
const SCHEDULE_COMMON_FIELDS = ['id', 'startMin', 'durationMin', 'kind'] as const;

/** Per-kind payload keys, and whether each is required. */
const SCHEDULE_PAYLOAD_FIELDS: Record<
  OnlineCompetitionScheduleKind,
  { key: 'eventId' | 'round' | 'label' | 'note'; required: boolean }[]
> = {
  round: [
    { key: 'eventId', required: true },
    { key: 'round', required: true },
    { key: 'note', required: false },
  ],
  other: [
    // A row with no label is a slot on the timeline that says nothing —
    // an athlete reads "10:00, 30 minutes, ???". Refused.
    { key: 'label', required: true },
    { key: 'note', required: false },
  ],
};

const SCHEDULE_KINDS = Object.keys(SCHEDULE_PAYLOAD_FIELDS) as OnlineCompetitionScheduleKind[];
/** Union across kinds — the "carries the other kind's payload" test.
 *  Derived, never restated. */
const ALL_SCHEDULE_PAYLOAD_KEYS = new Set<string>(
  SCHEDULE_KINDS.flatMap((k) => SCHEDULE_PAYLOAD_FIELDS[k].map((f) => f.key)),
);

/** Longest a single slot may be. A day; anything more is a typo or a
 *  runaway client, and the UI's own select tops out at two hours. */
const MAX_SLOT_MINUTES = 1440;
/** Ceiling on the derived start. Two weeks of minutes — high enough that
 *  no real programme reaches it, low enough that a corrupt accumulation
 *  is caught rather than stored. */
const MAX_START_MINUTES = MAX_SLOT_MINUTES * 14;

function parseScheduleEntry(raw: unknown, where: string): ParseResult<OnlineCompetitionScheduleEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${where}: invalid schedule entry` };
  }
  const e = raw as Record<string, unknown>;

  const kind = e.kind;
  if (typeof kind !== 'string' || !SCHEDULE_KINDS.includes(kind as OnlineCompetitionScheduleKind)) {
    return { ok: false, error: `${where}: unknown schedule kind ${JSON.stringify(e.kind)}` };
  }
  const entryKind = kind as OnlineCompetitionScheduleKind;

  const id = requiredString(e.id);
  if (id === null) return { ok: false, error: `${where}: schedule id is required` };

  const allowed = SCHEDULE_PAYLOAD_FIELDS[entryKind];
  const allowedKeys = new Set<string>([...SCHEDULE_COMMON_FIELDS, ...allowed.map((f) => f.key)]);
  for (const key of Object.keys(e)) {
    if (e[key] === undefined) continue;
    if (allowedKeys.has(key)) continue;
    if (ALL_SCHEDULE_PAYLOAD_KEYS.has(key)) {
      return { ok: false, error: `${where}: a ${entryKind} entry cannot carry ${key}` };
    }
    return { ok: false, error: `${where}: unknown schedule field ${key}` };
  }

  // Derived by the editor from the competition's startAt plus every
  // preceding duration, so this only has to refuse something impossible.
  if (typeof e.startMin !== 'number' || !Number.isInteger(e.startMin) || e.startMin < 0) {
    return { ok: false, error: `${where}: startMin must be a non-negative whole number of minutes` };
  }
  if (e.startMin > MAX_START_MINUTES) {
    return { ok: false, error: `${where}: startMin ${e.startMin} is implausibly far from the start` };
  }
  // Deliberately NOT restricted to SCHEDULE_DURATIONS. That list is what
  // the select offers today; enshrining it here would turn a UI decision
  // into a schema one and refuse a document the next design writes.
  if (typeof e.durationMin !== 'number' || !Number.isInteger(e.durationMin) || e.durationMin <= 0) {
    return { ok: false, error: `${where}: durationMin must be a whole number of minutes above zero` };
  }
  if (e.durationMin > MAX_SLOT_MINUTES) {
    return { ok: false, error: `${where}: durationMin ${e.durationMin} is longer than a day` };
  }

  const out: OnlineCompetitionScheduleEntry = {
    id,
    startMin: e.startMin,
    durationMin: e.durationMin,
    kind: entryKind,
  };

  // Built from the manifest, the only place a payload field is written.
  for (const field of allowed) {
    const value = e[field.key];
    if (value === undefined || value === null) {
      if (field.required) return { ok: false, error: `${where}: a ${entryKind} entry requires ${field.key}` };
      continue;
    }
    if (field.key === 'round') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        return { ok: false, error: `${where}: round must be a whole number from 1` };
      }
      out.round = value;
      continue;
    }
    if (typeof value !== 'string') return { ok: false, error: `${where}: ${field.key} must be a string` };
    // `note` is the one field allowed to be empty — an added row has no
    // note yet, and that is not an error.
    if (field.key === 'note') {
      out.note = value;
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      if (field.required) return { ok: false, error: `${where}: a ${entryKind} entry requires ${field.key}` };
      continue;
    }
    if (field.key === 'eventId') out.eventId = trimmed;
    if (field.key === 'label') out.label = trimmed;
  }

  return { ok: true, value: out };
}

/** Absent/null/[] -> []. Every other malformation is refused.
 *
 *  Note what is NOT checked: that a 'round' entry names an event the
 *  competition actually has. An admin legitimately drafts a programme
 *  before finishing the Төрөл tab, and removing an event should not make
 *  every save fail until they also fix the schedule. The editor flags a
 *  stale row instead. */
function parseSchedule(raw: unknown): ParseResult<OnlineCompetitionScheduleEntry[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'schedule must be an array' };
  if (raw.length > MAX_SCHEDULE_ENTRIES) {
    return { ok: false, error: `at most ${MAX_SCHEDULE_ENTRIES} schedule entries are allowed (got ${raw.length})` };
  }

  const out: OnlineCompetitionScheduleEntry[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const parsed = parseScheduleEntry(entry, `schedule row ${index + 1}`);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.id)) {
      return { ok: false, error: `schedule row ${index + 1}: duplicate schedule id ${parsed.value.id}` };
    }
    seen.add(parsed.value.id);
    out.push(parsed.value);
  }
  // ARRAY ORDER IS THE ORDER. Not sorted by startMin: the accumulation is
  // what produces startMin, so sorting by it would be circular, and a
  // half-edited schedule whose rows are briefly out of sequence must not
  // be silently rearranged under the admin.
  return { ok: true, value: out };
}

/** Stored schedule, read defensively for the two GET mappers. Same
 *  read-side stance as normalizeStoredSections: drop what cannot be
 *  understood rather than throwing, so an odd document can still be
 *  opened and fixed. */
export function normalizeStoredSchedule(raw: unknown): OnlineCompetitionScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionScheduleEntry[] = [];
  for (const [index, item] of (raw as unknown[]).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.kind !== 'string' || !SCHEDULE_KINDS.includes(e.kind as OnlineCompetitionScheduleKind)) continue;
    const kind = e.kind as OnlineCompetitionScheduleKind;
    if (typeof e.durationMin !== 'number' || e.durationMin <= 0) continue;
    const entry: OnlineCompetitionScheduleEntry = {
      id: typeof e.id === 'string' && e.id.trim() ? e.id.trim() : `sch${index + 1}`,
      // Recomputed by the editor on the next save anyway; a missing or
      // junk value reads as 0 rather than dropping an announced row.
      startMin: typeof e.startMin === 'number' && e.startMin >= 0 ? Math.trunc(e.startMin) : 0,
      durationMin: Math.trunc(e.durationMin),
      kind,
    };
    for (const field of SCHEDULE_PAYLOAD_FIELDS[kind]) {
      const value = e[field.key];
      if (field.key === 'round') {
        if (typeof value === 'number' && value >= 1) entry.round = Math.trunc(value);
        continue;
      }
      if (typeof value !== 'string') continue;
      if (field.key === 'eventId') entry.eventId = value;
      else if (field.key === 'label') entry.label = value;
      else if (field.key === 'note') entry.note = value;
    }
    // A row whose required payload did not survive says nothing on a
    // timeline, so it is dropped rather than rendered blank.
    if (kind === 'round' && (!entry.eventId || entry.round === undefined)) continue;
    if (kind === 'other' && !entry.label) continue;
    out.push(entry);
  }
  return out;
}

export function validateCompetitionInput(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' };
  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || !b.name.trim()) {
    return { ok: false, error: 'name is required' };
  }
  if (typeof b.status !== 'string' || !VALID_STATUSES.includes(b.status as OnlineCompetitionStatus)) {
    return { ok: false, error: 'invalid status' };
  }
  // A draft may have no events yet. The Ерөнхий tab of the admin editor
  // saves before the Төрөл tab has been built, let alone filled in, so a
  // competition genuinely exists with events: [] for part of its life —
  // rejecting that would make "Нооргоор хадгалах" impossible on a new
  // competition. Every OTHER status keeps the original guarantee: nothing
  // reaches the public site without at least one event. The publish-time
  // readiness checklist (Хянах tab) is where a draft's completeness gets
  // enforced.
  if (!Array.isArray(b.events)) {
    return { ok: false, error: 'events must be an array' };
  }
  if (b.events.length === 0 && b.status !== 'draft') {
    return { ok: false, error: 'at least one event is required' };
  }

  // This loop REBUILDS each event object field by field, so a property not
  // named below would be silently dropped — the trap that ate
  // `advancement` and nearly ate `resultFormat`.
  //
  // EVENT_FIELDS closes it, using the same half of the manifest idea that
  // sections[] uses: an event key that is not on the list is a REJECTED
  // WRITE, not a dropped field. The other half — driving the rebuild from
  // the manifest — does NOT transfer here, and deliberately so: a block's
  // fields are independent strings, while an event's are interdependent
  // (rounds bounds advancement, resultFormat gates cutoffs), so parsing
  // has to stay hand-written. The allow-list is the part that makes
  // forgetting loud, and that is the part worth having.
  //
  // Adding a per-event field means adding it here, to the push() below,
  // and to OnlineCompetitionEventConfig. Miss the first and the save fails
  // with `unknown event field`; miss the third and tsc fails.
  const events: OnlineCompetitionEventConfig[] = [];
  for (const raw of b.events) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid event config' };
    const e = raw as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (e[key] === undefined) continue;
      if (!(EVENT_FIELDS as readonly string[]).includes(key)) {
        return { ok: false, error: `${String(e.eventId)}: unknown event field ${key}` };
      }
    }
    if (typeof e.eventId !== 'string' || typeof e.label !== 'string' || typeof e.rounds !== 'number' || e.rounds < 1) {
      return { ok: false, error: 'invalid event config' };
    }
    const advancement = parseAdvancement(e.advancement, e.rounds);
    if (!advancement.ok) return { ok: false, error: `${e.eventId}: ${advancement.error}` };
    // Absent is legal (every event stored before this field existed) and
    // means 'ao5'; a PRESENT but unrecognised value is a malformed payload
    // and is refused rather than quietly defaulted — silently rewriting an
    // admin's choice is worse than telling them it was invalid.
    // null counts as ABSENT, not as invalid — JSON has no `undefined`, so a
    // client that spells an unset optional field as null must mean the same
    // thing as omitting it. Same rule parseAdvancement above applies.
    if (
      e.resultFormat !== undefined &&
      e.resultFormat !== null &&
      !RESULT_FORMATS.includes(e.resultFormat as ResultFormat)
    ) {
      return { ok: false, error: `${e.eventId}: invalid resultFormat` };
    }
    const resultFormat: ResultFormat = (e.resultFormat as ResultFormat | null) ?? 'ao5';
    // Absent/null = NO LIMIT. Never defaulted to a real value — see the
    // field comment in types.ts for why 10:00 would be destructive.
    if (
      e.timeLimitCs !== undefined &&
      e.timeLimitCs !== null &&
      (typeof e.timeLimitCs !== 'number' || !Number.isInteger(e.timeLimitCs) || e.timeLimitCs <= 0)
    ) {
      return { ok: false, error: `${e.eventId}: invalid timeLimitCs` };
    }
    const timeLimitCs: number | null = (e.timeLimitCs as number | null | undefined) ?? null;
    const cutoffs = parseCutoffs(e.cutoffs, e.rounds, resultFormat);
    if (!cutoffs.ok) return { ok: false, error: `${e.eventId}: ${cutoffs.error}` };
    const surcharge = parseSurcharge(e.surchargeMnt);
    if (!surcharge.ok) return { ok: false, error: `${e.eventId}: ${surcharge.error}` };
    events.push({
      eventId: e.eventId,
      label: e.label,
      rounds: e.rounds,
      resultFormat,
      timeLimitCs,
      cutoffs: cutoffs.value,
      advancement: advancement.value,
      // null = included in the base fee. Stored as an explicit null rather
      // than omitted so the field's absence never has to be told apart
      // from its being unset — the same treatment timeLimitCs gets.
      surchargeMnt: surcharge.value,
    });
  }

  const sections = parseSections(b.sections);
  if (!sections.ok) return { ok: false, error: sections.error };

  const baseFee = parseBaseFee(b.baseFeeMnt);
  if (!baseFee.ok) return { ok: false, error: baseFee.error };

  const schedule = parseSchedule(b.schedule);
  if (!schedule.ok) return { ok: false, error: schedule.error };

  return {
    ok: true,
    data: {
      name: b.name.trim(),
      description: typeof b.description === 'string' ? b.description : '',
      startAt: typeof b.startAt === 'number' ? b.startAt : null,
      registrationDeadline: typeof b.registrationDeadline === 'number' ? b.registrationDeadline : null,
      participantLimit: typeof b.participantLimit === 'number' ? b.participantLimit : null,
      events,
      status: b.status as OnlineCompetitionStatus,
      season: typeof b.season === 'string' ? b.season.trim() : '',
      // Same coerce-don't-reject treatment as the dates above: this is a
      // sanity check against a malformed payload, and the form owns the
      // ordering rules (opens < deadline <= start < end) with Mongolian
      // messages. A draft is expected to have most of these unset.
      registrationOpensAt: typeof b.registrationOpensAt === 'number' ? b.registrationOpensAt : null,
      endAt: typeof b.endAt === 'number' ? b.endAt : null,
      format: typeof b.format === 'string' && b.format.trim() ? b.format.trim() : DEFAULT_COMPETITION_FORMAT,
      featured: b.featured === true,
      // The banner three are stored regardless of `featured` — see the
      // field comments in types.ts. Not trimmed to '' and dropped when the
      // flag is off: that would silently discard an admin's copy the
      // moment they unticked the box.
      featuredHeading: typeof b.featuredHeading === 'string' ? b.featuredHeading.trim() : '',
      featuredCtaLabel: typeof b.featuredCtaLabel === 'string' ? b.featuredCtaLabel.trim() : '',
      featuredUntil: typeof b.featuredUntil === 'number' ? b.featuredUntil : null,
      instructions: typeof b.instructions === 'string' ? b.instructions : '',
      paid: b.paid === true,
      // NOT gated on `paid`: the fee is stored whether or not the
      // competition currently charges one, so toggling Төлбөргүй and back
      // restores what was configured — the treatment the featured banner
      // fields get, for the same reason.
      baseFeeMnt: baseFee.value,
      // Images: null unless a non-empty string arrives. An empty string is
      // normalised to null so "removed" has exactly one representation in
      // the document rather than two ('' and null) for readers to handle.
      posterUrl: nullableString(b.posterUrl),
      posterPublicId: nullableString(b.posterPublicId),
      bannerUrl: nullableString(b.bannerUrl),
      bannerPublicId: nullableString(b.bannerPublicId),
      sections: sections.value,
      schedule: schedule.value,
    },
  };
}

/** The competition's base fee in whole tugrik.
 *
 *  Absent/null = not set, which is legal at every status: a draft is
 *  expected to be half-filled, and a Төлбөргүй competition has no fee to
 *  set. A PRESENT value must be a non-negative whole number — unlike a
 *  surcharge, 0 is allowed here and means a base fee of nothing, which is
 *  a real configuration (every event surcharged, no entry fee). */
function parseBaseFee(raw: unknown): ParseResult<number | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'baseFeeMnt must be a number' };
  }
  if (!Number.isInteger(raw)) return { ok: false, error: 'baseFeeMnt must be a whole number of tugrik' };
  if (raw < 0) return { ok: false, error: 'baseFeeMnt cannot be negative' };
  return { ok: true, value: raw };
}

/** '' / non-string / absent -> null; otherwise the trimmed string. */
function nullableString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** Normalizes a raw Firestore `status` value into the current v2 enum
 *  ('draft' | 'upcoming' | 'live' | 'finished'). Competition docs created before the
 *  Phase 1 schema migration — namely the original test-comp-1 seed — may
 *  still carry the old 'upcoming' | 'active' | 'closed' shape. Reading
 *  that raw string straight through (typed as OnlineCompetitionStatus but
 *  not runtime-validated) would hand an unrecognized value to any UI
 *  lookup keyed strictly on the new enum, e.g. the admin dashboard's
 *  status Badge — map the old values onto their closest new-shape
 *  equivalent instead. */
export function normalizeCompetitionStatus(raw: unknown): OnlineCompetitionStatus {
  if (typeof raw === 'string' && VALID_STATUSES.includes(raw as OnlineCompetitionStatus)) {
    return raw as OnlineCompetitionStatus;
  }
  if (raw === 'active') return 'live';
  if (raw === 'closed') return 'finished';
  // Fallback for a genuinely unrecognized value (or a doc with no status
  // field at all). Deliberately NOT 'draft': a legacy doc that currently
  // shows publicly must not silently vanish from the public site because
  // its status string wasn't recognised. The cost of that choice is that
  // 'draft' has to be a RECOGNISED value (it is, via VALID_STATUSES above)
  // — if it is ever dropped from that list, every draft lands here and
  // goes public. That is the failure this comment exists to prevent.
  return 'upcoming';
}

/** Converts a validated write input into the plain object stored in
 *  Firestore (epoch-ms -> Timestamp). Does not set `createdAt` — callers
 *  add that themselves (serverTimestamp on create, left untouched on
 *  update). */
export function toFirestoreDoc(input: OnlineCompetitionWriteInput) {
  return {
    name: input.name,
    description: input.description,
    startAt: input.startAt !== null ? Timestamp.fromMillis(input.startAt) : null,
    registrationDeadline:
      input.registrationDeadline !== null ? Timestamp.fromMillis(input.registrationDeadline) : null,
    participantLimit: input.participantLimit,
    events: input.events,
    status: input.status,
    season: input.season,
    registrationOpensAt:
      input.registrationOpensAt !== null ? Timestamp.fromMillis(input.registrationOpensAt) : null,
    endAt: input.endAt !== null ? Timestamp.fromMillis(input.endAt) : null,
    format: input.format,
    featured: input.featured,
    featuredHeading: input.featuredHeading,
    featuredCtaLabel: input.featuredCtaLabel,
    featuredUntil: input.featuredUntil !== null ? Timestamp.fromMillis(input.featuredUntil) : null,
    instructions: input.instructions,
    paid: input.paid,
    baseFeeMnt: input.baseFeeMnt,
    posterUrl: input.posterUrl,
    posterPublicId: input.posterPublicId,
    bannerUrl: input.bannerUrl,
    bannerPublicId: input.bannerPublicId,
    // Written WHOLE, never merged into: sections ARE the array, so a
    // shorter array after a deletion has to replace the stored one. The
    // enclosing tx.set uses merge:true, which replaces an array field
    // wholesale rather than merging element by element — which is exactly
    // what this needs, and is worth stating because the opposite would
    // leave a deleted tail behind.
    sections: input.sections,
    // Written whole, like sections and for the same reason: the array IS
    // the schedule, so a shorter one after a deletion has to replace the
    // stored one rather than merge into it.
    schedule: input.schedule,
  };
}

/** Creates or updates a competition, keeping `featured` exclusive.
 *
 *  At most one competition may be featured, so a save that sets the flag
 *  has to clear it everywhere else. Done in a TRANSACTION rather than a
 *  query-then-batch: the read of "who is featured now" and the writes that
 *  act on it have to be one atomic unit, or two admins saving at once each
 *  read an empty set, each clear nothing, and both end up featured — the
 *  exact invariant this is here to hold. Firestore retries the transaction
 *  on contention, so the loser re-reads and sees the winner's flag.
 *
 *  Firestore requires every read in a transaction to precede every write,
 *  which is why the query runs before any tx.set/tx.update below.
 *
 *  The query needs no composite index — a single-field equality filter
 *  uses the automatic index. Docs written before `featured` existed simply
 *  don't match, which is correct: they aren't featured.
 *
 *  Pass `competitionId: null` to create. The id is allocated up front so
 *  create and update share one path (and so a newly created competition
 *  can be the one being featured).
 *
 *  Returns the competition's id. */
/** Thrown when a write is refused for a reason only the stored document
 *  can reveal. Both routes turn it into a 400 with this message. */
export class CompetitionWriteError extends Error {}

/** The per-event settings that RE-DERIVE HISTORY if changed, so both are
 *  locked once results exist.
 *
 *  timeLimitCs is locked for the same reason resultFormat is, and the case
 *  for it is if anything stronger: a solve that was legal under a 15:00
 *  limit becomes a DNF under 10:00, and adding a limit where there was
 *  none can only ever turn valid solves into DNFs. Either silently
 *  rewrites Ao5s, standings, season points and PRs for results that have
 *  already been announced. Identical hazard, identical guard. */
interface ScoringRules {
  resultFormat: string;
  timeLimitCs: number | null;
  /** Serialised "round:cs,round:cs" so a set of cutoffs compares by value.
   *  Changing one re-derives history the same way the other two do: it
   *  decides whether an athlete's round ended at attempt 2, so moving it
   *  can retroactively grant or revoke three attempts' worth of result. */
  cutoffs: string;
}

function serialiseCutoffs(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return (raw as Record<string, unknown>[])
    .filter((c) => typeof c?.round === 'number' && typeof c?.cutoffCs === 'number')
    .map((c) => `${c.round as number}:${c.cutoffCs as number}`)
    .sort()
    .join(',');
}

function storedScoringRules(stored: unknown): Map<string, ScoringRules> {
  const before = new Map<string, ScoringRules>();
  if (!Array.isArray(stored)) return before;
  for (const e of stored as Record<string, unknown>[]) {
    if (typeof e?.eventId !== 'string') continue;
    before.set(e.eventId, {
      // Absent reads as 'ao5' (resolveResultFormat's rule) — so adding the
      // field to a legacy event by SELECTING Ao5 is not a change, while
      // selecting anything else is.
      resultFormat: RESULT_FORMATS.includes(e.resultFormat as ResultFormat) ? (e.resultFormat as string) : 'ao5',
      // Absent reads as null (no limit), so setting one on a legacy event
      // IS a change — which is correct: it can only add DNFs.
      timeLimitCs: typeof e.timeLimitCs === 'number' ? e.timeLimitCs : null,
      cutoffs: serialiseCutoffs(e.cutoffs),
    });
  }
  return before;
}

/** eventIds whose scoring rules differ from what is stored, with the field
 *  that moved — so the refusal can name it. */
function eventsChangingScoringRules(
  stored: unknown,
  incoming: OnlineCompetitionWriteInput['events'],
): { eventId: string; field: 'resultFormat' | 'timeLimitCs' | 'cutoffs' }[] {
  const before = storedScoringRules(stored);
  const out: { eventId: string; field: 'resultFormat' | 'timeLimitCs' | 'cutoffs' }[] = [];
  for (const e of incoming) {
    const was = before.get(e.eventId);
    if (!was) continue;
    if (was.resultFormat !== (e.resultFormat ?? 'ao5')) {
      out.push({ eventId: e.eventId, field: 'resultFormat' });
    }
    if (was.timeLimitCs !== (e.timeLimitCs ?? null)) {
      out.push({ eventId: e.eventId, field: 'timeLimitCs' });
    }
    if (was.cutoffs !== serialiseCutoffs(e.cutoffs)) {
      out.push({ eventId: e.eventId, field: 'cutoffs' });
    }
  }
  return out;
}

/** eventIds of this competition that already have a JUDGED submission.
 *  Judged = approved or rejected, matching the completeness rule every
 *  scorer now uses: a rejected attempt is a DNF that counts, so it is just
 *  as much a result as an approved one and just as much at risk from a
 *  format change. Pending work does not lock anything — nothing has been
 *  derived from it yet. */
export async function lockedFormatEventIds(db: Firestore, competitionId: string): Promise<string[]> {
  const snap = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .where('status', 'in', ['approved', 'rejected'])
    .select('event')
    .get();
  const ids = new Set<string>();
  for (const d of snap.docs) {
    const event = d.get('event');
    if (typeof event === 'string') ids.add(event);
  }
  return [...ids];
}

/** How many athletes have REGISTERED for this competition.
 *
 *  Targeted at one competition, unlike the list endpoint's
 *  countRegistrationsByCompetition which scans every registration to build
 *  a map. The grandparent check is load-bearing for the same reason it is
 *  there and in scramble-roster.ts: this database has an unrelated
 *  top-level `registrations` collection that the same collectionGroup
 *  query otherwise pulls in.
 *
 *  Used by the editor's fee-change warning, which needs to know whether
 *  anyone has already registered under the current fee. */
export async function countRegistrationsFor(db: Firestore, competitionId: string): Promise<number> {
  const snap = await db.collectionGroup('registrations').where('competitionId', '==', competitionId).get();
  return snap.docs.filter((d) => d.ref.parent.parent?.parent.id === 'onlineParticipants').length;
}

export async function writeCompetitionDoc(
  db: Firestore,
  competitionId: string | null,
  input: OnlineCompetitionWriteInput,
): Promise<string> {
  const col = db.collection('onlineCompetitions');
  const ref = competitionId ? col.doc(competitionId) : col.doc();
  const isCreate = competitionId === null;
  const data = toFirestoreDoc(input);

  await db.runTransaction(async (tx) => {
    // ── every read first ──
    const others = input.featured
      ? (await tx.get(col.where('featured', '==', true))).docs.filter((d) => d.id !== ref.id)
      : [];

    // ── the resultFormat lock ──
    // Changing an event's format once results exist would silently
    // re-derive that history under a different rule: an Ao5 recomputed as
    // an Mo3 is a different number from the same attempts, and stored
    // season points and athlete stats would shift with no record of why.
    //
    // Enforced HERE, not in validateCompetitionInput, for the simple
    // reason that validateCompetitionInput is a pure function of the
    // request body — it cannot see the stored document and so cannot know
    // what the format was before, or whether anything has been judged.
    // This is also the only place that sees BOTH, and it sees them inside
    // the transaction that performs the write, so a submission judged
    // between the check and the save cannot slip through.
    //
    // A create can never trip this: there is no stored document and no
    // submission can reference an id that did not exist.
    if (!isCreate) {
      const snap = await tx.get(ref);
      const storedEvents = snap.exists ? snap.get('events') : [];
      const changing = snap.exists ? eventsChangingScoringRules(storedEvents, input.events) : [];
      // REMOVING a locked event is refused too, and that is not belt-and-
      // braces — without it the format lock has a trivial two-save bypass:
      // save once dropping the event (nothing flags it, because the check
      // only looked at events present in BOTH), then save again re-adding
      // it with a different format (nothing flags it either, because it is
      // no longer in the stored document to compare against).
      //
      // Removal is also independently destructive: athleteStats resolves a
      // submission's format by looking the event up on its competition, so
      // an event deleted out from under judged results silently re-derives
      // all of them as Ao5 — the default for "event not found".
      const storedIds = new Set(
        (Array.isArray(storedEvents) ? (storedEvents as Record<string, unknown>[]) : [])
          .map((e) => e?.eventId)
          .filter((id): id is string => typeof id === 'string'),
      );
      const incomingIds = new Set(input.events.map((e) => e.eventId));
      const removed = [...storedIds].filter((id) => !incomingIds.has(id));

      if (changing.length > 0 || removed.length > 0) {
        const locked = new Set(await lockedFormatEventIds(db, ref.id));
        const refusedChange = changing.filter((c) => locked.has(c.eventId));
        const refusedRemoval = removed.filter((id) => locked.has(id));
        const refusedFormat = refusedChange.filter((c) => c.field === 'resultFormat');
        const refusedLimit = refusedChange.filter((c) => c.field === 'timeLimitCs');
        if (refusedFormat.length > 0) {
          throw new CompetitionWriteError(
            `Үзүүлэлт орсон тул формат солих боломжгүй: ${refusedFormat.map((c) => c.eventId).join(', ')}`,
          );
        }
        if (refusedLimit.length > 0) {
          throw new CompetitionWriteError(
            `Үзүүлэлт орсон тул цагийн хязгаар солих боломжгүй: ${refusedLimit.map((c) => c.eventId).join(', ')}`,
          );
        }
        const refusedCutoff = refusedChange.filter((c) => c.field === 'cutoffs');
        if (refusedCutoff.length > 0) {
          throw new CompetitionWriteError(
            `Үзүүлэлт орсон тул шүүлтүүр солих боломжгүй: ${refusedCutoff.map((c) => c.eventId).join(', ')}`,
          );
        }
        if (refusedRemoval.length > 0) {
          throw new CompetitionWriteError(
            `Үзүүлэлт орсон тул төрлийг устгах боломжгүй: ${refusedRemoval.join(', ')}`,
          );
        }
      }
    }

    // ── then every write ──
    if (isCreate) {
      tx.set(ref, { ...data, createdAt: FieldValue.serverTimestamp() });
    } else {
      // merge: true, as the update path has always used — it preserves
      // createdAt and any field this form does not own.
      tx.set(ref, data, { merge: true });
    }
    for (const other of others) {
      tx.update(other.ref, { featured: false });
    }
  });

  return ref.id;
}
