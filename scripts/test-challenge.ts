// Unit checks for lib/challenge.ts and lib/challenge-progress.ts
// (docs/challenge-plan.md, phases 3–4): target-time parsing, title and
// preview sentence, the template validator, block / streak scoring, UB
// dates, the end-time rule and the sanity checks. No emulator. Run via:
//   npm run test:challenge

import {
  METRICS, STREAK_MAX, defaultTitle, formatTarget, isDefaultTitle, parseTargetTime,
  previewSentence, sanityCheck, validateTemplate,
} from '../lib/challenge';
import {
  computeProgress, daysTaken, passesTarget, ubDate, ubTimeToday, validateEndsAt, type ScoredSolve,
} from '../lib/challenge-progress';

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

console.log('\n=== computeProgress: blocks, truncation, streak ===');
const ok_ = (ms: number): ScoredSolve => ({ ms, penalty: 'none' });
const p2 = (ms: number): ScoredSolve => ({ ms, penalty: '+2' });
const dnf = (ms = 1000): ScoredSolve => ({ ms, penalty: 'dnf' });
type M = 'single' | 'mo3' | 'ao5' | 'ao12' | 'ao25' | 'ao50' | 'ao100';
const T = (metric: M, targetMs: number, streak: number) => ({ metric, targetMs, streak });

check('truncation: 1999 ms passes "< 2.00"', passesTarget(1999, 2000));
check('exact target: 2000 ms fails "< 2.00"', !passesTarget(2000, 2000));
check('truncated equal: 2009 ms (shows 2.00) fails', !passesTarget(2009, 2000));
check('DNF never passes', !passesTarget(null, 2000));

let pr = computeProgress(T('single', 2000, 3), [ok_(1990), ok_(1500), ok_(2009), ok_(1000)]);
check('Single: every solve is a block; 2.009 fails and resets', pr.blocksAttempted === 4 &&
  pr.blocks.map(b => b.pass).join() === 'true,true,false,true' && pr.currentStreak === 1 && pr.bestStreak === 2 &&
  !pr.completed && pr.inBlock === 0, pr);
pr = computeProgress(T('single', 2000, 3), [ok_(1990), ok_(1500), ok_(1000)]);
check('Single: completion exactly at M', pr.completed && pr.currentStreak === 3, pr);
pr = computeProgress(T('single', 2000, 2), [ok_(1000), dnf(500), ok_(1000)]);
check('Single: a DNF fails the block', pr.blocks[1].pass === false && pr.blocks[1].resultMs === null && pr.currentStreak === 1, pr);
pr = computeProgress(T('single', 3000, 1), [p2(900)]);
check('Single: +2 counts (0.90 + 2 = 2.90 < 3.00)', pr.completed && pr.blocks[0].resultMs === 2900, pr);

pr = computeProgress(T('mo3', 3000, 2), [ok_(1000), p2(1000), ok_(1000)]);
check('Mo3: mean with a +2 = 1.66 → pass', pr.blocks[0].pass && pr.blocks[0].displayCs === 166 && pr.currentStreak === 1, pr);
pr = computeProgress(T('mo3', 3000, 2), [ok_(1000), ok_(1000), dnf()]);
check('Mo3: any DNF → DNF block, fails', pr.blocks[0].resultMs === null && !pr.blocks[0].pass && pr.currentStreak === 0, pr);

pr = computeProgress(T('ao5', 2000, 2), [ok_(1900), ok_(1800), ok_(1950), ok_(5000), ok_(1700)]);
check('Ao5: best and worst trimmed (1.88 passes)', pr.blocks[0].resultMs === 1883 && pr.blocks[0].pass, pr);
pr = computeProgress(T('ao5', 2000, 2), [ok_(1900), ok_(1800), dnf(), ok_(1950), ok_(1700)]);
check('Ao5: one DNF is trimmed away', pr.blocks[0].resultMs === 1883 && pr.blocks[0].pass, pr);
pr = computeProgress(T('ao5', 2000, 2), [ok_(1900), dnf(), dnf(), ok_(1950), ok_(1700)]);
check('Ao5: two DNFs → DNF', pr.blocks[0].resultMs === null && !pr.blocks[0].pass, pr);
pr = computeProgress(T('ao5', 2000, 2), [...Array(5)].map(() => ok_(2000)));
check('Ao5: exactly the target fails', !pr.blocks[0].pass && pr.blocks[0].displayCs === 200, pr);

const twelve = [1500, 1600, 1700, 1800, 1900, 1950, 1980, 1990, 1600, 1700, 1800, 1900].map(ok_);
pr = computeProgress(T('ao12', 2000, 1), [...twelve.slice(0, 11), dnf()]);
check('Ao12: one DNF trimmed → pass', pr.blocks.length === 1 && pr.blocks[0].pass && pr.completed, pr);
pr = computeProgress(T('ao12', 2000, 1), [...twelve.slice(0, 10), dnf(), dnf()]);
check('Ao12: two DNFs → DNF', pr.blocks[0].resultMs === null && !pr.completed, pr);

const hundred = [...Array(100)].map((_, i) => ok_(1000 + i * 10));
pr = computeProgress(T('ao100', 2000, 1), hundred);
check('Ao100: 5 trimmed each end (mean of 1.05 … 1.94)', pr.blocks[0].resultMs === 1495 && pr.completed, pr);
pr = computeProgress(T('ao100', 2000, 1), [...hundred.slice(0, 95), ...[...Array(5)].map(() => dnf())]);
check('Ao100: 5 DNFs still trimmed away', pr.blocks[0].resultMs !== null, pr);
pr = computeProgress(T('ao100', 2000, 1), [...hundred.slice(0, 94), ...[...Array(6)].map(() => dnf())]);
check('Ao100: 6 DNFs → DNF', pr.blocks[0].resultMs === null, pr);

pr = computeProgress(T('ao5', 2000, 3), [...Array(8)].map(() => ok_(1500)));
check('unfinished block not scored: 8 solves = 1 block + 3 in the next', pr.blocksAttempted === 1 && pr.inBlock === 3 && pr.currentStreak === 1, pr);
const runs = [ok_(1000), ok_(1000), ok_(3000), ok_(1000), ok_(1000), ok_(1000), ok_(3000), ok_(1000)];
pr = computeProgress(T('single', 2000, 5), runs);
check('several streak runs: best 3, current 1', pr.bestStreak === 3 && pr.currentStreak === 1 && pr.blocksAttempted === 8, pr);
pr = computeProgress(T('single', 2000, 2), [ok_(1000), ok_(1000), ok_(1000)]);
check('nothing is scored after completion', pr.completed && pr.blocksAttempted === 2, pr);
pr = computeProgress(T('single', 2000, 100), [...Array(100)].map(() => ok_(1000)));
check('M = 100 completes at the 100th block', pr.completed && pr.currentStreak === 100, pr);
pr = computeProgress(T('ao5', 2000, 1), []);
check('no solves → empty progress', pr.blocksAttempted === 0 && pr.inBlock === 0 && pr.blockSize === 5, pr);

console.log('\n=== UB dates, days taken, end time ===');
// 2026-10-16 16:00 UTC is 00:00 on 2026-10-17 in Ulaanbaatar (UTC+8).
const ubMidnight = Date.UTC(2026, 9, 16, 16, 0);
eq('ubDate just before UB midnight', ubDate(ubMidnight - 1), '2026-10-16');
eq('ubDate at UB midnight', ubDate(ubMidnight), '2026-10-17');
eq('daysTaken same day = 1', daysTaken('2026-10-16', '2026-10-16'), 1);
eq('daysTaken Mon → Wed = 3', daysTaken('2026-10-12', '2026-10-14'), 3);
eq('daysTaken across a month end', daysTaken('2026-10-31', '2026-11-01'), 2);
const noon = Date.UTC(2026, 9, 16, 4, 0); // 12:00 UB
const endErr = (r: ReturnType<typeof validateEndsAt>) => ('error' in r ? r.error : 'ok');
const defEnd = validateEndsAt(noon, undefined);
check('end time omitted → 23:59 today', 'endsAtMs' in defEnd && defEnd.endsAtMs === ubTimeToday(noon, 23, 59), defEnd);
eq('18:00 today is fine', endErr(validateEndsAt(noon, ubTimeToday(noon, 18, 0))), 'ok');
eq('23:59 today is the latest allowed', endErr(validateEndsAt(noon, ubTimeToday(noon, 23, 59))), 'ok');
eq('after 23:59 → end-too-late', endErr(validateEndsAt(noon, ubTimeToday(noon, 23, 59) + 30_000)), 'end-too-late');
eq('tomorrow → end-other-day', endErr(validateEndsAt(noon, ubTimeToday(noon, 24, 30))), 'end-other-day');
eq('in the past → end-too-soon', endErr(validateEndsAt(noon, noon - 60_000)), 'end-too-soon');
eq('9 minutes ahead → end-too-soon', endErr(validateEndsAt(noon, noon + 9 * 60_000)), 'end-too-soon');
eq('10 minutes ahead is fine', endErr(validateEndsAt(noon, noon + 10 * 60_000)), 'ok');
eq('not a number → bad-end-time', endErr(validateEndsAt(noon, '18:00')), 'bad-end-time');
eq('at 23:55 the default 23:59 is too soon', endErr(validateEndsAt(ubTimeToday(noon, 23, 55), undefined)), 'end-too-soon');

console.log('\n=== sanity checks ===');
eq('3x3 2.40 → too-fast', sanityCheck('333', { ms: 2400, stoppedAt: 100_000 }, null, 0, 60_000), 'too-fast');
eq('3x3 2.60 → ok', sanityCheck('333', { ms: 2600, stoppedAt: 100_000 }, null, 0, 60_000), null);
eq('2x2 0.39 → too-fast', sanityCheck('222', { ms: 390, stoppedAt: 100_000 }, null, 0, 60_000), 'too-fast');
eq('stopped 5 s after the previous stop but lasted 8 s → too-close',
  sanityCheck('333', { ms: 8000, stoppedAt: 105_000 }, { stoppedAt: 100_000 }, 0, 60_000), 'too-close');
eq('gap just inside the tolerance → ok',
  sanityCheck('333', { ms: 8000, stoppedAt: 107_800 }, { stoppedAt: 100_000 }, 0, 60_000), null);
eq('more solve time than has passed since the start → too-close',
  sanityCheck('333', { ms: 9000, stoppedAt: 200_000 }, { stoppedAt: 100_000 }, 50_000, 50_000), 'too-close');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
