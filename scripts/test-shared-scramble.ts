// Determinism check for the timer's "shared scramble code" feature
// (lib/shared-scramble.ts + generateSeededScramble in lib/scramble.ts).
//
//   npm run test:shared-scramble            # verify
//   npm run test:shared-scramble -- --update   # rewrite the golden file
//
// Spawns two SEPARATE Node processes that generate scrambles #1–#20 for all
// 17 timer events under two codes:
//   - "fresh": seeded scrambles only, in order;
//   - "dirty": first burns through unseeded random scrambles for every
//     event, then generates the seeded ones in a shuffled order with more
//     unseeded scrambles interleaved — so any hidden state carried between
//     calls (lazy tables, leftover RNG source, Math.random) would show up.
// Both outputs must be identical, every scramble non-empty, different
// indexes must give different scrambles, Math.random must be restored, and
// the per-event hashes must match scripts/shared-scramble.golden.json so a
// scrambow upgrade that changes output can't slip through silently.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRAMBOW_TYPE, generateScramble, generateSeededScramble } from '../lib/scramble';
import { sharedSeedKey } from '../lib/shared-scramble';

const EVENTS = Object.keys(SCRAMBOW_TYPE);
const CODES = ['4827', '0001'];
const COUNT = 20;
const GOLDEN = join(process.cwd(), 'scripts', 'shared-scramble.golden.json');

type Table = Record<string, string[]>; // `${code}|${event}` → scrambles #1…#COUNT

function worker(mode: 'fresh' | 'dirty'): Table {
  const jobs: { code: string; event: string; index: number }[] = [];
  for (const code of CODES) for (const event of EVENTS) for (let i = 1; i <= COUNT; i++) jobs.push({ code, event, index: i });

  if (mode === 'dirty') {
    for (let r = 0; r < 3; r++) for (const e of EVENTS) generateScramble(e);
    // Fixed shuffle (LCG) so the run is reproducible but far from in-order.
    let s = 12345;
    for (let i = jobs.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
    }
  }

  const table: Table = {};
  const nativeRandom = Math.random;
  jobs.forEach((job, n) => {
    if (mode === 'dirty' && n % 7 === 0) generateScramble(EVENTS[n % EVENTS.length]);
    const key = `${job.code}|${job.event}`;
    (table[key] ??= new Array<string>(COUNT))[job.index - 1] =
      generateSeededScramble(job.event, sharedSeedKey(job.code, job.event, job.index));
    if (Math.random !== nativeRandom) throw new Error('Math.random was not restored');
  });
  return table;
}

function runWorker(mode: 'fresh' | 'dirty'): Table {
  const out = spawnSync(process.execPath, [__filename, '--worker', mode], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) throw new Error(`${mode} worker failed:\n${out.stderr}`);
  return JSON.parse(out.stdout) as Table;
}

function hashes(table: Table): Record<string, string> {
  const h: Record<string, string> = {};
  for (const key of Object.keys(table).sort()) {
    h[key] = createHash('sha256').update(table[key].join('\n')).digest('hex').slice(0, 16);
  }
  return h;
}

function main(): void {
  const workerIdx = process.argv.indexOf('--worker');
  if (workerIdx >= 0) {
    process.stdout.write(JSON.stringify(worker(process.argv[workerIdx + 1] as 'fresh' | 'dirty')));
    return;
  }

  let failures = 0;
  const check = (label: string, pass: boolean, detail?: string) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail ? `\n      ${detail}` : ''}`);
    if (!pass) failures++;
  };

  const a = runWorker('fresh');
  const b = runWorker('dirty');

  let mismatches = 0, empty = 0, dupes = 0;
  for (const key of Object.keys(a)) {
    a[key].forEach((s, i) => {
      if (s !== b[key]?.[i]) mismatches++;
      if (!s) empty++;
    });
    if (new Set(a[key]).size !== a[key].length) dupes++;
  }
  const total = CODES.length * EVENTS.length * COUNT;
  check(`${EVENTS.length} events × ${CODES.length} codes × #1–#${COUNT}: identical across two processes`, mismatches === 0, `${mismatches}/${total} differ`);
  check('no empty scrambles', empty === 0, `${empty} empty`);
  check('indexes #1–#20 give distinct scrambles per event', dupes === 0, `${dupes} event/code sequences repeat`);
  check('different codes give different sequences',
    EVENTS.every(e => a[`${CODES[0]}|${e}`].join() !== a[`${CODES[1]}|${e}`].join()));

  const now = hashes(a);
  if (process.argv.includes('--update')) {
    writeFileSync(GOLDEN, JSON.stringify(now, null, 2) + '\n');
    console.log(`wrote ${GOLDEN}`);
  } else {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
    const changed = Object.keys(golden).filter(k => golden[k] !== now[k]);
    check('matches committed golden hashes (same scrambles as every other device/version)',
      changed.length === 0 && Object.keys(now).length === Object.keys(golden).length,
      `changed: ${changed.join(', ') || '(key count differs)'}`);
  }

  console.log(`\nsample: 4827 · 333 #1 = ${a['4827|333'][0]}`);
  console.log(`sample: 4827 · sq1 #1 = ${a['4827|sq1'][0]}`);
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main();
