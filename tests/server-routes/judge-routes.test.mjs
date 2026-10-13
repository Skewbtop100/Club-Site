// End-to-end test of the server routes (app/api/judge/pin, app/api/judge/login,
// app/api/staged/sync) against the LOCAL Firestore + Auth emulators — never
// production. It starts the built app (`next start`) with a throwaway
// service-account key and throwaway secrets, then drives the routes over
// HTTP exactly as a browser would. Run via `npm run test:routes` (which
// builds first and wraps this in `firebase emulators:exec`).
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';

const ROOT = process.cwd();
const PORT = 3999;
const PORT_NO_KEY = 3998;
const BASE = `http://127.0.0.1:${PORT}`;
// The project id the build inlined (NEXT_PUBLIC_*), so the server and this
// script talk to the same emulator namespace.
nextEnv.loadEnvConfig(ROOT, false, { info: () => {}, error: console.error });
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Refusing to run: emulator hosts are not set.');
  process.exit(1);
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  ...process.env,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_ADMIN_CLIENT_EMAIL: `smoke@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  JUDGE_PIN_PEPPER: 'smoke-pepper',
  JUDGE_PIN_ENC_KEY: randomBytes(32).toString('base64'),
};

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}
async function post(route, body, { token, ip, base = BASE } = {}) {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function authPost(method, body) {
  const res = await fetch(`${AUTH}/accounts:${method}?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
const signUp = (email) => authPost('signUp', { email, password: 'password123', returnSecureToken: true });
const exchange = async (customToken) => (await authPost('signInWithCustomToken', { token: customToken, returnSecureToken: true })).idToken;
const claimsOf = (idToken) => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());

let serverLog = '';
function startServer(port, serverEnv) {
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], { cwd: ROOT, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { serverLog += d; });
  child.stderr.on('data', d => { serverLog += d; });
  return child;
}
const server = startServer(PORT, env);
// A second instance WITHOUT the PIN encryption key, for the "key missing" cases.
const { JUDGE_PIN_ENC_KEY: _noKey, ...envNoKey } = env;
const serverNoKey = startServer(PORT_NO_KEY, envNoKey);
const NO_KEY = `http://127.0.0.1:${PORT_NO_KEY}`;

async function waitForServer() {
  for (const base of [BASE, NO_KEY]) {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { await fetch(base + '/api/judge/login', { method: 'POST', body: '{}' }); up = true; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!up) throw new Error('server did not start:\n' + serverLog);
  }
}

const row = (n, extra = {}) => ({ id: `333_r1_row${n}`, name: `Imported ${n}`, solves: [700, 710, 720, 730, 740], single: 700, average: 720, order: n, ...extra });

try {
  await waitForServer();

  // ── seed ──
  const adminUser = await signUp('admin@example.com');
  const memberUser = await signUp('member@example.com');
  await db.doc(`users/${adminUser.localId}`).set({ role: 'admin' });
  await db.doc(`users/${memberUser.localId}`).set({ role: 'member' });
  const comp = (status) => ({ name: 'Club Open', status, events: { '333': true, '222': true }, eventConfig: { '333': { rounds: 1, groups: 1 }, '222': { rounds: 1, groups: 1 } }, athletes: [{ id: 'c1', name: 'C1', events: ['333', '222'] }, { id: 'c2', name: 'C2', events: ['333', '222'] }] });
  await db.doc('competitions/comp1').set(comp('live'));
  await db.doc('competitions/comp2').set(comp('live'));
  await db.doc('competitions/compUp').set(comp('upcoming'));
  await db.doc('competitions/comp1/private/importedResults_333').set({ kind: 'importedResults', eventId: '333', rounds: { '1': [0, 1, 2, 3].map(n => row(n)) } });
  await db.doc('competitions/comp1/private/importedResults_222').set({ kind: 'importedResults', eventId: '222', rounds: { '1': [0, 1, 2, 3].map(n => row(n, { id: `222_r1_row${n}` })) } });
  const impCount = async (ev) => (await db.collection('results').where('competitionId', '==', 'comp1').where('eventId', '==', ev).where('source', '==', 'imported').get()).size;

  console.log('\n=== /api/judge/pin ===');
  check('no token → 401', (await post('/api/judge/pin', { competitionId: 'comp1', action: 'generate' })).status === 401);
  check('non-admin account → 403', (await post('/api/judge/pin', { competitionId: 'comp1', action: 'generate' }, { token: memberUser.idToken })).status === 403);
  check('garbage token → 401', (await post('/api/judge/pin', { competitionId: 'comp1', action: 'generate' }, { token: 'abc.def.ghi' })).status === 401);
  check('bad action → 400', (await post('/api/judge/pin', { competitionId: 'comp1', action: 'peek' }, { token: adminUser.idToken })).status === 400);
  check('unknown competition → 404', (await post('/api/judge/pin', { competitionId: 'nope', action: 'generate' }, { token: adminUser.idToken })).status === 404);
  const gen = await post('/api/judge/pin', { competitionId: 'comp1', action: 'generate' }, { token: adminUser.idToken });
  const PIN = gen.body.pin;
  check('admin generates a 6-digit PIN', gen.status === 200 && /^\d{6}$/.test(PIN || ''), gen);
  const stored = (await db.doc('competitions/comp1/private/judgeAccess').get()).data();
  check('only a hash is stored (no PIN anywhere in the document)', stored.enabled === true && /^[0-9a-f]{64}$/.test(stored.pinHash) && !JSON.stringify(stored).includes(PIN), Object.keys(stored));
  const wrong = PIN === '000000' ? '000001' : '000000';

  console.log('\n=== /api/judge/pin — reveal ===');
  const reveal = (opts, base) => post('/api/judge/pin', { competitionId: 'comp1', action: 'reveal' }, { ...opts, base });
  check('encrypted copy stored next to the hash, PIN not readable from it', typeof stored.pinEnc === 'string' && stored.pinEnc.startsWith('v1.') && !stored.pinEnc.includes(PIN)
    && !Buffer.from(stored.pinEnc.split('.')[3], 'base64').toString('utf8').includes(PIN) && gen.body.canReveal === true, stored.pinEnc);
  const shown = await reveal({ token: adminUser.idToken });
  check('admin reveal returns the active PIN', shown.status === 200 && shown.body.pin === PIN, shown);
  const noTok = await reveal({});
  check('reveal with no token → 401, no PIN', noTok.status === 401 && !('pin' in noTok.body), noTok);
  const asMember = await reveal({ token: memberUser.idToken });
  check('reveal as an ordinary account → 403, no PIN', asMember.status === 403 && !('pin' in asMember.body), asMember);
  check('reveal with a garbage token → 401', (await reveal({ token: 'abc.def.ghi' })).status === 401);
  check('reveal for an unknown competition → 404', (await post('/api/judge/pin', { competitionId: 'nope', action: 'reveal' }, { token: adminUser.idToken })).status === 404);
  const none2 = await post('/api/judge/pin', { competitionId: 'comp2', action: 'reveal' }, { token: adminUser.idToken });
  check('reveal for a competition with no PIN → 409 disabled', none2.status === 409 && none2.body.reason === 'disabled' && !('pin' in none2.body), none2);
  // The same record, read by a server that has no key.
  const keyless = await reveal({ token: adminUser.idToken }, NO_KEY);
  check('server without JUDGE_PIN_ENC_KEY cannot reveal → 409 no-key', keyless.status === 409 && keyless.body.reason === 'no-key' && !('pin' in keyless.body), keyless);
  // A ciphertext copied from another competition's document must not decrypt.
  await db.doc('competitions/comp2/private/judgeAccess').set({ ...stored });
  const moved = await post('/api/judge/pin', { competitionId: 'comp2', action: 'reveal' }, { token: adminUser.idToken });
  check('a ciphertext copied onto another competition does not decrypt → 409', moved.status === 409 && moved.body.reason === 'undecryptable' && !('pin' in moved.body), moved);
  await db.doc('competitions/comp2/private/judgeAccess').delete();
  // A PIN from before the encrypted copy existed: hash only.
  const { pinEnc: _enc, ...legacy } = stored;
  await db.doc('competitions/comp1/private/judgeAccess').set(legacy);
  const old = await reveal({ token: adminUser.idToken });
  check('legacy PIN (hash only) → 409 legacy, no PIN', old.status === 409 && old.body.reason === 'legacy' && !('pin' in old.body), old);
  await db.doc('competitions/comp1/private/judgeAccess').set(stored);

  console.log('\n=== /api/judge/login ===');
  check('malformed PIN → 400 (not counted)', (await post('/api/judge/login', { competitionId: 'comp1', pin: '12' }, { ip: '10.0.0.1' })).status === 400);
  const w1 = await post('/api/judge/login', { competitionId: 'comp1', pin: wrong }, { ip: '10.0.0.1' });
  check('wrong PIN → 401 invalid', w1.status === 401 && w1.body.error === 'invalid' && !w1.body.token, w1);
  check('PIN for a competition that has none → same 401', (await post('/api/judge/login', { competitionId: 'comp2', pin: PIN }, { ip: '10.0.0.2' })).status === 401);
  await db.doc('competitions/compUp/private/judgeAccess').set(stored);
  check('right PIN but the competition is not live → 401', (await post('/api/judge/login', { competitionId: 'compUp', pin: PIN }, { ip: '10.0.0.3' })).status === 401);
  const ok = await post('/api/judge/login', { competitionId: 'comp1', pin: PIN }, { ip: '10.0.0.1' });
  check('right PIN → custom token', ok.status === 200 && typeof ok.body.token === 'string', ok);
  const judgeToken = await exchange(ok.body.token);
  const claims = claimsOf(judgeToken);
  check('token claims: judge of comp1 only, current PIN version, ~24 h', claims.role === 'judge' && claims.competitionId === 'comp1' && claims.pinVersion === stored.version
    && Math.abs(claims.validUntil - Date.now() - 24 * 3600 * 1000) < 60000 && !('admin' in claims), claims);
  const asJudge = await reveal({ token: judgeToken });
  check('a JUDGE token cannot reveal the PIN → 403, no PIN', asJudge.status === 403 && !('pin' in asJudge.body), asJudge);
  check('...nor generate or disable one', (await post('/api/judge/pin', { competitionId: 'comp1', action: 'generate' }, { token: judgeToken })).status === 403
    && (await post('/api/judge/pin', { competitionId: 'comp1', action: 'disable' }, { token: judgeToken })).status === 403);
  check('...and the active PIN is unchanged by those attempts', (await reveal({ token: adminUser.idToken })).body.pin === PIN);
  check('a successful login cleared that client\'s failure count', !(await db.doc('judgeLoginAttempts/comp1_all').get()).data()?.lockedUntil);

  // per-client lock: 5 wrong tries from one address
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push(await post('/api/judge/login', { competitionId: 'comp1', pin: wrong }, { ip: '10.0.1.1' }));
  check('5th wrong try from one client reports the lock', tries.slice(0, 4).every(t => t.status === 401 && t.body.retryAfterMs === 0) && tries[4].body.retryAfterMs > 14 * 60000, tries.map(t => t.body));
  const lockedRight = await post('/api/judge/login', { competitionId: 'comp1', pin: PIN }, { ip: '10.0.1.1' });
  check('locked client: even the RIGHT PIN is refused (429)', lockedRight.status === 429 && lockedRight.body.error === 'locked' && !lockedRight.body.token, lockedRight);
  check('another client is not affected by that lock', (await post('/api/judge/login', { competitionId: 'comp1', pin: PIN }, { ip: '10.0.1.2' })).status === 200);
  check('the lock is per competition: same client, other competition is judged on its own', (await post('/api/judge/login', { competitionId: 'comp2', pin: wrong }, { ip: '10.0.1.1' })).status === 401);

  // per-competition cap: wrong tries spread over many addresses
  const before = ((await db.doc('judgeLoginAttempts/comp1_all').get()).data()?.failures || []).length;
  let last;
  for (let i = before; i < 30; i++) last = await post('/api/judge/login', { competitionId: 'comp1', pin: wrong }, { ip: `10.1.${i}.1` });
  check(`30 wrong tries in total (from ${30 - before} more addresses, 1 each) lock the competition`, last.body.retryAfterMs > 14 * 60000, { before, last: last.body });
  const fresh = await post('/api/judge/login', { competitionId: 'comp1', pin: PIN }, { ip: '10.9.9.9' });
  check('competition locked: a brand-new client with the RIGHT PIN is refused (429)', fresh.status === 429, fresh);

  console.log('\n=== /api/staged/sync ===');
  check('no token → 401', (await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' })).status === 401);
  check('ordinary account → 403', (await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: memberUser.idToken })).status === 403);
  check('judge of comp1 asking for comp2 → 403', (await post('/api/staged/sync', { competitionId: 'comp2', eventId: '333' }, { token: judgeToken })).status === 403);
  check('bad event id → 400', (await post('/api/staged/sync', { competitionId: 'comp1', eventId: '../x' }, { token: judgeToken })).status === 400);
  const s0 = await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: judgeToken });
  check('judge sync with no club result yet → ok, nothing revealed', s0.status === 200 && (await impCount('333')) === 0, s0);
  check('judge response carries no detail about the import', JSON.stringify(s0.body) === '{"ok":true}', s0.body);
  await db.doc('results/comp1_333_r1_c1').set({ competitionId: 'comp1', eventId: '333', round: 1, athleteId: 'c1', single: 800, average: 850, status: 'published', source: 'entry' });
  await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: judgeToken });
  check('after 1 of 2 club athletes: half revealed (2 of 4), in stored order', (await impCount('333')) === 2
    && (await db.doc('results/impst_comp1_333_r1_row0').get()).exists && (await db.doc('results/impst_comp1_333_r1_row1').get()).exists);
  await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: judgeToken });
  check('calling again changes nothing (idempotent)', (await impCount('333')) === 2);
  const flags = (await db.doc('competitions/comp1/private/importedResults_333').get()).data().rounds['1'];
  check('revealed flags recorded on the staged rows', flags.filter(r => r.revealed).length === 2, flags.map(r => !!r.revealed));
  const revealed = (await db.doc('results/impst_comp1_333_r1_row0').get()).data();
  check('revealed row is an ordinary imported result', revealed.source === 'imported' && revealed.status === 'published' && revealed.athleteId === '' && revealed.importRowId === '333_r1_row0' && revealed.competitionName === 'Club Open', revealed);

  await post('/api/staged/sync', { competitionId: 'comp1', eventId: '222', forceRounds: [1] }, { token: judgeToken });
  check('a judge cannot force "reveal all" (forceRounds ignored)', (await impCount('222')) === 0);
  const forced = await post('/api/staged/sync', { competitionId: 'comp1', eventId: '222', forceRounds: [1] }, { token: adminUser.idToken });
  check('an admin can', forced.status === 200 && forced.body.revealed === 4 && (await impCount('222')) === 4, forced);
  const none = await post('/api/staged/sync', { competitionId: 'comp2', eventId: '333' }, { token: adminUser.idToken });
  check('event with no staged import → staged:false, nothing written', none.status === 200 && none.body.staged === false && none.body.revealed === 0, none);

  console.log('\n=== revocation ===');
  const regen = await post('/api/judge/pin', { competitionId: 'comp1', action: 'generate' }, { token: adminUser.idToken });
  const PIN2 = regen.body.pin;
  check('regenerate returns a new PIN and lifts the competition lock', regen.status === 200 && /^\d{6}$/.test(PIN2));
  check('reveal now returns the NEW PIN', (await reveal({ token: adminUser.idToken })).body.pin === PIN2);
  check('the old judge session is refused by the server at once', (await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: judgeToken })).status === 403);
  if (PIN2 !== PIN) check('the old PIN no longer signs in', (await post('/api/judge/login', { competitionId: 'comp1', pin: PIN }, { ip: '10.5.0.1' })).status === 401);
  const ok2 = await post('/api/judge/login', { competitionId: 'comp1', pin: PIN2 }, { ip: '10.5.0.2' });
  check('the new PIN signs in', ok2.status === 200);
  const judge2 = await exchange(ok2.body.token);
  check('...and that session works', (await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: judge2 })).status === 200);
  check('admin disables judge access', (await post('/api/judge/pin', { competitionId: 'comp1', action: 'disable' }, { token: adminUser.idToken })).body.enabled === false);
  check('disabled: the session is refused', (await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: judge2 })).status === 403);
  check('disabled: the PIN no longer signs in', (await post('/api/judge/login', { competitionId: 'comp1', pin: PIN2 }, { ip: '10.5.0.3' })).status === 401);
  const afterDisable = (await db.doc('competitions/comp1/private/judgeAccess').get()).data();
  check('disabled: the hash and the encrypted copy are gone from the document', !('pinHash' in afterDisable) && !('salt' in afterDisable) && !('pinEnc' in afterDisable), Object.keys(afterDisable));
  const offReveal = await reveal({ token: adminUser.idToken });
  check('disabled: nothing to reveal → 409 disabled', offReveal.status === 409 && offReveal.body.reason === 'disabled' && !('pin' in offReveal.body), offReveal);

  console.log('\n=== server without JUDGE_PIN_ENC_KEY ===');
  const genNoKey = await post('/api/judge/pin', { competitionId: 'comp2', action: 'generate' }, { token: adminUser.idToken, base: NO_KEY });
  check('PIN generation still works, and says it cannot be shown again', genNoKey.status === 200 && /^\d{6}$/.test(genNoKey.body.pin || '') && genNoKey.body.canReveal === false, genNoKey);
  const storedNoKey = (await db.doc('competitions/comp2/private/judgeAccess').get()).data();
  check('hash only: no encrypted copy, and the document records why', /^[0-9a-f]{64}$/.test(storedNoKey.pinHash) && !('pinEnc' in storedNoKey) && storedNoKey.pinEncKeyMissing === true, Object.keys(storedNoKey));
  check('that PIN signs a judge in normally', (await post('/api/judge/login', { competitionId: 'comp2', pin: genNoKey.body.pin }, { ip: '10.7.0.1', base: NO_KEY })).status === 200);
  const rNoKey = await post('/api/judge/pin', { competitionId: 'comp2', action: 'reveal' }, { token: adminUser.idToken, base: NO_KEY });
  check('reveal → 409 no-key, no PIN', rNoKey.status === 409 && rNoKey.body.reason === 'no-key' && !('pin' in rNoKey.body), rNoKey);
  const rLater = await post('/api/judge/pin', { competitionId: 'comp2', action: 'reveal' }, { token: adminUser.idToken });
  check('adding the key later does not make that PIN revealable (still no-key) — regenerate to get one that is', rLater.status === 409 && rLater.body.reason === 'no-key', rLater);

  const g3 = await post('/api/judge/pin', { competitionId: 'comp1', action: 'generate' }, { token: adminUser.idToken });
  const j3 = await exchange((await post('/api/judge/login', { competitionId: 'comp1', pin: g3.body.pin }, { ip: '10.6.0.1' })).body.token);
  await db.doc('competitions/comp1').update({ status: 'finished' });
  check('competition finished: the session is refused', (await post('/api/staged/sync', { competitionId: 'comp1', eventId: '333' }, { token: j3 })).status === 403);
  check('competition finished: the PIN no longer signs in', (await post('/api/judge/login', { competitionId: 'comp1', pin: g3.body.pin }, { ip: '10.6.0.2' })).status === 401);
} catch (e) {
  fail++;
  console.error('SMOKE ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
} finally {
  server.kill();
  serverNoKey.kill();
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) console.log('--- server log ---\n' + serverLog.slice(-2000));
process.exit(fail === 0 ? 0 : 1);
