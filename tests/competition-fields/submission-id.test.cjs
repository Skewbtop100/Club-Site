// ── One attempt, one document ───────────────────────────────────────────
// Pure unit tests for submission-id.ts. No emulator, no Firestore.
//
// What this pins: a run's five attempts file to five ids, and filing the
// same attempt twice lands on the SAME id. Before this, createSubmission
// used addDoc, so a submit that failed part-way through and was retried
// re-filed the attempts that had already succeeded — seven submissions
// for a five-attempt run, and no way for a judge to tell which four
// counted.
//
// The id also has to be a legal Firestore document id, which these check
// directly: no '/', not '.' or '..', under 1500 bytes.
//
// Run: npm run test:subid

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-subid-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/submission-id.ts',
    '--outDir', path.basename(OUT),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--strict',
    '--skipLibCheck',
    '--esModuleInterop',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

const { submissionDocId } = require(path.join(OUT, 'submission-id.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`          -> ${detail}`);
  }
}
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const RUN = { uid: 'kQ8mZt3xYb', competitionId: 'abc123XYZ', event: '333', competitionRound: 1 };
const id = (over = {}) => submissionDocId({ ...RUN, attempt: 1, ...over });

console.log('\n  -- the same attempt always lands on the same document --');
eq('deterministic', id(), id());
eq('the exact shape (a change here is a change to stored ids)', id(), 'kQ8mZt3xYb__abc123XYZ__333__r1__a1');
// The bug this exists to prevent: a retry of a partly-filed submit.
{
  const firstSubmit = [1, 2, 3].map((attempt) => id({ attempt }));
  const retry = [1, 2, 3, 4, 5].map((attempt) => id({ attempt }));
  ok('a retry re-files the first three onto the SAME ids',
    firstSubmit.every((x, i) => x === retry[i]), `${firstSubmit.join(',')} vs ${retry.join(',')}`);
  eq('  ...so five attempts are five documents, not eight', new Set(retry).size, 5);
}
// A redo is a new run for the same round — it REPLACES the old one.
eq('a redo of the same round overwrites rather than adding', id({ attempt: 2 }), id({ attempt: 2 }));

console.log('\n  -- everything that must make it a different document --');
{
  const base = id();
  ok('a different attempt', id({ attempt: 2 }) !== base);
  ok('a different competition round', id({ competitionRound: 2 }) !== base);
  ok('a different event', id({ event: '222' }) !== base);
  ok('a different competition', id({ competitionId: 'other' }) !== base);
  ok('a different athlete', id({ uid: 'someoneElse' }) !== base);
  // Round 2 attempt 1 must not collide with round 1 attempt 2 — the
  // prefixes are what stop the numbers running together.
  ok('round/attempt cannot be confused for one another',
    id({ competitionRound: 2, attempt: 1 }) !== id({ competitionRound: 1, attempt: 2 }));
  // All five distinct attempts of a round, and all rounds of an event.
  const all = [];
  for (const competitionRound of [1, 2, 3]) {
    for (let attempt = 1; attempt <= 5; attempt++) all.push(id({ competitionRound, attempt }));
  }
  eq('15 distinct ids across 3 rounds x 5 attempts', new Set(all).size, 15);
}

console.log('\n  -- it has to be a legal Firestore document id --');
{
  const samples = [
    id(),
    id({ uid: 'a'.repeat(128), competitionId: 'b'.repeat(64), attempt: 5, competitionRound: 12 }),
    id({ event: '333oh' }),
    id({ event: '3x3x3_bf' }),
  ];
  ok('never contains a slash', samples.every((s) => !s.includes('/')), samples.join(' | '));
  ok('never "." or ".."', samples.every((s) => s !== '.' && s !== '..'));
  ok('never empty', samples.every((s) => s.length > 0));
  ok('under the 1500-byte limit', samples.every((s) => Buffer.byteLength(s, 'utf8') < 1500),
    String(Math.max(...samples.map((s) => Buffer.byteLength(s, 'utf8')))));
}

console.log('\n  -- data.ts files through it, and no longer with a random id --');
{
  const data = fs.readFileSync(path.join(ROOT, 'lib/online-competition/data.ts'), 'utf8');
  const fn = data.slice(data.indexOf('export async function createSubmission'), data.indexOf('// Where the computed Ao5 lives'));
  ok('createSubmission builds the id with submissionDocId', fn.includes('submissionDocId({'));
  ok('  ...and writes with setDoc at that id',
    fn.includes("const ref = doc(onlineCompDb, 'onlineSubmissions', id);") && fn.includes('await setDoc(ref, {'));
  ok('  ...never addDoc (a random id per call)', !fn.includes('addDoc('));
  ok('  ...and returns the id it wrote', fn.includes('return id;'));
  ok('the attempt index is what goes into the id', /attempt: input\.round/.test(fn));

  // ── already filed is SUCCESS ──
  // Athletes have no `update` on onlineSubmissions (firestore.rules), so
  // re-filing an attempt that already landed comes back permission-denied
  // — which is exactly what a retry after a network failure does. Telling
  // the athlete it failed would send them to solve it again.
  ok('a denial is looked at again, everything else is rethrown untouched',
    fn.includes('if (!isPermissionDenied(e)) throw e;'));
  ok('  ...by reading back what is actually filed', fn.includes('filed = await getDoc(ref);'));
  ok('  ...an identical attempt reads as success',
    /data\.reportedTime === input\.reportedTime && \(data\.isDnf \?\? false\) === isDnf\) return id;/.test(fn));
  ok('  ...a DIFFERENT result is a conflict, not a silent pass',
    fn.includes('throw new SubmissionAlreadyFiledError('));
  // A get of a document that does not exist is denied too (the read rule
  // dereferences resource.data.uid), so it proves nothing either way.
  ok('  ...and a failed read leaves the original denial standing',
    /\} catch \{[\s\S]{0,400}?throw e;\s*\}\s*\n\s*if \(!filed\.exists\(\)\) throw e;/.test(fn));
  ok('the error carries what was already filed',
    data.includes('readonly filedTime: number;'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
