// Playwright end-to-end test of challenge MODE on the timer and the coach
// live view (docs/challenge-plan.md, phases 4a–4b) against the LOCAL
// Firestore / Auth / Realtime Database emulators — never production. Run via
// `npm run test:e2e:challenge-mode` (wraps `firebase emulators:exec`).
//
// Coach and student in two browser contexts; the coach's room page stays
// open the whole time and must follow along LIVE (no refresh button):
//   coach starts with an end time → the student's open timer switches live
//   (event locked, Challenge session, inspection off, edit / delete blocked,
//   no points) → every solve needs OK / +2 / DNF and the next can't start
//   before → the live view shows block progress, streak, last result, solve
//   count → a failing Mo3 block resets ("дахин эхэллээ") → a too-fast solve
//   is refused ("Цаг хэт хурдан байна") and flagged for the coach → a
//   passing block counts → the student ends early ("Өнөөдрийг дуусгах"),
//   the partial block is dropped → the coach starts again while the student
//   is away; opening the timer enters the challenge at 0 → a passing run
//   completes it: celebration screen for the student, "Биелсэн" live for
//   the coach.
//
// Clock: the app runs on the test-only clock (lib/clock.ts in the browser,
// lib/server/clock.ts on the server — emulator mode only), pinned to
// PV_TEST_UB_TIME (default 12:00 UB, today's UB date). The real time of day
// doesn't matter. With --ub-time=23:50 (`npm run
// test:e2e:challenge-mode:late`) the late-night scenario runs instead: no
// valid end time is left (N2) so starting is refused, while a session that
// ends at 23:55 still runs and expired sessions are closed (timer + cron).
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const PORT = 3991;
// localhost, not 127.0.0.1: next dev blocks its dev resources for other origins.
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'pv-e2e-challenge-mode');
fs.mkdirSync(OUT, { recursive: true });
nextEnv.loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST']) {
  if (!process.env[v]) { console.error(`Refusing to run: ${v} is not set (use npm run test:e2e:challenge-mode).`); process.exit(1); }
}
const UB = 8 * 3600_000, DAY = 86_400_000;
const ubDayStart = (ms) => Math.floor((ms + UB) / DAY) * DAY - UB;
const ubDate = (ms) => new Date(ms + UB).toISOString().slice(0, 10);
// `--ub-time=HH:MM` (or PV_TEST_UB_TIME) picks the pinned UB time.
const argTime = process.argv.find(x => x.startsWith('--ub-time='))?.slice('--ub-time='.length);
const [TH, TM] = (argTime || process.env.PV_TEST_UB_TIME || '12:00').split(':').map(Number);
const REAL_START = Date.now();
const TODAY = ubDayStart(REAL_START);
/** Shared by the dev server and every browser context. */
const OFFSET = TODAY + (TH * 60 + TM) * 60_000 - REAL_START;
const now = () => Date.now() + OFFSET;
const ubAt = (hh, mm) => TODAY + (hh * 60 + mm) * 60_000;
const LATE = TH * 60 + TM >= 23 * 60 + 50;
const CRON_SECRET = 'e2e-cron-secret-0123456789';
console.log(`test clock: ${String(TH).padStart(2, '0')}:${String(TM).padStart(2, '0')} UB ${ubDate(now())}${LATE ? ' (late-night run)' : ''}`);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  ...process.env,
  NODE_ENV: 'development',
  NEXT_PUBLIC_FIREBASE_EMULATORS: '1',
  FIREBASE_ADMIN_CLIENT_EMAIL: `e2e@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  PV_TEST_CLOCK_OFFSET_MS: String(OFFSET),
  CRON_SECRET,
};

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

// next dev rewrites these two files; put them back so the tree stays clean.
const RESTORE = ['tsconfig.json', 'next-env.d.ts'].map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
const restoreConfigs = () => { for (const [f, text] of RESTORE) fs.writeFileSync(path.join(ROOT, f), text); };

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}
async function signUp(email, displayName, role = 'member') {
  const res = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName, returnSecureToken: true }),
  });
  const u = await res.json();
  await db.doc(`users/${u.localId}`).set({ uid: u.localId, email, displayName, role, points: 0, totalSolves: 0, photoURL: null, createdAt: admin.firestore.Timestamp.now() });
  return { uid: u.localId, email, displayName, idToken: u.idToken };
}
async function api(route, body, token) {
  const res = await fetch(`${BASE}/api/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return res.json();
}
const until = async (fn, ms = 15_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise(r => setTimeout(r, 250));
  }
};

let serverLog = '';
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(PORT)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
async function waitForServer() {
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(`${BASE}/timer/challenge`); if (r.status === 200) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('dev server did not start:\n' + serverLog.slice(-3000));
}

async function newUser(browser, account, url, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  // The browser side of the test clock (lib/clock.ts, emulator mode only).
  await ctx.addInitScript((off) => { window.__pvTestClockOffset = off; }, OFFSET);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/timer/challenge`);
  await page.waitForFunction(() => !!window.__pvTestAuth, null, { timeout: 120_000 });
  await page.evaluate(([e, p]) => window.__pvTestAuth.signIn(e, p), [account.email, 'password123']);
  await page.getByRole('heading', { name: 'Өрөөнд нэгдэх' }).waitFor();
  if (url) await page.goto(`${BASE}${url}`);
  return { ctx, page };
}

/** One keyboard solve of about `ms` on the timer (hold-to-start: 550 ms). */
async function keySolve(page, ms) {
  await page.keyboard.down('Space');
  await page.waitForTimeout(650);
  await page.keyboard.up('Space');
  await page.waitForTimeout(ms);
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
}

const cronRun = async (authorization) => {
  const res = await fetch(`${BASE}/api/challenge/close-stale`, { headers: authorization ? { authorization } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const textOf = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  if (LATE) { await lateNight(browser); throw 'done'; }

  const coachA = await signUp('e2e-cm-coach@example.com', 'Багш Дорж');
  // The student is a club admin: today only an admin's solve-point award
  // succeeds (pointTransactions is admin-write in firestore.rules), and the
  // "no points from challenge solves" check needs a baseline that does earn.
  const studentA = await signUp('e2e-cm-student@example.com', 'Сурагч Анар', 'admin');
  await db.doc(`coaches/${coachA.uid}`).set({ uid: coachA.uid, displayName: coachA.displayName, active: true });
  await db.doc('rooms/roomCM').set({ name: 'Challenge бүлэг', coachUid: coachA.uid, coachName: coachA.displayName, code: 'CMR234', archived: false, createdAt: admin.firestore.Timestamp.now() });
  await db.doc(`rooms/roomCM/members/${studentA.uid}`).set({
    uid: studentA.uid, roomId: 'roomCM', roomName: 'Challenge бүлэг', coachName: coachA.displayName,
    displayName: studentA.displayName, photoURL: null, status: 'active',
    requestedAt: admin.firestore.Timestamp.now(), decidedAt: admin.firestore.Timestamp.now(),
  });

  // Coach's challenge + assignment through the real routes: "2x2 Mo3 < 3.00 × 2".
  await waitForServer();
  const created = await api('challenge/create', { roomId: 'roomCM', event: '222', metric: 'mo3', targetMs: 3000, streak: 2 }, coachA.idToken);
  const CH = created.challengeId;
  await api('challenge/assign', { challengeId: CH, uids: [studentA.uid] }, coachA.idToken);
  const AID = `${CH}_${studentA.uid}`;
  check('challenge + assignment created', !!CH && (await db.doc(`challengeAssignments/${AID}`).get()).exists, created);

  console.log('\n=== student on the normal timer first ===');
  const S = await newUser(browser, studentA, '/timer');
  const pickEvent = S.page.getByRole('button', { name: 'Pick event' });
  await pickEvent.waitFor();
  check('normal timer on 3x3 (default)', (await pickEvent.innerText()).includes('3x3x3'));
  // One normal solve with inspection (the default): Space → inspecting.
  await S.page.keyboard.down('Space'); await S.page.keyboard.up('Space');
  await S.page.getByText('Inspection', { exact: true }).waitFor();
  check('normal mode: inspection is on', true);
  await keySolve(S.page, 800);
  await S.page.getByText('Эвлүүлэлт (1)').waitFor();
  const before = (await until(async () => {
    const u = (await db.doc(`users/${studentA.uid}`).get()).data();
    return u.totalSolves >= 1 ? u : null;
  })) ?? (await db.doc(`users/${studentA.uid}`).get()).data();
  check('normal solve: 1 solve, club point awarded', before.totalSolves === 1, before);

  console.log('\n=== coach starts with an end time ===');
  const C = await newUser(browser, coachA, '/timer/challenge/rooms/roomCM');
  const row = C.page.getByTestId(`assignment-${studentA.uid}`);
  await row.waitFor();
  await row.getByRole('button', { name: /эхлүүлэх/ }).click();
  const panel = row.getByTestId('start-panel');
  check('end-time picker defaults to 23:59', await panel.getByLabel('Дуусах цаг').inputValue() === '23:59');
  await panel.getByLabel('Дуусах цаг').fill('00:05');
  check('a time already past today is refused in the picker', await panel.getByText('10 минутын дараа', { exact: false }).isVisible() &&
    await panel.getByRole('button', { name: 'Эхлүүлэх' }).isDisabled());
  await panel.getByLabel('Дуусах цаг').fill('23:59');
  await panel.getByRole('button', { name: 'Эхлүүлэх' }).click();
  await row.getByRole('button', { name: /зогсоох/ }).waitFor();
  check('coach: "Идэвхтэй · 23:59 хүртэл" and "Зогсоох"', await row.getByText('Идэвхтэй').isVisible() && await row.getByText('23:59 хүртэл').isVisible());
  check('no "Шинэчлэх" button on the coach page any more', await C.page.getByRole('button', { name: 'Шинэчлэх' }).count() === 0);
  const live = C.page.getByTestId(`live-${studentA.uid}`);
  await live.waitFor();
  check('live view: event + metric, block 0/3, streak 0/2, 0 solves, ends 23:59', (await textOf(live)).includes('2x2 · Mo3') &&
    (await textOf(live.getByTestId('live-block'))) === '0/3' && (await textOf(live.getByTestId('live-streak'))).includes('0/2') &&
    (await textOf(live.getByTestId('live-count'))) === '0 эвлүүлэлт' && (await textOf(live)).includes('23:59 хүртэл'), await textOf(live));
  await C.page.screenshot({ path: path.join(OUT, 'coach-started.png'), fullPage: true });

  console.log('\n=== student timer switches live ===');
  const strip = S.page.getByTestId('challenge-strip');
  await strip.waitFor();
  check('strip above the digits: title, end time, block and streak', await strip.getByText('2x2 Mo3 < 3.00 × 2').isVisible() &&
    await strip.getByText('23:59 хүртэл', { exact: false }).isVisible() &&
    (await S.page.getByTestId('challenge-block').innerText()) === 'Mo3 · 0/3 эвлүүлэлт' &&
    (await S.page.getByTestId('challenge-streak').innerText()).includes('0/2'));
  await until(async () => (await pickEvent.innerText()).includes('2x2x2'));
  check('event locked to 2x2', (await pickEvent.innerText()).includes('2x2x2'));
  check('separate "Challenge" session, empty', await S.page.getByText('Эвлүүлэлт (0)').isVisible() &&
    await S.page.locator('.pv-sidebar').getByText('Challenge', { exact: true }).isVisible());
  await pickEvent.click();
  await S.page.getByText('Challenge-ийн үед боломжгүй').first().waitFor();
  check('event picker refuses to change the event', (await pickEvent.innerText()).includes('2x2x2'));
  await S.page.screenshot({ path: path.join(OUT, 'student-challenge-mode.png') });

  console.log('\n=== solves: confirm gate, inspection off, fade ===');
  await S.page.keyboard.down('Space');
  await S.page.waitForTimeout(250);
  check('inspection off: Space arms straight away (no "Inspection")', await S.page.getByText('Inspection', { exact: true }).count() === 0);
  await S.page.waitForTimeout(400);
  await S.page.keyboard.up('Space');
  await S.page.waitForTimeout(500);
  const stripOpacity = await strip.evaluate(el => getComputedStyle(el).opacity);
  check('the strip fades out while timing', stripOpacity === '0', stripOpacity);
  await S.page.waitForTimeout(600);
  await S.page.keyboard.down('Space'); await S.page.keyboard.up('Space');
  const confirmRow = S.page.getByTestId('challenge-confirm');
  await confirmRow.waitFor();
  await until(async () => (await strip.evaluate(el => getComputedStyle(el).opacity)) === '1', 3000);
  check('the strip returns when the timer stops', (await strip.evaluate(el => getComputedStyle(el).opacity)) === '1');
  check('OK / +2 / DNF shown; nothing saved yet', await S.page.getByTestId('challenge-confirm-ok').isVisible() &&
    await S.page.getByText('Эвлүүлэлт (0)').isVisible());
  const shown = await S.page.locator('.pv-timer-digits').innerText();
  await S.page.keyboard.down('Space'); await S.page.waitForTimeout(700); await S.page.keyboard.up('Space');
  await S.page.waitForTimeout(400);
  check('the next solve cannot start before confirming', await confirmRow.isVisible() &&
    (await S.page.locator('.pv-timer-digits').innerText()) === shown, shown);
  await S.page.getByTestId('challenge-confirm-ok').click();
  await S.page.getByText('Эвлүүлэлт (1)').waitFor();
  check('confirmed: saved, block 1/3', (await S.page.getByTestId('challenge-block').innerText()) === 'Mo3 · 1/3 эвлүүлэлт');
  await until(async () => (await textOf(live.getByTestId('live-count'))) === '1 эвлүүлэлт');
  check('live view follows: block 1/3, 1 solve (no refresh)', (await textOf(live.getByTestId('live-block'))) === '1/3' &&
    (await textOf(live.getByTestId('live-count'))) === '1 эвлүүлэлт');

  console.log('\n=== edit / delete blocked, comment allowed ===');
  const rowState = {
    del: await S.page.getByRole('button', { name: 'Delete solve' }).count(),
    dnf: await S.page.getByRole('button', { name: 'Mark DNF' }).count(),
    plus2: await S.page.getByRole('button', { name: 'Apply +2 penalty' }).count(),
    comment: await S.page.getByRole('button', { name: 'Comment', exact: true }).count(),
  };
  check('action row: no delete / DNF / +2, only the comment button',
    rowState.del === 0 && rowState.dnf === 0 && rowState.plus2 === 0 && rowState.comment === 1, rowState);
  await S.page.keyboard.press('KeyX');
  await S.page.keyboard.press('KeyD');
  await S.page.waitForTimeout(300);
  check('X / D shortcuts change nothing', await S.page.getByText('Устгах уу', { exact: false }).count() === 0 &&
    (await S.page.locator('.pv-timer-digits').innerText()) !== 'DNF');
  await S.page.getByRole('button', { name: 'Comment', exact: true }).click();
  await S.page.getByPlaceholder('Тайлбар', { exact: true }).fill('сайн эхлэл');
  await S.page.getByPlaceholder('Тайлбар', { exact: true }).press('Enter');
  const commented = await until(async () => {
    const live = (await db.doc(`challengeLive/${studentA.uid}`).get()).data();
    if (!live?.sessionId) return null;
    const ss = (await db.doc(`challengeSessions/${live.sessionId}`).get()).data();
    return ss?.solves?.[0]?.comment === 'сайн эхлэл' ? ss : null;
  });
  check('comment saved on the server, time and penalty unchanged', !!commented && commented.solves[0].penalty === 'none', commented?.solves?.[0]);
  await S.page.locator('.pv-sidebar .pv-solves-list > div > div').first().click();
  check('solve detail: "Challenge · баталгаажсан", no penalty buttons, no Delete',
    await S.page.getByText('Challenge · баталгаажсан').isVisible() && await S.page.getByRole('button', { name: 'Delete', exact: true }).count() === 0);
  await S.page.keyboard.press('Escape');
  await S.page.getByText('Challenge · баталгаажсан').waitFor({ state: 'detached' });

  console.log('\n=== a failing block resets ===');
  await keySolve(S.page, 900);
  await S.page.getByTestId('challenge-confirm-ok').click();
  await keySolve(S.page, 900);
  await S.page.getByTestId('challenge-confirm-dnf').click();
  await S.page.getByText('Эвлүүлэлт (3)').waitFor();
  const failNote = await S.page.getByTestId('challenge-block-note').innerText();
  check('block 1 (OK, OK, DNF) → "Mo3 DNF ✗ — дахин эхэллээ", streak 0/2', failNote === 'Mo3 DNF ✗ — дахин эхэллээ' &&
    (await S.page.getByTestId('challenge-streak').innerText()).includes('0/2'), failNote);
  check('the DNF shows on the timer', (await S.page.locator('.pv-timer-digits').innerText()) === 'DNF');
  await until(async () => (await textOf(live.getByTestId('live-count'))) === '3 эвлүүлэлт');
  check('live view: the failed block — last "DNF ✗", streak 0/2, block 0/3', (await textOf(live.getByTestId('live-last'))) === 'DNF ✗' &&
    (await textOf(live.getByTestId('live-streak'))).includes('0/2') && (await textOf(live.getByTestId('live-block'))) === '0/3', await textOf(live));

  console.log('\n=== a too-fast solve is refused and flagged ===');
  await keySolve(S.page, 20);
  await S.page.getByTestId('challenge-confirm-ok').click();
  await S.page.getByText('Цаг хэт хурдан байна').first().waitFor();
  check('student: "Цаг хэт хурдан байна"', true);
  await until(async () => (await S.page.getByText('Эвлүүлэлт (3)').count()) === 1);
  check('the refused solve is not kept (still 3 solves, block 0/3)', await S.page.getByText('Эвлүүлэлт (3)').isVisible() &&
    (await S.page.getByTestId('challenge-block').innerText()) === 'Mo3 · 0/3 эвлүүлэлт');
  const flag = live.getByTestId('live-flag');
  await flag.waitFor();
  check('coach: a flag appears on the student (⚑ 1)', (await textOf(flag)) === '⚑ 1');
  await flag.click();
  const flagList = (await textOf(live.getByTestId('live-flags')));
  check('tap the flag: time + reason ("хэт хурдан")', /\d\d:\d\d 0\.\d\d · хэт хурдан/.test(flagList), flagList);
  check('…and the solve count is unchanged', (await textOf(live.getByTestId('live-count'))) === '3 эвлүүлэлт');
  await C.page.screenshot({ path: path.join(OUT, 'coach-flag.png'), fullPage: true });

  console.log('\n=== a passing block counts (with a +2) ===');
  await keySolve(S.page, 900); await S.page.getByTestId('challenge-confirm-ok').click();
  await keySolve(S.page, 900); await S.page.getByTestId('challenge-confirm-plus2').click();
  await keySolve(S.page, 900); await S.page.getByTestId('challenge-confirm-ok').click();
  await S.page.getByText('Эвлүүлэлт (6)').waitFor();
  const passNote = await S.page.getByTestId('challenge-block-note').innerText();
  check('block 2 (OK, +2, OK) passes: "Mo3 x.xx ✓", streak 1/2', /^Mo3 \d\.\d\d ✓$/.test(passNote) &&
    (await S.page.getByTestId('challenge-streak').innerText()).includes('1/2'), passNote);
  await S.page.screenshot({ path: path.join(OUT, 'student-block-pass.png') });
  await until(async () => (await textOf(live.getByTestId('live-count'))) === '6 эвлүүлэлт');
  check('live view: streak 1/2, last block "x.xx ✓"', (await textOf(live.getByTestId('live-streak'))).includes('1/2') &&
    /^\d\.\d\d ✓$/.test(await textOf(live.getByTestId('live-last'))), await textOf(live));

  console.log('\n=== student ends early: partial block dropped ===');
  await keySolve(S.page, 900); await S.page.getByTestId('challenge-confirm-ok').click();
  await S.page.getByText('Эвлүүлэлт (7)').waitFor();
  const sid1 = (await db.doc(`challengeLive/${studentA.uid}`).get()).get('sessionId');
  await until(async () => ((await db.doc(`challengeSessions/${sid1}`).get()).get('solves') ?? []).length === 7);
  await S.page.getByTestId('challenge-end').click();
  await S.page.getByTestId('challenge-end-confirm').click();
  await strip.waitFor({ state: 'detached' });
  check('"Өнөөдрийг дуусгах": strip gone, back on 3x3 and the normal session',
    (await pickEvent.innerText()).includes('3x3x3') && await S.page.getByText('Эвлүүлэлт (1)').isVisible());
  const s1 = (await db.doc(`challengeSessions/${sid1}`).get()).data();
  check('server: session ended, 2 complete blocks (the 7th solve dropped), best streak 1',
    s1.status === 'ended' && s1.blocksAttempted === 2 && s1.bestStreak === 1, { status: s1.status, blocks: s1.blocksAttempted });
  await live.waitFor({ state: 'detached' });
  check('live view: the ended session leaves the list', true);
  await row.getByRole('button', { name: /эхлүүлэх/ }).waitFor();
  check('coach row offers "Эхлүүлэх" again without a refresh', true);
  const after = (await db.doc(`users/${studentA.uid}`).get()).data();
  check('no club points or solve count from challenge solves', after.totalSolves === before.totalSolves && after.points === before.points, { before, after });

  console.log('\n=== next session: student away, opens the timer → starts at 0 ===');
  await S.page.goto(`${BASE}/timer/challenge`);
  await S.page.getByTestId(`my-assignment-${CH}`).waitFor();
  check('hub: "Идэвхтэй", waiting for the coach', await S.page.getByTestId(`my-assignment-${CH}`).getByText('Идэвхтэй').isVisible() &&
    await S.page.getByText('Багш эхлүүлэхийг хүлээнэ үү').isVisible());
  await row.getByRole('button', { name: /эхлүүлэх/ }).click();
  await row.getByTestId('start-panel').getByRole('button', { name: 'Эхлүүлэх' }).click();
  await row.getByRole('button', { name: /зогсоох/ }).waitFor();
  await S.page.getByTestId('my-assignment-running').waitFor();
  check('hub shows the running session live', true);
  await S.page.getByRole('link', { name: 'Timer нээх' }).click();
  await strip.waitFor();
  check('the timer enters the challenge on open, progress back at 0',
    (await S.page.getByTestId('challenge-block').innerText()) === 'Mo3 · 0/3 эвлүүлэлт' &&
    (await S.page.getByTestId('challenge-streak').innerText()).includes('0/2') && (await pickEvent.innerText()).includes('2x2x2'));

  // Same session on a phone-sized screen: strip above the digits there too.
  const P = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await P.newPage();
  await P.addInitScript((off) => { window.__pvTestClockOffset = off; }, OFFSET);
  await pp.goto(`${BASE}/timer/challenge`);
  await pp.waitForFunction(() => !!window.__pvTestAuth, null, { timeout: 120_000 });
  await pp.evaluate(([e, p]) => window.__pvTestAuth.signIn(e, p), [studentA.email, 'password123']);
  await pp.getByRole('heading', { name: 'Өрөөнд нэгдэх' }).waitFor();
  await pp.goto(`${BASE}/timer`);
  await pp.getByTestId('challenge-strip').waitFor();
  check('mobile layout: strip shown above the digits', await pp.getByTestId('challenge-strip').isVisible() &&
    (await pp.getByTestId('challenge-strip').boundingBox()).y < (await pp.locator('.pv-timer-digits').boundingBox()).y);
  await pp.screenshot({ path: path.join(OUT, 'student-mobile.png') });
  await P.close();

  console.log('\n=== a passing run completes the challenge ===');
  for (let i = 0; i < 6; i++) {
    await keySolve(S.page, 900);
    await S.page.getByTestId('challenge-confirm-ok').click();
  }
  const cel = S.page.getByTestId('challenge-celebration');
  await cel.waitFor({ timeout: 30_000 });
  const stats = await textOf(cel.getByTestId('celebration-stats'));
  check('celebration: "✅ Challenge биеллээ", the sentence, days, sessions, blocks, date',
    (await textOf(cel.getByTestId('celebration-title'))).replace(/\uFE0E/g, '') === '✅ Challenge биеллээ' &&
    (await textOf(cel.getByTestId('celebration-sentence'))) === '2x2x2 дээр Mo3 < 3.00-ийг 2 удаа дараалан' &&
    stats.includes('Зарцуулсан өдөр 1') && stats.includes('Session 2') && stats.includes('Нийт блок 4') &&
    stats.includes(`Биелсэн огноо ${ubDate(now())}`), stats);
  const box = await cel.boundingBox();
  check('celebration is full-screen', box.width >= 1270 && box.height >= 890, box);
  check('no confetti: nothing animated but the card, ring and lines', await cel.locator('canvas').count() === 0);
  const anim = await cel.locator('.pv-cel-card').evaluate(el => getComputedStyle(el).animationName);
  check('a subtle entrance animation runs normally', anim === 'pv-cel-rise', anim);
  await S.page.emulateMedia({ reducedMotion: 'reduce' });
  const animReduced = await cel.locator('.pv-cel-card').evaluate(el => getComputedStyle(el).animationName);
  check('prefers-reduced-motion: no animation', animReduced === 'none', animReduced);
  await S.page.screenshot({ path: path.join(OUT, 'student-celebration.png') });

  // The coach sees it at once, without a refresh.
  await C.page.getByTestId(`live-done-${studentA.uid}`).waitFor();
  await row.getByText('Биелсэн').waitFor();
  check('coach (live): "✅ Биелсэн" in the live view and on the row', await C.page.getByTestId(`live-done-${studentA.uid}`).getByText('✅ Биелсэн').isVisible());
  await C.page.screenshot({ path: path.join(OUT, 'coach-completed-live.png'), fullPage: true });

  await cel.getByRole('button', { name: 'Үргэлжлүүлэх' }).click();
  await cel.waitFor({ state: 'detached' });
  await strip.waitFor({ state: 'detached' });
  await until(async () => (await pickEvent.innerText()).includes('3x3x3'), 5000);
  const backTo = { event: await pickEvent.innerText(), solves: await S.page.locator('.pv-sidebar').getByText(/Эвлүүлэлт \(\d+\)/).innerText() };
  check('"Үргэлжлүүлэх" → the normal timer (3x3, normal session, challenge mode off)',
    backTo.event.includes('3x3x3') && backTo.solves === 'Эвлүүлэлт (1)', backTo);
  const a = (await db.doc(`challengeAssignments/${AID}`).get()).data();
  check('assignment: completed, days 1, 2 sessions, 4 blocks, best streak 2', a.status === 'completed' && a.daysTaken === 1 &&
    a.sessionsCount === 2 && a.blocksAttempted === 4 && a.bestStreak === 2 && a.completedAt != null, a);

  console.log('\n=== "Биелсэн" on both sides ===');
  await S.page.goto(`${BASE}/timer/challenge`);
  const done = S.page.getByTestId(`my-assignment-${CH}`);
  await done.getByText('Биелсэн').first().waitFor();
  check('student hub: "Биелсэн" with dates, days, sessions, blocks, best streak', await done.getByTestId('my-assignment-done').isVisible() &&
    await done.getByText('1 өдөр · 2 session').isVisible() && await done.getByText('4 · хамгийн их дараалал 2').isVisible());
  await S.page.screenshot({ path: path.join(OUT, 'student-hub-done.png'), fullPage: true });
  await row.getByText('Биелсэн').waitFor();
  check('coach: "Биелсэн · 1 өдөр", no start button', await row.getByText('1 өдөр').isVisible() &&
    await row.getByRole('button', { name: /эхлүүлэх/ }).count() === 0);
  await C.page.screenshot({ path: path.join(OUT, 'coach-done.png'), fullPage: true });
} catch (e) {
  if (e !== 'done') {
    fail++;
    console.error('E2E ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
  }
} finally {
  await browser?.close();
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
  restoreConfigs();
}
console.log(`\n  ${pass} passed, ${fail} failed   (screenshots: ${OUT})\n`);
process.exit(fail === 0 ? 0 : 1);

// ── 23:50 UB: the late-night run ───────────────────────────────────────────
async function lateNight(browser) {
  const coachA = await signUp('e2e-late-coach@example.com', 'Багш Шөнө');
  const studentA = await signUp('e2e-late-student@example.com', 'Сурагч Шөнө');
  await db.doc(`coaches/${coachA.uid}`).set({ uid: coachA.uid, displayName: coachA.displayName, active: true });
  await db.doc('rooms/roomLate').set({ name: 'Оройн бүлэг', coachUid: coachA.uid, coachName: coachA.displayName, code: 'LTE234', archived: false, createdAt: admin.firestore.Timestamp.now() });
  await db.doc(`rooms/roomLate/members/${studentA.uid}`).set({
    uid: studentA.uid, roomId: 'roomLate', roomName: 'Оройн бүлэг', coachName: coachA.displayName,
    displayName: studentA.displayName, photoURL: null, status: 'active',
    requestedAt: admin.firestore.Timestamp.now(), decidedAt: admin.firestore.Timestamp.now(),
  });
  const created = await api('challenge/create', { roomId: 'roomLate', event: '222', metric: 'single', targetMs: 5000, streak: 3 }, coachA.idToken);
  const CH = created.challengeId;
  await api('challenge/assign', { challengeId: CH, uids: [studentA.uid] }, coachA.idToken);
  const AID = `${CH}_${studentA.uid}`;

  console.log('\n=== 23:50 UB: no valid end time is left today (N2) ===');
  const C = await newUser(browser, coachA, '/timer/challenge/rooms/roomLate');
  const row = C.page.getByTestId(`assignment-${studentA.uid}`);
  await row.waitFor();
  await row.getByRole('button', { name: /эхлүүлэх/ }).click();
  const panel = row.getByTestId('start-panel');
  check('picker: the default 23:59 is refused ("10 минутын дараа") and "Эхлүүлэх" disabled',
    await panel.getByLabel('Дуусах цаг').inputValue() === '23:59' &&
    await panel.getByText('10 минутын дараа', { exact: false }).isVisible() &&
    await panel.getByRole('button', { name: 'Эхлүүлэх' }).isDisabled());
  const refused = await api('challenge/start', { assignmentId: AID }, coachA.idToken);
  check('the start route agrees: 400 end-too-soon', refused.error === 'end-too-soon', refused);

  console.log('\n=== a session that ends at 23:55 still runs at 23:50 ===');
  const ends = ubAt(23, 55);
  const tpl = { event: '222', metric: 'single', targetMs: 5000, streak: 3, title: '2x2 Single < 5.00 × 3', note: '' };
  const seed = (id, endsAt) => db.doc(`challengeSessions/${id}`).set({
    assignmentId: AID, challengeId: CH, roomId: 'roomLate', coachUid: coachA.uid, studentUid: studentA.uid,
    template: tpl, startedAt: admin.firestore.Timestamp.fromMillis(now() - 30 * 60_000), endsAt: admin.firestore.Timestamp.fromMillis(endsAt),
    ubDate: ubDate(now()), status: 'active', endedAt: null, solves: [], blocks: [], currentStreak: 0, bestStreak: 0,
    blocksAttempted: 0, flags: [], visibleToCoach: true,
  });
  await seed('lateRun', ends);
  await db.doc(`challenges/${CH}`).update({ locked: true });
  await db.doc(`challengeAssignments/${AID}`).update({
    status: 'in-progress', sessionsCount: 1, firstStartedAt: admin.firestore.Timestamp.fromMillis(now() - 30 * 60_000),
    firstStartedUbDate: ubDate(now()), activeSessionId: 'lateRun', activeEndsAt: admin.firestore.Timestamp.fromMillis(ends),
  });
  await db.doc(`challengeLive/${studentA.uid}`).set({ sessionId: 'lateRun', assignmentId: AID, template: tpl, endsAt: admin.firestore.Timestamp.fromMillis(ends) });
  const S = await newUser(browser, studentA, '/timer');
  const strip = S.page.getByTestId('challenge-strip');
  await strip.waitFor();
  check('student timer: challenge mode, "23:55 хүртэл"', await strip.getByText('23:55 хүртэл', { exact: false }).isVisible());
  const live = C.page.getByTestId(`live-${studentA.uid}`);
  await live.waitFor();
  check('coach live view shows it ("23:55 хүртэл")', (await textOf(live)).includes('23:55 хүртэл'));
  await keySolve(S.page, 900);
  await S.page.getByTestId('challenge-confirm-ok').click();
  await until(async () => (await textOf(live.getByTestId('live-count'))) === '1 эвлүүлэлт');
  check('a solve at 23:50 is accepted and shows live (1 solve, streak 1/3)', (await textOf(live.getByTestId('live-count'))) === '1 эвлүүлэлт' &&
    (await textOf(live.getByTestId('live-streak'))).includes('1/3'), await textOf(live));
  await S.page.screenshot({ path: path.join(OUT, 'late-student.png') });

  console.log('\n=== end time passes: the timer closes it; the cron closes the rest ===');
  // Move its end time to just now: the end time has passed.
  const past = now() - 1000;
  await db.doc('challengeSessions/lateRun').update({ endsAt: admin.firestore.Timestamp.fromMillis(past) });
  await db.doc(`challengeLive/${studentA.uid}`).update({ endsAt: admin.firestore.Timestamp.fromMillis(past) });
  await strip.waitFor({ state: 'detached' });
  check('student timer leaves challenge mode at the end time', true);
  const closed = await until(async () => (await db.doc('challengeSessions/lateRun').get()).get('status') === 'auto-closed');
  check('…and the expired session is closed on the server (auto-closed, pointer cleared)', !!closed &&
    (await db.doc(`challengeLive/${studentA.uid}`).get()).get('sessionId') === null);
  await live.waitFor({ state: 'detached' });
  check('coach live view drops it', true);
  // Nobody comes back to this one: only the cron closes it.
  await seed('lateGhost', ubAt(23, 40));
  check('cron without the secret → 401', (await cronRun()).status === 401);
  const r1 = await cronRun(`Bearer ${CRON_SECRET}`);
  check('cron closes the expired session nobody touched', r1.status === 200 && r1.body.closed === 1 &&
    (await db.doc('challengeSessions/lateGhost').get()).get('status') === 'auto-closed', r1);
  const r2 = await cronRun(`Bearer ${CRON_SECRET}`);
  check('running the cron again closes nothing', r2.status === 200 && r2.body.closed === 0, r2);
  await C.page.screenshot({ path: path.join(OUT, 'late-coach.png'), fullPage: true });
}
