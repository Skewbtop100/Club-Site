// ── Splitting a scramble into chunks the athlete reads at a glance ─────
// Pure — no React, no DOM — so the arithmetic is unit-tested directly
// rather than only looked at.

/** The most moves that still fit ONE ROW at 375px and stay readable.
 *
 *  Not a taste call: the reveal row is a grid of N equal columns across
 *  the 343px a 375px screen leaves, so N tiles are 343/N wide minus gaps.
 *  At 8 that is about 37px a tile, which still holds a three-character
 *  move like "Rw'". At 9 it is 33px and they collide. A chunk that wraps
 *  to a second row stops being a chunk — the whole point is that it is
 *  taken in at a glance. */
export const MAX_MOVES_PER_CHUNK = 8;

/** What a scramble is split into when it can be: three chunks or four.
 *  Fewer than three is not a reveal, and more than four turns a 20-move
 *  scramble into a slideshow. Longer scrambles fall past these — see
 *  chunkCountFor. */
export const PREFERRED_CHUNK_COUNTS = [3, 4];

/** Lower is better, compared left to right.
 *
 *  1. An EXACT division wins outright. Four chunks of five beats three of
 *     7/7/6 for a 20-move scramble, which is what "divides better" means.
 *  2. Otherwise the split with the biggest SMALLEST chunk wins, because
 *     the thing worth avoiding is a chunk holding almost nothing. For 11
 *     moves that picks 4/4/3 over 3/3/3/2.
 *  3. Ties go to fewer chunks — a shorter ceremony for the same evenness. */
function rank(total: number, count: number): [number, number, number] {
  return [total % count === 0 ? 0 : 1, -Math.floor(total / count), count];
}

function better(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** How many chunks a scramble of `total` moves is shown in.
 *
 *  The old rule was a fixed chunk SIZE of five, which is why an 11-move
 *  2x2 scramble ended 5/5/1 — a final chunk holding one move, on screen
 *  for the same five seconds as a full one. The count is chosen from the
 *  length now, and the moves are then spread evenly across it, so no
 *  chunk can be left holding a remainder.
 *
 *  A long scramble cannot have three or four chunks AND fit one row, and
 *  the row wins: a 4x4's 40-odd moves would be 10+ to a chunk, which is
 *  two rows at 375px however the tiles are sized. Past that point the
 *  count grows until the chunks fit. */
export function chunkCountFor(total: number): number {
  if (total <= 0) return 1;
  const fits = (count: number) => Math.ceil(total / count) <= MAX_MOVES_PER_CHUNK;

  const candidates = PREFERRED_CHUNK_COUNTS.filter((count) => count <= total && fits(count));
  if (candidates.length > 0) {
    return candidates.reduce((best, count) => (better(rank(total, count), rank(total, best)) ? count : best));
  }

  // Short enough to be one row on its own — a scramble this brief does
  // not need chunking at all.
  if (total <= MAX_MOVES_PER_CHUNK) return 1;

  // Too long for the preferred counts. Add chunks until they fit a row.
  let count = Math.max(...PREFERRED_CHUNK_COUNTS) + 1;
  while (count < total && !fits(count)) count += 1;
  return count;
}

/** Splits a scramble into `chunkCountFor(moves)` chunks of as near the
 *  same length as the move count allows.
 *
 *  The longer chunks come FIRST. A remainder has to land somewhere, and
 *  the end of the reveal is the worst place for it: the last chunk is the
 *  one the athlete carries into the cube, and a short one there reads as
 *  the reveal having been cut off. */
export function splitScrambleIntoChunks(scramble: string): string[] {
  const moves = scramble.trim().split(/\s+/).filter(Boolean);
  if (moves.length === 0) return [''];

  const count = chunkCountFor(moves.length);
  const base = Math.floor(moves.length / count);
  const withExtra = moves.length % count;

  const chunks: string[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    const size = base + (i < withExtra ? 1 : 0);
    chunks.push(moves.slice(at, at + size).join(' '));
    at += size;
  }
  return chunks;
}
