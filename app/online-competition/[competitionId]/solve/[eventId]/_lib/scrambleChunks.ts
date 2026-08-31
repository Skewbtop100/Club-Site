/** Splits a scramble string into fixed-size groups of `groupSize` moves
 *  each, for the `scrambleReveal` state's one-group-at-a-time reveal.
 *  Group COUNT is dynamic (Math.ceil(totalMoves / groupSize)) — a longer
 *  scramble (e.g. bigger cubes) just gets more groups, not bigger ones. */
export function splitScrambleIntoGroups(scramble: string, groupSize = 5): string[] {
  const moves = scramble.trim().split(/\s+/).filter(Boolean);
  const groups: string[] = [];
  for (let i = 0; i < moves.length; i += groupSize) {
    groups.push(moves.slice(i, i + groupSize).join(' '));
  }
  return groups.length > 0 ? groups : [''];
}
