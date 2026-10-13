// Who holds the WCA records (WR / Asian CR / Mongolian NR), where and when
// they were set — so the record-break card can show the previous holder for
// a national-or-higher record the same way it does for a club record.
//
// SOURCE: the official WCA API, the same host the record VALUES already come
// from (api.worldcubeassociation.org/records):
//   GET /results/records?region=world | _Asia | MN   holder + competition per record
//   GET /competitions/{id}                            the competition's start date
// The values are not taken from here — they stay exactly what /records gives;
// a holder is attached only when its value equals the stored value.
//
// This file is the pure part (picking holders out of the API's rows), unit-
// tested in scripts/test-wca-record-holders.ts and imported relatively so
// that script compiles standalone. The fetching is in lib/wca-api.ts.

/** One row of GET /results/records → records[eventId][]. */
export interface WcaApiRecordRow {
  type: 'single' | 'average';
  /** The record, in the API's units (centiseconds for timed events). */
  value: number;
  person_id: string;
  person_name: string;
  competition_id: string;
  competition_name?: string;
}

/** Stored next to a record's value in wcaRecords/{eventId}. */
export interface WcaRecordHolder {
  holderName: string;
  /** Name in local script, when the WCA name carries one in parentheses. */
  holderLocalName?: string;
  holderWcaId: string;
  competitionId: string;
  competitionName: string;
  /** The competition's start date, "YYYY-MM-DD"; absent if it couldn't be fetched. */
  date?: string;
}

/** eventId → the holder of its single and of its average record, each with
 *  the value it was picked for (to check against the stored value). */
export type WcaHolderMap = Record<string, { single?: WcaRecordHolder & { value: number }; average?: WcaRecordHolder & { value: number } }>;

/** "Xuanyi Geng (耿暄一)" → name + local name. */
export function splitWcaName(raw: string): { name: string; localName?: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(raw || '');
  if (!m || !m[1].trim()) return { name: (raw || '').trim() };
  return { name: m[1].trim(), ...(m[2].trim() ? { localName: m[2].trim() } : {}) };
}

/** Every competition the rows refer to — the ones whose dates are needed. */
export function competitionIdsOf(records: Record<string, WcaApiRecordRow[]>, events?: Set<string>): string[] {
  const ids = new Set<string>();
  for (const [eventId, rows] of Object.entries(records || {})) {
    if (events && !events.has(eventId)) continue;
    for (const row of rows || []) if (row.competition_id) ids.add(row.competition_id);
  }
  return [...ids];
}

/**
 * The holder of each event's single and average record.
 *
 * A record can be TIED — several people, or one person at several
 * competitions, on the same value (the Asian FMC single has a dozen). The
 * holder is then whoever set it first: the row from the earliest
 * competition; rows whose competition date is unknown come last, and the
 * API's own order breaks what is left.
 *
 * `dates` = competition id → start date ("YYYY-MM-DD").
 */
export function pickRecordHolders(
  records: Record<string, WcaApiRecordRow[]>,
  dates: Record<string, string | undefined>,
  events?: Set<string>,
): WcaHolderMap {
  const out: WcaHolderMap = {};
  for (const [eventId, rows] of Object.entries(records || {})) {
    if (events && !events.has(eventId)) continue;
    for (const type of ['single', 'average'] as const) {
      const ofType = (rows || []).filter(r => r.type === type && typeof r.value === 'number' && r.person_name);
      if (ofType.length === 0) continue;
      const best = Math.min(...ofType.map(r => r.value));
      const first = ofType
        .filter(r => r.value === best)
        .map((r, i) => ({ r, i, date: dates[r.competition_id] || '' }))
        .sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : 0) || a.i - b.i)[0];
      const { name, localName } = splitWcaName(first.r.person_name);
      (out[eventId] ??= {})[type] = {
        value: best,
        holderName: name,
        ...(localName ? { holderLocalName: localName } : {}),
        holderWcaId: first.r.person_id || '',
        competitionId: first.r.competition_id || '',
        competitionName: first.r.competition_name || first.r.competition_id || '',
        ...(first.date ? { date: first.date } : {}),
      };
    }
  }
  return out;
}

/**
 * The holder to store next to a record value — only when it is the holder
 * OF THAT VALUE. `storedCs` is the value the site stores (centiseconds, from
 * /records); if the holder list has moved on (a record broken between the
 * two requests) the holder is left out rather than attached to the wrong
 * number.
 */
export function holderFor(
  holders: WcaHolderMap | undefined, eventId: string, type: 'single' | 'average', storedCs: number | null | undefined,
): WcaRecordHolder | undefined {
  const h = holders?.[eventId]?.[type];
  if (!h || storedCs == null || h.value !== storedCs) return undefined;
  const { value: _value, ...holder } = h;
  return holder;
}

/** A stored wcaRecords/{eventId} document, as far as this file cares. */
type StoredRecords = Partial<Record<'single' | 'average', Partial<Record<'WR' | 'CR' | 'NR' | 'TR', { value?: number }>>>>;

/**
 * Holders for one event's ALREADY STORED records, without touching a single
 * stored value — the one-time backfill for records saved before holders
 * existed.
 *
 * A stored value gets a holder only if it is still the current record (the
 * API's holder is for exactly that value). A stored value that has since
 * been beaten (or corrected) on the WCA side is reported as `stale` and left
 * exactly as it is — its holder can't be known from the current record list;
 * refreshing and saving the values is what brings it up to date.
 *
 * Each update is a whole entry ({ value, ...holder }) for one type+level,
 * with `value` the stored number, bit for bit.
 */
export function attachHoldersToStored(
  eventId: string,
  stored: StoredRecords,
  holdersByLevel: Partial<Record<'WR' | 'CR' | 'NR', WcaHolderMap>>,
): {
  updates: { type: 'single' | 'average'; level: 'WR' | 'CR' | 'NR'; entry: { value: number } & WcaRecordHolder }[];
  stale: { type: 'single' | 'average'; level: 'WR' | 'CR' | 'NR'; stored: number; current: number }[];
} {
  const updates: ReturnType<typeof attachHoldersToStored>['updates'] = [];
  const stale: ReturnType<typeof attachHoldersToStored>['stale'] = [];
  for (const type of ['single', 'average'] as const) {
    for (const level of ['WR', 'CR', 'NR'] as const) {
      const value = stored?.[type]?.[level]?.value;
      if (typeof value !== 'number') continue;
      // Stored in seconds (cs / 100); back to the whole centiseconds it came from.
      const cs = Math.round(value * 100);
      const holder = holderFor(holdersByLevel[level], eventId, type, cs);
      if (holder) updates.push({ type, level, entry: { value, ...holder } });
      else {
        const current = holdersByLevel[level]?.[eventId]?.[type]?.value;
        if (current !== undefined && current !== cs) stale.push({ type, level, stored: cs, current });
      }
    }
  }
  return { updates, stale };
}
