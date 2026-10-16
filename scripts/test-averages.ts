// Check for the AoN trimming in lib/timer-engine.ts (avgOfN / trimCount):
// Ao100 drops 5% from each end (5 best + 5 worst), Ao5/Ao12/Ao50 still
// drop 1 from each end. Run via:
//   npm run test:averages

import { avgOfN, calcStats, trimCount, type Solve, type Penalty } from '../lib/timer-engine';

let failures = 0;
function check(label: string, pass: boolean, detail?: unknown) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ''}`);
  if (!pass) failures++;
}

let seq = 0;
const solve = (ms: number, penalty: Penalty = 'none'): Solve => ({
  id: `t${++seq}`, ms, penalty, scramble: '', event: '333', ts: seq,
});
const finalOf = (s: Solve) => s.ms + (s.penalty === '+2' ? 2000 : 0);
/** Expected trimmed mean computed independently of the implementation. */
function expectedMean(list: Solve[], trim: number): number | null {
  const vals = list.map(s => (s.penalty === 'dnf' ? Infinity : finalOf(s))).sort((a, b) => a - b);
  const mid = vals.slice(trim, vals.length - trim);
  if (mid.some(v => v === Infinity)) return null;
  return Math.round(mid.reduce((a, b) => a + b, 0) / mid.length);
}

// Deterministic pseudo-random times (LCG) so the run is reproducible.
let r = 42;
const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
const times = (n: number) => Array.from({ length: n }, () => 8000 + Math.floor(rand() * 10000));

// ── trimCount ──
check('trimCount: 5/12/50 → 1, 100 → 5, 1000 → 50',
  trimCount(5) === 1 && trimCount(12) === 1 && trimCount(50) === 1 && trimCount(100) === 5 && trimCount(1000) === 50,
  [trimCount(5), trimCount(12), trimCount(50), trimCount(100), trimCount(1000)]);

// ── Ao100 cases from the spec ──
const clean = times(100).map(ms => solve(ms));
const cleanAvg = avgOfN(clean, 100);
check('Ao100, 100 clean solves → mean of the middle 90', cleanAvg !== null && cleanAvg === expectedMean(clean, 5), { cleanAvg, expected: expectedMean(clean, 5) });
check('Ao100 differs from the old trim-1 mean (sanity: 5% trimming is applied)', cleanAvg !== expectedMean(clean, 1));

const threeDnf = clean.map((s, i) => (i % 33 === 7 ? solve(s.ms, 'dnf') : s));
const threeAvg = avgOfN(threeDnf, 100);
check('Ao100 with 3 DNFs → a number (DNFs trimmed as worst)',
  threeDnf.filter(s => s.penalty === 'dnf').length === 3 && threeAvg !== null && threeAvg === expectedMean(threeDnf, 5), threeAvg);

const fiveDnf = clean.map((s, i) => (i % 20 === 3 ? solve(s.ms, 'dnf') : s));
check('Ao100 with 5 DNFs → still a number',
  fiveDnf.filter(s => s.penalty === 'dnf').length === 5 && avgOfN(fiveDnf, 100) !== null);

const sixDnf = clean.map((s, i) => (i % 17 === 4 ? solve(s.ms, 'dnf') : s));
check('Ao100 with 6 DNFs → DNF (null)',
  sixDnf.filter(s => s.penalty === 'dnf').length === 6 && avgOfN(sixDnf, 100) === null);

const plusTwo = clean.map((s, i) => (i === 10 ? solve(s.ms, '+2') : s));
check('Ao100 counts +2 penalties', avgOfN(plusTwo, 100) === expectedMean(plusTwo, 5));

const longer = [...times(37).map(ms => solve(ms, 'dnf')), ...clean];
check('Ao100 uses only the last 100 solves', avgOfN(longer, 100) === cleanAvg);
check('Ao100 with 99 solves → null', avgOfN(clean.slice(1), 100) === null);
check('calcStats().ao100 uses the same trimming', calcStats(threeDnf).ao100 === threeAvg);

// ── Ao5 / Ao12 / Ao50 unchanged ──
// The previous implementation, verbatim except for naming.
function oldAvgOfN(list: Solve[], n: number): number | null {
  if (list.length < n) return null;
  const last = list.slice(-n);
  const sorted = [...last].sort((a, b) => {
    const aV = a.penalty === 'dnf' ? Infinity : finalOf(a);
    const bV = b.penalty === 'dnf' ? Infinity : finalOf(b);
    return aV - bV;
  });
  const middle = sorted.slice(1, -1);
  if (middle.some(s => s.penalty === 'dnf')) return null;
  return Math.round(middle.reduce((acc, s) => acc + finalOf(s), 0) / middle.length);
}
let compared = 0, diffs = 0;
for (let trial = 0; trial < 3000; trial++) {
  const len = 3 + Math.floor(rand() * 70);
  const list = times(len).map(ms => {
    const p = rand();
    return solve(ms, p < 0.06 ? 'dnf' : p < 0.12 ? '+2' : 'none');
  });
  for (const n of [5, 12, 50]) {
    compared++;
    if (avgOfN(list, n) !== oldAvgOfN(list, n)) diffs++;
  }
}
check(`Ao5 / Ao12 / Ao50 identical to the previous implementation (${compared} random windows)`, diffs === 0, `${diffs} differ`);

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
