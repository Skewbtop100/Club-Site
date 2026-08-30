/** Splits a scramble string into 4 roughly-equal chunks of moves, for the
 *  `reveal` state's sequential reveal. Practical scrambles always have
 *  well more than 4 moves, so this never produces an empty chunk in
 *  practice. */
export function splitScrambleIntoChunks(scramble: string, chunkCount = 4): string[] {
  const moves = scramble.trim().split(/\s+/).filter(Boolean);
  const perChunk = Math.ceil(moves.length / chunkCount);
  const chunks: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(moves.slice(i * perChunk, (i + 1) * perChunk).join(' '));
  }
  return chunks;
}
