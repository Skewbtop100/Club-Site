// Playwright end-to-end test of coach rooms (docs/challenge-plan.md, phase 2)
// against the LOCAL Firestore / Auth / Realtime Database emulators — never
// production. Run via `npm run test:e2e:rooms`, which wraps this in
// `firebase emulators:exec`.
//
// It starts `next dev` with NEXT_PUBLIC_FIREBASE_EMULATORS=1 (the test-only
// emulator mode in lib/firebase.ts, which exists only outside production
// builds — see emulator-guard.mjs) and signs accounts in with
// window.__pvTestAuth (email + password against the Auth emulator).
// Admin, coach and students each get their own browser context.
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const PORT = 3996;
// localhost, not 127.0.0.1: next dev blocks its dev resources for other origins.
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'pv-e2e-rooms');
fs.mkdirSync(OUT, { recursive: true });
nextEnv.loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST']) {
  if (!process.env[v]) { console.error(`Refusing to run: ${v} is not set (use npm run test:e2e:rooms).`); process.exit(1); }
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  ...process.env,
  NODE_ENV: 'development',
  NEXT_PUBLIC_FIREBASE_EMULATORS: '1',
  FIREBASE_ADMIN_CLIENT_EMAIL: `e2e@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
};

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

// next build / next dev rewrite these two files (types path, include list);
// snapshot them and put them back so a test run leaves the tree clean.
const RESTORE = ["tsconfig.json", "next-env.d.ts"].map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]);
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
  // createdAt: the admin users list orders by it (docs without it are skipped).
  await db.doc(`users/${u.localId}`).set({ uid: u.localId, email, displayName, role, points: 0, photoURL: null, createdAt: admin.firestore.Timestamp.now() });
  return { uid: u.localId, email, displayName };
}

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

async function newUser(browser, account, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/timer/challenge`);
  if (account) {
    await page.waitForFunction(() => !!window.__pvTestAuth, null, { timeout: 120_000 });
    await page.evaluate(([e, p]) => window.__pvTestAuth.signIn(e, p), [account.email, 'password123']);
    await page.getByRole('heading', { name: 'Өрөөнд нэгдэх' }).waitFor();
  }
  return { ctx, page };
}
const noChevrons = (page) => page.evaluate(() => !/[▾▼⌄]/.test(document.body.innerText));

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();

  const adminA = await signUp('e2e-admin@example.com', 'Admin Админ', 'admin');
  const coachA = await signUp('e2e-coach@example.com', 'Coach Батаа');
  const studentA = await signUp('e2e-student@example.com', 'Сурагч Болд');
  const lateA = await signUp('e2e-late@example.com', 'Хожуу Сараа');

  console.log('\n=== signed out ===');
  const anon = await newUser(browser, null);
  await anon.page.getByText('Нэвтрэх шаардлагатай').waitFor();
  check('not signed in → Google sign-in prompt', await anon.page.getByRole('button', { name: 'Google-ээр нэвтрэх' }).isVisible());
  await anon.ctx.close();

  console.log('\n=== admin grants coach ===');
  const A = await newUser(browser, adminA);
  await A.page.goto(`${BASE}/admin/users`);
  const row = A.page.locator('tr', { hasText: coachA.email });
  await row.waitFor({ timeout: 120_000 });
  await row.getByRole('button', { name: 'Үйлдэл' }).click();
  await A.page.getByRole('menuitem', { name: 'Coach эрх олгох' }).click();
  await row.getByText('Coach', { exact: true }).waitFor();
  check('admin users list: "Coach эрх олгох" → Coach badge', true);
  const coachDoc = (await db.doc(`coaches/${coachA.uid}`).get()).data();
  check('coaches/{uid} written by the admin (active)', coachDoc?.active === true && coachDoc?.grantedBy === adminA.uid, coachDoc);
  const adminRow = A.page.locator('tr', { hasText: adminA.email });
  check('admin row shows "Coach (авто)" without a toggle', await adminRow.getByText('Coach (авто)').isVisible());
  await A.page.screenshot({ path: path.join(OUT, 'admin-users.png') });
  await A.ctx.close();

  console.log('\n=== coach creates a room ===');
  const C = await newUser(browser, coachA);
  await C.page.getByRole('heading', { name: 'Миний удирддаг өрөөнүүд' }).waitFor();
  await C.page.getByLabel('Шинэ өрөөний нэр').fill('Бямба гарагийн бүлэг');
  await C.page.getByRole('button', { name: 'Өрөө үүсгэх' }).click();
  await C.page.waitForURL(/\/timer\/challenge\/rooms\//);
  const codeEl = C.page.getByTestId('room-code');
  await codeEl.waitFor();
  const code1 = (await codeEl.innerText()).trim();
  check('room page shows a 6-char code from the safe alphabet', /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code1), code1);
  check('coach room page has no chevrons', await noChevrons(C.page));
  await C.page.screenshot({ path: path.join(OUT, 'coach-room-new.png'), fullPage: true });

  console.log('\n=== student joins ===');
  const S = await newUser(browser, studentA, { width: 390, height: 844 });
  await S.page.getByLabel('Өрөөний код').fill(code1.toLowerCase());
  await S.page.getByRole('button', { name: 'Нэгдэх' }).click();
  await S.page.getByText('хүсэлт илгээлээ', { exact: false }).waitFor();
  const myRow = S.page.getByTestId('my-rooms').getByText('Бямба гарагийн бүлэг');
  await myRow.waitFor();
  check('student: my rooms shows the room as "Хүлээгдэж байна"', await S.page.getByTestId('my-rooms').getByText('Хүлээгдэж байна').isVisible());
  check('student hub has no chevrons', await noChevrons(S.page));
  await S.page.screenshot({ path: path.join(OUT, 'student-pending.png'), fullPage: true });

  console.log('\n=== coach approves (live) ===');
  const pendingRow = C.page.getByTestId(`pending-${studentA.uid}`);
  await pendingRow.waitFor();
  check('coach sees the pending request with the student\'s name', await pendingRow.getByText('Сурагч Болд').isVisible());
  await pendingRow.getByRole('button', { name: 'Зөвшөөрөх' }).click();
  await C.page.getByTestId(`member-${studentA.uid}`).waitFor();
  check('approved student moves to the member list', await C.page.getByTestId(`member-${studentA.uid}`).getByText('Сурагч Болд').isVisible());
  await C.page.screenshot({ path: path.join(OUT, 'coach-room-member.png'), fullPage: true });
  // No refresh: the student's list is live.
  await S.page.getByTestId('my-rooms').getByText('Нэгдсэн').waitFor();
  check('student: status becomes "Нэгдсэн" live (no refresh)', true);
  await S.page.getByText('хүсэлт илгээлээ', { exact: false }).waitFor({ state: 'detached' });
  check('the green "хүсэлт илгээлээ" message is gone after approval', true);
  check('no "Шинэчлэх" button any more', await S.page.getByRole('button', { name: 'Шинэчлэх' }).count() === 0);
  // (The seeded coach is *named* "Coach Батаа" — only the UI labels changed.)
  check('student hub labels say "Багш", not "Coach"', await S.page.evaluate(() => !/Coach(:|-ийн| баталгаа)/.test(document.body.innerText)) &&
    await S.page.getByText('Багш: Coach Батаа').isVisible());

  console.log('\n=== coach removes, student re-requests, coach re-adds ===');
  const memberRow = C.page.getByTestId(`member-${studentA.uid}`);
  await memberRow.getByRole('button', { name: 'Хасах' }).click();
  await memberRow.getByRole('button', { name: 'Тийм, хасах' }).click();
  await memberRow.waitFor({ state: 'detached' });
  check('removed student disappears from the coach view', true);
  const removedDoc = (await db.doc(`rooms/${(await C.page.url()).split('/').pop()}/members/${studentA.uid}`).get());
  check('membership kept with status removed (not deleted)', removedDoc.exists && removedDoc.get('status') === 'removed');
  await S.page.getByTestId('my-rooms').getByText('Хасагдсан').waitFor();
  check('student still sees the room in their own list as "Хасагдсан"', true);
  await S.page.getByLabel('Өрөөний код').fill(code1);
  await S.page.getByRole('button', { name: 'Нэгдэх' }).click();
  await S.page.getByTestId('my-rooms').getByText('Хүлээгдэж байна').waitFor();
  await C.page.getByTestId(`pending-${studentA.uid}`).getByRole('button', { name: 'Зөвшөөрөх' }).click();
  await C.page.getByTestId(`member-${studentA.uid}`).waitFor();
  check('re-added after a new request + approval', true);

  console.log('\n=== regenerate code ===');
  await C.page.getByRole('button', { name: 'Шинэ код' }).click();
  await C.page.getByRole('button', { name: 'Тийм, шинэ код' }).click();
  await C.page.getByText('Хуучин код ажиллахаа болилоо', { exact: false }).waitFor();
  const code2 = (await codeEl.innerText()).trim();
  check('new code shown, different from the old', code2 !== code1 && /^[A-Z2-9]{6}$/.test(code2), { code1, code2 });
  const L = await newUser(browser, lateA, { width: 390, height: 844 });
  await L.page.getByLabel('Өрөөний код').fill(code1);
  await L.page.getByRole('button', { name: 'Нэгдэх' }).click();
  await L.page.getByText('Ийм кодтой өрөө олдсонгүй.').waitFor();
  check('the OLD code no longer works', true);
  await L.page.getByLabel('Өрөөний код').fill(code2);
  await L.page.getByRole('button', { name: 'Нэгдэх' }).click();
  await L.page.getByTestId('my-rooms').getByText('Хүлээгдэж байна').waitFor();
  check('the NEW code works', true);
  await L.page.screenshot({ path: path.join(OUT, 'late-student-pending.png'), fullPage: true });
  await L.ctx.close();

  console.log('\n=== timer entry points ===');
  await S.page.goto(`${BASE}/timer`);
  await S.page.getByRole('button', { name: 'Community' }).click();
  const tile = S.page.getByRole('button', { name: 'Challenge', exact: true });
  await tile.waitFor();
  check('mobile Community tab: "Challenge" tile is open (not "Удахгүй")', !(await tile.innerText()).includes('Удахгүй'));
  const raceTile = S.page.getByRole('button', { name: 'Race', exact: true });
  check('Racing is open again (not "Удахгүй")', await raceTile.isVisible() && !(await raceTile.innerText()).includes('Удахгүй'));
  check('Competition stays "Удахгүй"', await S.page.getByRole('button', { name: 'Competition — Удахгүй' }).isVisible());
  {
    // The route itself renders the real racing page, not the coming-soon screen.
    const p = await S.ctx.newPage();
    await p.goto(`${BASE}/timer/multiplayer`);
    await p.waitForLoadState('load');
    check('/timer/multiplayer is no longer the "Удахгүй" screen', (await p.getByText('Энэ хэсэг удахгүй нээгдэнэ.').count()) === 0);
    await p.close();
  }
  await S.page.screenshot({ path: path.join(OUT, 'mobile-community.png') });
  await tile.click();
  await S.page.waitForURL(/\/timer\/challenge$/);
  check('tile opens /timer/challenge', true);
  await C.page.goto(`${BASE}/timer`);
  await C.page.getByRole('button', { name: 'Challenge', exact: true }).click();
  await C.page.waitForURL(/\/timer\/challenge$/);
  check('desktop sidebar "Challenge" button opens /timer/challenge', true);
  await C.page.getByTestId('coach-rooms').getByText('Бямба гарагийн бүлэг').waitFor();
  check('coach hub lists the room with its current code', await C.page.getByTestId('coach-rooms').getByText(code2).isVisible());
  await C.page.screenshot({ path: path.join(OUT, 'coach-hub.png'), fullPage: true });
} catch (e) {
  fail++;
  console.error('E2E ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
} finally {
  await browser?.close();
  // next dev spawns workers; take the whole tree down (Windows needs taskkill).
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
  restoreConfigs();
}
console.log(`\n  ${pass} passed, ${fail} failed   (screenshots: ${OUT})\n`);
process.exit(fail === 0 ? 0 : 1);
