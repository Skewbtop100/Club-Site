// ── The shared read normalisers ─────────────────────────────────────────
// Pure unit tests for competition-shape.ts: normalizeStoredEvents,
// normalizeStoredSections, normalizeStoredSchedule, isRenderableBlock,
// renderableSections. No emulator, no Firestore.
//
// These are now PUBLIC-FACING. The admin GET routes and the public
// fetchers in data.ts call the same functions, so a mistake here is no
// longer an admin-only oddity — it is what every athlete sees.
//
// The load-bearing group is FIELD COVERAGE. The old public reader rebuilt
// each event field by field and had never learned `advancement` or
// `surchargeMnt`, so the detail page read every event as included in the
// base fee. That is exactly the kind of drop the Required<> literal in
// normalizeStoredEvents now makes a compile error; the assertions here
// catch it at runtime too.
//
// The last group checks the WIRING, by reading source: that the admin
// routes and data.ts import these functions from this module, and that no
// second event reader has grown back anywhere. Two readers drifting apart
// is how the bug happened; this is what notices a third.
//
// Run: npm run test:shape

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-shape-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/competition-shape.ts',
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

const {
  normalizeStoredEvents,
  normalizeStoredSections,
  normalizeStoredSchedule,
  isRenderableBlock,
  renderableSections,
  BLOCK_PAYLOAD_FIELDS,
  SCHEDULE_PAYLOAD_FIELDS,
} = require(path.join(OUT, 'competition-shape.js'));

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
const j = (v) => JSON.stringify(v);

console.log('\n  -- events: EVERY field is carried (the public-reader bug) --');
const FULL = {
  eventId: '333',
  label: '3x3x3',
  rounds: 3,
  resultFormat: 'mo3',
  timeLimitCs: 60000,
  cutoffs: [{ round: 1, cutoffCs: 3000 }],
  advancement: [{ fromRound: 1, method: 'percent', value: 50 }, { fromRound: 2, method: 'count', value: 8 }],
  surchargeMnt: 5000,
};
{
  const [e] = normalizeStoredEvents([FULL]);
  eq('eventId', e.eventId, '333');
  eq('label', e.label, '3x3x3');
  eq('rounds', e.rounds, 3);
  eq('resultFormat', e.resultFormat, 'mo3');
  eq('timeLimitCs', e.timeLimitCs, 60000);
  eq('cutoffs', j(e.cutoffs), j([{ round: 1, cutoffCs: 3000 }]));
  // The two the old public reader silently dropped.
  eq('ADVANCEMENT survives (the public reader dropped it)', j(e.advancement), j(FULL.advancement));
  eq('SURCHARGE survives (the public reader dropped it)', e.surchargeMnt, 5000);
  eq('exactly the eight fields, no more', Object.keys(e).sort().join(','),
    'advancement,cutoffs,eventId,label,resultFormat,rounds,surchargeMnt,timeLimitCs');
}

console.log('\n  -- events: legacy and absent shapes default cleanly --');
{
  const [e] = normalizeStoredEvents([{ eventId: '222', label: '2x2x2', rounds: 1 }]);
  eq('absent resultFormat reads ao5', e.resultFormat, 'ao5');
  eq('absent timeLimitCs reads null (no limit)', e.timeLimitCs, null);
  eq('absent cutoffs reads []', j(e.cutoffs), '[]');
  eq('absent advancement reads []', j(e.advancement), '[]');
  eq('absent surchargeMnt reads null (included)', e.surchargeMnt, null);
}
{
  // events: ["333", "222"] — the pre-object shape the original seed has.
  const out = normalizeStoredEvents(['333', '222']);
  eq('legacy string[] is converted, not dropped', out.length, 2);
  eq('  ...with the string as the eventId', out[0].eventId, '333');
  eq('  ...and the CATALOGUE label, not the bare id', out[0].label, '3x3x3');
  eq('  ...one round', out[0].rounds, 1);
  eq('  ...and every other field defaulted', j([out[0].timeLimitCs, out[0].surchargeMnt, out[0].advancement]), j([null, null, []]));
}
eq('a missing label falls back to the catalogue name',
  normalizeStoredEvents([{ eventId: '444', rounds: 1 }])[0].label, '4x4x4');
// onlineCompEventLabel's own fallback: the uppercased id, which is also
// what the old public reader produced — so this is unchanged behaviour.
eq('an unknown event id with no label falls back to the uppercased id',
  normalizeStoredEvents([{ eventId: 'xyz', rounds: 1 }])[0].label, 'XYZ');
eq('rounds 0 floors to 1', normalizeStoredEvents([{ eventId: '333', rounds: 0 }])[0].rounds, 1);
eq('negative rounds floors to 1', normalizeStoredEvents([{ eventId: '333', rounds: -2 }])[0].rounds, 1);
eq('fractional rounds floors to 1', normalizeStoredEvents([{ eventId: '333', rounds: 2.5 }])[0].rounds, 1);

console.log('\n  -- events: junk is dropped or coerced, never thrown on --');
{
  const out = normalizeStoredEvents([
    { eventId: '333', rounds: 1 },
    { label: 'no id', rounds: 1 },
    { eventId: '   ', rounds: 1 },
    null,
    42,
    [],
    '',
  ]);
  eq('only the event with an id survives', out.map((e) => e.eventId).join(','), '333');
}
eq('a non-array reads as []', normalizeStoredEvents('nope').length, 0);
eq('undefined reads as [] (a legacy doc)', normalizeStoredEvents(undefined).length, 0);
eq('a zero surcharge reads as included', normalizeStoredEvents([{ eventId: '333', surchargeMnt: 0 }])[0].surchargeMnt, null);
eq('a fractional surcharge reads as included', normalizeStoredEvents([{ eventId: '333', surchargeMnt: 2.5 }])[0].surchargeMnt, null);
eq('a zero time limit reads as no limit', normalizeStoredEvents([{ eventId: '333', timeLimitCs: 0 }])[0].timeLimitCs, null);
{
  const [e] = normalizeStoredEvents([{
    eventId: '333',
    rounds: 3,
    cutoffs: [{ round: 2, cutoffCs: 4000 }, { round: 'x', cutoffCs: 1 }, { round: 1, cutoffCs: -5 }, { round: 1, cutoffCs: 3000 }, null],
    advancement: [
      { fromRound: 2, method: 'count', value: 8 },
      { fromRound: 1, method: 'top', value: 5 },
      { fromRound: 1, method: 'percent', value: NaN },
      { fromRound: 1, method: 'percent', value: 50 },
    ],
  }]);
  // A reader must never meet a NaN, an unknown method or a negative time.
  eq('unreadable cutoffs are dropped, the rest sorted by round', j(e.cutoffs),
    j([{ round: 1, cutoffCs: 3000 }, { round: 2, cutoffCs: 4000 }]));
  eq('unreadable advancement is dropped, the rest sorted by fromRound', j(e.advancement),
    j([{ fromRound: 1, method: 'percent', value: 50 }, { fromRound: 2, method: 'count', value: 8 }]));
}

console.log('\n  -- sections --');
{
  const out = normalizeStoredSections([
    { id: 'a', title: 'Шагнал', blocks: [{ id: 'b1', type: 'text', text: 'x' }, { id: 'b2', type: 'image', imageUrl: 'https://x/i.jpg', imagePublicId: 'p' }] },
    { title: 'ID-гүй', blocks: [{ type: 'text' }] },
    { id: 'c', title: '   ', blocks: [] },
    { id: 'd', title: 'Шинэ', blocks: [{ id: 'v', type: 'video', videoUrl: 'not a video' }, { id: 'u', type: 'audio' }, { id: 'i', type: 'image' }] },
    'junk',
  ]);
  eq('titled sections survive, untitled and junk are dropped', out.map((s) => s.id).join(','), 'a,s2,d');
  eq('block order is preserved', out[0].blocks.map((b) => b.id).join(','), 'b1,b2');
  eq('an image block keeps both payload fields', j(out[0].blocks[1]), j({ id: 'b2', type: 'image', imageUrl: 'https://x/i.jpg', imagePublicId: 'p' }));
  eq('a missing section id gets a DETERMINISTIC positional id', out[1].id, 's2');
  eq('a missing block id gets one too', out[1].blocks[0].id, 's2-b1');
  eq('a text block with no text reads as ""', out[1].blocks[0].text, '');
  // An unparseable video is KEPT by the normaliser — the admin must see it
  // to fix it. Whether it renders publicly is renderableSections' call.
  eq('an unparseable video is KEPT for the admin', out[2].blocks.map((b) => b.id).join(','), 'v');
  eq('an unknown block type is dropped', out[2].blocks.some((b) => b.id === 'u'), false);
  eq('an image block with no image is dropped', out[2].blocks.some((b) => b.id === 'i'), false);
}
eq('two reads give identical ids (no random fallback)',
  j(normalizeStoredSections([{ title: 'A', blocks: [{ type: 'text', text: 'x' }] }])),
  j(normalizeStoredSections([{ title: 'A', blocks: [{ type: 'text', text: 'x' }] }])));

console.log('\n  -- renderable: what the PUBLIC page shows --');
const text = (t) => ({ id: 't', type: 'text', text: t });
eq('text with content renders', isRenderableBlock(text('Сайн байна уу')), true);
eq('EMPTY text does not', isRenderableBlock(text('')), false);
eq('whitespace-only text does not', isRenderableBlock(text('  \n ')), false);
eq('an image with a url renders', isRenderableBlock({ id: 'i', type: 'image', imageUrl: 'https://x/i.jpg' }), true);
eq('a parseable YouTube url renders', isRenderableBlock({ id: 'v', type: 'video', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }), true);
eq('an UNPARSEABLE video does not', isRenderableBlock({ id: 'v', type: 'video', videoUrl: 'https://example.com/v.mp4' }), false);
{
  const out = renderableSections([
    { id: 'full', title: 'Дүрэм', blocks: [text(''), text('Дүрэм 1'), { id: 'v', type: 'video', videoUrl: 'nope' }] },
    { id: 'empty', title: 'Хоосон', blocks: [] },
    { id: 'hollow', title: 'Хөндий', blocks: [text(''), { id: 'v', type: 'video', videoUrl: 'nope' }] },
    { id: 'untitled', title: '  ', blocks: [text('x')] },
  ]);
  eq('a section with renderable blocks is kept', out.map((s) => s.id).join(','), 'full');
  eq('  ...holding ONLY its renderable blocks', out[0].blocks.length, 1);
  eq('an empty section gets no tab', out.some((s) => s.id === 'empty'), false);
  eq('a section of only blank/broken blocks gets no tab', out.some((s) => s.id === 'hollow'), false);
  eq('an untitled section gets no tab', out.some((s) => s.id === 'untitled'), false);
}

console.log('\n  -- schedule --');
{
  const out = normalizeStoredSchedule([
    { id: 'a', startMin: 600, durationMin: 30, kind: 'other', label: 'Бүртгэл', note: '' },
    { id: 'b', startMin: 630, durationMin: 60, kind: 'round', eventId: '333', round: 1, note: 'Шүүгч: Б' },
    { startMin: 690, durationMin: 30, kind: 'other', label: 'ID-гүй' },
    { id: 'c', durationMin: 30, kind: 'other', label: 'no start' },
    { id: 'd', startMin: 0, durationMin: 0, kind: 'other', label: 'zero' },
    { id: 'e', startMin: 0, durationMin: 30, kind: 'round', round: 1 },
    { id: 'f', startMin: 0, durationMin: 30, kind: 'other' },
    { id: 'g', startMin: 0, durationMin: 30, kind: 'lunch', label: 'x' },
  ]);
  eq('valid rows survive in array order', out.map((r) => r.id).join(','), 'a,b,sch3,c');
  eq('a round row keeps eventId, round and note', j([out[1].eventId, out[1].round, out[1].note]), j(['333', 1, 'Шүүгч: Б']));
  eq('a missing startMin reads as 0 rather than dropping the row', out[3].startMin, 0);
  eq('a zero-length row is dropped', out.some((r) => r.id === 'd'), false);
  eq('a round with no event is dropped', out.some((r) => r.id === 'e'), false);
  eq('an other with no label is dropped', out.some((r) => r.id === 'f'), false);
  eq('an unknown kind is dropped', out.some((r) => r.id === 'g'), false);
}
eq('a non-array schedule reads as []', normalizeStoredSchedule({}).length, 0);

console.log('\n  -- the manifests the write path imports --');
eq('block manifest covers the three types', Object.keys(BLOCK_PAYLOAD_FIELDS).sort().join(','), 'image,text,video');
eq('schedule manifest covers the two kinds', Object.keys(SCHEDULE_PAYLOAD_FIELDS).sort().join(','), 'other,round');

console.log('\n  -- WIRING: one reader, used by admin AND public --');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const importsShared = (rel) => /from\s+['"](?:@\/lib\/online-competition|\.)\/competition-shape['"]/.test(src(rel));
for (const rel of [
  'lib/online-competition/data.ts',
  'app/api/online-competition/admin-competitions/route.ts',
  'app/api/online-competition/admin-competitions/[id]/route.ts',
  'lib/online-competition/admin-competitions.ts',
]) {
  ok(`${rel} imports from competition-shape`, importsShared(rel));
}
ok('data.ts calls the shared event reader', /normalizeStoredEvents\(/.test(src('lib/online-competition/data.ts')));
ok('data.ts no longer defines its own event reader', !/function\s+normalizeEvents\b/.test(src('lib/online-competition/data.ts')));
ok('admin-competitions.ts no longer defines the readers',
  !/function\s+normalizeStored(Events|Sections|Schedule)\b/.test(src('lib/online-competition/admin-competitions.ts')));
{
  // No SECOND event reader has grown anywhere under lib/ or app/ — any
  // function whose name says it normalises events, other than the one.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(rel);
      } else if (/\.(ts|tsx)$/.test(entry.name) && rel !== path.join('lib', 'online-competition', 'competition-shape.ts')) {
        if (/function\s+normalize\w*Events\b/.test(src(rel))) offenders.push(rel);
      }
    }
  };
  walk('lib');
  walk('app');
  ok('no other event normaliser exists anywhere', offenders.length === 0, offenders.join(', '));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
