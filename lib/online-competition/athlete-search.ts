// ── Searching the athlete list ───────────────────────────────────────────
// Pure — unit-tested in tests/competition-fields/athlete-search.test.cjs.
//
// Client-side on purpose: the verified-athletes page already holds the whole
// list (one admin-athletes read), a few hundred rows filter in well under a
// millisecond per keystroke, and Firestore has no case-insensitive substring
// search to ask instead.
//
// Matching: the query is split on whitespace and EVERY term must appear
// somewhere in surname, given name, email or WCA ID — so "бат ууган" finds
// Батжаргал Ууганбаяр, in either order. Both sides are NFKC-normalised and
// lower-cased with the standard Unicode mapping, which folds Cyrillic
// (including Mongolian Ө/Ү) as well as Latin.

export interface SearchableAthlete {
  lastName: string;
  firstName: string;
  email: string | null;
  wcaId?: string;
}

export function normalizeForSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function termsOf(query: string): string[] {
  return normalizeForSearch(query).split(' ').filter(Boolean);
}

export function athleteMatches(athlete: SearchableAthlete, query: string): boolean {
  const terms = termsOf(query);
  if (terms.length === 0) return true;
  const haystack = normalizeForSearch(
    [athlete.lastName, athlete.firstName, athlete.email ?? '', athlete.wcaId ?? ''].join(' '),
  );
  return terms.every((t) => haystack.includes(t));
}

/** The rows to show, in their original order. An empty or blank query
 *  shows every row. */
export function filterAthletes<T extends SearchableAthlete>(athletes: readonly T[], query: string): T[] {
  if (termsOf(query).length === 0) return [...athletes];
  return athletes.filter((a) => athleteMatches(a, query));
}
