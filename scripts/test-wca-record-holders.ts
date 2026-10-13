// Standalone correctness check for lib/wca-record-holders.ts (picking the
// holder of each WCA record out of the official API's rows). No test runner
// in this project — plain script. Run via:
//   npx tsc lib/wca-record-holders.ts scripts/test-wca-record-holders.ts \
//     --outDir .tmp-test-build --module commonjs --target es2020 --esModuleInterop --skipLibCheck
//   node .tmp-test-build/scripts/test-wca-record-holders.js

import { splitWcaName, competitionIdsOf, pickRecordHolders, holderFor, attachHoldersToStored, type WcaApiRecordRow } from '../lib/wca-record-holders';

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

const row = (type: 'single' | 'average', value: number, person_name: string, competition_id: string, over: Partial<WcaApiRecordRow> = {}): WcaApiRecordRow => ({
  type, value, person_name, person_id: `2020${person_name.slice(0, 4).toUpperCase()}01`, competition_id, competition_name: `${competition_id} name`, ...over,
});

// Rows shaped like GET /results/records?region=MN → records (real field names).
const RECORDS: Record<string, WcaApiRecordRow[]> = {
  '333': [
    row('single', 484, 'Myagmardorj Ulziijargal (Өлзийжаргал Мягмардорж)', 'UBOpen2025', { person_id: '2019ULZI01', competition_name: 'Ulaanbaatar Open 2025' }),
    row('average', 663, 'Temuulen Tserendagva', 'BCChamp2026', { person_id: '2021TSER02', competition_name: 'BC Championship 2026' }),
  ],
  '333fm': [ // a much-tied record: same value, several people and competitions
    row('single', 17, 'Late Person', 'Shanghai2026'),
    row('single', 17, 'Early Person', 'Tianjin2021'),
    row('single', 17, 'Undated Person', 'Unknown2020'),
    row('single', 17, 'Also Late', 'Shanghai2026'),
  ],
  '222': [row('single', 101, 'Mandakh Davaasuren', 'Debica2026'), row('average', 184, 'Mandakh Davaasuren', 'BCChamp2026')],
  '333ft': [row('single', 2500, 'Old Event', 'Old2015')], // not an event the site tracks
};
const DATES = { UBOpen2025: '2025-11-02', BCChamp2026: '2026-08-07', Shanghai2026: '2026-03-14', Tianjin2021: '2021-06-20', Debica2026: '2026-02-22' };
const EVENTS = new Set(['333', '222', '333fm']);

{
  eq('name: Latin name + local-script name', splitWcaName('Myagmardorj Ulziijargal (Өлзийжаргал Мягмардорж)'), { name: 'Myagmardorj Ulziijargal', localName: 'Өлзийжаргал Мягмардорж' });
  eq('name: plain', splitWcaName('Max Park'), { name: 'Max Park' });
  eq('name: empty parentheses / empty input', [splitWcaName('Max Park ()'), splitWcaName('')], [{ name: 'Max Park' }, { name: '' }]);

  eq('competition ids: every competition the tracked events refer to, each once',
    competitionIdsOf(RECORDS, EVENTS).sort(), ['BCChamp2026', 'Debica2026', 'Shanghai2026', 'Tianjin2021', 'UBOpen2025', 'Unknown2020']);
  check('competition ids: an untracked event\'s competition is not fetched', !competitionIdsOf(RECORDS, EVENTS).includes('Old2015'));
}

{
  const h = pickRecordHolders(RECORDS, DATES, EVENTS);
  eq('holder: name, local name, WCA ID, competition and date for a record', h['333'].single, {
    value: 484, holderName: 'Myagmardorj Ulziijargal', holderLocalName: 'Өлзийжаргал Мягмардорж', holderWcaId: '2019ULZI01',
    competitionId: 'UBOpen2025', competitionName: 'Ulaanbaatar Open 2025', date: '2025-11-02',
  });
  eq('holder: single and average are independent', [h['333'].average?.holderName, h['333'].average?.date, h['222'].single?.competitionId, h['222'].average?.competitionId],
    ['Temuulen Tserendagva', '2026-08-07', 'Debica2026', 'BCChamp2026']);
  eq('tie: the holder is whoever set it FIRST — the earliest dated competition; undated ones come last',
    [h['333fm'].single?.holderName, h['333fm'].single?.date], ['Early Person', '2021-06-20']);
  eq('untracked events are left out', Object.keys(h).sort(), ['222', '333', '333fm']);
  eq('no events filter → everything', Object.keys(pickRecordHolders(RECORDS, DATES)).sort(), ['222', '333', '333fm', '333ft']);

  const undated = pickRecordHolders(RECORDS, {}, EVENTS);
  eq('competition date unavailable: holder kept, no date key at all', [undated['333'].single?.holderName, 'date' in (undated['333'].single ?? {})], ['Myagmardorj Ulziijargal', false]);
  eq('tie with no dates at all: the API\'s own order decides', undated['333fm'].single?.holderName, 'Late Person');

  const mixed = pickRecordHolders({ '333': [row('single', 500, 'Slower Row', 'A'), row('single', 484, 'Record Row', 'B')] }, {});
  eq('only the BEST value\'s rows are record holders', [mixed['333'].single?.holderName, mixed['333'].single?.value], ['Record Row', 484]);
  eq('empty / malformed input → nothing, no throw',
    [pickRecordHolders({}, {}), pickRecordHolders({ '333': [] }, {}), pickRecordHolders({ '333': [{ type: 'single', value: 484 } as WcaApiRecordRow] }, {})], [{}, {}, {}]);
  check('no undefined fields (Firestore would refuse them)', Object.values(h).every(ev => Object.values(ev).every(x => Object.values(x ?? {}).every(v => v !== undefined))));
}

{
  // Attaching a holder to a stored value: only when it is the holder OF that value.
  const h = pickRecordHolders(RECORDS, DATES, EVENTS);
  eq('holderFor: stored value matches → the holder, without the helper `value` field', holderFor(h, '333', 'single', 484), {
    holderName: 'Myagmardorj Ulziijargal', holderLocalName: 'Өлзийжаргал Мягмардорж', holderWcaId: '2019ULZI01',
    competitionId: 'UBOpen2025', competitionName: 'Ulaanbaatar Open 2025', date: '2025-11-02',
  });
  eq('holderFor: the record moved on between the two requests (values differ) → no holder, the value is left alone',
    holderFor(h, '333', 'single', 490), undefined);
  eq('holderFor: no holder row / no stored value / no holders at all → undefined',
    [holderFor(h, '444', 'single', 3000), holderFor(h, '333', 'single', null), holderFor(undefined, '333', 'single', 484)], [undefined, undefined, undefined]);
  // What the admin tab writes: the value exactly as before, holder fields beside it.
  const stored = { value: 484 / 100, ...holderFor(h, '333', 'single', 484) };
  eq('stored entry: value unchanged (seconds), holder fields beside it', [stored.value, stored.holderName, stored.date], [4.84, 'Myagmardorj Ulziijargal', '2025-11-02']);
  eq('stored entry without a holder is exactly the old shape', { value: 484 / 100, ...holderFor(h, '333', 'single', 490) }, { value: 4.84 });
}

{
  // Holders-only backfill of what is already stored: no stored value may change.
  const nr = pickRecordHolders(RECORDS, DATES, EVENTS);
  const wr = pickRecordHolders({ '333': [row('single', 251, 'Xuanyi Geng (耿暄一)', 'Guangzhou2026'), row('average', 351, 'Yiheng Wang (王艺衡)', 'Guangzhou2026')] }, { Guangzhou2026: '2026-10-05' });
  const stored = {
    single: { WR: { value: 2.76 }, CR: { value: 2.77 }, NR: { value: 4.84 }, TR: { value: 5.83 } }, // WR stored is out of date (now 2.51)
    average: { WR: { value: 3.51 }, NR: { value: 6.63 } },
    fetchedAt: 'whatever',
  };
  const before = JSON.stringify(stored);
  const r = attachHoldersToStored('333', stored, { WR: wr, NR: nr });
  eq('backfill: a holder for every stored value that is still the current record',
    r.updates.map(u => [u.type, u.level, u.entry.holderName, u.entry.date]),
    [['single', 'NR', 'Myagmardorj Ulziijargal', '2025-11-02'], ['average', 'WR', 'Yiheng Wang', '2026-10-05'], ['average', 'NR', 'Temuulen Tserendagva', '2026-08-07']]);
  eq('backfill: every written entry carries the STORED value, unchanged', r.updates.map(u => u.entry.value), [4.84, 3.51, 6.63]);
  eq('backfill: a stored value the WCA has moved on from is reported and left alone', r.stale, [{ type: 'single', level: 'WR', stored: 276, current: 251 }]);
  check('backfill: TR (the club\'s own record) and levels with no holder list are never touched',
    !r.updates.some(u => (u.level as string) === 'TR' || u.level === 'CR') && !r.stale.some(s => s.level === 'CR'));
  eq('backfill: the stored document is not mutated', JSON.stringify(stored), before);
  eq('backfill: float storage (cs / 100) maps back to the exact centiseconds',
    attachHoldersToStored('222', { single: { NR: { value: 101 / 100 } }, average: { NR: { value: 184 / 100 } } }, { NR: nr }).updates.map(u => [u.entry.holderName, u.entry.value]),
    [['Mandakh Davaasuren', 1.01], ['Mandakh Davaasuren', 1.84]]);
  eq('backfill: an event with nothing stored / no holders → nothing to do',
    [attachHoldersToStored('333', {}, { NR: nr }), attachHoldersToStored('444', stored, { NR: nr })], [{ updates: [], stale: [] }, { updates: [], stale: [] }]);
}

console.log(failures === 0 ? '\nAll wca-record-holders checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
