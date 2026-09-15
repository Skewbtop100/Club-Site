// ── Searching verified athletes, and the clipped-text fix ────────────────
// REAL unit tests for athlete-search.ts (pure), plus source checks on the
// table.
//
// Run: npm run test:athletesearch

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-athletesearch-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/athlete-search.ts',
    '--outDir', path.basename(OUT),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
const { athleteMatches, filterAthletes, normalizeForSearch } = require(path.join(OUT, 'athlete-search.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const A = { lastName: 'Батжаргал', firstName: 'Ууганбаяр', email: 'uuganbayar@gmail.com', wcaId: '2021BATJ01' };
const B = { lastName: 'Мягмардорж', firstName: 'Өлзийжаргал', email: 'olzii.m@gmail.com', wcaId: '' };
const C = { lastName: 'Sato', firstName: 'Haruki', email: 'H.Sato@Gmail.com', wcaId: '2021SATO04' };
const D = { lastName: 'Даш', firstName: 'Солонго', email: null };
const ALL = [A, B, C, D];
const names = (list) => list.map((a) => a.firstName).join(',');

console.log('\n  -- matching --');
ok('Cyrillic, any case: "БАТ" finds Батжаргал', athleteMatches(A, 'БАТ') && athleteMatches(A, 'бат'));
ok('Mongolian Ө folds: "өлзий" finds Өлзийжаргал', athleteMatches(B, 'өлзий') && athleteMatches(B, 'ӨЛЗИЙ'));
ok('Latin, any case: "sato" and "HARUKI"', athleteMatches(C, 'sato') && athleteMatches(C, 'HARUKI'));
ok('email, partial and case-insensitive', athleteMatches(C, 'h.sato@gmail') && athleteMatches(B, 'OLZII'));
ok('WCA ID, lower-case typed', athleteMatches(A, '2021batj') && athleteMatches(C, '2021sato04'));
ok('several terms must ALL match, across fields, in any order',
  athleteMatches(A, 'ууган бат') && athleteMatches(A, 'бат 2021') && !athleteMatches(A, 'бат sato'));
ok('extra spaces are ignored', athleteMatches(A, '   бат    ууган  '));
ok('no match is no match', !athleteMatches(D, 'бат'));
ok('a missing email or WCA ID does not break matching', athleteMatches(D, 'солонго') && !athleteMatches(D, 'null'));
ok('NFKC folds compatibility forms', normalizeForSearch('ＳＡＴＯ') === 'sato');

console.log('\n  -- filtering --');
ok('an empty query shows everyone, in order', names(filterAthletes(ALL, '')) === names(ALL));
ok('a blank query shows everyone', filterAthletes(ALL, '   ').length === 4);
ok('filters keep the original order', names(filterAthletes(ALL, 'жаргал')) === 'Ууганбаяр,Өлзийжаргал');
ok('nothing matching gives an empty list', filterAthletes(ALL, 'zzz').length === 0);
ok('the input list is never modified', (() => { const copy = [...ALL]; filterAthletes(copy, 'бат'); return copy.length === 4; })());

console.log('\n  -- the table --');
const table = src('app/online-competition/admin/_components/VerifiedAthletesTable.tsx');
ok('FIX 1: the clipped name cells have room for descenders', /const NAME[\s\S]{0,200}font: `500 13px\/1\.4 \$\{HEADING\}`/.test(table));
ok('  ...and no other element in the table both clips and sits at line-height 1',
  !/overflow: 'hidden'[^}]*\/1 \$\{|\/1 \$\{[^}]*overflow: 'hidden'/.test(table));
ok('  ...nor in the requests list', !/overflow: 'hidden'[^}]*\/1(\.2)? \$\{|\/1(\.2)? \$\{[^}]*overflow: 'hidden'/.test(src('app/online-competition/admin/_components/AthleteRequests.tsx')));
ok('FIX 2: rows come from the search filter', table.includes('filterAthletes(athletes, query)') && table.includes('(visible ?? []).map((a) =>'));
ok('  ...with the result count', table.includes('`${visible.length} / ${athletes.length} ТАМИРЧИН`'));
ok('  ...an empty state for no matches, distinct from an empty list',
  table.includes('тохирох тамирчин алга.') && table.includes('Баталгаажсан тамирчин алга.'));
ok('  ...cleared by ×, by Escape, and from the empty state',
  table.includes('aria-label="Хайлт цэвэрлэх"') && table.includes("e.key === 'Escape' && query") &&
    (table.match(/onClick=\{clearSearch\}/g) || []).length === 2);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
