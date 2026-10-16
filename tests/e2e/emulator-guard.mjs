// Proves the test-only emulator login (lib/firebase.ts EMULATOR_MODE) is
// impossible in a production build, even when someone sets the flag.
//
//   npm run test:emulator-guard
//
// 1. `next build` with NEXT_PUBLIC_FIREBASE_EMULATORS=1 into .next-guard/
//    (NEXT_DIST_DIR, so the real .next build is untouched).
// 2. Static: no browser chunk contains the emulator hosts or the test hook.
//    Sanity first: those exact strings DO exist in lib/firebase.ts, so the
//    search is looking for the right thing.
// 3. Runtime: `next start` on that build; the page has no window.__pvTestAuth
//    and makes no request to an emulator port (9099 / 8080 / 9000).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const DIST = '.next-guard';
const PORT = 3994;
const BASE = `http://localhost:${PORT}`;
const MARKERS = ['__pvTestAuth', '__pvEmulatorsConnected', '127.0.0.1:9099'];

// next build / next dev rewrite these two files (types path, include list);
// snapshot them and put them back so a test run leaves the tree clean.
const RESTORE = ["tsconfig.json", "next-env.d.ts"].map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]);
const restoreConfigs = () => { for (const [f, text] of RESTORE) fs.writeFileSync(path.join(ROOT, f), text); };

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}

const env = { ...process.env, NEXT_DIST_DIR: DIST, NEXT_PUBLIC_FIREBASE_EMULATORS: '1' };
delete env.NODE_ENV; // let `next build` / `next start` set production themselves

console.log('\n=== sanity: the markers exist in the source ===');
const src = fs.readFileSync(path.join(ROOT, 'lib/firebase.ts'), 'utf8');
for (const m of MARKERS) check(`lib/firebase.ts contains "${m}"`, src.includes(m));

console.log('\n=== production build WITH NEXT_PUBLIC_FIREBASE_EMULATORS=1 ===');
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'build'], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
check('next build succeeds', build.status === 0, (build.stdout + build.stderr).slice(-1500));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const clientChunks = walk(path.join(ROOT, DIST, 'static'));
check('found client chunks to scan', clientChunks.length > 20, clientChunks.length);
const hits = [];
for (const f of clientChunks) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of MARKERS) if (text.includes(m)) hits.push(`${path.relative(ROOT, f)}: ${m}`);
}
check('no client chunk contains the emulator hosts or the test hook', hits.length === 0, hits);

console.log('\n=== runtime: next start on that build ===');
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
let browser;
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`${BASE}/timer/challenge`)).status === 200; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  check('production server is up', up, log.slice(-800));
  browser = await chromium.launch();
  const page = await browser.newPage();
  const emulatorRequests = [];
  page.on('request', (r) => { if (/:(9099|8080|9000)\//.test(r.url())) emulatorRequests.push(r.url()); });
  for (const route of ['/timer/challenge', '/timer']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    check(`${route}: window.__pvTestAuth does not exist`, await page.evaluate(() => typeof window.__pvTestAuth === 'undefined'));
  }
  check('no request went to an emulator port', emulatorRequests.length === 0, emulatorRequests.slice(0, 5));
} catch (e) {
  fail++;
  console.error('GUARD ERROR', e, '\n' + log.slice(-1500));
} finally {
  await browser?.close();
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
  restoreConfigs();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
