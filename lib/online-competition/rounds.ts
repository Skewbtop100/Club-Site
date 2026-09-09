// ── Round management (Раунд удирдах) ────────────────────────────────────
// Pure types + selection maths shared by the admin UI and the API routes.
// Nothing here touches Firestore or the DOM.
//
// Doc ids in both subcollections use the same `${eventId}_${round}` key as
// scrambleData/groupAssignments — see roundKey in ./scrambles, which this
// module deliberately reuses rather than defining a second format.

/** onlineCompetitions/{id}/roundState/{eventId}_{round}
 *
 *  'closed' — not accepting attempts (the implicit state of a round with
 *             no doc at all).
 *  'live'   — the one round athletes may currently attempt for this event.
 *  'done'   — finished; no new attempts. Reached either by closing the
 *             round or by advancing it.
 */
export type RoundStatus = 'closed' | 'live' | 'done';

export type QualifierMethod = 'count' | 'percent';

export interface RoundStateDoc {
  status: RoundStatus;
  /** epoch ms of the last time this round was opened; null if never. */
  openedAt: number | null;
  qualifierMethod: QualifierMethod | null;
  qualifierValue: number | null;
}

/** onlineCompetitions/{id}/qualifiers/{eventId}_{round} — who advanced OUT
 *  of this round, i.e. who may attempt round+1. */
export interface QualifiersDoc {
  uids: string[];
}

export const ROUND_STATUSES: RoundStatus[] = ['closed', 'live', 'done'];

export function normalizeRoundStatus(value: unknown): RoundStatus {
  return ROUND_STATUSES.includes(value as RoundStatus) ? (value as RoundStatus) : 'closed';
}

/** One athlete's standing in a round, best first. Only athletes with a
 *  real (non-DNF) Ao5 are ever ranked — see rankRoundResults. */
export interface RoundRanking {
  uid: string;
  displayName: string;
  /** The round's ranking value — an average for ao5/mo3, the best single
   *  for bo3/bo2/bo1. Renamed from `ao5`, which was a lie for Mo3 and
   *  meaningless for Bo-N; free to rename because this type is in-memory
   *  and its one wire shape (QualifyResponse) is consumed only by
   *  RoundsManager in this repo. */
  value: number;
  /** Best single of the round — the WCA tie-break for equal values. null
   *  only if every attempt DNF'd, which cannot coexist with a non-null
   *  value. */
  best: number | null;
  attempts: number;
}

/** Top N (count) or top N% floored (percent) of the ranked list.
 *
 *  Athletes without a complete, non-DNF Ao5 never appear in `ranked` at
 *  all, so they can't qualify — that exclusion happens upstream, in
 *  rankRoundResults, rather than being re-decided here.
 *
 *  Percent floors deliberately: "top 50%" of 7 athletes advances 3, not 4.
 *  A value that resolves to 0 qualifies nobody, which is a legitimate (if
 *  unlikely) admin choice and is surfaced in the preview before commit. */
export function selectQualifiers(
  ranked: RoundRanking[],
  method: QualifierMethod,
  value: number,
): RoundRanking[] {
  if (!Number.isFinite(value) || value <= 0) return [];
  const take =
    method === 'count'
      ? Math.floor(value)
      : Math.floor((ranked.length * Math.min(value, 100)) / 100);
  return ranked.slice(0, Math.max(0, Math.min(take, ranked.length)));
}

/** Mongolian validation message, or null when the input is usable. */
export function validateQualifierInput(method: QualifierMethod, value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return 'Утга 0-ээс их байх ёстой.';
  }
  if (method === 'percent' && value > 100) {
    return 'Хувь 100-аас их байж болохгүй.';
  }
  if (method === 'count' && !Number.isInteger(value)) {
    return 'Тамирчны тоо бүхэл тоо байх ёстой.';
  }
  return null;
}
