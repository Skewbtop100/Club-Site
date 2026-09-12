// ── Splitting a scramble into chunks the athlete reads at a glance ─────
// Pure — no React, no DOM — so the arithmetic is unit-tested directly
// rather than only looked at.

/** Moves per chunk. Five is the rhythm the reveal is built around: five
 *  moves, five seconds, one row. */
export const CHUNK_SIZE = 5;

/** The most moves a chunk can end up holding, which is CHUNK_SIZE plus
 *  the one a folded tail adds. The reveal row is a grid of one column per
 *  move across the 343px a 375px screen leaves, so six tiles are about
 *  52px each — comfortably wider than a three-character move like "Rw'".
 *  A chunk that wrapped to a second row would stop being a chunk. */
export const MAX_MOVES_PER_CHUNK = CHUNK_SIZE + 1;

/** Splits a scramble into chunks of CHUNK_SIZE, except that a tail of
 *  exactly ONE move is folded back into the chunk before it.
 *
 *  WHY THE FOLD: a 21-move scramble is 5/5/5/5/1, and that final chunk
 *  sits on screen for the same five seconds as a full one to show a
 *  single move. It reads as the reveal having glitched, and it stretches
 *  the ceremony by five seconds to deliver one move's worth of
 *  information. Six moves in one chunk for five seconds is the better
 *  trade — it is one more tile on a row that has room for it.
 *
 *  ONLY a tail of one. A tail of two or more is a real chunk and stays
 *  its own: folding it would make a seven- or eight-move chunk, which is
 *  both a longer read than five seconds buys and a tighter row.
 *
 *  Nothing to fold into when the whole scramble is one move, so that case
 *  is left alone. */
export function splitScrambleIntoChunks(scramble: string): string[] {
  const moves = scramble.trim().split(/\s+/).filter(Boolean);
  if (moves.length === 0) return [''];

  const chunks: string[][] = [];
  for (let i = 0; i < moves.length; i += CHUNK_SIZE) {
    chunks.push(moves.slice(i, i + CHUNK_SIZE));
  }

  const last = chunks[chunks.length - 1];
  if (chunks.length > 1 && last.length === 1) {
    chunks[chunks.length - 2].push(...last);
    chunks.pop();
  }

  return chunks.map((c) => c.join(' '));
}
