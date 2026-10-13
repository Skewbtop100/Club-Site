// Pure logic for the staged import of a past competition's results: rows are
// stored admin-only (competitions/{id}/private/importedResults_{eventId}) and
// revealed gradually as public imported results while club athletes finish
// each round. Everything here is deterministic given its inputs — the
// Firestore side lives in lib/firebase/services/staged-results.ts.
// Imported relatively (not via '@/') so scripts/test-results-import.ts can
// compile it standalone.

import { compareRoundResults } from './results-entry-helpers';
import type { AdvancementConfig, Result } from './types';
import type { ParsedResultRound } from './results-import';

export interface StagedRow {
  /** Stable id: event + round + the athlete's normalised name. */
  id: string;
  name: string;
  localName?: string;
  country?: string;
  solves: number[];
  single: number;
  average: number | null;
  /** Fixed random reveal order, assigned once at import. Lower reveals first. */
  order: number;
  /** Club athlete of this competition with the same name (display hint only). */
  matchedClubAthleteId?: string;
  /** Written as a public result. Never reset. */
  revealed?: boolean;
  /** Did not advance to this round in the combined (club + imported) ranking
   *  of the previous one — never revealed. */
  eliminated?: boolean;
}

/** One event's staged rows: round number (string key) → rows. */
export interface StagedEvent {
  eventId: string;
  rounds: Record<string, StagedRow[]>;
}

/** The fields of a result the reveal logic looks at; `Result` satisfies it. */
export type RoundResultLite = Pick<Result, 'id' | 'athleteId' | 'eventId' | 'single' | 'average'> &
  Partial<Pick<Result, 'athleteName' | 'round' | 'status' | 'source' | 'isPlaceholder'>>;

// ── names ────────────────────────────────────────────────────────────────────

/** Lower-case, diacritics stripped, punctuation and repeated spaces collapsed. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\s!-/:-@[-`{-~’]+/g, ' ').trim();
}

/** Order-insensitive name key: "Orgil Otgonbayar" and "Otgonbayar  ORGIL" match. */
export function nameKey(s: string): string {
  return normalizeName(s).split(' ').filter(Boolean).sort().join(' ');
}

/** The club athlete (of this competition) whose full name equals the row's
 *  name or local-script name, ignoring case, spacing, diacritics and word
 *  order. undefined when there is none. */
export function matchClubAthlete(
  row: { name: string; localName?: string },
  clubAthletes: { id: string; name: string; lastName?: string }[],
): string | undefined {
  const keys = [row.name, row.localName || ''].map(nameKey).filter(Boolean);
  return clubAthletes.find(a => {
    const key = nameKey(`${a.name || ''} ${a.lastName || ''}`);
    return !!key && keys.includes(key);
  })?.id;
}

// ── ids ──────────────────────────────────────────────────────────────────────

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Stable row id — the same athlete in the same event+round always gets the
 *  same id, however often the text is re-imported. */
export function stagedRowId(eventId: string, roundId: string, name: string): string {
  return `${eventId}_r${roundId}_${fnv1a(nameKey(name))}`;
}

/** Deterministic public result doc id for a revealed row: a retried or
 *  concurrent reveal overwrites the same document instead of adding one. */
export function stagedResultDocId(compId: string, rowId: string): string {
  return `impst_${compId}_${rowId}`;
}

/** A revealed row as a public result, in the existing imported-result shape
 *  (athleteId '', source 'imported', status 'published'). */
export function stagedRowToResult(
  comp: { id: string; name?: string }, eventId: string, round: number, row: StagedRow,
): Result {
  return {
    id: stagedResultDocId(comp.id, row.id),
    athleteId: '', athleteName: row.name, country: row.country || '',
    competitionId: comp.id, competitionName: comp.name || '',
    eventId, round,
    single: row.single, average: row.average, solves: row.solves,
    status: 'published', source: 'imported',
    importRowId: row.id,
    ...(row.localName ? { localName: row.localName } : {}),
    ...(row.matchedClubAthleteId ? { matchedClubAthleteId: row.matchedClubAthleteId } : {}),
  };
}

// ── import ───────────────────────────────────────────────────────────────────

/**
 * Merge freshly parsed rounds of ONE event into its staged rows.
 * For each round present in `parsed`: rows already revealed are kept exactly
 * as they are, every unrevealed row is replaced by the new import, and a
 * re-imported athlete who is already revealed is dropped rather than staged
 * twice. Rounds not in `parsed` are left untouched. New rows get a fixed
 * random reveal order (after anything already revealed).
 */
export function buildStagedEvent(
  existing: StagedEvent | undefined,
  eventId: string,
  parsed: ParsedResultRound[],
  clubAthletes: { id: string; name: string; lastName?: string }[],
  random: () => number = Math.random,
): StagedEvent {
  const rounds: Record<string, StagedRow[]> = { ...(existing?.rounds || {}) };
  for (const p of parsed) {
    if (p.eventId !== eventId) continue;
    const kept = (rounds[p.roundId] || []).filter(r => r.revealed);
    const keptIds = new Set(kept.map(r => r.id));
    const taken = new Set(keptIds);
    const fresh: Omit<StagedRow, 'order'>[] = [];
    for (const row of p.rows) {
      const base = stagedRowId(eventId, p.roundId, row.name);
      if (keptIds.has(base)) continue; // already revealed — never touched
      // Two different people with one name in the same round: keep both.
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
      taken.add(id);
      const matched = matchClubAthlete(row, clubAthletes);
      fresh.push({
        id, name: row.name, solves: row.solves, single: row.single, average: row.average,
        ...(row.localName ? { localName: row.localName } : {}),
        ...(row.country ? { country: row.country } : {}),
        ...(matched ? { matchedClubAthleteId: matched } : {}),
      });
    }
    // Fisher–Yates: a fixed random permutation, stored so it never changes.
    const perm = fresh.map((_, i) => i);
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const firstOrder = kept.reduce((max, r) => Math.max(max, r.order + 1), 0);
    rounds[p.roundId] = [...kept, ...fresh.map((r, i) => ({ ...r, order: firstOrder + perm[i] }))];
  }
  return { eventId, rounds };
}

// ── reveal math ──────────────────────────────────────────────────────────────

/**
 * How many of a round's M eligible imported rows should be public once k of
 * its N club athletes have finished: ceil(M·k/N). Everything when the round
 * is complete (or forced), or when no club athlete is expected (N = 0).
 */
export function revealTarget(M: number, k: number, N: number, all = false): number {
  if (M <= 0) return 0;
  if (all || N <= 0) return M;
  const done = Math.min(Math.max(0, k), N);
  return Math.min(M, Math.ceil(M * done / N));
}

function isClubResult(r: RoundResultLite): boolean {
  return !!r.athleteId && r.source !== 'imported' && r.source !== 'import';
}

function advancingKey(r: RoundResultLite): string {
  return r.athleteId ? `cl:${r.athleteId}` : `imp:${nameKey(r.athleteName || '')}`;
}

/** Results advancing from a round, from the combined ranking of everything
 *  in it (club + imported), with the existing fixed / percent rule — the same
 *  computation as CompResultsTab's next-round placeholders. */
export function computeAdvancing<T extends RoundResultLite>(roundResults: T[], advCfg: AdvancementConfig): T[] {
  const sorted = roundResults
    .filter(r => !r.isPlaceholder && r.status !== 'withdrawn')
    .sort(compareRoundResults);
  const rawCount = advCfg.type === 'fixed' ? advCfg.value : Math.floor(sorted.length * advCfg.value / 100);
  return sorted.slice(0, Math.min(Math.max(0, rawCount), sorted.length));
}

export interface StagedSyncInput {
  comp: { id: string; name?: string };
  eventId: string;
  staged: StagedEvent;
  /** Every result document of the competition as it stands now. */
  results: RoundResultLite[];
  /** eventConfig[eventId].advancement — round r (string) → rule for r → r+1. */
  advancement?: Record<string, AdvancementConfig>;
  /** competition.roundStatus ("{eventId}_r{round}" → 'complete' | 'ongoing'). */
  roundStatus?: Record<string, string>;
  /** Club athletes registered for this event (the round-1 field). */
  registeredClubIds: string[];
  /** Rounds to reveal completely right now ("Бүгдийг одоо нээх"). */
  forceRounds?: number[];
}

export interface StagedSyncPlan {
  /** `staged` with revealed/eliminated flags brought up to date. */
  staged: StagedEvent;
  /** True when `staged` differs from the input and needs writing. */
  changed: boolean;
  /** Public result documents to write (deterministic ids). */
  reveals: Result[];
}

/**
 * Bring one event's staged rows in line with the competition's current
 * state. Idempotent: it computes each round's target and returns only what
 * is missing, so running it twice (or from two admins at once) writes the
 * same documents. It never un-reveals: a row once revealed stays revealed
 * whatever happens to club results afterwards.
 *
 * Per round r, in order:
 *  - r ≥ 2 and round r-1 complete → eligibility: unrevealed rows whose
 *    athlete is not in round r-1's advancing set (combined ranking, counting
 *    the rows this very run reveals) are eliminated.
 *  - N = club athletes expected (round 1: registered for the event; later:
 *    club athletes who advanced), k = those with a finished result,
 *    M = eligible rows; target = revealTarget(M, k, N), everything when the
 *    round is complete or forced. A later round reveals nothing until the
 *    round before it is complete.
 */
export function planStagedSync(input: StagedSyncInput): StagedSyncPlan {
  const { comp, eventId, results, advancement, roundStatus = {}, registeredClubIds, forceRounds = [] } = input;
  const existingIds = new Set(results.map(r => r.id));
  // Results of this event, growing with the rows revealed along the way so a
  // later round's eligibility sees them.
  const sim: RoundResultLite[] = results.filter(r => r.eventId === eventId);
  const reveals: Result[] = [];
  let changed = false;
  const rounds: Record<string, StagedRow[]> = {};

  const roundNums = Object.keys(input.staged.rounds).map(Number).sort((a, b) => a - b);
  for (const r of roundNums) {
    const rows = input.staged.rounds[String(r)].map(row => ({ ...row }));
    rounds[String(r)] = rows;

    // A result document that exists IS revealed, even if a previous run died
    // before recording the flag.
    for (const row of rows) {
      if (!row.revealed && existingIds.has(stagedResultDocId(comp.id, row.id))) { row.revealed = true; changed = true; }
    }

    const prevComplete = r === 1 || roundStatus[`${eventId}_r${r - 1}`] === 'complete';
    const complete = roundStatus[`${eventId}_r${r}`] === 'complete';
    const forced = forceRounds.includes(r);

    const expected = new Set<string>(r === 1 ? registeredClubIds : []);
    if (r > 1 && prevComplete) {
      const advCfg = advancement?.[String(r - 1)];
      const advancing = advCfg ? computeAdvancing(sim.filter(x => (x.round || 1) === r - 1), advCfg) : null;
      const advancingKeys = advancing ? new Set(advancing.map(advancingKey)) : null;
      advancing?.filter(isClubResult).forEach(x => expected.add(x.athleteId));
      for (const row of rows) {
        if (row.revealed) continue;
        // No advancement rule configured → nobody is cut.
        const eliminated = advancingKeys ? !advancingKeys.has(`imp:${nameKey(row.name)}`) : false;
        if (!!row.eliminated !== eliminated) {
          if (eliminated) row.eliminated = true; else delete row.eliminated;
          changed = true;
        }
      }
    }

    const roundResults = sim.filter(x => (x.round || 1) === r && isClubResult(x));
    const finished = new Set(roundResults.filter(x => !x.isPlaceholder && x.status === 'published').map(x => x.athleteId));
    roundResults.forEach(x => expected.add(x.athleteId)); // placeholders + anyone entered regardless

    const eligible = rows.filter(row => row.revealed || !row.eliminated);
    const locked = !prevComplete && !complete && !forced;
    const target = locked ? 0 : revealTarget(eligible.length, finished.size, expected.size, complete || forced);
    const missing = target - eligible.filter(row => row.revealed).length;
    if (missing <= 0) continue;

    const picks = eligible.filter(row => !row.revealed).sort((a, b) => a.order - b.order).slice(0, missing);
    for (const row of picks) {
      row.revealed = true;
      changed = true;
      const result = stagedRowToResult(comp, eventId, r, row);
      reveals.push(result);
      sim.push(result);
    }
  }

  return { staged: { eventId, rounds }, changed, reveals };
}

/** Counts for a round's status line. `total` excludes eliminated rows. */
export function stagedRoundStatus(rows: StagedRow[]): { revealed: number; total: number; eliminated: number } {
  const eliminated = rows.filter(r => r.eliminated && !r.revealed).length;
  return { revealed: rows.filter(r => r.revealed).length, total: rows.length - eliminated, eliminated };
}
