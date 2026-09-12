// ── How a scramble is split into chunks ─────────────────────────────────
// The rule is arithmetic, so it is tested as arithmetic rather than read
// off the component. Chunks of five, except that a tail of exactly ONE
// move folds back into the chunk before it — and the result must still
// fit one row at 375px, which is what caps a chunk at six.
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
  CHUNK_SIZE,
  MAX_MOVES_PER_CHUNK,
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
  ok('the chunk size is five', CHUNK_SIZE === 5);
}

console.log('\n  -- the tail rule --');
{
  // THE CASE IT EXISTS FOR. A lone final move sat on screen for the same
  // five seconds as a full chunk, which reads as a glitch and stretches
  // the reveal by five seconds to deliver one move.
  ok('a tail of ONE folds into the chunk before it',
    sizes(21).join('/') === '5/5/5/6', sizes(21).join('/'));
  ok('  ...so no split ever ends in a chunk of one',
    Array.from({ length: 72 }, (_, i) => i + 9).every((n) => sizes(n).slice(-1)[0] !== 1));
  // A tail of two or more is a real chunk. Folding it would make a seven-
  // or eight-move chunk: a longer read than five seconds buys, and a
  // tighter row than 375px has.
  ok('a tail of TWO is left as its own chunk',
    sizes(7).join('/') === '5/2', sizes(7).join('/'));
  ok('  ...and a tail of four likewise',
    sizes(24).join('/') === '5/5/5/5/4', sizes(24).join('/'));
  // Nothing to fold into.
  ok('a one-move scramble is left alone', sizes(1).join('/') === '1');
  ok('a scramble of six is a single folded chunk', sizes(6).join('/') === '6', sizes(6).join('/'));
}

console.log('\n  -- what real scrambles get --');
{
  const table = [
    ['2x2   11', 11, '5/6'],
    ['3x3   20', 20, '5/5/5/5'],
    ['3x3   21', 21, '5/5/5/6'],
    ['      26', 26, '5/5/5/5/6'],
    ['4x4   40', 40, '5/5/5/5/5/5/5/5'],
  ];
  for (const [name, n, expected] of table) {
    ok(`${name} moves -> ${expected}`, sizes(n).join('/') === expected, sizes(n).join('/'));
  }
}

console.log('\n  -- one row at 375px, across every plausible length --');
{
  // 9 (skewb) through 80 (7x7) covers every event this platform runs.
  let widest = 0;
  for (let n = 1; n <= 80; n++) {
    const s = sizes(n);
    widest = Math.max(widest, ...s);
    if (s.reduce((a, b) => a + b, 0) !== n) ok(`all ${n} moves are placed`, false, s.join('/'));
  }
  // THE CAP THE ROW IS SIZED AGAINST. The reveal's grid gives one column
  // per move; six across 343px is about 52px a tile, which holds a
  // three-character move comfortably. The splitter may never exceed it.
  ok(`no chunk is ever wider than ${MAX_MOVES_PER_CHUNK} moves`,
    widest <= MAX_MOVES_PER_CHUNK, `widest was ${widest}`);
  ok('  ...which is the chunk size plus the one a fold adds',
    MAX_MOVES_PER_CHUNK === CHUNK_SIZE + 1);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
