// Playwright end-to-end test of challenge creation and assignment
// (docs/challenge-plan.md, phase 3) against the LOCAL Firestore / Auth /
// Realtime Database emulators — never production. Run via
// `npm run test:e2e:challenges`, which wraps this in `firebase emulators:exec`.
//
// Same harness as challenge-rooms.e2e.mjs: `next dev` in the test-only
// emulator mode, accounts signed in with window.__pvTestAuth. The room and
// its members are seeded with the Admin SDK (joining is covered there).
// Flow: coach creates "2x2 Ao5 < 2.00 × 5" with the live preview, assigns
// it to 2 of 3 students, both see it (the third doesn't), coach edits it
// (students see the change live), unassigns one, it gets locked (as the
// phase-4 start will do) → only "Хуулбарлах", duplicate + edit, delete.
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const PORT = 3993;
// localhost, not 127.0.0.1: next dev blocks its dev resources for other origins.
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'pv-e2e-challenges');
fs.mkdirSync(OUT, { recursive: true });
nextEnv.loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST']) {
  if (!process.env[v]) { console.error(`Refusing to run: ${v} is not set (use npm run test:e2e:challenges).`); process.exit(1); }
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
  await db.doc(`users/${u.localId}`).set({ uid: u.localId, email, displayName, role: 'member', points: 0, photoURL: null, createdAt: admin.firestore.Timestamp.now() });
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

async function newUser(browser, account, url, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/timer/challenge`);
  await page.waitForFunction(() => !!window.__pvTestAuth, null, { timeout: 120_000 });
  await page.evaluate(([e, p]) => window.__pvTestAuth.signIn(e, p), [account.email, 'password123']);
  await page.getByRole('heading', { name: 'Өрөөнд нэгдэх' }).waitFor();
  if (url) await page.goto(`${BASE}${url}`);
  return { ctx, page };
}
const noChevrons = (page) => page.evaluate(() => !/[▾▼⌄]/.test(document.body.innerText));
const challengesOf = async () => (await db.collection('challenges').where('roomId', '==', 'roomE2E').get()).docs;

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();

  const coachA = await signUp('e2e-ch-coach@example.com', 'Багш Дорж');
  const s1 = await signUp('e2e-ch-s1@example.com', 'Сурагч Анар');
  const s2 = await signUp('e2e-ch-s2@example.com', 'Сурагч Бат');
  const s3 = await signUp('e2e-ch-s3@example.com', 'Сурагч Цэцэг');
  await db.doc(`coaches/${coachA.uid}`).set({ uid: coachA.uid, displayName: coachA.displayName, active: true });
  await db.doc('rooms/roomE2E').set({ name: 'Ням гарагийн бүлэг', coachUid: coachA.uid, coachName: coachA.displayName, code: 'QWE234', archived: false, createdAt: admin.firestore.Timestamp.now() });
  for (const s of [s1, s2, s3]) {
    await db.doc(`rooms/roomE2E/members/${s.uid}`).set({
      uid: s.uid, roomId: 'roomE2E', roomName: 'Ням гарагийн бүлэг', coachName: coachA.displayName,
      displayName: s.displayName, photoURL: null, status: 'active',
      requestedAt: admin.firestore.Timestamp.now(), decidedAt: admin.firestore.Timestamp.now(),
    });
  }

  console.log('\n=== coach creates a challenge with a live preview ===');
  const C = await newUser(browser, coachA, '/timer/challenge/rooms/roomE2E');
  const card = C.page.getByTestId('challenges-card');
  await card.waitFor();
  await card.getByRole('button', { name: 'Шинэ challenge' }).click();
  const form = C.page.getByTestId('challenge-form');
  await form.getByLabel('Төрөл').selectOption('222');
  await form.getByLabel('Хэмжүүр').selectOption('ao5');
  await form.getByLabel('Зорилтот цаг').fill('2.005');
  await form.getByLabel('Дараалан хэдэн удаа').fill('5');
  check('an invalid target shows a hint and disables "Үүсгэх"',
    await form.getByText('Зорилтот цаг буруу', { exact: false }).isVisible() && await form.getByRole('button', { name: 'Үүсгэх' }).isDisabled());
  await form.getByLabel('Зорилтот цаг').fill('2.00');
  const preview = C.page.getByTestId('challenge-preview');
  check('preview: "2x2x2 дээр Ao5 < 2.00-ийг 5 удаа дараалан"', (await preview.innerText()).trim() === '2x2x2 дээр Ao5 < 2.00-ийг 5 удаа дараалан', await preview.innerText());
  check('title placeholder shows the generated title', await form.getByLabel('Гарчиг').getAttribute('placeholder') === '2x2 Ao5 < 2.00 × 5');
  await form.getByLabel('Дараалан хэдэн удаа').fill('101');
  check('M = 101 refused in the form', await form.getByRole('button', { name: 'Үүсгэх' }).isDisabled());
  await form.getByLabel('Дараалан хэдэн удаа').fill('5');
  await form.getByLabel('Тэмдэглэл').fill('Анхаарч эвлүүлээрэй');
  check('the challenge form has no chevrons', await noChevrons(C.page));
  await C.page.screenshot({ path: path.join(OUT, 'coach-form.png'), fullPage: true });
  await form.getByRole('button', { name: 'Үүсгэх' }).click();
  await form.waitFor({ state: 'detached' });
  const [chDoc] = await challengesOf();
  const CH = chDoc.id;
  const item = C.page.getByTestId(`challenge-${CH}`);
  await item.waitFor();
  check('created: title "2x2 Ao5 < 2.00 × 5" and the sentence listed', await item.getByText('2x2 Ao5 < 2.00 × 5').isVisible() &&
    (await item.getByTestId('challenge-sentence').innerText()) === '2x2x2 дээр Ao5 < 2.00-ийг 5 удаа дараалан');
  check('stored with targetMs 2000, M 5, unlocked', chDoc.get('targetMs') === 2000 && chDoc.get('streak') === 5 && chDoc.get('locked') === false);

  console.log('\n=== assign to 2 students at once ===');
  await item.getByRole('button', { name: 'Оноох' }).click();
  const panel = item.getByTestId('assign-panel');
  await panel.getByTestId(`assign-pick-${s1.uid}`).click();
  await panel.getByTestId(`assign-pick-${s2.uid}`).click();
  await panel.getByRole('button', { name: 'Оноох (2)' }).click();
  await item.getByTestId(`assignment-${s1.uid}`).waitFor();
  await item.getByTestId(`assignment-${s2.uid}`).waitFor();
  check('coach: both students listed as "Оноогдсон"',
    await item.getByTestId(`assignment-${s1.uid}`).getByText('Оноогдсон').isVisible() &&
    await item.getByTestId(`assignment-${s2.uid}`).getByText('Оноогдсон').isVisible());
  check('the third student is not assigned', await item.getByTestId(`assignment-${s3.uid}`).count() === 0);
  await C.page.screenshot({ path: path.join(OUT, 'coach-assigned.png'), fullPage: true });

  console.log('\n=== both students see it ===');
  const S1 = await newUser(browser, s1, null, { width: 390, height: 844 });
  const S2 = await newUser(browser, s2, null, { width: 390, height: 844 });
  const S3 = await newUser(browser, s3, null, { width: 390, height: 844 });
  for (const [label, S] of [['student 1', S1], ['student 2', S2]]) {
    const mine = S.page.getByTestId(`membership-roomE2E`).getByTestId(`my-assignment-${CH}`);
    await mine.waitFor();
    check(`${label}: under the room, the sentence, "Оноогдсон" and "Багш эхлүүлэхийг хүлээнэ үү"`,
      (await mine.getByTestId('my-assignment-sentence').innerText()) === '2x2x2 дээр Ao5 < 2.00-ийг 5 удаа дараалан' &&
      await mine.getByText('Оноогдсон').isVisible() && await mine.getByText('Багш эхлүүлэхийг хүлээнэ үү').isVisible() &&
      await mine.getByText('Анхаарч эвлүүлээрэй').isVisible());
    check(`${label}: no start button`, await mine.getByRole('button').count() === 0);
  }
  await S1.page.screenshot({ path: path.join(OUT, 'student-assigned.png'), fullPage: true });
  await S3.page.getByTestId('membership-roomE2E').waitFor();
  check('student 3 (not assigned) sees no challenge', await S3.page.getByTestId(`my-assignment-${CH}`).count() === 0);
  await S3.ctx.close();

  console.log('\n=== coach edits (before start) — students see it live ===');
  await item.getByRole('button', { name: 'Засах' }).click();
  const edit = C.page.getByTestId(`challenge-edit-${CH}`);
  check('edit form is prefilled (2.00, 5, empty auto title)',
    await edit.getByLabel('Зорилтот цаг').inputValue() === '2.00' && await edit.getByLabel('Дараалан хэдэн удаа').inputValue() === '5' &&
    await edit.getByLabel('Гарчиг').inputValue() === '');
  await edit.getByLabel('Зорилтот цаг').fill('1:05.30');
  await edit.getByLabel('Хэмжүүр').selectOption('single');
  await edit.getByLabel('Дараалан хэдэн удаа').fill('3');
  check('edit preview follows', (await edit.getByTestId('challenge-preview').innerText()).trim() === '2x2x2 дээр Single < 1:05.30-ийг 3 удаа дараалан');
  await edit.getByRole('button', { name: 'Хадгалах' }).click();
  await item.getByText('2x2 Single < 1:05.30 × 3').waitFor();
  check('coach: new generated title shown', true);
  const s1Sentence = S1.page.getByTestId(`my-assignment-${CH}`).getByTestId('my-assignment-sentence');
  await S1.page.waitForFunction((id) => document.querySelector(`[data-testid="my-assignment-${id}"] [data-testid="my-assignment-sentence"]`)?.textContent === '2x2x2 дээр Single < 1:05.30-ийг 3 удаа дараалан', CH);
  check('student 1 sees the edited challenge live', (await s1Sentence.innerText()) === '2x2x2 дээр Single < 1:05.30-ийг 3 удаа дараалан');

  console.log('\n=== unassign before start ===');
  await item.getByTestId(`assignment-${s2.uid}`).getByRole('button', { name: 'Хасах' }).click();
  await item.getByTestId(`assignment-${s2.uid}`).waitFor({ state: 'detached' });
  check('coach: student 2 unassigned', true);
  await S2.page.getByTestId(`my-assignment-${CH}`).waitFor({ state: 'detached' });
  check('student 2 no longer sees it (live)', true);
  await S2.ctx.close();

  console.log('\n=== after the first start: locked → only "Хуулбарлах" ===');
  // The phase-4 start route sets this; until then the test does.
  await db.doc(`challenges/${CH}`).update({ locked: true });
  await C.page.reload();
  await item.waitFor();
  check('locked challenge: no "Засах", no "Устгах"', await item.getByRole('button', { name: 'Засах' }).count() === 0 &&
    await item.getByRole('button', { name: 'Устгах' }).count() === 0);
  check('locked challenge: "Хуулбарлах" offered and the lock is explained', await item.getByRole('button', { name: 'Хуулбарлах' }).isVisible() &&
    await item.getByText('Эхэлсэн · түгжигдсэн').isVisible());
  await C.page.screenshot({ path: path.join(OUT, 'coach-locked.png'), fullPage: true });

  console.log('\n=== duplicate, edit the copy ===');
  await item.getByRole('button', { name: 'Хуулбарлах' }).click();
  await C.page.getByText('Хуулбар үүслээ', { exact: false }).waitFor();
  const docs = await challengesOf();
  const copy = docs.find(d => d.id !== CH);
  check('a copy exists, unlocked, linked to the original', !!copy && copy.get('locked') === false && copy.get('duplicatedFrom') === CH);
  const copyEdit = C.page.getByTestId(`challenge-edit-${copy.id}`);
  await copyEdit.waitFor();
  check('the copy opens in the edit form with the same template',
    await copyEdit.getByLabel('Зорилтот цаг').inputValue() === '1:05.30' && await copyEdit.getByLabel('Дараалан хэдэн удаа').inputValue() === '3');
  await copyEdit.getByLabel('Дараалан хэдэн удаа').fill('10');
  await copyEdit.getByLabel('Гарчиг').fill('Хурдны сорил');
  await copyEdit.getByRole('button', { name: 'Хадгалах' }).click();
  const copyItem = C.page.getByTestId(`challenge-${copy.id}`);
  await copyItem.getByText('Хурдны сорил').waitFor();
  check('copy saved with its own title and M 10', (await copyItem.getByTestId('challenge-sentence').innerText()) === '2x2x2 дээр Single < 1:05.30-ийг 10 удаа дараалан');
  check('the original is unchanged', (await item.getByTestId('challenge-sentence').innerText()) === '2x2x2 дээр Single < 1:05.30-ийг 3 удаа дараалан');

  console.log('\n=== delete (never started) ===');
  await copyItem.getByRole('button', { name: 'Устгах' }).click();
  await copyItem.getByRole('button', { name: 'Тийм, устгах' }).click();
  await copyItem.waitFor({ state: 'detached' });
  check('the copy is deleted', !(await db.doc(`challenges/${copy.id}`).get()).exists);
  check('the locked original remains', (await db.doc(`challenges/${CH}`).get()).exists && await item.isVisible());
  check('student 1 still sees the original', await S1.page.getByTestId(`my-assignment-${CH}`).isVisible());
  check('coach room page labels say "Багш", not "Coach"', await C.page.evaluate(() => !/Coach(:|-ийн| баталгаа)/.test(document.body.innerText)));
  await C.page.screenshot({ path: path.join(OUT, 'coach-final.png'), fullPage: true });
  await S1.page.screenshot({ path: path.join(OUT, 'student-final.png'), fullPage: true });
} catch (e) {
  fail++;
  console.error('E2E ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
} finally {
  await browser?.close();
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
  restoreConfigs();
}
console.log(`\n  ${pass} passed, ${fail} failed   (screenshots: ${OUT})\n`);
process.exit(fail === 0 ? 0 : 1);
