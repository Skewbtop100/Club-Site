// Standalone correctness check for lib/scramble-import.ts.
// No test runner is configured in this project (see
// scripts/test-cube-state-simulator.ts), so this is a plain script. Run via:
//   npx tsc lib/scramble-import.ts scripts/test-scramble-import.ts \
//     --outDir .tmp-test-build --module commonjs --target es2020 --esModuleInterop --skipLibCheck
//   node .tmp-test-build/scripts/test-scramble-import.js

import {
  parseWcaScrambles,
  mergeScrambleSets,
  groupLetter,
  groupOptions,
  scrambleFor,
  nextExtraSource,
} from '../lib/scramble-import';

let failures = 0;

function check(label: string, pass: boolean, detail?: unknown) {
  if (pass) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}`);
    if (detail !== undefined) console.log('      got: ' + JSON.stringify(detail));
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

// ── Sample in the WCA scramble-page shape: tab-separated, Final before First round ──

const SAMPLE = [
  '3x3x3 Cube Final',
  'Group\t#\tScramble',
  "A\t1\tD' L D2 B2 U2 F2 R2 U' B2",
  "2\tR' D' L D' F2 U B'",
  '3\tF2 U2 R2 D B2',
  "4\tL2 B' R U2 F",
  "5\tU R2 F' L2 D",
  'Extra 1\tR U2 L2 B D',
  "Extra 2\tD L' B R2 U",
  '3x3x3 Cube First round',
  'Group\t#\tScramble',
  'A\t1\tU2 R B2 L D',
  '2\tB U2 L F2 R',
  "3\tF' D2 R U L2",
  '4\tR2 U B D2 F',
  "5\tL U' F2 R B",
  'Extra 1\tU L2 D R F',
  'Extra 2\tB2 R D L U',
  'B\t1\tB2 F2 R U D',
  "2\tD' R2 U F L",
  '3\tU F R2 D B',
  '4\tL D2 F U R',
  "5\tR' B U2 L D",
  'Extra 1\tF U R B2 L',
  'Extra 2\tD2 L F R U',
].join('\n');

const CONFIG = { '333': { rounds: 2 }, '666': { rounds: 1 }, 'minx': { rounds: 1 }, 'pyram': { rounds: 1 } };

{
  const { sets, warnings } = parseWcaScrambles(SAMPLE, CONFIG);
  eq('sample: no warnings', warnings, []);
  eq('sample: two blocks', sets.length, 2);
  const fin = sets[0], first = sets[1];
  eq('sample: Final maps to the last round (2 of 2)', [fin.eventId, fin.roundId, fin.roundName], ['333', '2', 'Final']);
  eq('sample: First round maps to round 1', [first.eventId, first.roundId], ['333', '1']);
  eq('sample: Final has one group', Object.keys(fin.groups), ['A']);
  eq('sample: Final A has 5 main + 2 extra', [fin.groups.A.main.length, fin.groups.A.extra.length], [5, 2]);
  eq('sample: first scramble text', fin.groups.A.main[0], "D' L D2 B2 U2 F2 R2 U' B2");
  eq('sample: continuation-row scramble text', fin.groups.A.main[1], "R' D' L D' F2 U B'");
  eq('sample: extras in order', fin.groups.A.extra, ['R U2 L2 B D', "D L' B R2 U"]);
  eq('sample: First round has groups A and B', Object.keys(first.groups), ['A', 'B']);
  eq('sample: group B starts at its own first scramble', first.groups.B.main[0], 'B2 F2 R U D');
  eq('sample: group B 5 main + 2 extra', [first.groups.B.main.length, first.groups.B.extra.length], [5, 2]);
  eq('sample: group A extras do not leak into B', first.groups.A.extra, ['U L2 D R F', 'B2 R D L U']);
  check('sample: "Group # Scramble" header never becomes a scramble',
    !JSON.stringify(sets).toLowerCase().includes('scramble\\t') && !JSON.stringify(sets).includes('Group'));
}

// ── Final depends on the competition's round count ──

{
  const { sets } = parseWcaScrambles(SAMPLE, { '333': { rounds: 4 } });
  eq('config: Final is round 4 when the event has 4 rounds', sets[0].roundId, '4');

  const semi = parseWcaScrambles('3x3x3 Cube Semi Final\nA\t1\tR U\n2\tU R\n3\tF R\n4\tL U\n5\tD B', { '333': { rounds: 4 } });
  eq('config: Semi Final is round 3 of 4', semi.sets[0]?.roundId, '3');

  const noCfg = parseWcaScrambles(SAMPLE);
  eq('no config: rounds inferred from the text (First=1, Final=2)', noCfg.sets.map(s => s.roundId), ['2', '1']);

  const missing = parseWcaScrambles(SAMPLE, { '333': { rounds: 1 } });
  eq('config: with only 1 round, First round and Final collapse into round 1', missing.sets.map(s => s.roundId), ['1']);
  check('config: First round + Final both mapping to round 1 warns about the duplicate',
    missing.warnings.some(w => w.includes('давхар')), missing.warnings);

  const tooMany = parseWcaScrambles('3x3x3 Cube Round 3\nA\t1\tR U\n2\tU R\n3\tF R\n4\tL U\n5\tD B', { '333': { rounds: 2 } });
  eq('config: a round the competition does not have is skipped', tooMany.sets, []);
  eq('config: ...with one warning', tooMany.warnings.length, 1);

  const notRun = parseWcaScrambles(SAMPLE, { '222': { rounds: 1 } });
  eq('config: an event the competition does not run is skipped', notRun.sets, []);
  eq('config: ...with a warning per block', notRun.warnings.length, 2);
}

// ── Round-name variants ──

{
  const body = '\nA 1 R U\n2 U R\n3 F R\n4 L U\n5 D B';
  const names: [string, string][] = [
    ['3x3x3 Cube first round', '1'], ['3x3x3 Cube SECOND ROUND', '2'], ['3x3x3 Cube Round 1', '1'],
    ['3x3x3 Cube Round 2', '2'], ['3x3x3 Cube Semi Final', '3'], ['3x3x3 Cube semi-final', '3'], ['3x3x3 Cube FINAL', '4'],
  ];
  for (const [header, roundId] of names) {
    const r = parseWcaScrambles(header + body, { '333': { rounds: 4 } });
    eq(`round name: "${header}" → ${roundId}`, [r.sets[0]?.roundId, r.warnings], [roundId, []]);
  }
}

// ── Space-separated input, Mo3 block, count warnings ──

{
  const mo3 = ['6x6x6 Cube Final', 'Group # Scramble', "A 1 3Rw2 U' Fw D2", "2 U 3Fw' R2 Bw", '3 Dw2 L 3Uw F', "Extra 1 R 3Rw U'"].join('\n');
  const r = parseWcaScrambles(mo3, CONFIG);
  eq('Mo3: three scrambles kept, no count warning', [r.sets[0]?.groups.A.main.length, r.warnings], [3, []]);
  eq('Mo3: space-separated columns parsed', r.sets[0]?.groups.A.main[0], "3Rw2 U' Fw D2");
  eq('Mo3: extra parsed', r.sets[0]?.groups.A.extra, ["R 3Rw U'"]);

  const short = parseWcaScrambles("3x3x3 Cube Final\nA\t1\tR U\n2\tU R\n3\tF R", { '333': { rounds: 1 } });
  eq('count: a 3-scramble 3x3 block is kept as given', short.sets[0]?.groups.A.main.length, 3);
  check('count: ...and warns that 5 were expected', short.warnings.length === 1 && short.warnings[0].includes('5'), short.warnings);

  // Expected count per event: 3x3 Blindfolded is 5 (Ao5); the other
  // three-attempt events stay at 3.
  const rows = (n: number) => ['A\t1\tR U F', '2\tU R F', '3\tF R U', '4\tL U B', '5\tD B L'].slice(0, n).join('\n');
  const countWarnings = (header: string, eventId: string, n: number) =>
    parseWcaScrambles(`${header} Final\n${rows(n)}`, { [eventId]: { rounds: 1 } });
  const bf5 = countWarnings('3x3x3 Blindfolded', '333bf', 5);
  eq('count: 333bf with 5 scrambles — kept, no warning', [bf5.sets[0]?.groups.A.main.length, bf5.warnings], [5, []]);
  const bf3 = countWarnings('3x3x3 Blindfolded', '333bf', 3);
  check('count: 333bf with 3 scrambles warns that 5 were expected',
    bf3.sets[0]?.groups.A.main.length === 3 && bf3.warnings.length === 1 && bf3.warnings[0].includes('(5 '), bf3.warnings);
  const threeAttempt: [string, string][] = [
    ['4x4x4 Blindfolded', '444bf'], ['5x5x5 Blindfolded', '555bf'], ['3x3x3 Multi-Blind', '333mbf'],
    ['3x3x3 Fewest Moves', '333fm'], ['6x6x6 Cube', '666'], ['7x7x7 Cube', '777'],
  ];
  for (const [header, eventId] of threeAttempt) {
    eq(`count: ${eventId} with 3 scrambles — no warning`, countWarnings(header, eventId, 3).warnings, []);
    const five = countWarnings(header, eventId, 5).warnings;
    check(`count: ${eventId} with 5 scrambles warns that 3 were expected`, five.length === 1 && five[0].includes('(3 '), five);
  }

  const bo1 = parseWcaScrambles('3x3x3 Cube Final\nA\t1\tR U F', { '333': { rounds: 1 } });
  eq('count: a single-scramble (Bo1) block is kept', bo1.sets[0]?.groups.A.main, ['R U F']);
}

// ── Megaminx multi-line scrambles ──

{
  const minx = [
    'Megaminx Final',
    'Group\t#\tScramble',
    "A\t1\tR++ D-- R++ D++ R-- D++ R-- D-- R++ D-- U'",
    'R-- D++ R++ D-- R-- D++ R++ D++ R-- D++ U',
    "R++ D++ R-- D-- R++ D-- R++ D-- R-- D-- U'",
    '2\tR-- D-- R++ D++ R-- D-- R++ D++ R++ D++ U',
    "R++ D-- R-- D++ R++ D++ R-- D-- R++ D-- U'",
    '3\tR++ D++ R++ D++ R-- D-- R-- D-- R++ D++ U',
    '4\tR-- D++ R-- D++ R++ D-- R++ D-- R-- D++ U',
    "5\tR++ D-- R++ D-- R-- D++ R-- D++ R++ D-- U'",
    "Extra 1\tR-- D-- R-- D-- R++ D++ R++ D++ R-- D-- U'",
    'R++ D++ R++ D-- R-- D-- R++ D++ R-- D++ U',
  ].join('\n');
  const r = parseWcaScrambles(minx, CONFIG);
  const g = r.sets[0]?.groups.A;
  eq('megaminx: 5 scrambles + 1 extra, no warnings', [g?.main.length, g?.extra.length, r.warnings], [5, 1, []]);
  eq('megaminx: first scramble spans 3 lines joined by newline', g?.main[0].split('\n').length, 3);
  eq('megaminx: continuation text preserved', g?.main[0].split('\n')[1], 'R-- D++ R++ D-- R-- D++ R++ D++ R-- D++ U');
  eq('megaminx: second scramble spans 2 lines', g?.main[1].split('\n').length, 2);
  eq('megaminx: single-line scramble untouched', g?.main[2], 'R++ D++ R++ D++ R-- D-- R-- D-- R++ D++ U');
  eq('megaminx: extra continuation joined to the extra', g?.extra[0].split('\n').length, 2);
}

// ── Scrambles starting with a face letter are not group rows ──

{
  const pyra = ['Pyraminx Final', 'Group\t#\tScramble', "A\t1\tL R' U B l r'", "2\tU L' R B' u", "3\tB U R' L b", "4\tR B' L U' l", '5\tL U B R r b'].join('\n');
  const r = parseWcaScrambles(pyra, CONFIG);
  eq('pyraminx: only group A, 5 scrambles', [Object.keys(r.sets[0]?.groups || {}), r.sets[0]?.groups.A.main.length], [['A'], 5]);

  const spaced = "Pyraminx Final\nA 1 L R' U B\nL R' U B l\n2 U L' R B'\n3 B U R' L\n4 R B' L U'\n5 L U B R";
  const s = parseWcaScrambles(spaced, CONFIG);
  eq('pyraminx: a wrapped line starting "L R\'" continues the scramble instead of opening group L',
    [Object.keys(s.sets[0]?.groups || {}), s.sets[0]?.groups.A.main[0]], [['A'], "L R' U B\nL R' U B l"]);
}

// ── Unknown event / round: warn, skip the block, keep the rest ──

{
  const mixed = [
    'Rubik Snake Final',
    'Group\t#\tScramble',
    'A\t1\tR U F',
    '2\tU R F',
    SAMPLE,
    '3x3x3 Cube Quarterfinals',
    'Group\t#\tScramble',
    'A\t1\tR R R',
  ].join('\n');
  let r: ReturnType<typeof parseWcaScrambles> | null = null;
  let threw = false;
  try { r = parseWcaScrambles(mixed, CONFIG); } catch { threw = true; }
  check('unknown: never throws', !threw);
  eq('unknown: the two valid blocks still parse', r?.sets.map(s => `${s.eventId}:${s.roundId}`), ['333:2', '333:1']);
  eq('unknown: one warning per skipped block', r?.warnings.length, 2);
  check('unknown: warnings name the offending header',
    !!r && r.warnings[0].includes('Rubik Snake Final') && r.warnings[1].includes('Quarterfinals'), r?.warnings);
  check('unknown: skipped scrambles do not leak into another block', !JSON.stringify(r?.sets).includes('R R R') && !JSON.stringify(r?.sets).includes('"R U F"'));

  for (const junk of ['', '\n\n  \n', 'hello world', '1\tR U F', 'Group\t#\tScramble']) {
    let ok = true;
    let out: ReturnType<typeof parseWcaScrambles> | null = null;
    try { out = parseWcaScrambles(junk, CONFIG); } catch { ok = false; }
    check(`junk input ${JSON.stringify(junk)}: no throw, no sets`, ok && out?.sets.length === 0, out);
  }
}

// ── Windows line endings ──

{
  const r = parseWcaScrambles(SAMPLE.replace(/\n/g, '\r\n'), CONFIG);
  eq('CRLF: parses the same', [r.sets.length, r.warnings, r.sets[0]?.groups.A.main[4]], [2, [], "U R2 F' L2 D"]);
}

// ── Merge + lookup helpers ──

{
  const existing = {
    '333': { '1': { A: { main: ['old-first'], extra: [] } }, '2': { A: { main: ['old-final'], extra: [] }, B: { main: ['old-final-b'], extra: [] } } },
    '222': { '1': { A: { main: ['two'], extra: [] } } },
  };
  const before = JSON.stringify(existing);
  const final = parseWcaScrambles(SAMPLE.split('\n').slice(0, 9).join('\n'), CONFIG).sets;
  const merged = mergeScrambleSets(existing, final);
  eq('merge: imported round replaced wholesale (old group B gone)', Object.keys(merged['333']['2']), ['A']);
  eq('merge: imported round has the new scrambles', merged['333']['2'].A.main.length, 5);
  eq('merge: other round of the same event untouched', merged['333']['1'], existing['333']['1']);
  eq('merge: other event untouched', merged['222'], existing['222']);
  eq('merge: input not mutated', JSON.stringify(existing), before);
  eq('merge: into nothing', Object.keys(mergeScrambleSets(undefined, final)), ['333']);

  eq('groupLetter', [groupLetter(1), groupLetter(2), groupLetter(10)], ['A', 'B', 'J']);

  const grp = { main: ['m'], extra: [] };
  const nine = Object.fromEntries('ABCDEFGHI'.split('').map(l => [l, grp]));
  eq('groupOptions: no import, no legacy setting → one group', [groupOptions(undefined), groupOptions(undefined, {})], [[1], [1]]);
  eq('groupOptions: no import → legacy stored groups kept (old competitions)', [groupOptions(1), groupOptions(3), groupOptions(2, {})], [[1], [1, 2, 3], [1, 2]]);
  eq('groupOptions: legacy 0/invalid still offers group A', [groupOptions(0), groupOptions(NaN)], [[1], [1]]);
  eq('groupOptions: 9 imported (A–I) → all nine', groupOptions(undefined, nine), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq('groupOptions: import decides — legacy count ignored when scrambles exist', [groupOptions(3, { A: grp }), groupOptions(1, nine).length], [[1], 9]);
  eq('groupOptions: sorted even when stored out of order, gaps kept as-is', groupOptions(undefined, { D: grp, B: grp }), [2, 4]);

  const g = { main: ['m1', 'm2', 'm3', 'm4', 'm5'], extra: ['e1', 'e2'] };
  eq('scrambleFor: main by slot', [scrambleFor(g, 0), scrambleFor(g, 4, 'main')], ['m1', 'm5']);
  eq('scrambleFor: extra overrides the slot', [scrambleFor(g, 2, 'extra1'), scrambleFor(g, 2, 'extra2')], ['e1', 'e2']);
  eq('scrambleFor: slot past the end is empty', scrambleFor(g, 5), '');
  eq('scrambleFor: missing extra falls back to main', scrambleFor(g, 1, 'extra3'), 'm2');
  eq('nextExtraSource: Extra 1 first', nextExtraSource(g, ['main', 'main', 'main', 'main', 'main']), 'extra1');
  eq('nextExtraSource: then Extra 2', nextExtraSource(g, ['main', 'extra1', 'main', 'main', 'main']), 'extra2');
  eq('nextExtraSource: none left', nextExtraSource(g, ['extra2', 'extra1', 'main', 'main', 'main']), null);
  eq('nextExtraSource: group without extras', nextExtraSource({ main: ['m'], extra: [] }, ['main']), null);
}

console.log(failures === 0 ? '\nAll scramble-import checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
