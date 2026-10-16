// End-to-end test of the coach-room server routes (app/api/rooms/*:
// create, rename, regenerate-code, join, member) against the LOCAL
// Firestore + Auth emulators — never production. Same harness as
// judge-routes.test.mjs: it starts the built app (`next start`) with a
// throwaway service-account key and drives the routes over HTTP.
// Run via `npm run test:routes` (builds first, wraps emulators:exec).
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';

const ROOT = process.cwd();
const PORT = 3997;
const BASE = `http://127.0.0.1:${PORT}`;
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
};

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const isCode = (c) => typeof c === 'string' && c.length === 6 && [...c].every(ch => ALPHABET.includes(ch));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}
async function post(route, body, token) {
  const res = await fetch(`${BASE}/api/rooms/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function authPost(method, body) {
  const res = await fetch(`${AUTH}/accounts:${method}?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
const signUp = (email) => authPost('signUp', { email, password: 'password123', returnSecureToken: true });
const member = (roomId, uid) => db.doc(`rooms/${roomId}/members/${uid}`).get();

let serverLog = '';
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${BASE}/api/rooms/join`, { method: 'POST', body: '{}' }); return; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('server did not start:\n' + serverLog);
}

try {
  await waitForServer();

  // ── seed ──
  const adminU = await signUp('rooms-admin@example.com');
  const coachU = await signUp('rooms-coach@example.com');
  const coach2U = await signUp('rooms-coach2@example.com');
  const revokedU = await signUp('rooms-revoked@example.com');
  const studentU = await signUp('rooms-student@example.com');
  const student2U = await signUp('rooms-student2@example.com');
  const noDocU = await signUp('rooms-nodoc@example.com');
  const users = [[adminU, 'admin', 'Admin'], [coachU, 'member', 'Coach One'], [coach2U, 'athlete', 'Coach Two'],
    [revokedU, 'member', 'Revoked'], [studentU, 'member', 'Student One'], [student2U, 'member', 'Student Two']];
  for (const [u, role, name] of users) {
    await db.doc(`users/${u.localId}`).set({ uid: u.localId, role, displayName: name, photoURL: name === 'Student One' ? 'https://example.com/s1.png' : null });
  }
  await db.doc(`coaches/${coachU.localId}`).set({ uid: coachU.localId, active: true });
  await db.doc(`coaches/${coach2U.localId}`).set({ uid: coach2U.localId, active: true });
  await db.doc(`coaches/${revokedU.localId}`).set({ uid: revokedU.localId, active: false });
  const COACH = coachU.idToken, COACH2 = coach2U.idToken, ADMIN = adminU.idToken;
  const STUDENT = studentU.idToken, STUDENT2 = student2U.idToken;

  console.log('\n=== auth on every route ===');
  for (const r of ['create', 'rename', 'regenerate-code', 'join', 'member']) {
    check(`${r}: no token → 401`, (await post(r, {})).status === 401);
    check(`${r}: garbage token → 401`, (await post(r, {}, 'abc.def.ghi')).status === 401);
  }
  check('bad JSON body → 400', (await post('join', 'not json', STUDENT)).status === 400);
  // A judge PIN session (custom token, role: judge) is not a club account.
  const judgeCustom = await admin.auth().createCustomToken('judge-rooms', { role: 'judge', competitionId: 'c1' });
  const judgeId = (await authPost('signInWithCustomToken', { token: judgeCustom, returnSecureToken: true })).idToken;
  check('a judge session is refused → 403', (await post('join', { code: 'ABCDEF' }, judgeId)).status === 403);

  console.log('\n=== create ===');
  check('a non-coach cannot create a room → 403', (await post('create', { name: 'Mine' }, STUDENT)).status === 403);
  check('a revoked coach cannot create a room → 403', (await post('create', { name: 'Mine' }, revokedU.idToken)).status === 403);
  check('an account with no users doc → 403', (await post('create', { name: 'Mine' }, noDocU.idToken)).status === 403);
  check('empty name → 400', (await post('create', { name: '   ' }, COACH)).status === 400);
  check('name over 40 chars → 400', (await post('create', { name: 'x'.repeat(41) }, COACH)).status === 400);
  const c1 = await post('create', { name: '  Даваа   гарагийн бүлэг ' }, COACH);
  const room1 = c1.body.roomId;
  check('coach creates a room with a 6-char code from the safe alphabet', c1.status === 200 && isCode(c1.body.code), c1);
  const r1doc = (await db.doc(`rooms/${room1}`).get()).data();
  check('room stored: trimmed name, owner, code, not archived', r1doc.name === 'Даваа гарагийн бүлэг' && r1doc.coachUid === coachU.localId && r1doc.code === c1.body.code && r1doc.archived === false && r1doc.coachName === 'Coach One', r1doc);
  const code1doc = (await db.doc(`roomCodes/${c1.body.code}`).get()).data();
  check('roomCodes maps the code to the room', code1doc?.roomId === room1, code1doc);
  const cAdmin = await post('create', { name: 'Admin room' }, ADMIN);
  check('an admin is a coach automatically (no coaches doc) → 200', cAdmin.status === 200 && isCode(cAdmin.body.code), cAdmin);
  const c2 = await post('create', { name: 'Coach Two room' }, COACH2);
  const room2 = c2.body.roomId;
  check('a second coach creates their own room', c2.status === 200, c2);
  const codes = new Set();
  for (let i = 0; i < 12; i++) codes.add((await post('create', { name: `Bulk ${i}` }, COACH)).body.code);
  check('12 more rooms get 12 distinct valid codes', codes.size === 12 && [...codes].every(isCode), [...codes]);

  console.log('\n=== rename ===');
  check('another coach cannot rename → 403', (await post('rename', { roomId: room1, name: 'Hijack' }, COACH2)).status === 403);
  check('a student cannot rename → 403', (await post('rename', { roomId: room1, name: 'Hijack' }, STUDENT)).status === 403);
  check('unknown room → 404', (await post('rename', { roomId: 'nope', name: 'X' }, COACH)).status === 404);
  check('bad room id → 400', (await post('rename', { roomId: '../x', name: 'X' }, COACH)).status === 400);

  console.log('\n=== join ===');
  check('bad code format → 400', (await post('join', { code: 'O0I1L!' }, STUDENT)).status === 400);
  check('unknown code → 404', (await post('join', { code: 'ZZZZZZ' }, STUDENT)).status === 404);
  check('coach cannot join their own room → 400', (await post('join', { code: c1.body.code }, COACH)).status === 400);
  const lower = c1.body.code.toLowerCase().replace(/^(...)/, '$1-');
  const j1 = await post('join', { code: lower }, STUDENT);
  check('student joins (lower-case, dashed code accepted) → pending', j1.status === 200 && j1.body.status === 'pending' && j1.body.roomId === room1, j1);
  const m1 = (await member(room1, studentU.localId)).data();
  check('membership: pending, name + photo from the users doc, room name copied', m1.status === 'pending' && m1.displayName === 'Student One' && m1.photoURL === 'https://example.com/s1.png' && m1.roomName === 'Даваа гарагийн бүлэг' && m1.uid === studentU.localId, m1);
  const j1b = await post('join', { code: c1.body.code }, STUDENT);
  check('joining again while pending stays pending (idempotent)', j1b.status === 200 && j1b.body.status === 'pending', j1b);
  const jc2 = await post('join', { code: c1.body.code }, COACH2);
  check('a coach can be a student in another coach\'s room', jc2.status === 200 && jc2.body.status === 'pending', jc2);
  check('student can be in several rooms (joins room 2 too)', (await post('join', { code: c2.body.code }, STUDENT)).body.status === 'pending');
  check('student2 joins room 1', (await post('join', { code: c1.body.code }, STUDENT2)).body.status === 'pending');

  console.log('\n=== approve / reject ===');
  const act = (token, roomId, uid, action) => post('member', { roomId, uid, action }, token);
  check('a student cannot approve themselves → 403', (await act(STUDENT, room1, studentU.localId, 'approve')).status === 403);
  check('another coach cannot approve → 403', (await act(COACH2, room1, studentU.localId, 'approve')).status === 403);
  check('bad action → 400', (await act(COACH, room1, studentU.localId, 'promote')).status === 400);
  check('unknown member → 404', (await act(COACH, room1, 'nobody', 'approve')).status === 404);
  const ap = await act(COACH, room1, studentU.localId, 'approve');
  check('coach approves → active', ap.status === 200 && ap.body.status === 'active' && (await member(room1, studentU.localId)).get('status') === 'active', ap);
  check('approving an active member again → 409', (await act(COACH, room1, studentU.localId, 'approve')).status === 409);
  check('rejecting an active member → 409 (use remove)', (await act(COACH, room1, studentU.localId, 'reject')).status === 409);
  const jActive = await post('join', { code: c1.body.code }, STUDENT);
  check('joining again while active stays active', jActive.body.status === 'active', jActive);
  const rj = await act(COACH, room1, student2U.localId, 'reject');
  check('coach rejects a pending request → request deleted', rj.status === 200 && rj.body.status === 'deleted' && !(await member(room1, student2U.localId)).exists, rj);
  check('a rejected student may ask again → pending', (await post('join', { code: c1.body.code }, STUDENT2)).body.status === 'pending');
  check('coach2 approves student in room 2 (independent rooms)', (await act(COACH2, room2, studentU.localId, 'approve')).body.status === 'active');

  console.log('\n=== remove / re-add ===');
  check('a student cannot remove another → 403', (await act(STUDENT, room1, student2U.localId, 'remove')).status === 403);
  check('removing a pending request → 409 (reject it instead)', (await act(COACH, room1, student2U.localId, 'remove')).status === 409);
  const before = (await member(room1, studentU.localId)).data();
  const rm = await act(COACH, room1, studentU.localId, 'remove');
  const afterRm = await member(room1, studentU.localId);
  check('coach removes → marked removed, NOT deleted', rm.status === 200 && rm.body.status === 'removed' && afterRm.exists && afterRm.get('status') === 'removed', rm);
  check('removed membership keeps its original request data (history kept)', afterRm.get('displayName') === before.displayName && afterRm.get('roomName') === before.roomName);
  check('removing again → 409', (await act(COACH, room1, studentU.localId, 'remove')).status === 409);
  check('room 2 membership untouched by removal from room 1', (await member(room2, studentU.localId)).get('status') === 'active');
  const rejoin = await post('join', { code: c1.body.code }, STUDENT);
  check('removed student asks again → same doc back to pending', rejoin.body.status === 'pending' && (await member(room1, studentU.localId)).get('status') === 'pending', rejoin);
  check('coach approves → re-added (active)', (await act(COACH, room1, studentU.localId, 'approve')).body.status === 'active');

  console.log('\n=== regenerate code ===');
  check('another coach cannot regenerate → 403', (await post('regenerate-code', { roomId: room1 }, COACH2)).status === 403);
  check('a student cannot regenerate → 403', (await post('regenerate-code', { roomId: room1 }, STUDENT)).status === 403);
  const oldCode = c1.body.code;
  const rg = await post('regenerate-code', { roomId: room1 }, COACH);
  check('coach regenerates → new valid code, different from the old', rg.status === 200 && isCode(rg.body.code) && rg.body.code !== oldCode, rg);
  check('old roomCodes doc is gone, new one points at the room', !(await db.doc(`roomCodes/${oldCode}`).get()).exists && (await db.doc(`roomCodes/${rg.body.code}`).get()).get('roomId') === room1);
  check('room doc carries the new code', (await db.doc(`rooms/${room1}`).get()).get('code') === rg.body.code);
  const newStudent = await signUp('rooms-late@example.com');
  await db.doc(`users/${newStudent.localId}`).set({ uid: newStudent.localId, role: 'member', displayName: 'Late' });
  check('the OLD code stops working → 404', (await post('join', { code: oldCode }, newStudent.idToken)).status === 404);
  check('the NEW code works → pending', (await post('join', { code: rg.body.code }, newStudent.idToken)).body.status === 'pending');
  check('existing members keep their status after a new code', (await member(room1, studentU.localId)).get('status') === 'active');

  console.log('\n=== rename (owner) ===');
  const rn = await post('rename', { roomId: room1, name: 'Мягмар' }, COACH);
  check('owner renames', rn.status === 200 && (await db.doc(`rooms/${room1}`).get()).get('name') === 'Мягмар', rn);
  check('member copies follow the new name', (await member(room1, studentU.localId)).get('roomName') === 'Мягмар' && (await member(room1, coach2U.localId)).get('roomName') === 'Мягмар');
} catch (e) {
  fail++;
  console.error('ROOMS ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
} finally {
  server.kill();
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) console.log('--- server log ---\n' + serverLog.slice(-2000));
process.exit(fail === 0 ? 0 : 1);
