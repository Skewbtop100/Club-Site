// End-to-end test of the challenge creation / assignment routes
// (app/api/challenge/{create,update,delete,duplicate,assign,unassign},
// docs/challenge-plan.md phase 3) against the LOCAL Firestore + Auth
// emulators — never production. Same harness as rooms-routes.test.mjs:
// `next start` on the built app with a throwaway service-account key.
// Run via `npm run test:routes` (builds first, wraps emulators:exec).
//
// The edit lock (decision 9) is set by the phase-4 start route, which does
// not exist yet; here the test sets `locked: true` / a started assignment
// with the Admin SDK and proves the routes then refuse edit and delete.
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';

const ROOT = process.cwd();
const PORT = 3995;
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

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}
async function post(route, body, token) {
  const res = await fetch(`${BASE}/api/${route}`, {
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
const ch = (id) => db.doc(`challenges/${id}`).get();
const asg = (cid, uid) => db.doc(`challengeAssignments/${cid}_${uid}`).get();

let serverLog = '';
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${BASE}/api/challenge/create`, { method: 'POST', body: '{}' }); return; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('server did not start:\n' + serverLog);
}

const T = { event: '222', metric: 'ao5', targetMs: 2000, streak: 5 };

try {
  await waitForServer();

  // ── seed: coach1 owns room1 (3 active students, 1 pending, 1 removed);
  //    coach2 owns room2; admin owns roomA ──
  const [adminU, coachU, coach2U, s1U, s2U, s3U, pendU, remU, strangerU] = await Promise.all([
    'adm', 'coach', 'coach2', 's1', 's2', 's3', 'pend', 'rem', 'stranger',
  ].map(n => signUp(`ch-${n}@example.com`)));
  const names = new Map([[s1U, 'Student One'], [s2U, 'Student Two'], [s3U, 'Student Three'], [pendU, 'Pending'], [remU, 'Removed']]);
  for (const [u, role] of [[adminU, 'admin'], [coachU, 'member'], [coach2U, 'member'], [s1U, 'member'], [s2U, 'member'],
    [s3U, 'member'], [pendU, 'member'], [remU, 'member'], [strangerU, 'member']]) {
    await db.doc(`users/${u.localId}`).set({ uid: u.localId, role, displayName: names.get(u) ?? 'X' });
  }
  await db.doc(`coaches/${coachU.localId}`).set({ uid: coachU.localId, active: true });
  await db.doc(`coaches/${coach2U.localId}`).set({ uid: coach2U.localId, active: true });
  const room = (id, coachUid) => db.doc(`rooms/${id}`).set({ name: id, coachUid, coachName: 'C', code: 'ABCDEF', archived: false });
  await room('room1', coachU.localId);
  await room('room2', coach2U.localId);
  await room('roomA', adminU.localId);
  const addMember = (roomId, u, status) => db.doc(`rooms/${roomId}/members/${u.localId}`).set({
    uid: u.localId, roomId, roomName: roomId, coachName: 'C', displayName: names.get(u) ?? 'X', photoURL: null, status,
  });
  for (const u of [s1U, s2U, s3U]) await addMember('room1', u, 'active');
  await addMember('room1', pendU, 'pending');
  await addMember('room1', remU, 'removed');
  await addMember('room2', s1U, 'active');
  const COACH = coachU.idToken, COACH2 = coach2U.idToken, ADMIN = adminU.idToken, S1 = s1U.idToken;
  const s1 = s1U.localId, s2 = s2U.localId, s3 = s3U.localId;

  console.log('\n=== auth on every route ===');
  for (const r of ['create', 'update', 'delete', 'duplicate', 'assign', 'unassign']) {
    check(`${r}: no token → 401`, (await post(`challenge/${r}`, {})).status === 401);
  }
  const judgeCustom = await admin.auth().createCustomToken('judge-ch', { role: 'judge', competitionId: 'c1' });
  const judgeId = (await authPost('signInWithCustomToken', { token: judgeCustom, returnSecureToken: true })).idToken;
  check('a judge session is refused → 403', (await post('challenge/create', { roomId: 'room1', ...T }, judgeId)).status === 403);
  check('bad JSON → 400', (await post('challenge/create', 'nope', COACH)).status === 400);

  console.log('\n=== create ===');
  check('a student cannot create → 403', (await post('challenge/create', { roomId: 'room1', ...T }, S1)).status === 403);
  check('another coach cannot create in my room → 403', (await post('challenge/create', { roomId: 'room1', ...T }, COACH2)).status === 403);
  check('unknown room → 404', (await post('challenge/create', { roomId: 'nope', ...T }, COACH)).status === 404);
  for (const [label, patch, code] of [
    ['metric ao3', { metric: 'ao3' }, 'bad-metric'],
    ['M = 0', { streak: 0 }, 'bad-streak'],
    ['M = 101', { streak: 101 }, 'bad-streak'],
    ['target 2005 ms', { targetMs: 2005 }, 'bad-target'],
    ['target as text', { targetMs: '2.00' }, 'bad-target'],
    ['unknown event', { event: 'xyz' }, 'bad-event'],
    ['title > 60', { title: 'x'.repeat(61) }, 'bad-title'],
  ]) {
    const r = await post('challenge/create', { roomId: 'room1', ...T, ...patch }, COACH);
    check(`${label} → 400 ${code}`, r.status === 400 && r.body.error === code, r);
  }
  const c1 = await post('challenge/create', { roomId: 'room1', ...T, note: ' Анхаар ' }, COACH);
  const C1 = c1.body.challengeId;
  check('coach creates → generated title', c1.status === 200 && c1.body.title === '2x2 Ao5 < 2.00 × 5', c1);
  const c1doc = (await ch(C1)).data();
  check('stored: template, owner, room, unlocked, note trimmed', c1doc.coachUid === coachU.localId && c1doc.roomId === 'room1' &&
    c1doc.locked === false && c1doc.metric === 'ao5' && c1doc.targetMs === 2000 && c1doc.streak === 5 && c1doc.note === 'Анхаар' && c1doc.duplicatedFrom === null, c1doc);
  const cClient = await post('challenge/create', { roomId: 'room1', ...T, locked: true, coachUid: strangerU.localId }, COACH);
  const cClientDoc = (await ch(cClient.body.challengeId)).data();
  check('client-sent locked / coachUid are ignored', cClientDoc.locked === false && cClientDoc.coachUid === coachU.localId, cClientDoc);
  check('an admin is a coach in their own room', (await post('challenge/create', { roomId: 'roomA', ...T }, ADMIN)).status === 200);
  check('an admin cannot create in another coach\'s room → 403', (await post('challenge/create', { roomId: 'room1', ...T }, ADMIN)).status === 403);

  console.log('\n=== assign ===');
  const assign = (token, challengeId, uids) => post('challenge/assign', { challengeId, uids }, token);
  check('a student cannot assign → 403', (await assign(S1, C1, [s1])).status === 403);
  check('another coach cannot assign → 403', (await assign(COACH2, C1, [s1])).status === 403);
  check('empty list → 400', (await assign(COACH, C1, [])).status === 400);
  check('a pending member → 409, nothing written', (await assign(COACH, C1, [s1, pendU.localId])).status === 409 && !(await asg(C1, s1)).exists);
  check('a removed member → 409', (await assign(COACH, C1, [remU.localId])).status === 409);
  check('a non-member → 409', (await assign(COACH, C1, [strangerU.localId])).status === 409);
  const a1 = await assign(COACH, C1, [s1, s2, s1]);
  check('assign to 2 students at once (dupes collapsed)', a1.status === 200 && a1.body.assigned.length === 2, a1);
  const a1doc = (await asg(C1, s1)).data();
  check('assignment: ids, name, template copy, assigned, visible, zero progress', a1doc.challengeId === C1 && a1doc.studentUid === s1 &&
    a1doc.coachUid === coachU.localId && a1doc.roomId === 'room1' && a1doc.studentName === 'Student One' && a1doc.status === 'assigned' &&
    a1doc.visibleToCoach === true && a1doc.template.title === '2x2 Ao5 < 2.00 × 5' && a1doc.template.note === 'Анхаар' &&
    a1doc.sessionsCount === 0 && a1doc.bestStreak === 0 && a1doc.blocksAttempted === 0 && a1doc.firstStartedAt === null, a1doc);
  const a2 = await assign(COACH, C1, [s2, s3]);
  check('re-assign is idempotent: s2 skipped, s3 added', a2.body.assigned.join() === s3 && a2.body.skipped.join() === s2, a2);
  check('too many uids → 400', (await assign(COACH, C1, Array.from({ length: 201 }, (_, i) => `u${i}`))).status === 400);

  console.log('\n=== update (only while never started) ===');
  const upd = (token, challengeId, patch) => post('challenge/update', { challengeId, ...T, ...patch }, token);
  check('a student cannot edit → 403', (await upd(S1, C1, { targetMs: 1500 })).status === 403);
  check('another coach cannot edit → 403', (await upd(COACH2, C1, { targetMs: 1500 })).status === 403);
  check('invalid edit → 400', (await upd(COACH, C1, { streak: 0 })).status === 400);
  const u1 = await upd(COACH, C1, { targetMs: 1500, title: 'Хурд' });
  check('coach edits an unstarted challenge', u1.status === 200 && (await ch(C1)).get('targetMs') === 1500, u1);
  check('the template copy in every assignment follows', (await asg(C1, s1)).get('template.targetMs') === 1500 &&
    (await asg(C1, s3)).get('template.title') === 'Хурд');

  console.log('\n=== unassign ===');
  check('a student cannot unassign → 403', (await post('challenge/unassign', { challengeId: C1, uid: s3 }, S1)).status === 403);
  check('unknown assignment → 404', (await post('challenge/unassign', { challengeId: C1, uid: strangerU.localId }, COACH)).status === 404);
  const un = await post('challenge/unassign', { challengeId: C1, uid: s3 }, COACH);
  check('coach unassigns before start → deleted', un.status === 200 && !(await asg(C1, s3)).exists, un);

  console.log('\n=== lock after the first start (decision 9) ===');
  // What the phase-4 start route will do: lock the challenge and mark s1's
  // assignment started.
  await db.doc(`challenges/${C1}`).update({ locked: true });
  await db.doc(`challengeAssignments/${C1}_${s1}`).update({ status: 'in-progress', firstStartedAt: admin.firestore.Timestamp.now(), sessionsCount: 1 });
  const lockedEdit = await upd(COACH, C1, { targetMs: 9990 });
  check('edit after start → 409 locked', lockedEdit.status === 409 && lockedEdit.body.error === 'locked', lockedEdit);
  check('nothing changed on the challenge or the copies', (await ch(C1)).get('targetMs') === 1500 && (await asg(C1, s2)).get('template.targetMs') === 1500);
  check('even a client-sent locked:false does not unlock it', (await upd(COACH, C1, { targetMs: 9990, locked: false })).status === 409 && (await ch(C1)).get('locked') === true);
  const lockedDel = await post('challenge/delete', { challengeId: C1 }, COACH);
  check('delete after start → 409 locked', lockedDel.status === 409 && (await ch(C1)).exists, lockedDel);
  check('unassign a started student → 409', (await post('challenge/unassign', { challengeId: C1, uid: s1 }, COACH)).status === 409 && (await asg(C1, s1)).exists);
  check('unassign an unstarted student of a locked challenge → OK', (await post('challenge/unassign', { challengeId: C1, uid: s2 }, COACH)).status === 200);
  check('assigning more students to a locked challenge → OK (template fixed)', (await assign(COACH, C1, [s2])).body.assigned?.length === 1);
  // Lock enforced on the assignment too: a started assignment blocks edit
  // even if `locked` were somehow false.
  const c3 = await post('challenge/create', { roomId: 'room1', ...T }, COACH);
  await assign(COACH, c3.body.challengeId, [s1]);
  await db.doc(`challengeAssignments/${c3.body.challengeId}_${s1}`).update({ status: 'in-progress', firstStartedAt: admin.firestore.Timestamp.now() });
  check('a started assignment alone also blocks edit → 409', (await upd(COACH, c3.body.challengeId, { targetMs: 1000 })).status === 409);
  check('…and delete → 409', (await post('challenge/delete', { challengeId: c3.body.challengeId }, COACH)).status === 409);

  console.log('\n=== duplicate ===');
  check('a student cannot duplicate → 403', (await post('challenge/duplicate', { challengeId: C1 }, S1)).status === 403);
  check('another coach cannot duplicate → 403', (await post('challenge/duplicate', { challengeId: C1 }, COACH2)).status === 403);
  const dup = await post('challenge/duplicate', { challengeId: C1 }, COACH);
  const dupDoc = (await ch(dup.body.challengeId)).data();
  check('duplicate of a locked challenge: new, unlocked, same template, linked', dup.status === 200 && dupDoc.locked === false &&
    dupDoc.duplicatedFrom === C1 && dupDoc.targetMs === 1500 && dupDoc.title === 'Хурд' && dupDoc.roomId === 'room1', dupDoc);
  const dupAssigned = await db.collection('challengeAssignments').where('challengeId', '==', dup.body.challengeId).get();
  check('the duplicate has no assignments', dupAssigned.empty);
  check('the duplicate can be edited', (await upd(COACH, dup.body.challengeId, { targetMs: 1400 })).status === 200);

  console.log('\n=== delete (only if never started) ===');
  check('a student cannot delete → 403', (await post('challenge/delete', { challengeId: dup.body.challengeId }, S1)).status === 403);
  check('another coach cannot delete → 403', (await post('challenge/delete', { challengeId: dup.body.challengeId }, COACH2)).status === 403);
  await assign(COACH, dup.body.challengeId, [s2, s3]);
  const del = await post('challenge/delete', { challengeId: dup.body.challengeId }, COACH);
  check('coach deletes an unstarted challenge with its assignments', del.status === 200 && del.body.deleted === 2 &&
    !(await ch(dup.body.challengeId)).exists && !(await asg(dup.body.challengeId, s2)).exists, del);
  check('unknown challenge → 404', (await post('challenge/delete', { challengeId: 'nope' }, COACH)).status === 404);

  console.log('\n=== remove / re-add hides and shows assignments to the coach (decision 24) ===');
  const act = (action, u) => post('rooms/member', { roomId: 'room1', uid: u, action }, COACH);
  check('coach removes s2', (await act('remove', s2)).status === 200);
  check('s2\'s assignment kept, hidden from the coach', (await asg(C1, s2)).exists && (await asg(C1, s2)).get('visibleToCoach') === false);
  check('s1 (still active) unaffected', (await asg(C1, s1)).get('visibleToCoach') === true);
  await db.doc(`rooms/room1/members/${s2}`).update({ status: 'pending' }); // the student asks again (join route)
  check('coach re-approves s2', (await act('approve', s2)).status === 200);
  check('s2\'s assignment visible to the coach again', (await asg(C1, s2)).get('visibleToCoach') === true);
} catch (e) {
  fail++;
  console.error('CHALLENGE ROUTES ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
} finally {
  server.kill();
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) console.log('--- server log ---\n' + serverLog.slice(-2000));
process.exit(fail === 0 ? 0 : 1);
