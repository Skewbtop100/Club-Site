// Standalone correctness check for lib/record-celebration.ts (which records a
// just-saved result breaks, and the content of the celebration card). No
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
  levelName: { TR: 'Клубын рекорд', NR: 'Үндэсний рекорд', CR: 'Тивийн рекорд', WR: 'Дэлхийн рекорд' },
  single: 'нэг', average: 'дундаж',
  previousLabel: 'Өмнөх', newLabel: 'Шинэ', today: 'өнөөдөр', seconds: 'сек',
  daysUnit: 'хоног', daysCaption: 'хадгалагдсан рекорд шинэчлэгдлээ',
  sameDay: 'Өнөөдөр {n} дахь удаагаа шинэчлэгдлээ', ownRecord: 'Өөрийн рекордыг ахиуллаа',
  tied: 'Рекордтой тэнцлээ', first: 'Энэ төрлийн анхны рекорд',
};

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime(); // local time
const NOW = at(2026, 10, 13, 15);

const CLUB = new Set(['T', 'B', 'C']);
const NAMES = { T: 'Tergel Batzorig', B: 'Bold Dorj', C: 'Chimeg Enkh' };
const BESTS: ClubBests = {
  athletes: { T: { '222': { s: 230, a: 300 } }, B: { '222': { s: 210, a: 280 } } },
  club: { '222': { s: 210, a: 280 } },
  holders: { '222': {
    s: { athleteId: 'B', name: 'Bold Dorj', competitionId: 'old', competitionName: 'Autumn Open', at: at(2026, 9, 28) },
    a: { athleteId: 'B', name: 'Bold Dorj', competitionId: 'old', competitionName: 'Autumn Open', at: at(2026, 6, 7) },
  } },
};
let seq = 0;
const res = (athleteId: string, single: number | null, average: number | null, over: Record<string, unknown> = {}) => ({
  id: `r${++seq}`, athleteId, eventId: '222', competitionId: 'live', round: 1,
  single, average, status: 'published', source: 'entry', ...over,
});
const input = (saved: ReturnType<typeof res>, others: ReturnType<typeof res>[] = [], over: Partial<CelebrationInput> = {}): CelebrationInput => ({
  saved, competitionResults: others, bests: BESTS, clubAthleteIds: CLUB, athleteNames: NAMES,
  eventName: '2x2x2', competitionName: 'Mongolian Open 2026', ...over,
});
const text = (inp: CelebrationInput, now = NOW) => { const c = findCelebration(inp); return c ? buildCelebrationText(c, MN, now) : null; };
const noEmpty = (o: unknown): boolean => o === null || typeof o !== 'object'
  ? o !== '' && o !== undefined
  : Object.values(o as Record<string, unknown>).every(noEmpty);

// ═══ TR with holder + date ═══════════════════════════════════════════════════

{
  const saved = res('T', 240, 263); // average 2.63 beats 2.80; single 2.40 does not beat 2.10
  const t = text(input(saved));
  eq('TR: only the average is a record', findCelebration(input(saved))?.breaks.map(b => [b.type, b.level, b.value]), [['average', 'TR', 263]]);
  eq('TR: title and event', [t?.title, t?.eventName], ['Шинэ клубын рекорд!', '2x2x2']);
  eq('TR: the item', t?.items, [{
    level: 'TR', type: 'average', chip: 'Клубын рекорд · дундаж',
    next: { label: 'Шинэ', value: '2.63', name: 'Tergel Batzorig', when: 'өнөөдөр' },
    previous: { label: 'Өмнөх', value: '2.80', name: 'Bold Dorj', date: '2026.06.07', competition: 'Autumn Open' },
    improvement: '−0.17 сек',
    stat: { days: 128, unit: 'хоног', caption: 'хадгалагдсан рекорд шинэчлэгдлээ' },
  }]);
  const single = text(input(res('T', 205, 400)))?.items[0];
  eq('TR single: chip, date in 2026.09.28 form, and the days the record stood',
    [single?.chip, single?.previous?.date, single?.improvement, single?.stat], ['Клубын рекорд · нэг', '2026.09.28', '−0.05 сек', { days: 15, unit: 'хоног', caption: 'хадгалагдсан рекорд шинэчлэгдлээ' }]);
}

// ═══ Single + average in one card ════════════════════════════════════════════

{
  const t = text(input(res('T', 198, 263)));
  eq('single + average: two items, single first', t?.items.map(i => [i.type, i.chip, i.next.value]),
    [['single', 'Клубын рекорд · нэг', '1.98'], ['average', 'Клубын рекорд · дундаж', '2.63']]);
  eq('single + average: each has its own previous record, gap and stat', t?.items.map(i => [i.previous?.value, i.previous?.date, i.improvement, i.stat?.days]),
    [['2.10', '2026.09.28', '−0.12 сек', 15], ['2.80', '2026.06.07', '−0.17 сек', 128]]);
}

// ═══ Same athlete improving their own record ═════════════════════════════════

{
  const own = text(input(res('B', 205, 400)))?.items[0]; // B holds the single (2.10, 15 days ago)
  eq('own record, an earlier day: day count with the "own record" caption',
    [own?.previous?.name, own?.next.name, own?.improvement, own?.stat], ['Bold Dorj', 'Bold Dorj', '−0.05 сек', { days: 15, unit: 'хоног', caption: 'Өөрийн рекордыг ахиуллаа' }]);

  const r1 = res('T', 400, 270, { submittedAt: at(2026, 10, 13, 10) });           // T took the average record this morning
  const fin = res('T', 400, 263, { round: 2, submittedAt: NOW });                  // …and lowers it in the final
  const sameDay = text(input(fin, [r1]))?.items[0];
  eq('own record, same day: the caption alone, no day count, and no "N-th time today"',
    [sameDay?.previous, sameDay?.stat], [{ label: 'Өмнөх', value: '2.70', name: 'Tergel Batzorig', date: 'өнөөдөр', competition: 'Mongolian Open 2026' }, { caption: 'Өөрийн рекордыг ахиуллаа' }]);
  const noHolderId: ClubBests = { ...BESTS, holders: { '222': { s: { athleteId: '', name: 'Bold Dorj', competitionId: 'old', competitionName: 'Autumn Open', at: at(2026, 9, 28) } } } };
  eq('a holder known only by name is not assumed to be the same person',
    text(input(res('B', 205, 400), [], { bests: noHolderId }))?.items[0].stat?.caption, 'хадгалагдсан рекорд шинэчлэгдлээ');
}

// ═══ Previous record set earlier in this same competition ════════════════════

{
  const earlier = res('C', 300, 270, { submittedAt: at(2026, 10, 13, 10) });        // C took the average record this morning
  const saved = res('T', 240, 263, { submittedAt: NOW });
  const t = text(input(saved, [earlier]))?.items[0];
  eq('same competition: the record set earlier today is the previous record — today\'s holder, this competition',
    t?.previous, { label: 'Өмнөх', value: '2.70', name: 'Chimeg Enkh', date: 'өнөөдөр', competition: 'Mongolian Open 2026' });
  eq('same day: "2nd time today" in place of a day count', [t?.improvement, t?.stat], ['−0.07 сек', { caption: 'Өнөөдөр 2 дахь удаагаа шинэчлэгдлээ' }]);

  const first = res('B', 300, 275, { submittedAt: at(2026, 10, 13, 9) });
  eq('third time today: counted from the records actually lowered today',
    text(input(saved, [first, earlier]))?.items[0].stat, { caption: 'Өнөөдөр 3 дахь удаагаа шинэчлэгдлээ' });
  const notARecord = res('B', 300, 290, { submittedAt: at(2026, 10, 13, 9) });     // 2.90 never beat the old 2.80
  eq('…a result that was not a record does not count as a time', text(input(saved, [notARecord, earlier]))?.items[0].stat, { caption: 'Өнөөдөр 2 дахь удаагаа шинэчлэгдлээ' });

  const yesterday = res('C', 300, 270, { submittedAt: at(2026, 10, 12, 10) });       // multi-day competition
  eq('same competition, an earlier day: dated, and counted in days',
    [text(input(saved, [yesterday]))?.items[0].previous?.date, text(input(saved, [yesterday]))?.items[0].stat],
    ['2026.10.12', { days: 1, unit: 'хоног', caption: 'хадгалагдсан рекорд шинэчлэгдлээ' }]);
  const r1 = res('C', 300, 270, { submittedAt: at(2026, 10, 13, 9) });
  const fin = res('T', 240, 263, { round: 2, submittedAt: NOW });
  eq('an earlier ROUND\'s record counts as the previous record too', text(input(fin, [r1]))?.items[0].previous?.name, 'Chimeg Enkh');
  const slowEarlier = res('C', 300, 290, { submittedAt: at(2026, 10, 13, 10) });    // did not beat the old 2.80
  eq('an earlier result that was NOT a record leaves the pre-competition record as the previous one',
    [text(input(saved, [slowEarlier]))?.items[0].previous?.name, text(input(saved, [slowEarlier]))?.items[0].stat?.days], ['Bold Dorj', 128]);
  const faster = res('C', 300, 250, { submittedAt: at(2026, 10, 13, 10) });
  eq('same round, someone already faster: not the round\'s best → no record, no card', findCelebration(input(saved, [faster])), null);
  eq('the saved result being in the list already (subscription caught up) changes nothing',
    text(input(saved, [earlier, saved])), text(input(saved, [earlier])));
}

// ═══ Tie ═════════════════════════════════════════════════════════════════════

{
  const tie = text(input(res('T', 400, 280)))?.items[0];
  eq('tie: "Рекордтой тэнцлээ" in place of an improvement', [tie?.tied, tie?.improvement], ['Рекордтой тэнцлээ', undefined]);
  eq('tie: the previous record is still shown in full; no "renewed" highlight',
    [tie?.previous, tie?.stat], [{ label: 'Өмнөх', value: '2.80', name: 'Bold Dorj', date: '2026.06.07', competition: 'Autumn Open' }, undefined]);
}

// ═══ First-ever record ═══════════════════════════════════════════════════════

{
  const first = text(input(res('C', 4000, 4500, { eventId: '555' }), [], { eventName: '5x5x5' }));
  eq('first ever: a single panel, no comparison, for both single and average', first?.items.map(i => [i.chip, i.first, i.next.value, i.previous, i.improvement, i.stat, i.tied]), [
    ['Клубын рекорд · нэг', 'Энэ төрлийн анхны рекорд', '40.00', undefined, undefined, undefined, undefined],
    ['Клубын рекорд · дундаж', 'Энэ төрлийн анхны рекорд', '45.00', undefined, undefined, undefined, undefined],
  ]);
}

// ═══ Unknown holder / date ═══════════════════════════════════════════════════

{
  const saved = res('T', 240, 263);
  // NR from the WCA thresholds: value known, nothing else.
  const nr = text(input(saved, [], { wca: { average: { level: 'NR', previousValue: 270 } } }));
  eq('NR: national title and chip', [nr?.title, nr?.items[0].chip, nr?.items[0].level], ['Шинэ үндэсний рекорд!', 'Үндэсний рекорд · дундаж', 'NR']);
  eq('NR: previous is the value alone — no name, date or competition keys at all', nr?.items[0].previous, { label: 'Өмнөх', value: '2.70' });
  eq('NR: improvement shown, no day-count highlight', [nr?.items[0].improvement, nr?.items[0].stat], ['−0.07 сек', undefined]);
  eq('NR with no threshold value: treated as a first record', text(input(saved, [], { wca: { average: { level: 'NR' } } }))?.items[0].first, 'Энэ төрлийн анхны рекорд');
  eq('titles and chips by level',
    (['CR', 'WR'] as const).map(level => { const t = text(input(saved, [], { wca: { average: { level } } })); return [t?.title, t?.items[0].chip]; }),
    [['Шинэ тивийн рекорд!', 'Тивийн рекорд · дундаж'], ['Шинэ дэлхийн рекорд!', 'Дэлхийн рекорд · дундаж']]);
  const mixed = text(input(res('T', 198, 263), [], { wca: { average: { level: 'NR', previousValue: 270 } } }));
  eq('mixed levels: the title follows the highest, each item keeps its own', [mixed?.title, mixed?.items.map(i => i.level)], ['Шинэ үндэсний рекорд!', ['TR', 'NR']]);
  eq('an NR is celebrated even when the bests summary is missing',
    text(input(saved, [], { bests: null, wca: { average: { level: 'NR', previousValue: 270 } } }))?.title, 'Шинэ үндэсний рекорд!');

  // A summary from before holders were stored (the production state until it is recalculated).
  const noHolders: ClubBests = { athletes: BESTS.athletes, club: BESTS.club };
  const old = text(input(saved, [], { bests: noHolders }))?.items[0];
  eq('summary without holders: value only, improvement shown, no highlight', [old?.previous, old?.improvement, old?.stat], [{ label: 'Өмнөх', value: '2.80' }, '−0.17 сек', undefined]);
  const noDate: ClubBests = { ...noHolders, holders: { '222': { a: { athleteId: 'B', name: 'Bold Dorj', competitionId: 'old', competitionName: '' } } } };
  eq('holder known, date and competition unknown: just the name', text(input(saved, [], { bests: noDate }))?.items[0].previous, { label: 'Өмнөх', value: '2.80', name: 'Bold Dorj' });

  const everything = [
    text(input(saved)), nr, old, text(input(saved, [], { bests: noDate })), mixed,
    text(input(res('T', 400, 280))), text(input(res('C', 4000, 4500, { eventId: '555' }))),
  ];
  check('nothing the card renders is ever an empty string or undefined (no empty labels)', everything.every(noEmpty), everything.filter(x => !noEmpty(x)));
}

// ═══ Edges ═══════════════════════════════════════════════════════════════════

{
  const b: ClubBests = { athletes: {}, club: { '666': { a: 20000 } }, holders: {} };
  const long = text(input(res('T', 30000, 12470, { eventId: '666' }), [], { bests: b, eventName: '6x6x6' }))?.items[1];
  eq('a gap of a minute or more is a time, not "сек"', [long?.next.value, long?.previous?.value, long?.improvement], ['2:04.70', '3:20.00', '−1:15.30']);
  const future: ClubBests = { ...BESTS, holders: { '222': { a: { ...BESTS.holders!['222'].a!, at: NOW + 3 * 86400000 } } } };
  eq('a record dated in the future (clock skew) never gives a negative day count', text(input(res('T', 400, 263), [], { bests: future }))?.items[0].previous?.date, 'өнөөдөр');

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
