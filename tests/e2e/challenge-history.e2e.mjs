// Playwright end-to-end test of challenge HISTORY (docs/challenge-plan.md,
// phase 5) against the LOCAL Firestore / Auth / Realtime Database emulators —
// never production. Run via `npm run test:e2e:history` (wraps
// `firebase emulators:exec`).
//
// Data: every session runs through the real routes (start / solve / end /
// the cron), so status, endedBy, blocks and the assignment roll-up are the
// server's own. Sessions meant for earlier days are then moved back in time
// with the Admin SDK (dates only), so the history shows several days.
//   Анар    "2x2 Mo3 < 2.00 × 2": 3 sessions — 2 days ago closed by the end
//           time (cron), yesterday ended by the student, today completed →
//           3 days, 3 sessions, 6 blocks, best streak 2. Plus a second
//           challenge with 12 empty sessions (pagination, 10 per page).
//   Болд    completes in one session today, BEFORE Анар.
//   Ганаа   one session, stopped by the coach (Идэвхтэй).
//   Дэлгэр  assigned, never started.
//   Есүхэй  one session ended by the student, then removed from the room.
// Checks: the student's history (summary, session list, blocks, solves,
// +2 / DNF, comments) at 360 px; the coach's per-student page, the same
// detail, and the per-challenge overview order (completed first by date);
// the removed student hidden from the coach but still seeing their own.
//
// Clock: the test clock pins the app to 12:00 UB today (lib/clock.ts,
// lib/server/clock.ts — emulator mode only).
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const PORT = 3989;
// localhost, not 127.0.0.1: next dev blocks its dev resources for other origins.
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'pv-e2e-challenge-history');
fs.mkdirSync(OUT, { recursive: true });
nextEnv.loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST']) {
  if (!process.env[v]) { console.error(`Refusing to run: ${v} is not set (use npm run test:e2e:history).`); process.exit(1); }
}
const UB = 8 * 3600_000, DAY = 86_400_000;
const ubDayStart = (ms) => Math.floor((ms + UB) / DAY) * DAY - UB;
const ubDate = (ms) => new Date(ms + UB).toISOString().slice(0, 10);
const REAL_START = Date.now();
const TODAY = ubDayStart(REAL_START);
const OFFSET = TODAY + 12 * 3600_000 - REAL_START; // 12:00 UB
const now = () => Date.now() + OFFSET;
const ubAt = (hh, mm) => TODAY + (hh * 60 + mm) * 60_000;
const CRON_SECRET = 'e2e-cron-secret-history-0123456789';
console.log(`test clock: 12:00 UB ${ubDate(now())}`);

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
const Ts = admin.firestore.Timestamp;

// next dev rewrites these two files; put them back so the tree stays clean.
const RESTORE = ['tsconfig.json', 'next-env.d.ts'].map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
const restoreConfigs = () => { for (const [f, text] of RESTORE) fs.writeFileSync(path.join(ROOT, f), text); };

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}
async function signUp(email, displayName) {
  const res = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName, returnSecureToken: true }),
  });
  const u = await res.json();
  await db.doc(`users/${u.localId}`).set({ uid: u.localId, email, displayName, role: 'member', points: 0, totalSolves: 0, photoURL: null, createdAt: Ts.now() });
  return { uid: u.localId, email, displayName, idToken: u.idToken };
}
async function post(route, body, token) {
  const res = await fetch(`${BASE}/api/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const out = { status: res.status, body: await res.json().catch(() => ({})) };
  if (res.status !== 200) throw new Error(`${route} → ${res.status} ${JSON.stringify(out.body)}`);
  return out.body;
}
const textOf = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const texts = async (loc) => (await loc.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());

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
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// ── Sessions through the real routes ─────────────────────────────────────
let clk = 1_800_000_000_000; // the student's client clock for stoppedAt
/**
 * Coach starts; the student's confirmed solves go in (`[ms, penalty?, comment?]`);
 * then it ends `by` 'student' | 'coach' | 'time' (cron) | 'complete'
 * (the last solve completes it). Returns the session id.
 */
async function runSession(coach, student, aid, solves, by) {
  const { sessionId } = await post('challenge/start', { assignmentId: aid, endsAt: ubAt(23, 59) }, coach.idToken);
  // The "total solve time ≤ time since start" check reads startedAt.
  await db.doc(`challengeSessions/${sessionId}`).update({ startedAt: Ts.fromMillis(now() - 10 * 60_000) });
  let seq = 0;
  for (const [ms, penalty = 'none', comment] of solves) {
    seq++;
    clk += 10_000;
    await post('challenge/solve', { sessionId, seq, ms, penalty, stoppedAt: clk, input: 'timer' }, student.idToken);
    if (comment) await post('challenge/comment', { sessionId, seq, comment }, student.idToken);
  }
  if (by === 'student') await post('challenge/end', { sessionId }, student.idToken);
  if (by === 'coach') await post('challenge/end', { sessionId }, coach.idToken);
  if (by === 'time') {
    await db.doc(`challengeSessions/${sessionId}`).update({ endsAt: Ts.fromMillis(now() - 1000) });
    const r = await fetch(`${BASE}/api/challenge/close-stale`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    if (r.status !== 200) throw new Error(`cron → ${r.status}`);
  }
  return sessionId;
}
/** Moves a closed session `days` back (dates only; results untouched). */
async function moveBack(sessionId, days) {
  const ref = db.doc(`challengeSessions/${sessionId}`);
  const s = (await ref.get()).data();
  const back = (t) => (t ? Ts.fromMillis(t.toMillis() - days * DAY) : t);
  await ref.update({ startedAt: back(s.startedAt), endsAt: back(s.endsAt), endedAt: back(s.endedAt), ubDate: ubDate(s.startedAt.toMillis() - days * DAY) });
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();

  const coach = await signUp('e2e-h-coach@example.com', 'Багш Хос');
  const anar = await signUp('e2e-h-anar@example.com', 'Анар');
  const bold = await signUp('e2e-h-bold@example.com', 'Болд');
  const ganaa = await signUp('e2e-h-ganaa@example.com', 'Ганаа');
  const delger = await signUp('e2e-h-delger@example.com', 'Дэлгэр');
  const esukhei = await signUp('e2e-h-esukhei@example.com', 'Есүхэй');
  const students = [anar, bold, ganaa, delger, esukhei];
  await db.doc(`coaches/${coach.uid}`).set({ uid: coach.uid, displayName: coach.displayName, active: true });
  await db.doc('rooms/roomH').set({ name: 'Түүхийн бүлэг', coachUid: coach.uid, coachName: coach.displayName, code: 'HST234', archived: false, createdAt: Ts.now() });
  for (const s of students) {
    await db.doc(`rooms/roomH/members/${s.uid}`).set({
      uid: s.uid, roomId: 'roomH', roomName: 'Түүхийн бүлэг', coachName: coach.displayName,
      displayName: s.displayName, photoURL: null, status: 'active', requestedAt: Ts.now(), decidedAt: Ts.now(),
    });
  }

  console.log('\n=== data through the real routes ===');
  const X = (await post('challenge/create', { roomId: 'roomH', event: '222', metric: 'mo3', targetMs: 2000, streak: 2 }, coach.idToken)).challengeId;
  const Y = (await post('challenge/create', { roomId: 'roomH', event: '222', metric: 'single', targetMs: 5000, streak: 100 }, coach.idToken)).challengeId;
  await post('challenge/assign', { challengeId: X, uids: students.map(s => s.uid) }, coach.idToken);
  await post('challenge/assign', { challengeId: Y, uids: [anar.uid] }, coach.idToken);
  const aid = (c, s) => `${c}_${s.uid}`;

  // Анар, 2 days ago: 1.50 1.60 1.70 → Mo3 1.60 ✓, then 2 solves of an unfinished block; closed by the end time.
  const A1 = await runSession(coach, anar, aid(X, anar), [[1500], [1600], [1700], [1800], [1900]], 'time');
  await moveBack(A1, 2);
  await db.doc(`challengeAssignments/${aid(X, anar)}`).update({
    firstStartedAt: Ts.fromMillis(now() - 2 * DAY - 10 * 60_000), firstStartedUbDate: ubDate(now() - 2 * DAY),
  });
  // Анар, yesterday: DNF block ✗, a block with a +2 (2.26 ✗), 1.80 ✓; a comment; ended by the student.
  const A2 = await runSession(coach, anar, aid(X, anar), [
    [1800], [2500], [1700, 'dnf'], [1500, '+2', 'гулссан'], [1600], [1700], [1700], [1800], [1900],
  ], 'student');
  await moveBack(A2, 1);
  // Болд completes today, before Анар does.
  await runSession(coach, bold, aid(X, bold), [[1500], [1500], [1500], [1500], [1500], [1500]], 'complete');
  await new Promise(r => setTimeout(r, 1100));
  // Анар, today: 1.55 ✓, 1.45 ✓ → completed.
  const A3 = await runSession(coach, anar, aid(X, anar), [[1500], [1550], [1600], [1400], [1450], [1500]], 'complete');
  await runSession(coach, ganaa, aid(X, ganaa), [[2100], [2200], [2300]], 'coach');
  await runSession(coach, esukhei, aid(X, esukhei), [[1500], [1600], [1700]], 'student');
  await post('rooms/member', { roomId: 'roomH', uid: esukhei.uid, action: 'remove' }, coach.idToken);
  // Анар's second challenge: 12 sessions, started and ended at once.
  const ySessions = [];
  for (let i = 0; i < 12; i++) {
    ySessions.push(await runSession(coach, anar, aid(Y, anar), [], 'student'));
    await new Promise(r => setTimeout(r, 20));
  }
  const ax = (await db.doc(`challengeAssignments/${aid(X, anar)}`).get()).data();
  check('Анар rolled up: completed, 3 days, 3 sessions, 6 blocks, best streak 2', ax.status === 'completed' && ax.daysTaken === 3 &&
    ax.sessionsCount === 3 && ax.blocksAttempted === 6 && ax.bestStreak === 2, ax);
  const statuses = await Promise.all([A1, A2, A3].map(async id => (await db.doc(`challengeSessions/${id}`).get()).data()));
  check('the 3 sessions: auto-closed / ended by the student / completed', statuses.map(s => `${s.status}${s.endedBy ? ':' + s.endedBy : ''}`).join() ===
    'auto-closed,ended:student,completed', statuses.map(s => [s.status, s.endedBy]));
  check('Есүхэй is removed and hidden from the coach', (await db.doc(`challengeAssignments/${aid(X, esukhei)}`).get()).get('visibleToCoach') === false);

  console.log('\n=== student: history at 360 px ===');
  const S = await newUser(browser, anar, null, { width: 360, height: 800 });
  const card = S.page.getByTestId(`my-assignment-${X}`);
  await card.waitFor();
  await card.getByTestId('my-assignment-history').click();
  await S.page.waitForURL(`**/timer/challenge/history/${aid(X, anar)}`);
  const summary = S.page.getByTestId('history-summary');
  await summary.waitFor();
  const stat = (page, label) => textOf(page.getByTestId('history-stats').locator(`[data-stat="${label}"]`));
  const checkSummary = async (page, who) => {
    check(`${who}: sentence and status "Биелсэн"`, (await textOf(page.getByTestId('history-sentence'))) === '2x2x2 дээр Mo3 < 2.00-ийг 2 удаа дараалан' &&
      (await textOf(page.getByTestId('history-status'))) === 'Биелсэн', await textOf(page.getByTestId('history-summary')));
    const got = [await stat(page, 'Анх эхэлсэн'), await stat(page, 'Биелсэн'), await stat(page, 'Зарцуулсан'),
      await stat(page, 'Session'), await stat(page, 'Нийт блок'), await stat(page, 'Хамгийн их дараалал')];
    check(`${who}: first started 2 days ago, completed today, 3 days, 3 sessions, 6 blocks, best streak 2`,
      got.join('|') === [`Анх эхэлсэн ${ubDate(now() - 2 * DAY)}`, `Биелсэн ${ubDate(now())}`, 'Зарцуулсан 3 өдөр',
        'Session 3', 'Нийт блок 6', 'Хамгийн их дараалал 2'].join('|'), got);
  };
  await checkSummary(S.page, 'student');

  const rows = S.page.getByTestId('session-row');
  await rows.first().waitFor();
  const checkSessions = async (page, who) => {
    const r = page.getByTestId('session-row');
    check(`${who}: 3 sessions, newest first`, (await r.count()) === 3 &&
      (await r.evaluateAll(els => els.map(e => e.dataset.sessionId))).join() === [A3, A2, A1].join(), await r.count());
    check(`${who}: how each ended — биелсэн / дуусгасан / цаг дууссан`,
      (await texts(page.getByTestId('session-reason'))).join() === 'биелсэн,дуусгасан,цаг дууссан', await texts(page.getByTestId('session-reason')));
    const when = await texts(page.getByTestId('session-when'));
    check(`${who}: dates today / yesterday / 2 days ago, with start–end times`,
      [0, 1, 2].every(i => when[i].startsWith(`${ubDate(now() - i * DAY)} · `) && /\d{2}:\d{2}–\d{2}:\d{2}$/.test(when[i])), when);
    check(`${who}: blocks attempted and best streak per session`, (await texts(page.getByTestId('session-numbers'))).join('|') ===
      ['2 блок · хамгийн их дараалал 2 · 6 эвлүүлэлт', '3 блок · хамгийн их дараалал 1 · 9 эвлүүлэлт',
        '1 блок · хамгийн их дараалал 1 · 5 эвлүүлэлт'].join('|'), await texts(page.getByTestId('session-numbers')));
    check(`${who}: no "Цааш үзэх" for 3 sessions`, (await page.getByRole('button', { name: 'Цааш үзэх' }).count()) === 0);
    // Yesterday's session: blocks in order, with their solves, +2 / DNF and the comment.
    await r.nth(1).getByRole('button').click();
    const d = r.nth(1).getByTestId('session-detail');
    await d.waitFor();
    check(`${who}: yesterday's blocks — Mo3 DNF ✗, Mo3 2.26 ✗, Mo3 1.80 ✓`,
      (await texts(d.getByTestId('block-result'))).join('|') === 'Mo3 DNF ✗|Mo3 2.26 ✗|Mo3 1.80 ✓', await texts(d.getByTestId('block-result')));
    const solves = await texts(d.getByTestId('block-solves'));
    check(`${who}: each block's solves (DNF, +2 shown as 3.50+)`, solves.join('|') === '1. 1.80 2. 2.50 3. DNF|4. 3.50+ 5. 1.60 6. 1.70|7. 1.70 8. 1.80 9. 1.90', solves);
    check(`${who}: the comment on solve 4`, (await texts(d.getByTestId('solve-comment'))).join() === '4. гулссан', await texts(d.getByTestId('solve-comment')));
    // 2 days ago: one scored block, plus the unfinished one that never counted.
    await r.nth(2).getByRole('button').click();
    const d2 = r.nth(2).getByTestId('session-detail');
    await d2.waitFor();
    const left = d2.getByTestId('history-leftover');
    check(`${who}: 2 days ago — Mo3 1.60 ✓ and an unfinished block (тооцогдоогүй: 1.80, 1.90)`,
      (await texts(d2.getByTestId('block-result'))).join() === 'Mo3 1.60 ✓' && (await textOf(left)).includes('тооцогдоогүй') &&
      (await textOf(left.getByTestId('block-solves'))) === '4. 1.80 5. 1.90', await textOf(d2));
  };
  await checkSessions(S.page, 'student');
  check('student: no sideways scroll at 360 px', await noSideScroll(S.page));
  await S.page.screenshot({ path: path.join(OUT, 'student-history-360.png'), fullPage: true });

  console.log('\n=== student: pagination (12 sessions, 10 per page) ===');
  await S.page.goto(`${BASE}/timer/challenge/history/${aid(Y, anar)}`);
  await rows.first().waitFor();
  const ids = () => rows.evaluateAll(els => els.map(e => e.dataset.sessionId));
  check('first page: the 10 newest', (await ids()).join() === ySessions.slice().reverse().slice(0, 10).join(), await ids());
  await S.page.getByRole('button', { name: 'Цааш үзэх' }).click();
  await S.page.waitForFunction(() => document.querySelectorAll('[data-testid="session-row"]').length === 12);
  check('"Цааш үзэх" loads the last 2, in order', (await ids()).join() === ySessions.slice().reverse().join(), await ids());
  check('…and then disappears', (await S.page.getByRole('button', { name: 'Цааш үзэх' }).count()) === 0);
  check('summary of the unfinished challenge: Идэвхтэй, 12 sessions, no completion date',
    (await textOf(S.page.getByTestId('history-status'))) === 'Идэвхтэй' && (await stat(S.page, 'Session')) === 'Session 12' &&
    (await stat(S.page, 'Биелсэн')) === 'Биелсэн —' && (await stat(S.page, 'Зарцуулсан')) === 'Зарцуулсан —');

  console.log('\n=== coach: one student ===');
  const C = await newUser(browser, coach, '/timer/challenge/rooms/roomH');
  await C.page.getByTestId(`member-history-${anar.uid}`).click();
  await C.page.waitForURL(`**/rooms/roomH/students/${anar.uid}`);
  const sx = C.page.getByTestId(`student-assignment-${X}`);
  await sx.waitFor();
  check('coach: Анар\'s challenges in this room, both listed', await C.page.getByTestId(`student-assignment-${Y}`).isVisible());
  const sxText = await textOf(sx);
  check('coach: status and the same summary numbers', sxText.includes('Биелсэн') && sxText.includes('3 өдөр') &&
    sxText.includes('Session 3') && sxText.includes('Нийт блок 6') && sxText.includes('Хамгийн их дараалал 2'), sxText);
  await sx.click();
  await C.page.waitForURL(`**/timer/challenge/history/${aid(X, anar)}`);
  await C.page.getByTestId('history-summary').waitFor();
  await checkSummary(C.page, 'coach');
  await C.page.getByTestId('session-row').first().waitFor();
  await checkSessions(C.page, 'coach');
  check('coach: the student\'s name on the history page', (await textOf(C.page.getByTestId('history-summary'))).startsWith('Анар'));

  console.log('\n=== coach: one challenge, every student ===');
  await C.page.goto(`${BASE}/timer/challenge/rooms/roomH`);
  await C.page.getByTestId(`challenge-overview-${X}`).click();
  await C.page.waitForURL(`**/rooms/roomH/challenges/${X}`);
  await C.page.getByTestId('overview-row').first().waitFor();
  const names = await texts(C.page.getByTestId('overview-name'));
  check('completed on top by completion date (Болд, then Анар), then active, then not started', names.join() === 'Болд,Анар,Ганаа,Дэлгэр', names);
  check('the removed student is not listed', !names.includes('Есүхэй'));
  const nums = await texts(C.page.getByTestId('overview-numbers'));
  check('days taken, sessions and best streak per student', nums.join('|') === [
    `${ubDate(now())} · 1 өдөр · 1 session · хамгийн их дараалал 2`,
    `${ubDate(now())} · 3 өдөр · 3 session · хамгийн их дараалал 2`,
    'Зарцуулсан — · 1 session · хамгийн их дараалал 0',
    'Зарцуулсан — · 0 session · хамгийн их дараалал 0'].join('|'), nums);
  check('statuses: Биелсэн, Биелсэн, Идэвхтэй, Оноогдсон', (await texts(C.page.getByTestId('overview-row')))
    .map(t => ['Биелсэн', 'Идэвхтэй', 'Оноогдсон'].find(s => t.includes(s))).join() === 'Биелсэн,Биелсэн,Идэвхтэй,Оноогдсон');
  check('header: 2/4 completed', (await textOf(C.page.getByTestId('overview-card'))).includes('2/4 биелсэн'));
  await C.page.getByTestId('overview-row').nth(2).click();
  await C.page.waitForURL(`**/timer/challenge/history/${aid(X, ganaa)}`);
  await C.page.getByTestId('session-row').first().waitFor();
  check('tap through: Ганаа\'s session, stopped by the coach', (await texts(C.page.getByTestId('session-reason'))).join() === 'багш зогсоосон');
  await C.page.setViewportSize({ width: 360, height: 800 });
  await C.page.goto(`${BASE}/timer/challenge/rooms/roomH/challenges/${X}`);
  await C.page.getByTestId('overview-row').first().waitFor();
  check('coach overview: no sideways scroll at 360 px', await noSideScroll(C.page));
  await C.page.screenshot({ path: path.join(OUT, 'coach-overview-360.png'), fullPage: true });

  console.log('\n=== removed student: hidden from the coach, visible to themself ===');
  await C.page.goto(`${BASE}/timer/challenge/rooms/roomH`);
  await C.page.getByTestId(`member-${anar.uid}`).waitFor();
  check('coach: not in the member list', (await C.page.getByTestId(`member-${esukhei.uid}`).count()) === 0);
  await C.page.goto(`${BASE}/timer/challenge/rooms/roomH/students/${esukhei.uid}`);
  await C.page.getByTestId('student-missing').waitFor();
  check('coach: their student page is hidden', true);
  await C.page.goto(`${BASE}/timer/challenge/history/${aid(X, esukhei)}`);
  await C.page.getByTestId('history-missing').waitFor();
  check('coach: their history is hidden', (await C.page.getByTestId('session-row').count()) === 0);

  const E = await newUser(browser, esukhei, null, { width: 360, height: 800 });
  const eMember = E.page.getByTestId('membership-roomH');
  await eMember.waitFor();
  check('removed student: the hub shows "Хасагдсан" and the challenge', (await textOf(eMember)).includes('Хасагдсан'));
  await E.page.getByTestId(`my-assignment-${X}`).getByTestId('my-assignment-history').click();
  await E.page.getByTestId('session-row').first().waitFor();
  check('removed student still sees their own history (N4): Идэвхтэй, 1 session ended by them, 1 block',
    (await textOf(E.page.getByTestId('history-status'))) === 'Идэвхтэй' &&
    (await texts(E.page.getByTestId('session-reason'))).join() === 'дуусгасан' &&
    (await texts(E.page.getByTestId('session-numbers'))).join() === '1 блок · хамгийн их дараалал 1 · 3 эвлүүлэлт');
  await E.page.screenshot({ path: path.join(OUT, 'removed-student-history.png'), fullPage: true });
} catch (e) {
  fail++;
  console.error('E2E ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
} finally {
  await browser?.close();
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
  restoreConfigs();
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
