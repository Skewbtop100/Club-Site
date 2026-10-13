// Standalone correctness check for lib/record-celebration.ts (which records a
// just-saved result breaks, and the wording of the celebration card). No
// test runner in this project — plain script. Run via:
//   npx tsc lib/record-celebration.ts scripts/test-record-celebration.ts \
//     --outDir .tmp-test-build --module commonjs --target es2020 --esModuleInterop --skipLibCheck
//   node .tmp-test-build/scripts/test-record-celebration.js

import { findCelebration, buildCelebrationText, type CelebrationStrings, type CelebrationInput } from '../lib/record-celebration';
import type { ClubBests } from '../lib/club-bests';

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

// The strings exactly as lib/i18n/mn.ts has them.
const MN: CelebrationStrings = {
  title: { TR: 'Шинэ клубын рекорд!', NR: 'Шинэ үндэсний рекорд!', CR: 'Шинэ тивийн рекорд!', WR: 'Шинэ дэлхийн рекорд!' },
  single: 'нэг', average: 'дундаж',
  previous: 'Өмнөх рекорд:', today: 'өнөөдөр',
  afterDays: '{n} хоногийн дараа шинэчлэгдлээ', renewed: 'Шинэчлэгдлээ',
  tied: 'Өмнөх рекордтой тэнцлээ', first: 'Энэ төрлийн анхны рекорд',
};

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime(); // local time
const NOW = at(2026, 10, 13, 15);

const CLUB = new Set(['T', 'B', 'C']);
const NAMES = { T: 'Tergel Batzorig', B: 'Bold Dorj', C: 'Chimeg Enkh' };
const BESTS: ClubBests = {
  athletes: { T: { '222': { s: 230, a: 300 } }, B: { '222': { s: 210, a: 280 } } },
  club: { '222': { s: 210, a: 280 } },
  holders: { '222': {
    s: { athleteId: 'B', name: 'Bold Dorj', competitionId: 'old', competitionName: 'Autumn Open', at: at(2026, 10, 1) },
    a: { athleteId: 'B', name: 'Bold Dorj', competitionId: 'old', competitionName: 'Autumn Open', at: at(2026, 10, 1) },
  } },
};
let seq = 0;
const res = (athleteId: string, single: number | null, average: number | null, over: Record<string, unknown> = {}) => ({
  id: `r${++seq}`, athleteId, eventId: '222', competitionId: 'live', round: 1,
  single, average, status: 'published', source: 'entry', ...over,
});
const input = (saved: ReturnType<typeof res>, others: ReturnType<typeof res>[] = [], over: Partial<CelebrationInput> = {}): CelebrationInput => ({
  saved, competitionResults: others, bests: BESTS, clubAthleteIds: CLUB, athleteNames: NAMES, eventName: '2x2x2', ...over,
});
const text = (inp: CelebrationInput, now = NOW) => { const c = findCelebration(inp); return c ? buildCelebrationText(c, MN, now) : null; };

// ═══ TR only (the example from the spec) ═════════════════════════════════════

{
  const saved = res('T', 240, 263); // average 2.63 beats 2.80; single 2.40 does not beat 2.10
  const c = findCelebration(input(saved));
  eq('TR only: just the average is a record', c?.breaks.map(b => [b.type, b.level, b.value]), [['average', 'TR', 263]]);
  eq('TR only: the card', text(input(saved)), {
    title: 'Шинэ клубын рекорд!',
    items: [{
      level: 'TR',
      headline: 'Tergel Batzorig — 2x2x2 дундаж 2.63',
      previous: 'Өмнөх рекорд: 2.80 — Bold Dorj, 2026-10-01',
      gap: '12 хоногийн дараа шинэчлэгдлээ (−0.17)',
    }],
  });
  eq('TR only: the single alone', text(input(res('T', 205, 400)))?.items, [{
    level: 'TR', headline: 'Tergel Batzorig — 2x2x2 нэг 2.05',
    previous: 'Өмнөх рекорд: 2.10 — Bold Dorj, 2026-10-01', gap: '12 хоногийн дараа шинэчлэгдлээ (−0.05)',
  }]);
}

// ═══ Single + average in one card ════════════════════════════════════════════

{
  const t = text(input(res('T', 198, 263)));
  eq('single + average: one card, two items, single first', t?.items.map(i => i.headline),
    ['Tergel Batzorig — 2x2x2 нэг 1.98', 'Tergel Batzorig — 2x2x2 дундаж 2.63']);
  eq('single + average: each with its own previous record and gap', t?.items.map(i => [i.previous, i.gap]), [
    ['Өмнөх рекорд: 2.10 — Bold Dorj, 2026-10-01', '12 хоногийн дараа шинэчлэгдлээ (−0.12)'],
    ['Өмнөх рекорд: 2.80 — Bold Dorj, 2026-10-01', '12 хоногийн дараа шинэчлэгдлээ (−0.17)'],
  ]);
  eq('single + average: one title', t?.title, 'Шинэ клубын рекорд!');
}

// ═══ Previous record set earlier in this same competition ════════════════════

{
  const earlier = res('C', 300, 270, { submittedAt: at(2026, 10, 13, 10) });        // took the average record this morning
  const saved = res('T', 240, 263, { submittedAt: NOW });
  const t = text(input(saved, [earlier]));
  eq('same competition: the record set earlier today is the previous record, with today\'s holder', t?.items, [{
    level: 'TR', headline: 'Tergel Batzorig — 2x2x2 дундаж 2.63',
    previous: 'Өмнөх рекорд: 2.70 — Chimeg Enkh, өнөөдөр', gap: 'Шинэчлэгдлээ (−0.07)',
  }]);
  const yesterday = res('C', 300, 270, { submittedAt: at(2026, 10, 12, 10) });       // multi-day competition
  eq('same competition, an earlier day: dated, and counted in days',
    [text(input(saved, [yesterday]))?.items[0].previous, text(input(saved, [yesterday]))?.items[0].gap],
    ['Өмнөх рекорд: 2.70 — Chimeg Enkh, 2026-10-12', '1 хоногийн дараа шинэчлэгдлээ (−0.07)']);
  const r1 = res('C', 300, 270, { submittedAt: at(2026, 10, 13, 9) });
  const fin = res('T', 240, 263, { round: 2, submittedAt: NOW });
  eq('same competition: an earlier ROUND\'s record counts as the previous record too',
    text(input(fin, [r1]))?.items[0].previous, 'Өмнөх рекорд: 2.70 — Chimeg Enkh, өнөөдөр');
  const slowEarlier = res('C', 300, 290, { submittedAt: at(2026, 10, 13, 10) });    // did not beat the old 2.80
  eq('same competition: an earlier result that was NOT a record leaves the pre-competition record as the previous one',
    text(input(saved, [slowEarlier]))?.items[0].previous, 'Өмнөх рекорд: 2.80 — Bold Dorj, 2026-10-01');
  const faster = res('C', 300, 250, { submittedAt: at(2026, 10, 13, 10) });
  eq('same round, someone already faster: not the round\'s best → no record, no card', findCelebration(input(saved, [faster])), null);
  eq('the saved result being in the list already (subscription caught up) changes nothing',
    text(input(saved, [earlier, saved])), t);
}

// ═══ Unknown holder / date ═══════════════════════════════════════════════════

{
  const saved = res('T', 240, 263);
  const noHolders: ClubBests = { athletes: BESTS.athletes, club: BESTS.club }; // summary from before holders were stored
  eq('unknown holder: the previous value alone, and no day count', text(input(saved, [], { bests: noHolders }))?.items, [{
    level: 'TR', headline: 'Tergel Batzorig — 2x2x2 дундаж 2.63', previous: 'Өмнөх рекорд: 2.80', gap: 'Шинэчлэгдлээ (−0.17)',
  }]);
  const noDate: ClubBests = { ...noHolders, holders: { '222': { a: { athleteId: 'B', name: 'Bold Dorj', competitionId: 'old', competitionName: '' } } } };
  eq('holder known, date unknown: name only', [text(input(saved, [], { bests: noDate }))?.items[0].previous, text(input(saved, [], { bests: noDate }))?.items[0].gap],
    ['Өмнөх рекорд: 2.80 — Bold Dorj', 'Шинэчлэгдлээ (−0.17)']);

  // NR from the WCA thresholds: value known, holder not.
  const nr = text(input(saved, [], { wca: { average: { level: 'NR', previousValue: 270 } } }));
  eq('NR: national title; previous record without holder or date', nr, {
    title: 'Шинэ үндэсний рекорд!',
    items: [{ level: 'NR', headline: 'Tergel Batzorig — 2x2x2 дундаж 2.63', previous: 'Өмнөх рекорд: 2.70', gap: 'Шинэчлэгдлээ (−0.07)' }],
  });
  eq('NR with no threshold value at all: the line is simply dropped',
    text(input(saved, [], { wca: { average: { level: 'NR' } } }))?.items, [{ level: 'NR', headline: 'Tergel Batzorig — 2x2x2 дундаж 2.63', gap: 'Энэ төрлийн анхны рекорд' }]);
  eq('titles by level', (['CR', 'WR'] as const).map(level => text(input(saved, [], { wca: { average: { level } } }))?.title),
    ['Шинэ тивийн рекорд!', 'Шинэ дэлхийн рекорд!']);
  const mixed = text(input(res('T', 198, 263), [], { wca: { average: { level: 'NR', previousValue: 270 } } }));
  eq('mixed levels: the title follows the highest, each item keeps its own', [mixed?.title, mixed?.items.map(i => i.level)], ['Шинэ үндэсний рекорд!', ['TR', 'NR']]);
  eq('an NR is celebrated even when the bests summary is missing',
    text(input(saved, [], { bests: null, wca: { average: { level: 'NR', previousValue: 270 } } }))?.title, 'Шинэ үндэсний рекорд!');
}

// ═══ Edges ═══════════════════════════════════════════════════════════════════

{
  const first = res('C', 4000, 4500, { eventId: '555' });
  eq('first result ever in an event: a record with nothing before it',
    text(input(first, [], { eventName: '5x5x5' }))?.items, [
      { level: 'TR', headline: 'Chimeg Enkh — 5x5x5 нэг 40.00', gap: 'Энэ төрлийн анхны рекорд' },
      { level: 'TR', headline: 'Chimeg Enkh — 5x5x5 дундаж 45.00', gap: 'Энэ төрлийн анхны рекорд' },
    ]);
  eq('a tie with the standing record is called a tie, not "−0.00"',
    text(input(res('T', 400, 280)))?.items[0].gap, 'Өмнөх рекордтой тэнцлээ');
  eq('minutes are formatted as times, in the value and in the gap',
    (() => { const b: ClubBests = { athletes: {}, club: { '666': { a: 13000 } }, holders: {} }; const t = text(input(res('T', 20000, 12470, { eventId: '666' }), [], { bests: b, eventName: '6x6x6' })); return [t?.items[1].headline, t?.items[1].gap]; })(),
    ['Tergel Batzorig — 6x6x6 дундаж 2:04.70', 'Шинэчлэгдлээ (−5.30)']);

  eq('no record: slower than the club best → null', findCelebration(input(res('T', 400, 400))), null);
  eq('a PR that is not a club record is not celebrated', findCelebration(input(res('T', 220, 290))), null);
  eq('DNF average, slow single → null', findCelebration(input(res('T', 400, -1))), null);
  eq('an implausibly fast typo (0.05) is not a record', findCelebration(input(res('T', 5, 6))), null);
  eq('no summary and no WCA level → null (never "everything is a record")', findCelebration(input(res('T', 100, 100), [], { bests: null })), null);
  eq('an imported result never celebrates', findCelebration(input(res('', 100, 100, { source: 'imported' }))), null);
  eq('the athlete\'s name falls back to the result, then the id',
    [findCelebration(input(res('T', 198, 400, { athleteName: 'Stored' }), [], { athleteNames: {} }))?.athleteName,
     findCelebration(input(res('T', 198, 400), [], { athleteNames: {} }))?.athleteName], ['Stored', 'T']);
  const before = JSON.stringify(BESTS);
  findCelebration(input(res('T', 198, 263), [res('C', 300, 270)]));
  eq('inputs are not mutated', JSON.stringify(BESTS), before);
}

console.log(failures === 0 ? '\nAll record-celebration checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
