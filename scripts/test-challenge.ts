// Unit checks for lib/challenge.ts (docs/challenge-plan.md, phase 3):
// target-time parsing, the generated title, the preview sentence and the
// template validator. No emulator. Run via:
//   npm run test:challenge

import {
  METRICS, STREAK_MAX, defaultTitle, formatTarget, isDefaultTitle, parseTargetTime,
  previewSentence, validateTemplate,
} from '../lib/challenge';

let failures = 0;
function check(label: string, pass: boolean, detail?: unknown) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ''}`);
  if (!pass) failures++;
}
const eq = (label: string, got: unknown, want: unknown) => check(label, got === want, got);

console.log('\n=== parseTargetTime ===');
eq('"2.00" → 2000', parseTargetTime('2.00'), 2000);
eq('"2" → 2000', parseTargetTime('2'), 2000);
eq('"2.5" → 2500 (one decimal = tenths)', parseTargetTime('2.5'), 2500);
eq('"1.99" → 1990', parseTargetTime('1.99'), 1990);
eq('"0.01" → 10', parseTargetTime('0.01'), 10);
eq('"1:05.30" → 65300', parseTargetTime('1:05.30'), 65300);
eq('"1:05" → 65000', parseTargetTime('1:05'), 65000);
eq('"65.3" → 65300 (seconds over 60 without minutes)', parseTargetTime('65.3'), 65300);
eq('"  15.00 " → 15000 (spaces trimmed)', parseTargetTime('  15.00 '), 15000);
eq('"2,50" → 2500 (comma decimal)', parseTargetTime('2,50'), 2500);
eq('"59:59.99" → max', parseTargetTime('59:59.99'), 3_599_990);
for (const bad of ['', '0', '0.00', '2.005', '1:65.00', '1:5.00', 'abc', '-2', '2.', '.5', '1:2:03', '60:00.00', '2.00s', '1e3']) {
  eq(`"${bad}" → refused`, parseTargetTime(bad), null);
}

console.log('\n=== formatTarget ===');
eq('2000 → "2.00"', formatTarget(2000), '2.00');
eq('65300 → "1:05.30"', formatTarget(65300), '1:05.30');
eq('10 → "0.01"', formatTarget(10), '0.01');
eq('600000 → "10:00.00"', formatTarget(600000), '10:00.00');
for (const s of ['2.00', '1:05.30', '0.01', '12.34', '9:59.99']) {
  eq(`round trip "${s}"`, formatTarget(parseTargetTime(s)!), s);
}

console.log('\n=== title and preview sentence ===');
const t1 = { event: '222', metric: 'ao5' as const, targetMs: 2000, streak: 5 };
eq('preview: 2x2 Ao5 < 2.00 × 5', previewSentence(t1), '2x2x2 дээр Ao5 < 2.00-ийг 5 удаа дараалан');
eq('title: 2x2 Ao5 < 2.00 × 5', defaultTitle(t1), '2x2 Ao5 < 2.00 × 5');
eq('preview: M = 1 has no "дараалан"', previewSentence({ event: '333', metric: 'ao12', targetMs: 15000, streak: 1 }), '3x3x3 дээр Ao12 < 15.00-ийг 1 удаа');
eq('preview: Single with minutes', previewSentence({ event: '444', metric: 'single', targetMs: 65300, streak: 10 }), '4x4x4 дээр Single < 1:05.30-ийг 10 удаа дараалан');
eq('preview: Pyraminx Mo3', previewSentence({ event: 'pyram', metric: 'mo3', targetMs: 5000, streak: 3 }), 'Pyraminx дээр Mo3 < 5.00-ийг 3 удаа дараалан');
eq('preview: Ao100', previewSentence({ event: '333', metric: 'ao100', targetMs: 12000, streak: 2 }), '3x3x3 дээр Ao100 < 12.00-ийг 2 удаа дараалан');

console.log('\n=== validateTemplate ===');
const base = { event: '222', metric: 'ao5', targetMs: 2000, streak: 5 };
const ok = validateTemplate(base);
check('valid template accepted, empty title → generated', ok.ok && ok.value.title === '2x2 Ao5 < 2.00 × 5' && ok.value.note === '', ok);
check('every one of the 7 metrics is accepted', METRICS.length === 7 && METRICS.every(m => validateTemplate({ ...base, metric: m }).ok));
const titled = validateTemplate({ ...base, title: '  Даваа   гараг ', note: ' Анхаар! ' });
check('custom title trimmed + collapsed, note trimmed', titled.ok && titled.value.title === 'Даваа гараг' && titled.value.note === 'Анхаар!', titled);
check('M = 1 accepted', validateTemplate({ ...base, streak: 1 }).ok);
check(`M = ${STREAK_MAX} accepted`, validateTemplate({ ...base, streak: 100 }).ok);
const err = (raw: Record<string, unknown>) => { const r = validateTemplate(raw); return 'error' in r ? r.error : 'ok'; };
eq('M = 0 → bad-streak', err({ ...base, streak: 0 }), 'bad-streak');
eq('M = 101 → bad-streak', err({ ...base, streak: 101 }), 'bad-streak');
eq('M = 2.5 → bad-streak', err({ ...base, streak: 2.5 }), 'bad-streak');
eq('M as string → bad-streak', err({ ...base, streak: '5' }), 'bad-streak');
eq('metric ao3 → bad-metric', err({ ...base, metric: 'ao3' }), 'bad-metric');
eq('metric missing → bad-metric', err({ ...base, metric: undefined }), 'bad-metric');
eq('unknown event → bad-event', err({ ...base, event: '888' }), 'bad-event');
eq('FMC not allowed → bad-event', err({ ...base, event: '333fm' }), 'bad-event');
eq('target 2005 (not centiseconds) → bad-target', err({ ...base, targetMs: 2005 }), 'bad-target');
eq('target 0 → bad-target', err({ ...base, targetMs: 0 }), 'bad-target');
eq('target negative → bad-target', err({ ...base, targetMs: -100 }), 'bad-target');
eq('target over 59:59.99 → bad-target', err({ ...base, targetMs: 3_600_000 }), 'bad-target');
eq('target as string → bad-target', err({ ...base, targetMs: '2.00' }), 'bad-target');
eq('title over 60 → bad-title', err({ ...base, title: 'x'.repeat(61) }), 'bad-title');
eq('note over 300 → bad-note', err({ ...base, note: 'x'.repeat(301) }), 'bad-note');
eq('title not a string → bad-title', err({ ...base, title: 5 }), 'bad-title');
check('isDefaultTitle: generated title', ok.ok && isDefaultTitle(ok.value));
check('isDefaultTitle: custom title', titled.ok && !isDefaultTitle(titled.value));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
