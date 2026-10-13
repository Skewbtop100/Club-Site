// Standalone correctness check for lib/results-import.ts (WCA results
// parser) and lib/staged-reveal.ts (staged import: ids, reveal math,
// advancement/elimination). No test runner in this project — plain script,
// like scripts/test-scramble-import.ts. Run via:
//   npx tsc lib/results-import.ts lib/staged-reveal.ts scripts/test-results-import.ts \
//     --outDir .tmp-test-build --module commonjs --target es2020 --esModuleInterop --skipLibCheck
//   node .tmp-test-build/scripts/test-results-import.js

import { parseWcaResults, parseResultTime, importedAverage } from '../lib/results-import';
import { calcMo3, compareRoundResults } from '../lib/results-entry-helpers';
import {
  normalizeName, nameKey, matchClubAthlete, stagedRowId, stagedResultDocId, stagedRowToResult,
  buildStagedEvent, revealTarget, computeAdvancing, planStagedSync, stagedRoundStatus,
  type StagedEvent, type StagedRow, type RoundResultLite, type StagedSyncInput,
} from '../lib/staged-reveal';

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

// ═══ Parser ══════════════════════════════════════════════════════════════════

const SAMPLE = [
  '3x3x3 Cube Final',
  '#\tName\tBest\t\tAverage\t\tRepresenting\tSolves',
  '1\tTemuulen Tserendagva\t7.22\t\t7.35\t\t\t7.44 7.32 (7.22) (8.22) 7.30',
  '3\tOrgil Otgonbayar (Отгонбаяр Оргил)\t7.41\tNR\t8.10\t\tMongolia\t8.05 (7.41) 8.20 8.05 (9.90)',
  '130\tUrin-Uchralt Bilguun\t37.26\t\tDNF\t\t\tDNF (DNF) 1:26.99 1:11.13 (37.26)',
  '134\tJargalbayar Martsaikhan\tDNF\t\tDNF\t\t\t(DNF) DNF DNF DNS (DNS)',
  '3x3x3 Cube First round',
  '#\tName\tBest\t\tAverage\t\tRepresenting\tSolves',
  '1\tTemuulen Tserendagva\t6.90\t\t7.50\t\t\t7.40 7.60 (6.90) (9.00) 7.50',
  '2\tOrgil Otgonbayar (Отгонбаяр Оргил)\t7.80\t\t8.00\t\t\t8.00 (7.80) 8.00 8.00 (9.90)',
].join('\n');

{
  eq('time: ss.xx', parseResultTime('7.22'), 722);
  eq('time: m:ss.xx', parseResultTime('1:26.99'), 8699);
  eq('time: parentheses stripped', [parseResultTime('(7.22)'), parseResultTime('(DNF)'), parseResultTime('(1:11.13)')], [722, -1, 7113]);
  eq('time: DNF / DNS in the project encoding', [parseResultTime('DNF'), parseResultTime('dns')], [-1, -2]);
  eq('time: extra decimals are truncated, never rounded', [parseResultTime('7.229'), parseResultTime('7.995'), parseResultTime('1:02.999')], [722, 799, 6299]);
  eq('time: a single decimal digit is tenths', parseResultTime('7.2'), 720);
  eq('time: no float error on values like 8.29 / 1.15', [parseResultTime('8.29'), parseResultTime('1.15'), parseResultTime('4.35')], [829, 115, 435]);
  eq('time: junk is not a time', [parseResultTime('abc'), parseResultTime(''), parseResultTime('Mongolia'), parseResultTime('24')], [null, null, null, null]);
}

{
  const { rounds, warnings } = parseWcaResults(SAMPLE, { '333': { rounds: 2 } });
  eq('sample: no warnings', warnings, []);
  eq('sample: two round blocks, Final → round 2, First round → round 1', rounds.map(r => `${r.eventId}:${r.roundId}`), ['333:2', '333:1']);
  const fin = rounds[0].rows;
  eq('sample: 4 rows in the Final', fin.length, 4);
  eq('sample: plain name, no local name', [fin[0].name, fin[0].localName], ['Temuulen Tserendagva', '']);
  eq('sample: solves in order, parentheses gone', fin[0].solves, [744, 732, 722, 822, 730]);
  eq('sample: best / average recomputed', [fin[0].single, fin[0].average], [722, 735]);
  eq('sample: local-script name kept separately', [fin[1].name, fin[1].localName], ['Orgil Otgonbayar', 'Отгонбаяр Оргил']);
  eq('sample: Representing read, record marker ignored', [fin[1].country, fin[0].country], ['Mongolia', '']);
  eq('sample: hyphenated name + m:ss solves', [fin[2].name, fin[2].solves], ['Urin-Uchralt Bilguun', [-1, -1, 8699, 7113, 3726]]);
  eq('sample: two DNFs → DNF average, best still counts', [fin[2].single, fin[2].average], [3726, -1]);
  eq('sample: DNS kept as DNS (-2), all-DNF row', [fin[3].solves, fin[3].single, fin[3].average], [[-1, -1, -1, -2, -2], -1, -1]);
}

{
  const multiTab = '3x3x3 Cube Final\n1\t\t\tAnu Bat\t\t7.22\t\t\t7.35\t\t\t\t7.44 7.32 (7.22) (8.22) 7.30';
  const r = parseWcaResults(multiTab, { '333': { rounds: 1 } });
  eq('columns: any run of tabs separates columns', [r.rounds[0]?.rows[0]?.name, r.rounds[0]?.rows[0]?.average, r.warnings], ['Anu Bat', 735, []]);

  const wrong = '3x3x3 Cube Final\n1\tAnu Bat\t7.00\t\t7.99\t\t\t7.44 7.32 (7.22) (8.22) 7.30';
  const w = parseWcaResults(wrong, { '333': { rounds: 1 } });
  eq('mismatch: recomputed values are the ones stored', [w.rounds[0].rows[0].single, w.rounds[0].rows[0].average], [722, 735]);
  check('mismatch: one warning for best, one for average', w.warnings.length === 2 && w.warnings.every(x => x.includes('Anu Bat')), w.warnings);

  const mo3 = '6x6x6 Cube Final\n1\tAnu Bat\t1:40.00\t\t1:45.00\t\t\t1:40.00 1:45.00 1:50.00\n2\tBold Dorj\t2:00.00\t\tDNF\t\t\t2:00.00 DNF 2:10.00';
  const m = parseWcaResults(mo3, { '666': { rounds: 1 } });
  eq('3 solves: count follows the input, mean of 3', [m.rounds[0].rows[0].solves.length, m.rounds[0].rows[0].average, m.warnings], [3, 10500, []]);
  eq('3 solves: any DNF → DNF mean', [m.rounds[0].rows[1].single, m.rounds[0].rows[1].average], [12000, -1]);
  eq('importedAverage: 5 → Ao5, 3 → Mo3, other → none', [importedAverage([700, 800, 900, 1000, 1100]), importedAverage([700, 800, 900]), importedAverage([700, 800])], [900, 800, null]);
  eq('calcMo3: needs exactly 3', [calcMo3([100, 200, 300]), calcMo3([100, 200]), calcMo3([100, -2, 300])], [200, null, -1]);
}

{
  const mixed = ['Rubik Snake Final', '#\tName\tBest\t\tAverage\t\tRepresenting\tSolves', '1\tGhost One\t1.00\t\t1.00\t\t\t1.00 1.00 1.00 1.00 1.00',
    SAMPLE, '3x3x3 Cube Quarterfinals', '1\tGhost Two\t1.00\t\t1.00\t\t\t1.00 1.00 1.00 1.00 1.00'].join('\n');
  let r: ReturnType<typeof parseWcaResults> | null = null;
  let threw = false;
  try { r = parseWcaResults(mixed, { '333': { rounds: 2 } }); } catch { threw = true; }
  check('unknown: never throws', !threw);
  eq('unknown: valid blocks still parse', r?.rounds.map(x => `${x.eventId}:${x.roundId}:${x.rows.length}`), ['333:2:4', '333:1:2']);
  check('unknown: one warning per skipped block, naming it',
    r?.warnings.length === 2 && r.warnings[0].includes('Rubik Snake') && r.warnings[1].includes('Quarterfinals'), r?.warnings);
  check('unknown: skipped rows do not leak into another block', !JSON.stringify(r?.rounds).includes('Ghost'));

  const notRun = parseWcaResults(SAMPLE, { '222': { rounds: 1 } });
  eq('config: an event the competition does not run is skipped with warnings', [notRun.rounds, notRun.warnings.length], [[], 2]);
  const bad = parseWcaResults('3x3x3 Cube Final\n1\tAnu Bat\t7.22\t\t7.35\t\t\t7.44 oops (7.22) (8.22) 7.30\n2\tBold Dorj\t8.00\t\t8.00\t\t\t8.00 8.00 8.00 8.00 8.00', { '333': { rounds: 1 } });
  eq('bad row: skipped with a warning, the rest kept', [bad.rounds[0]?.rows.map(x => x.name), bad.warnings.length], [['Bold Dorj'], 1]);
  for (const junk of ['', '\n \n', 'hello', '1\tAnu Bat\t7.22', '#\tName\tBest']) {
    let ok = true; let out: ReturnType<typeof parseWcaResults> | null = null;
    try { out = parseWcaResults(junk, { '333': { rounds: 1 } }); } catch { ok = false; }
    check(`junk input ${JSON.stringify(junk)}: no throw, no rounds`, ok && out?.rounds.length === 0, out);
  }
  const crlf = parseWcaResults(SAMPLE.replace(/\n/g, '\r\n'), { '333': { rounds: 2 } });
  eq('CRLF: parses the same', [crlf.rounds.map(x => x.rows.length), crlf.warnings], [[4, 2], []]);
}

// ═══ Names, ids ══════════════════════════════════════════════════════════════

{
  eq('normalizeName: case, spacing, punctuation, diacritics', normalizeName('  Urin-Uchralt   BILGÜÜN '), 'urin uchralt bilguun');
  eq('nameKey: word order ignored', nameKey('Otgonbayar  ORGIL') === nameKey('Orgil Otgonbayar'), true);
  eq('nameKey: Cyrillic й/ё survive consistently', nameKey('Отгонбаяр Оргил') === nameKey('оргил ОТГОНБАЯР'), true);
  const club = [{ id: 'athA', name: 'Orgil', lastName: 'Otgonbayar' }, { id: 'athB', name: 'Тэмүүлэн', lastName: 'Цэрэндагва' }, { id: 'athC', name: 'Bold' }];
  eq('match: Latin name, any order/case', matchClubAthlete({ name: 'OTGONBAYAR orgil' }, club), 'athA');
  eq('match: by the local-script name', matchClubAthlete({ name: 'Temuulen Tserendagva', localName: 'Цэрэндагва Тэмүүлэн' }, club), 'athB');
  eq('match: no partial matches', [matchClubAthlete({ name: 'Orgil' }, club), matchClubAthlete({ name: 'Orgil Otgonbayar Jr' }, club)], [undefined, undefined]);
  eq('match: nobody', matchClubAthlete({ name: 'Max Park' }, club), undefined);

  eq('row id: stable across spelling/case/order of the same name', stagedRowId('333', '1', 'Orgil Otgonbayar') === stagedRowId('333', '1', ' otgonbayar  ORGIL '), true);
  check('row id: differs by round, event and person',
    new Set([stagedRowId('333', '1', 'A B'), stagedRowId('333', '2', 'A B'), stagedRowId('222', '1', 'A B'), stagedRowId('333', '1', 'A C')]).size === 4);
  eq('result doc id: deterministic', stagedResultDocId('comp1', stagedRowId('333', '1', 'A B')), `impst_comp1_${stagedRowId('333', '1', 'A B')}`);
}

// ═══ Import / re-import ══════════════════════════════════════════════════════

const row = (name: string, average: number, extra: Partial<StagedRow> = {}) => ({
  name, localName: '', country: '', solves: [average, average, average, average, average], single: average - 10, average, ...extra,
});
const parsedRound = (roundId: string, names: [string, number][]) =>
  ({ eventId: '333', roundId, roundName: `r${roundId}`, rows: names.map(([n, a]) => row(n, a)) });

{
  const names: [string, number][] = Array.from({ length: 30 }, (_, i) => [`Imp ${String.fromCharCode(65 + (i % 26))}${i}`, 1000 + i * 10]);
  const club = [{ id: 'athA', name: 'Imp', lastName: 'A0' }];
  const a = buildStagedEvent(undefined, '333', [parsedRound('1', names)], club, () => 0.42);
  const rows = a.rounds['1'];
  eq('import: every row staged', rows.length, 30);
  eq('import: reveal order is a permutation 0..29', [...rows.map(r => r.order)].sort((x, y) => x - y), Array.from({ length: 30 }, (_, i) => i));
  check('import: order is not simply the pasted order', rows.some((r, i) => r.order !== i));
  eq('import: unique ids', new Set(rows.map(r => r.id)).size, 30);
  eq('import: nothing revealed or eliminated yet', rows.filter(r => r.revealed || r.eliminated).length, 0);
  eq('import: club-name match recorded on the imported row only', rows.filter(r => r.matchedClubAthleteId).map(r => [r.name, r.matchedClubAthleteId]), [['Imp A0', 'athA']]);
  check('import: no undefined fields (Firestore would refuse them)', rows.every(r => Object.values(r).every(v => v !== undefined)));

  const dup = buildStagedEvent(undefined, '333', [parsedRound('1', [['Same Name', 900], ['Same Name', 950]])], []);
  eq('import: two rows with one name in a round are both kept', [dup.rounds['1'].length, new Set(dup.rounds['1'].map(r => r.id)).size], [2, 2]);

  // Re-import: revealed rows are frozen, unrevealed ones replaced, other rounds untouched.
  const before: StagedEvent = {
    eventId: '333',
    rounds: {
      '1': [
        { id: stagedRowId('333', '1', 'Keep Me'), name: 'Keep Me', solves: [1, 1, 1, 1, 1], single: 1, average: 1, order: 0, revealed: true },
        { id: stagedRowId('333', '1', 'Drop Me'), name: 'Drop Me', solves: [2, 2, 2, 2, 2], single: 2, average: 2, order: 1 },
      ],
      '2': [{ id: 'other-round', name: 'Other Round', solves: [3], single: 3, average: null, order: 0 }],
    },
  };
  const snapshot = JSON.stringify(before);
  const re = buildStagedEvent(before, '333', [parsedRound('1', [['Keep Me', 5000], ['New One', 1200], ['New Two', 1300]])], []);
  const r1 = re.rounds['1'];
  eq('re-import: revealed row untouched (old values, still revealed)', r1.find(r => r.name === 'Keep Me'), before.rounds['1'][0]);
  eq('re-import: the revealed athlete is not staged a second time', r1.filter(r => r.name === 'Keep Me').length, 1);
  eq('re-import: unrevealed rows replaced by the new paste', r1.map(r => r.name).sort(), ['Keep Me', 'New One', 'New Two']);
  check('re-import: new rows are ordered after the revealed ones', r1.filter(r => !r.revealed).every(r => r.order >= 1));
  eq('re-import: a round not in the paste is untouched', re.rounds['2'], before.rounds['2']);
  eq('re-import: input not mutated', JSON.stringify(before), snapshot);
  const other = buildStagedEvent(before, '333', [{ ...parsedRound('1', [['X Y', 1]]), eventId: '222' }], []);
  eq('re-import: another event\'s rounds are ignored', other.rounds, before.rounds);
}

// ═══ Reveal math ═════════════════════════════════════════════════════════════

{
  eq('target: N=5, M=30 → 6 per club athlete', [0, 1, 2, 3, 4, 5].map(k => revealTarget(30, k, 5)), [0, 6, 12, 18, 24, 30]);
  eq('target: rounds UP (M=10, N=3)', [0, 1, 2, 3].map(k => revealTarget(10, k, 3)), [0, 4, 7, 10]);
  eq('target: N=0 → everything at once', revealTarget(30, 0, 0), 30);
  eq('target: k > N is clamped, never more than M', [revealTarget(30, 9, 5), revealTarget(30, 6, 5)], [30, 30]);
  eq('target: round complete / forced → everything', [revealTarget(30, 1, 5, true), revealTarget(30, 0, 5, true)], [30, 30]);
  eq('target: M=0 → 0, negative k → 0', [revealTarget(0, 3, 5), revealTarget(0, 0, 0), revealTarget(30, -2, 5)], [0, 0, 0]);
}

// ── scenario helpers ──

const COMP = { id: 'comp1', name: 'Club Open' };
const club = (id: string, round: number, average: number, extra: Partial<RoundResultLite> = {}): RoundResultLite => ({
  id: `comp1_333_r${round}_${id}`, athleteId: id, athleteName: id, eventId: '333', round,
  single: average - 20, average, status: 'published', source: 'entry', ...extra,
});
const stage = (rounds: Record<string, [string, number][]>): StagedEvent =>
  buildStagedEvent(undefined, '333', Object.entries(rounds).map(([r, n]) => parsedRound(r, n)), []);
const names30: [string, number][] = Array.from({ length: 30 }, (_, i) => [`Imp ${String.fromCharCode(65 + (i % 26))}${i}`, 1000 + i * 10]);
const REGISTERED = ['c1', 'c2', 'c3', 'c4', 'c5'];
const input = (over: Partial<StagedSyncInput>): StagedSyncInput => ({
  comp: COMP, eventId: '333', staged: stage({ '1': names30 }), results: [], registeredClubIds: REGISTERED, ...over,
});
/** Apply a plan the way the service does: reveals become result docs, flags are stored. */
const apply = (inp: StagedSyncInput): StagedSyncInput => {
  const plan = planStagedSync(inp);
  return { ...inp, staged: plan.staged, results: [...inp.results, ...plan.reveals] };
};

{
  const none = planStagedSync(input({}));
  eq('reveal: nothing before any club athlete finishes', [none.reveals.length, none.changed], [0, false]);

  let state = input({});
  const counts: number[] = [];
  for (let k = 1; k <= 5; k++) {
    state = { ...state, results: [...state.results, club(`c${k}`, 1, 900 + k)] };
    const plan = planStagedSync(state);
    counts.push(plan.reveals.length);
    state = { ...state, staged: plan.staged, results: [...state.results, ...plan.reveals] };
  }
  eq('reveal: N=5, M=30 → 6 more after each club result', counts, [6, 6, 6, 6, 6]);
  eq('reveal: all 30 public at k = N', stagedRoundStatus(state.staged.rounds['1']), { revealed: 30, total: 30, eliminated: 0 });
  eq('reveal: 30 distinct result docs, no duplicates', new Set(state.results.filter(r => r.source === 'imported').map(r => r.id)).size, 30);

  // Stored random order is what decides who comes out first.
  const st = stage({ '1': names30 });
  const p = planStagedSync(input({ staged: st, results: [club('c1', 1, 900)] }));
  eq('reveal: the 6 lowest `order` rows go first', p.reveals.map(r => r.importRowId).sort(),
    [...st.rounds['1']].sort((a, b) => a.order - b.order).slice(0, 6).map(r => r.id).sort());

  // Shape of a revealed result.
  const doc = p.reveals[0];
  eq('result doc: existing imported format',
    [doc.athleteId, doc.source, doc.status, doc.competitionId, doc.competitionName, doc.eventId, doc.round, doc.solves?.length],
    ['', 'imported', 'published', 'comp1', 'Club Open', '333', 1, 5]);
  eq('result doc: deterministic id from the row', doc.id, stagedResultDocId('comp1', doc.importRowId!));
  check('result doc: no undefined fields', Object.values(doc).every(v => v !== undefined));
  const matchedRow: StagedRow = { ...st.rounds['1'][0], matchedClubAthleteId: 'c1', localName: 'Нэр' };
  const matchedDoc = stagedRowToResult(COMP, '333', 1, matchedRow);
  eq('result doc: club-name match + local name carried, athleteId still empty', [matchedDoc.matchedClubAthleteId, matchedDoc.localName, matchedDoc.athleteId], ['c1', 'Нэр', '']);
}

{
  // Idempotency / retries.
  const base = input({ results: [club('c1', 1, 900), club('c2', 1, 910)] });
  const p1 = planStagedSync(base);
  const p2 = planStagedSync(base);
  eq('idempotent: the same state plans the same documents', p1.reveals.map(r => r.id), p2.reveals.map(r => r.id));
  const after = apply(base);
  const again = planStagedSync(after);
  eq('idempotent: running again after applying writes nothing', [again.reveals.length, again.changed], [0, false]);

  // Crash after the result docs were written but before the flags were stored.
  const crashed = { ...base, results: [...base.results, ...p1.reveals] };
  const repair = planStagedSync(crashed);
  eq('retry: existing docs are recognised, none written twice', repair.reveals.length, 0);
  eq('retry: ...and their rows are flagged revealed', [repair.changed, stagedRoundStatus(repair.staged.rounds['1']).revealed], [true, 12]);

  // Never un-reveal.
  const deleted = { ...after, results: after.results.filter(r => r.athleteId !== 'c2') }; // club result deleted
  const shrink = planStagedSync(deleted);
  eq('never un-reveal: a deleted club result takes nothing back', [shrink.reveals.length, stagedRoundStatus(shrink.staged.rounds['1']).revealed], [0, 12]);
  const edited = { ...after, results: after.results.map(r => r.athleteId === 'c1' ? { ...r, average: 5000 } : r) };
  eq('never un-reveal: an edited club result changes nothing', planStagedSync(edited).reveals.length, 0);

  // Placeholders are expected athletes, not finished ones.
  const ph = planStagedSync(input({ results: [club('c1', 1, 900), club('c9', 1, 0, { isPlaceholder: true, status: 'draft', average: null, single: null })] }));
  eq('k/N: an unregistered club athlete with a row counts toward N (6 expected → 5 revealed)', ph.reveals.length, 5);
  const extra = planStagedSync(input({ registeredClubIds: ['c1'], results: [club('c1', 1, 900), club('c2', 1, 910)] }));
  eq('k/N: more finished than registered never exceeds M', extra.reveals.length, 30);
}

{
  // N = 0.
  const n0 = planStagedSync(input({ registeredClubIds: [] }));
  eq('N=0: round 1 reveals everything at import', n0.reveals.length, 30);
  // Round complete / forced.
  const done = planStagedSync(input({ results: [club('c1', 1, 900)], roundStatus: { '333_r1': 'complete' } }));
  eq('complete: marking the round complete reveals the rest', done.reveals.length, 30);
  const forced = planStagedSync(input({ forceRounds: [1] }));
  eq('force: "reveal all now" reveals everything with no club result', forced.reveals.length, 30);
  const other = planStagedSync(input({ results: [{ ...club('c1', 1, 900), eventId: '222' }] }));
  eq('scope: a club result in another event reveals nothing here', other.reveals.length, 0);
}

// ═══ Advancement / elimination ═══════════════════════════════════════════════

{
  // 20 imported in round 1 (averages 10.00 … 11.90); the real competition
  // advanced its top 12 to the final. Three club athletes beat all of them.
  const r1: [string, number][] = Array.from({ length: 20 }, (_, i) => [`Imp ${String.fromCharCode(65 + i)}`, 1000 + i * 10]);
  const r2: [string, number][] = r1.slice(0, 12).map(([n, a]) => [n, a - 50]);
  const staged = stage({ '1': r1, '2': r2 });
  const adv = { '1': { type: 'fixed' as const, value: 12 } };
  const clubs = [club('c1', 1, 800), club('c2', 1, 810), club('c3', 1, 820)];
  const reg = ['c1', 'c2', 'c3'];

  const open = planStagedSync({ comp: COMP, eventId: '333', staged, results: clubs.slice(0, 1), advancement: adv, registeredClubIds: reg });
  eq('later round: nothing of round 2 is revealed or eliminated while round 1 is open',
    [open.reveals.filter(r => r.round === 2).length, stagedRoundStatus(open.staged.rounds['2'])], [0, { revealed: 0, total: 12, eliminated: 0 }]);

  const inp: StagedSyncInput = { comp: COMP, eventId: '333', staged, results: clubs, advancement: adv, registeredClubIds: reg, roundStatus: { '333_r1': 'complete' } };
  const plan = planStagedSync(inp);
  eq('complete: all 20 round-1 rows revealed', plan.reveals.filter(r => r.round === 1).length, 20);
  const two = plan.staged.rounds['2'];
  eq('elimination: 3 club athletes in the top 12 push 3 imported out', stagedRoundStatus(two), { revealed: 0, total: 9, eliminated: 3 });
  eq('elimination: exactly the imported ranked 10th–12th', two.filter(r => r.eliminated).map(r => r.name).sort(), ['Imp J', 'Imp K', 'Imp L']);
  eq('elimination: eliminated rows are not revealed (and nothing of round 2 yet — clubs have not solved)', plan.reveals.filter(r => r.round === 2).length, 0);

  // Round 2: N = the 3 club athletes who advanced, M = 9.
  let state: StagedSyncInput = { ...inp, staged: plan.staged, results: [...inp.results, ...plan.reveals] };
  const perClub: number[] = [];
  for (const id of ['c1', 'c2', 'c3']) {
    state = { ...state, results: [...state.results, club(id, 2, 790)] };
    const p = planStagedSync(state);
    perClub.push(p.reveals.length);
    state = { ...state, staged: p.staged, results: [...state.results, ...p.reveals] };
  }
  eq('round 2: M=9, N=3 → 3 per advancing club athlete', perClub, [3, 3, 3]);
  const publicRound2 = state.results.filter(r => r.round === 2 && r.source === 'imported').map(r => r.athleteName);
  check('round 2: an eliminated athlete\'s row is never revealed', !publicRound2.some(n => ['Imp J', 'Imp K', 'Imp L'].includes(n || '')), publicRound2);
  const finalDone = planStagedSync({ ...state, roundStatus: { '333_r1': 'complete', '333_r2': 'complete' } });
  eq('round 2 complete / force: still nothing for the eliminated', [finalDone.reveals.length, planStagedSync({ ...state, forceRounds: [2] }).reveals.length], [0, 0]);
  eq('no duplicates across the whole run', new Set(state.results.map(r => r.id)).size, state.results.length);

  // No club athlete advanced → N = 0 for the next round → revealed when round 1 completes.
  const slow = [club('c1', 1, 5000), club('c2', 1, 5100)];
  const n0 = planStagedSync({ ...inp, results: slow, registeredClubIds: ['c1', 'c2'] });
  eq('N=0 later round: no club athlete advanced → round 2 revealed at round-1 completion',
    [n0.reveals.filter(r => r.round === 2).length, stagedRoundStatus(n0.staged.rounds['2']).eliminated], [12, 0]);

  // Percent rule counts the combined field: 23 results × 50% = 11 advance (3 club + 8 imported).
  const pct = planStagedSync({ ...inp, advancement: { '1': { type: 'percent', value: 50 } } });
  eq('percent: floor(23 × 50%) = 11 → 8 imported eligible, 4 eliminated', stagedRoundStatus(pct.staged.rounds['2']), { revealed: 0, total: 8, eliminated: 4 });

  // No advancement rule → nobody is cut.
  const noRule = planStagedSync({ ...inp, advancement: undefined });
  eq('no rule configured: nobody eliminated', stagedRoundStatus(noRule.staged.rounds['2']).eliminated, 0);

  // Re-completing after a correction re-evaluates only unrevealed rows.
  const corrected = planStagedSync({ ...state, results: state.results.map(r => r.athleteId === 'c3' && r.round === 1 ? { ...r, average: 9999, single: 9999 } : r) });
  eq('correction: the 9 revealed round-2 rows stay; the freed place un-eliminates (and reveals) the next imported',
    [corrected.staged.rounds['2'].filter(r => r.revealed).length, corrected.reveals.map(r => r.athleteName), corrected.staged.rounds['2'].filter(r => r.eliminated).map(r => r.name).sort()],
    [10, ['Imp J'], ['Imp K', 'Imp L']]);

  eq('computeAdvancing: placeholders and withdrawn rows never advance',
    computeAdvancing([club('a', 1, 900), club('b', 1, 800, { isPlaceholder: true }), club('c', 1, 700, { status: 'withdrawn' }), club('d', 1, 950)], { type: 'fixed', value: 3 }).map(r => r.athleteId), ['a', 'd']);
}

// ═══ Ranking ═════════════════════════════════════════════════════════════════

{
  const a = { eventId: '333', single: 500, average: 900 }, b = { eventId: '333', single: 800, average: 850 };
  check('ranking: average first for ordinary events', compareRoundResults(a, b) > 0);
  const c = { eventId: '444bf', single: 500, average: -1 }, d = { eventId: '444bf', single: 800, average: 850 };
  check('ranking: 444bf / 555bf / 333mbf rank by best single', compareRoundResults(c, d) < 0
    && compareRoundResults({ ...c, eventId: '555bf' }, { ...d, eventId: '555bf' }) < 0
    && compareRoundResults({ ...c, eventId: '333mbf' }, { ...d, eventId: '333mbf' }) < 0);
  check('ranking: 333bf, 666, 777 rank by average/mean', ['333bf', '666', '777'].every(ev =>
    compareRoundResults({ eventId: ev, single: 500, average: 900 }, { eventId: ev, single: 800, average: 850 }) > 0));
  check('ranking: DNF average sorts after any average, ties fall to single',
    compareRoundResults({ eventId: '333', single: 400, average: -1 }, b) > 0
    && compareRoundResults({ eventId: '333', single: 400, average: 850 }, b) < 0
    && compareRoundResults({ eventId: '333', single: -1, average: -1 }, { eventId: '333', single: -1, average: null }) === 0);
}

console.log(failures === 0 ? '\nAll results-import checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
