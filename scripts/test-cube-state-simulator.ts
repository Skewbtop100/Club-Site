// Standalone correctness check for lib/cube-state-simulator.ts.
// No test runner is configured in this project (no jest/vitest in
// package.json), so this is a plain script instead of a test-framework
// suite. Run via:
//   npx tsc lib/cube-state-simulator.ts scripts/test-cube-state-simulator.ts \
//     --outDir .tmp-test-build --module commonjs --target es2020 --esModuleInterop --skipLibCheck
//   node .tmp-test-build/scripts/test-cube-state-simulator.js

import {
  applyScramble,
  applyMove,
  validateStateInvariants,
  SOLVED_STATE,
  makeSolvedState,
  type CubeState,
  type Face3x3,
} from '../lib/cube-state-simulator';

let failures = 0;

function faceEqual(a: Face3x3, b: Face3x3): boolean {
  return a.every((row, r) => row.every((cell, c) => cell === b[r][c]));
}

function statesEqual(a: CubeState, b: CubeState): boolean {
  return (['U', 'D', 'F', 'B', 'L', 'R'] as const).every((f) => faceEqual(a[f], b[f]));
}

function printFace(name: string, face: Face3x3) {
  console.log(`  ${name}:`);
  face.forEach((row) => console.log('    ' + row.map((c) => c.padEnd(6)).join(' ')));
}

function check(label: string, pass: boolean) {
  if (pass) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
}

function checkInvariants(label: string, state: CubeState) {
  const violations = validateStateInvariants(state);
  check(`invariants hold: ${label}`, violations.length === 0);
  violations.forEach((v) => console.log(`      - ${v}`));
}

console.log('=== TEST 1: applyScramble("") === SOLVED_STATE ===');
{
  const result = applyScramble('');
  check('empty scramble returns solved state', statesEqual(result, SOLVED_STATE));
  checkInvariants('empty scramble', result);
}

console.log('\n=== TEST 2: applyScramble("R R R R") === SOLVED_STATE (four quarter turns = identity) ===');
{
  const result = applyScramble('R R R R');
  check('R R R R returns solved state', statesEqual(result, SOLVED_STATE));
  checkInvariants('R R R R', result);
}

console.log('\n=== TEST 3: applyScramble("R U R\' U\'") repeated 6 times === SOLVED_STATE (known 6-rep identity) ===');
{
  let state = makeSolvedState();
  const alg = ['R', 'U', "R'", "U'"];
  for (let rep = 0; rep < 6; rep++) {
    for (const move of alg) {
      state = applyMove(state, move);
    }
  }
  check('(R U R\' U\') x6 returns solved state', statesEqual(state, SOLVED_STATE));
  checkInvariants('(R U R\' U\') x6', state);
}

console.log('\n=== TEST 4: applyScramble("R") — manual visual check ===');
{
  // Expected effect of a single R turn (WCA: right face 90° clockwise as
  // viewed from the right side), starting from solved:
  //  - R face itself: unchanged (still solid red) — R only rotates its own
  //    face's stickers among themselves, and they're all red on a solved cube.
  //  - U face: right column (col 2) turns green (pulled up from F's right
  //    column), since R carries F's right edge up to U.
  //  - F face: right column (col 2) turns yellow (pulled from D's right column).
  //  - D face: right column (col 2) turns blue (pulled from B's LEFT column,
  //    col 0 — B is upside-down relative to F/U/D in this cycle, so the
  //    column that lands is B's col 0, not col 2).
  //  - B face: LEFT column (col 0) turns white (pulled from U's right column).
  //  - L, D(other columns) etc: unchanged.
  // i.e. the classic R-turn cycle U-right -> B-left -> D-right -> F-right -> U-right,
  // cycling white/green/yellow/blue through those strips (colors as WCA BOY scheme).
  const result = applyScramble('R');
  (['U', 'F', 'R', 'D', 'B', 'L'] as const).forEach((f) => printFace(f, result[f]));

  const col = (face: Face3x3, c: number) => [face[0][c], face[1][c], face[2][c]];
  check('U right column (col2) is green', col(result.U, 2).every((c) => c === 'green'));
  check('F right column (col2) is yellow', col(result.F, 2).every((c) => c === 'yellow'));
  check('D right column (col2) is blue', col(result.D, 2).every((c) => c === 'blue'));
  check('B left column (col0) is white', col(result.B, 0).every((c) => c === 'white'));
  check('R face unchanged (all red)', result.R.every((row) => row.every((c) => c === 'red')));
  check('L face unchanged (all orange)', result.L.every((row) => row.every((c) => c === 'orange')));
  // Untouched columns of U/F/D/B should retain their solved color.
  check('U col0/col1 still white', col(result.U, 0).every((c) => c === 'white') && col(result.U, 1).every((c) => c === 'white'));
  check('F col0/col1 still green', col(result.F, 0).every((c) => c === 'green') && col(result.F, 1).every((c) => c === 'green'));
  check('D col0/col1 still yellow', col(result.D, 0).every((c) => c === 'yellow') && col(result.D, 1).every((c) => c === 'yellow'));
  check('B col1/col2 still blue', col(result.B, 1).every((c) => c === 'blue') && col(result.B, 2).every((c) => c === 'blue'));
  checkInvariants('single R', result);
}

console.log('\n=== TEST 5: invariant check on a 19-move scramble ===');
// This scramble was originally flagged as producing an "impossible" state
// (opposite colors appearing on the same face's grid). That turned out to be
// a false alarm from an incorrect invariant, not a simulator bug — see the
// comment on validateStateInvariants. Kept here as a regression check.
const CHECK_SCRAMBLE = "R D' B2 F2 U L2 F2 D' L2 F2 L2 U B' D R2 U L B' L2 F";
{
  const result = applyScramble(CHECK_SCRAMBLE);
  checkInvariants(CHECK_SCRAMBLE, result);
}

console.log('\n=== TEST 6: move-by-move invariant check across that same scramble ===');
{
  const moves = CHECK_SCRAMBLE.split(' ');
  let state = makeSolvedState();
  let firstBadIndex = -1;
  moves.forEach((move, i) => {
    state = applyMove(state, move);
    const violations = validateStateInvariants(state);
    if (violations.length > 0 && firstBadIndex === -1) {
      firstBadIndex = i;
      console.log(`First violation after move #${i} ("${move}", sequence so far: ${moves.slice(0, i + 1).join(' ')}):`);
      violations.forEach((v) => console.log(`  - ${v}`));
    }
  });
  check('no invariant violation at any point in the sequence', firstBadIndex === -1);
}

console.log('\n=== TEST 7: invariant check on several independently generated scrambles ===');
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cstimer = require('cstimer_module');
  for (let i = 0; i < 8; i++) {
    const scramble: string = cstimer.getScramble('333');
    const result = applyScramble(scramble);
    checkInvariants(`random scramble #${i + 1}: ${scramble}`, result);
  }
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
