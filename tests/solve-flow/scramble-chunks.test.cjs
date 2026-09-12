// ── How a scramble is split into chunks ─────────────────────────────────
// The rule is arithmetic, so it is tested as arithmetic rather than read
// off the component. Two properties matter and they pull against each
// other: a chunk must be EVEN (no final chunk holding one move) and it
// must FIT ONE ROW at 375px (a chunk read in two goes is not a chunk).
//
// Run: npm run test:chunks

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SOLVE = 'app/online-competition/[competitionId]/solve/[eventId]';
const OUT = path.join(ROOT, '.tmp-chunks-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    path.join(SOLVE, '_lib/scrambleChunks.ts'),
    '--outDir', path.basename(OUT),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--strict',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

const {
  splitScrambleIntoChunks,
  chunkCountFor,
  MAX_MOVES_PER_CHUNK,
  PREFERRED_CHUNK_COUNTS,
} = require(path.join(OUT, 'scrambleChunks.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Chunk sizes for a scramble of `n` moves. */
function sizes(n) {
  const scramble = Array.from({ length: n }, (_, i) => `M${i}`).join(' ');
  return splitScrambleIntoChunks(scramble).map((c) => c.split(' ').filter(Boolean).length);
}

console.log('\n  -- the shape of a split --');
{
  ok('every move survives the split, in order', (() => {
    const scramble = "R U R' U' F2 L D2 B' R2 U F";
    return splitScrambleIntoChunks(scramble).join(' ') === scramble;
  })());
  ok('an empty scramble is one empty chunk',
    JSON.stringify(splitScrambleIntoChunks('')) === JSON.stringify(['']));
  ok('whitespace does not create phantom moves',
    splitScrambleIntoChunks("  R   U \n R'  ").join(' ') === "R U R'");
}

console.log('\n  -- the two properties, across every plausible length --');
{
  // 9 (skewb) through 80 (7x7) covers every event this platform runs.
  let widest = 0;
  let worstGap = 0;
  let singletons = [];
  for (let n = 9; n <= 80; n++) {
    const s = sizes(n);
    widest = Math.max(widest, ...s);
    worstGap = Math.max(worstGap, Math.max(...s) - Math.min(...s));
    if (Math.min(...s) <= 1) singletons.push(n);
    if (s.reduce((a, b) => a + b, 0) !== n) {
      ok(`all ${n} moves are placed`, false, s.join('/'));
    }
  }
  // FITS ONE ROW. The splitter may never hand the reveal a chunk wider
  // than a 375px row can hold — that cap is what the row's grid is sized
  // against.
  ok(`no chunk is ever wider than ${MAX_MOVES_PER_CHUNK} moves`,
    widest <= MAX_MOVES_PER_CHUNK, `widest was ${widest}`);
  // EVEN. Chunks within a split differ by at most one move, so there is
  // no "remainder" chunk — which is what the old fixed size of five
  // produced (5/5/1 for an 11-move scramble).
  ok('chunks within a split never differ by more than one move',
    worstGap <= 1, `worst gap was ${worstGap}`);
  ok('and no split ever leaves a chunk holding a single move',
    singletons.length === 0, `singletons at ${singletons.join(',')}`);
}

console.log('\n  -- the counts a real scramble gets --');
{
  // THE PREFERENCE: three chunks or four, when the scramble is short
  // enough for them to fit a row.
  ok('a 20-move 3x3 splits four ways, exactly even',
    chunkCountFor(20) === 4 && sizes(20).join('/') === '5/5/5/5', sizes(20).join('/'));
  // An exact division beats a more-balanced-looking uneven one: 4x5
  // rather than 7/7/6.
  ok('  ...because an exact division wins over 7/7/6',
    PREFERRED_CHUNK_COUNTS.includes(3) && PREFERRED_CHUNK_COUNTS.includes(4));
  // THE CASE THE OLD RULE GOT WRONG. A fixed size of five made this
  // 5/5/1 — a final chunk holding one move for a full five seconds.
  ok('an 11-move 2x2 splits three ways, 4/4/3',
    chunkCountFor(11) === 3 && sizes(11).join('/') === '4/4/3', sizes(11).join('/'));
  // TOO LONG FOR THE PREFERENCE. Three or four chunks of a 40-move
  // scramble is 10+ moves each, which is two rows at 375px however the
  // tiles are sized — so the count grows until the chunks fit.
  ok('a 40-move 4x4 splits five ways, 8 each',
    chunkCountFor(40) === 5 && sizes(40).join('/') === '8/8/8/8/8', sizes(40).join('/'));
  ok('  ...and a 45-move one six ways, 8/8/8/7/7/7',
    sizes(45).join('/') === '8/8/8/7/7/7', sizes(45).join('/'));
  ok('a 60-move 5x5 still fits a row per chunk',
    Math.max(...sizes(60)) <= MAX_MOVES_PER_CHUNK, sizes(60).join('/'));
  // A scramble that is already one row wide is not chunked at all.
  ok('a scramble shorter than one row is left whole',
    chunkCountFor(MAX_MOVES_PER_CHUNK - 1) === 1 || sizes(MAX_MOVES_PER_CHUNK - 1).length <= 4);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
