// ── Official scramble import + group assignment ────────────────────────
// Pure logic shared by the admin UI (client-side preview parse) and the
// admin API routes (authoritative re-parse before writing). Nothing here
// touches Firestore or the DOM, so both sides run byte-identical
// validation and the server never has to trust a client-parsed payload.

/** onlineCompetitions/{competitionId}/scrambleData/{eventId}_{round} — one
 *  group's five official scrambles. `label` is the human-facing group name
 *  ("A", "B", ...) and is stored rather than derived at render time so a
 *  later change to the labelling scheme can't silently rename groups that
 *  athletes have already been told they're in. */
export interface ScrambleGroup {
  label: string;
  scrambles: string[];
}

export interface ScrambleRoundData {
  eventId: string;
  round: number;
  groupCount: number;
  groups: ScrambleGroup[];
}

/** onlineCompetitions/{competitionId}/groupAssignments/{eventId}_{round} */
export interface GroupAssignmentsDoc {
  /** uid -> index into the round's `groups` array. */
  assignments: Record<string, number>;
}

/** Attempts per round the solve flow records (Ao5). A scramble set with
 *  fewer than this can't drive a full round, so such rounds are reported
 *  as skipped rather than imported half-usable. */
export const SCRAMBLES_PER_GROUP = 5;

/** Firestore doc id for both subcollections. */
export function roundKey(eventId: string, round: number): string {
  return `${eventId}_${round}`;
}

/** A -> Z, then AA, AB, ... — the WCA group-naming convention. Practically
 *  only the first few are ever used, but a 27-group round shouldn't
 *  collide two groups onto the same label. */
export function groupLabel(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

// ── TNoodle JSON parsing ─────────────────────────────────────────────────

export interface ParseWarning {
  eventId: string;
  round: number;
  reason: string;
}

export interface ParseSuccess {
  ok: true;
  rounds: ScrambleRoundData[];
  /** Rounds present in the file but deliberately not imported (e.g. a
   *  3-scramble blindfolded set) — surfaced in the admin preview so a
   *  missing round is never a silent drop. */
  warnings: ParseWarning[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "333-r1" -> 1. WCA round ids always end in `-r<n>`; anything else means
 *  the file isn't the export we think it is. */
function parseRoundNumber(roundId: unknown): number | null {
  if (typeof roundId !== 'string') return null;
  const m = /-r(\d+)$/.exec(roundId);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Parses a TNoodle/WCIF scramble export into per-round group data.
 *
 *  Accepts either the bare `{ events: [...] }` shape or a full export that
 *  nests the same array under `wcif` — TNoodle writes both depending on
 *  which download you take, and rejecting the second would look like a
 *  broken file to the admin. Every failure returns a Mongolian message
 *  naming what was wrong; nothing is ever dropped silently. */
export function parseTnoodleJson(raw: unknown): ParseResult {
  if (!isObject(raw)) {
    return { ok: false, error: 'JSON файлын бүтэц буруу байна (объект байх ёстой).' };
  }

  const wcif = isObject(raw.wcif) ? raw.wcif : raw;
  const events = wcif.events;
  if (!Array.isArray(events)) {
    return {
      ok: false,
      error:
        'JSON бүтэц таарахгүй байна: "events" массив олдсонгүй. WCA TNoodle-ийн холилтын JSON файлыг сонгоно уу.',
    };
  }
  if (events.length === 0) {
    return { ok: false, error: 'Файлд ямар нэг төрөл (event) байхгүй байна.' };
  }

  const rounds: ScrambleRoundData[] = [];
  const warnings: ParseWarning[] = [];

  for (const event of events) {
    if (!isObject(event) || typeof event.id !== 'string' || !event.id) {
      return { ok: false, error: 'Төрлийн бүтэц буруу байна: "events[].id" олдсонгүй.' };
    }
    const eventId = event.id;
    if (!Array.isArray(event.rounds)) {
      return { ok: false, error: `"${eventId}" төрөлд "rounds" массив олдсонгүй.` };
    }

    for (let i = 0; i < event.rounds.length; i++) {
      const round = event.rounds[i];
      if (!isObject(round)) {
        return { ok: false, error: `"${eventId}" төрлийн раундын бүтэц буруу байна.` };
      }
      // Fall back to array position when the id is missing or non-standard,
      // so a slightly off-spec export still imports in the right order.
      const roundNumber = parseRoundNumber(round.id) ?? i + 1;

      const sets = round.scrambleSets;
      if (!Array.isArray(sets)) {
        return {
          ok: false,
          error: `"${eventId}" төрлийн ${roundNumber}-р раундад "scrambleSets" массив олдсонгүй.`,
        };
      }
      if (sets.length === 0) {
        warnings.push({ eventId, round: roundNumber, reason: 'групп (scrambleSet) байхгүй' });
        continue;
      }

      const groups: ScrambleGroup[] = [];
      let skipReason = '';
      for (let g = 0; g < sets.length; g++) {
        const set = sets[g];
        if (!isObject(set) || !Array.isArray(set.scrambles)) {
          return {
            ok: false,
            error: `"${eventId}" төрлийн ${roundNumber}-р раундын ${groupLabel(g)} группэд "scrambles" массив олдсонгүй.`,
          };
        }
        // `extraScrambles` (replacements for a spoiled attempt) are
        // deliberately ignored for now — there is no re-scramble flow to
        // hand them to yet.
        const scrambles = set.scrambles.filter(
          (s: unknown): s is string => typeof s === 'string' && s.trim() !== '',
        );
        if (scrambles.length < SCRAMBLES_PER_GROUP) {
          skipReason = `нэг группэд ${SCRAMBLES_PER_GROUP} холилт байх ёстой (${scrambles.length} байна)`;
          break;
        }
        groups.push({ label: groupLabel(g), scrambles: scrambles.slice(0, SCRAMBLES_PER_GROUP) });
      }

      if (skipReason) {
        warnings.push({ eventId, round: roundNumber, reason: skipReason });
        continue;
      }
      rounds.push({ eventId, round: roundNumber, groupCount: groups.length, groups });
    }
  }

  if (rounds.length === 0) {
    const detail =
      warnings.length > 0
        ? ` (${warnings.map((w) => `${w.eventId} раунд ${w.round}: ${w.reason}`).join('; ')})`
        : '';
    return { ok: false, error: `Импортлох боломжтой раунд олдсонгүй${detail}.` };
  }

  rounds.sort((a, b) => a.eventId.localeCompare(b.eventId) || a.round - b.round);
  return { ok: true, rounds, warnings };
}

// ── Snake-seeded auto-assignment ─────────────────────────────────────────

export interface SeedableAthlete {
  uid: string;
  /** Best single for the round's event, centiseconds; null when the
   *  athlete has no approved result for it yet. */
  pr: number | null;
  /** Registration timestamp (epoch ms) — the tiebreaker, and the sole
   *  ordering for athletes with no pr. */
  registeredAt: number | null;
}

/** Fastest first, then everyone without a pr in registration order.
 *  Sorting is fully deterministic (uid as the final tiebreaker) so
 *  re-running auto-assignment on unchanged data reproduces the same
 *  groups rather than shuffling athletes around. */
export function rankAthletes(athletes: SeedableAthlete[]): SeedableAthlete[] {
  return [...athletes].sort((a, b) => {
    const aHas = a.pr !== null;
    const bHas = b.pr !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.pr !== b.pr) return (a.pr as number) - (b.pr as number);
    const aReg = a.registeredAt ?? Number.MAX_SAFE_INTEGER;
    const bReg = b.registeredAt ?? Number.MAX_SAFE_INTEGER;
    if (aReg !== bReg) return aReg - bReg;
    return a.uid.localeCompare(b.uid);
  });
}

/** Snake ("boustrophedon") seeding across `groupCount` groups: the ranked
 *  list fills A, B, C, then reverses back through C, B, A, and so on.
 *  This is the standard way to balance average group strength — a plain
 *  round-robin would stack every group's seed advantage into group A. */
export function snakeSeed(rankedUids: string[], groupCount: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (groupCount < 1) return out;
  rankedUids.forEach((uid, i) => {
    const cycle = Math.floor(i / groupCount);
    const pos = i % groupCount;
    out[uid] = cycle % 2 === 0 ? pos : groupCount - 1 - pos;
  });
  return out;
}

/** rankAthletes + snakeSeed — the whole auto-assignment in one call. */
export function autoAssign(athletes: SeedableAthlete[], groupCount: number): Record<string, number> {
  return snakeSeed(rankAthletes(athletes).map((a) => a.uid), groupCount);
}
