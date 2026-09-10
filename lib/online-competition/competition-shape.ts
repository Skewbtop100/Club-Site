// ── Stored competition shape: manifests and read normalisers ───────────
// Everything needed to turn a raw onlineCompetitions document's events,
// sections and schedule into their typed shapes — and NOTHING that touches
// Firestore. No firebase-admin, no firebase client SDK, no React, which is
// the entire reason this file exists:
//
//   * the ADMIN GET routes (admin-competitions/route.ts and [id]/route.ts)
//     import these normalisers, and
//   * the PUBLIC client fetchers (data.ts: fetchCompetition,
//     fetchAllCompetitions) import the SAME ones.
//
// Until this module existed there were two event readers — this one's
// ancestor in admin-competitions.ts (server-only, because that file
// imports firebase-admin) and a separate `normalizeEvents` in data.ts —
// and the public copy had fallen behind: it rebuilt each event field by
// field and never learned `advancement` or `surchargeMnt`. So the public
// detail page read every event as included in the base fee, and could not
// have rendered an advancement plan at all. That is the field-by-field
// rebuild trap again, on the read side this time, and the fix is the same
// one the write side got: one reader, so there is one list to forget.
//
// The write-side MANIFESTS live here too, and admin-competitions.ts
// imports them for validateCompetitionInput. A field readable here is a
// field writable there — one list, two directions.
//
// Read-side stance throughout: COERCE AND DROP, NEVER THROW. A write is
// refused when malformed; a read must still produce something, or the
// admin cannot open a hand-edited document to fix it and a visitor gets a
// blank page instead of a competition.

import { resolveResultFormat } from './ao5';
import { onlineCompEventLabel } from './events';
import { parseVideoUrl } from './video-url';
import type {
  OnlineCompetitionAdvancement,
  OnlineCompetitionBlock,
  OnlineCompetitionBlockType,
  OnlineCompetitionCutoff,
  OnlineCompetitionEventConfig,
  OnlineCompetitionScheduleEntry,
  OnlineCompetitionScheduleKind,
  OnlineCompetitionSection,
} from './types';

// ── manifests (shared with the write path) ─────────────────────────────

/** Every key a SECTION may carry. validateCompetitionInput refuses any
 *  other rather than dropping it. */
export const SECTION_FIELDS = ['id', 'title', 'blocks'] as const;

/** Every key a BLOCK may carry, keyed by type, and whether each is
 *  required. `text` may be '' — an added-but-untyped block is a legal
 *  intermediate state. An image or video block with no payload is not:
 *  it is a slot that can never render. */
export const BLOCK_PAYLOAD_FIELDS: Record<
  OnlineCompetitionBlockType,
  { key: 'text' | 'imageUrl' | 'imagePublicId' | 'videoUrl'; required: boolean }[]
> = {
  text: [{ key: 'text', required: true }],
  image: [
    { key: 'imageUrl', required: true },
    { key: 'imagePublicId', required: false },
  ],
  video: [{ key: 'videoUrl', required: true }],
};

export const BLOCK_TYPES = Object.keys(BLOCK_PAYLOAD_FIELDS) as OnlineCompetitionBlockType[];
/** Union of every block payload key — the "carries another type's
 *  payload" test. Derived, never restated. */
export const ALL_PAYLOAD_KEYS = new Set<string>(
  BLOCK_TYPES.flatMap((t) => BLOCK_PAYLOAD_FIELDS[t].map((f) => f.key)),
);

/** Keys every schedule entry carries whatever its kind. */
export const SCHEDULE_COMMON_FIELDS = ['id', 'startMin', 'durationMin', 'kind'] as const;

/** Per-kind schedule payload keys, and whether each is required. `note`
 *  is on both kinds, so it is listed on both rather than special-cased. */
export const SCHEDULE_PAYLOAD_FIELDS: Record<
  OnlineCompetitionScheduleKind,
  { key: 'eventId' | 'round' | 'label' | 'note'; required: boolean }[]
> = {
  round: [
    { key: 'eventId', required: true },
    { key: 'round', required: true },
    { key: 'note', required: false },
  ],
  other: [
    // A row with no label is a slot on the timeline that says nothing.
    { key: 'label', required: true },
    { key: 'note', required: false },
  ],
};

export const SCHEDULE_KINDS = Object.keys(SCHEDULE_PAYLOAD_FIELDS) as OnlineCompetitionScheduleKind[];
export const ALL_SCHEDULE_PAYLOAD_KEYS = new Set<string>(
  SCHEDULE_KINDS.flatMap((k) => SCHEDULE_PAYLOAD_FIELDS[k].map((f) => f.key)),
);

// ── events ─────────────────────────────────────────────────────────────

/** Planned advancement rows that can actually be read. The write path
 *  validates these properly (validateQualifierInput); this only guarantees
 *  a reader never meets a NaN or an unknown method. */
function readAdvancement(raw: unknown): OnlineCompetitionAdvancement[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionAdvancement[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object') continue;
    if (typeof a.fromRound !== 'number' || !Number.isInteger(a.fromRound) || a.fromRound < 1) continue;
    if (a.method !== 'count' && a.method !== 'percent') continue;
    if (typeof a.value !== 'number' || !Number.isFinite(a.value) || a.value <= 0) continue;
    out.push({ fromRound: a.fromRound, method: a.method, value: a.value });
  }
  return out.sort((x, y) => x.fromRound - y.fromRound);
}

/** Per-round cutoffs that can actually be read. */
function readCutoffs(raw: unknown): OnlineCompetitionCutoff[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionCutoff[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    if (typeof c.round !== 'number' || !Number.isInteger(c.round) || c.round < 1) continue;
    if (typeof c.cutoffCs !== 'number' || !Number.isFinite(c.cutoffCs) || c.cutoffCs <= 0) continue;
    out.push({ round: c.round, cutoffCs: c.cutoffCs });
  }
  return out.sort((x, y) => x.round - y.round);
}

/** Stored events, for BOTH the admin GET routes and the public fetchers.
 *
 *  The union of what the two old readers each got right:
 *   - from the public one: the LEGACY string[] shape (`["333", "222"]`,
 *     written before events became objects — the original seed has it) is
 *     converted rather than read as an event with no id; an entry with no
 *     string eventId is dropped rather than kept as a blank row the editor
 *     could save back; rounds below 1 floor to 1.
 *   - from the admin one: every field, including `advancement` and
 *     `surchargeMnt`, which the public reader had never learned.
 *
 *  Each object is built as `Required<OnlineCompetitionEventConfig>`. That
 *  is the guard against the next forgotten field: every per-event field is
 *  optional on the type (for legacy documents), so an omission here would
 *  normally compile — but Required<> makes each one mandatory in THIS
 *  literal, so adding a field to the interface without teaching this
 *  reader fails tsc. */
export function normalizeStoredEvents(raw: unknown): OnlineCompetitionEventConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionEventConfig[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry === 'string') {
      if (!entry.trim()) continue;
      const legacy: Required<OnlineCompetitionEventConfig> = {
        eventId: entry,
        label: onlineCompEventLabel(entry),
        rounds: 1,
        resultFormat: 'ao5',
        timeLimitCs: null,
        cutoffs: [],
        advancement: [],
        surchargeMnt: null,
      };
      out.push(legacy);
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.eventId !== 'string' || !e.eventId.trim()) continue;
    const event: Required<OnlineCompetitionEventConfig> = {
      eventId: e.eventId,
      // The stored label, else the catalogue's — "3x3x3" rather than the
      // bare id "333" the old public fallback produced.
      label: typeof e.label === 'string' && e.label.trim() ? e.label : onlineCompEventLabel(e.eventId),
      rounds: typeof e.rounds === 'number' && Number.isInteger(e.rounds) && e.rounds >= 1 ? e.rounds : 1,
      // Read-time default, no backfill: absent reads as 'ao5'.
      resultFormat: resolveResultFormat(e.resultFormat),
      // null = no limit. Never defaulted to a real value.
      timeLimitCs:
        typeof e.timeLimitCs === 'number' && Number.isFinite(e.timeLimitCs) && e.timeLimitCs > 0
          ? e.timeLimitCs
          : null,
      cutoffs: readCutoffs(e.cutoffs),
      advancement: readAdvancement(e.advancement),
      // null = included in the base fee, which is also what a non-positive
      // or fractional stored value reads as. The write path refuses those.
      surchargeMnt:
        typeof e.surchargeMnt === 'number' && Number.isInteger(e.surchargeMnt) && e.surchargeMnt > 0
          ? e.surchargeMnt
          : null,
    };
    out.push(event);
  }
  return out;
}

// ── sections ───────────────────────────────────────────────────────────

/** Stored sections. Drops what it cannot understand, and supplies a
 *  DETERMINISTIC positional id (`s2`, `s2-b3`) for anything stored without
 *  one — the editor saves back whatever it read, and a fresh random id per
 *  GET would make every save look like a wholesale replacement.
 *
 *  Deliberately NOT a filter for "renderable": an admin must still see a
 *  video block whose url no longer parses, so they can fix it. What the
 *  public page shows is renderableSections' decision, below. */
export function normalizeStoredSections(raw: unknown): OnlineCompetitionSection[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionSection[] = [];
  for (const [index, entry] of (raw as unknown[]).entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const sec = entry as Record<string, unknown>;
    const title = typeof sec.title === 'string' ? sec.title : '';
    // No title: cannot be shown as a tab and cannot be saved back.
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
      // The same manifest the write path uses.
      for (const field of BLOCK_PAYLOAD_FIELDS[type]) {
        const value = b[field.key];
        if (typeof value !== 'string') continue;
        if (field.key === 'text') block.text = value;
        else if (field.key === 'imageUrl') block.imageUrl = value;
        else if (field.key === 'imagePublicId') block.imagePublicId = value;
        else if (field.key === 'videoUrl') block.videoUrl = value;
      }
      if (type === 'image' && !block.imageUrl) continue;
      if (type === 'video' && !block.videoUrl) continue;
      if (type === 'text' && block.text === undefined) block.text = '';
      blocks.push(block);
    }
    out.push({ id, title, blocks });
  }
  return out;
}

/** Whether a block would render ANYTHING on the public page.
 *
 *  Stricter than the normaliser on purpose. An empty text block is a legal
 *  draft state; a video block whose url no longer parses must stay
 *  visible to the admin so they can fix it. Neither should put a blank
 *  gap — or a blank tab — in front of an athlete. */
export function isRenderableBlock(block: OnlineCompetitionBlock): boolean {
  if (block.type === 'text') return typeof block.text === 'string' && block.text.trim().length > 0;
  if (block.type === 'image') return typeof block.imageUrl === 'string' && block.imageUrl.trim().length > 0;
  return typeof block.videoUrl === 'string' && parseVideoUrl(block.videoUrl) !== null;
}

/** The sections the public detail page shows as tabs, each holding only
 *  its renderable blocks, in array order. A section survives only with a
 *  non-empty title AND at least one renderable block — a tab that opens on
 *  nothing is worse than no tab, because the reader has already paid the
 *  click. */
export function renderableSections(sections: OnlineCompetitionSection[]): OnlineCompetitionSection[] {
  const out: OnlineCompetitionSection[] = [];
  for (const sec of sections) {
    if (!sec.title.trim()) continue;
    const blocks = sec.blocks.filter(isRenderableBlock);
    if (blocks.length > 0) out.push({ ...sec, blocks });
  }
  return out;
}

// ── schedule ───────────────────────────────────────────────────────────

/** Stored schedule. Drops rows whose required payload did not survive —
 *  a row that says nothing is worse on a timeline than no row. */
export function normalizeStoredSchedule(raw: unknown): OnlineCompetitionScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlineCompetitionScheduleEntry[] = [];
  for (const [index, item] of (raw as unknown[]).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.kind !== 'string' || !SCHEDULE_KINDS.includes(e.kind as OnlineCompetitionScheduleKind)) continue;
    const kind = e.kind as OnlineCompetitionScheduleKind;
    if (typeof e.durationMin !== 'number' || !Number.isFinite(e.durationMin) || e.durationMin <= 0) continue;
    const entry: OnlineCompetitionScheduleEntry = {
      id: typeof e.id === 'string' && e.id.trim() ? e.id.trim() : `sch${index + 1}`,
      // Recomputed by the editor on the next save; junk reads as 0 rather
      // than dropping an announced row.
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
    if (kind === 'round' && (!entry.eventId || entry.round === undefined)) continue;
    if (kind === 'other' && !entry.label) continue;
    out.push(entry);
  }
  return out;
}
