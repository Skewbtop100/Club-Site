// End-to-end test of the challenge SESSION routes (docs/challenge-plan.md,
// phases 4a–4b: app/api/challenge/{start,solve,comment,end,close-stale})
// against the LOCAL Firestore + Auth emulators — never production. Same
// harness as the other route tests: `next start` on the built app with a
// throwaway service-account key. Run via `npm run test:routes`.
//
// Clock: the challenge rules read the test-only clock (lib/server/clock.ts,
// PV_TEST_CLOCK_OFFSET_MS — emulator only). The main server is pinned to
// 12:00 UB on today's UB date, so the suite runs at any real hour; a second
// server pinned to 23:50 UB checks the late-night rules (no valid end time
// is left — N2 — while running sessions and the end logic still work).
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import nextEnv from '@next/env';
import admin from 'firebase-admin';

const ROOT = process.cwd();
const PORT = 3992;
const BASE = `http://127.0.0.1:${PORT}`;
nextEnv.loadEnvConfig(ROOT, false, { info: () => {}, error: console.error });
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Refusing to run: emulator hosts are not set.');
  process.exit(1);
}

// UB clock helpers (UTC+8, no DST) and the two pinned test clocks.
const UB = 8 * 3600_000, DAY = 86_400_000;
const ubDayStart = (ms) => Math.floor((ms + UB) / DAY) * DAY - UB;
const ubDate = (ms) => new Date(ms + UB).toISOString().slice(0, 10);
const REAL_START = Date.now();
const TODAY = ubDayStart(REAL_START);
const OFFSET = TODAY + 12 * 3600_000 - REAL_START;              // 12:00 UB
const LATE_OFFSET = TODAY + (23 * 60 + 50) * 60_000 - REAL_START; // 23:50 UB
/** The app's "now" on the main server (advances in real time). */
const now = () => Date.now() + OFFSET;
const lateNow = () => Date.now() + LATE_OFFSET;
const ubAt = (hh, mm) => TODAY + (hh * 60 + mm) * 60_000;
const CRON_SECRET = 'test-cron-secret-0123456789';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  ...process.env,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_ADMIN_CLIENT_EMAIL: `smoke@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  PV_TEST_CLOCK_OFFSET_MS: String(OFFSET),
  CRON_SECRET,
};
// The late server: 23:50 UB, and no CRON_SECRET (the cron must refuse).
const lateEnv = { ...env, PV_TEST_CLOCK_OFFSET_MS: String(LATE_OFFSET) };
delete lateEnv.CRON_SECRET;
const LATE_PORT = 3990;
const LATE = `http://127.0.0.1:${LATE_PORT}`;

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const Ts = admin.firestore.Timestamp;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
}
async function post(route, body, token, base = BASE) {
  const res = await fetch(`${base}/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function authPost(method, body) {
  const res = await fetch(`${AUTH}/accounts:${method}?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
const signUp = (email) => authPost('signUp', { email, password: 'password123', returnSecureToken: true });
const doc = (p) => db.doc(p).get();

let serverLog = '';
const startServer = (port, serverEnv) => {
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], { cwd: ROOT, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { serverLog += d; });
  p.stderr.on('data', d => { serverLog += d; });
  return p;
};
const server = startServer(PORT, env);
const lateServer = startServer(LATE_PORT, lateEnv);
async function waitForServer(base = BASE) {
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${base}/api/challenge/start`, { method: 'POST', body: '{}' }); return; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('server did not start:\n' + serverLog);
}

// Virtual client clock for stoppedAt: 5 s between stops.
let clock = 1_800_000_000_000;
const solveBody = (sessionId, seq, ms, penalty = 'none', extra = {}) => {
  clock += 5000;
  return { sessionId, seq, ms, penalty, stoppedAt: clock, input: 'timer', ...extra };
};
/** Lets a test submit solves right after a start: the "total solve time
 *  can't exceed time since start" check reads startedAt. */
const backdate = (sessionId) => db.doc(`challengeSessions/${sessionId}`).update({ startedAt: Ts.fromMillis(now() - 10 * 60_000) });

try {
  await waitForServer();
  await waitForServer(LATE);

  const [adminU, coachU, coach2U, s1U, s2U, strangerU] = await Promise.all(
    ['adm', 'coach', 'coach2', 's1', 's2', 'stranger'].map(n => signUp(`cs-${n}@example.com`)));
  for (const [u, role, name] of [[adminU, 'admin', 'Admin'], [coachU, 'member', 'Coach'], [coach2U, 'member', 'Coach2'],
    [s1U, 'member', 'Student One'], [s2U, 'member', 'Student Two'], [strangerU, 'member', 'Stranger']]) {
    await db.doc(`users/${u.localId}`).set({ uid: u.localId, role, displayName: name });
  }
  await db.doc(`coaches/${coachU.localId}`).set({ uid: coachU.localId, active: true });
  await db.doc(`coaches/${coach2U.localId}`).set({ uid: coach2U.localId, active: true });
  for (const [id, owner] of [['room1', coachU.localId], ['room2', coach2U.localId], ['roomA', adminU.localId]]) {
    await db.doc(`rooms/${id}`).set({ name: id, coachUid: owner, coachName: 'C', code: 'ABCDEF', archived: false });
  }
  const addMember = (roomId, u, name) => db.doc(`rooms/${roomId}/members/${u.localId}`).set({
    uid: u.localId, roomId, roomName: roomId, coachName: 'C', displayName: name, photoURL: null, status: 'active' });
  await addMember('room1', s1U, 'Student One');
  await addMember('room1', s2U, 'Student Two');
  await addMember('roomA', s2U, 'Student Two');
  const COACH = coachU.idToken, COACH2 = coach2U.idToken, ADMIN = adminU.idToken;
  const S1 = s1U.idToken, S2 = s2U.idToken, STRANGER = strangerU.idToken;
  const s1 = s1U.localId, s2 = s2U.localId;

  // "2x2 Mo3 < 3.00 × 2" assigned to both students; a second challenge for s1.
  const mk = async (token, roomId, t) => (await post('challenge/create', { roomId, ...t }, token)).body.challengeId;
  const C1 = await mk(COACH, 'room1', { event: '222', metric: 'mo3', targetMs: 3000, streak: 2 });
  const C2 = await mk(COACH, 'room1', { event: '222', metric: 'single', targetMs: 5000, streak: 1 });
  await post('challenge/assign', { challengeId: C1, uids: [s1, s2] }, COACH);
  await post('challenge/assign', { challengeId: C2, uids: [s1] }, COACH);
  const A1 = `${C1}_${s1}`, A1b = `${C1}_${s2}`, A2 = `${C2}_${s1}`;
  const latest = ubAt(23, 59);

  console.log('\n=== start: who may ===');
  for (const r of ['start', 'solve', 'comment', 'end']) check(`${r}: no token → 401`, (await post(`challenge/${r}`, {})).status === 401);
  check('a student cannot start their own challenge → 403', (await post('challenge/start', { assignmentId: A1 }, S1)).status === 403);
  check('another coach cannot start it → 403', (await post('challenge/start', { assignmentId: A1 }, COACH2)).status === 403);
  check('an admin who is not the room\'s coach → 403', (await post('challenge/start', { assignmentId: A1 }, ADMIN)).status === 403);
  check('unknown assignment → 404', (await post('challenge/start', { assignmentId: 'nope_x' }, COACH)).status === 404);

  console.log('\n=== start: end time (same UB day, ≤ 23:59, ≥ now + 10 min) ===');
  const endCase = async (label, endsAt, code) => {
    const r = await post('challenge/start', { assignmentId: A1, endsAt }, COACH);
    check(`${label} → 400 ${code}`, r.status === 400 && r.body.error === code, r);
  };
  await endCase('in the past', now() - 60_000, 'end-too-soon');
  await endCase('5 minutes from now', now() + 5 * 60_000, 'end-too-soon');
  await endCase('tomorrow 00:30', ubAt(24, 30), 'end-other-day');
  await endCase('after 23:59', latest + 30_000, 'end-too-late');
  await endCase('not a number', '18:00', 'bad-end-time');
  check('no session was created by the refusals', (await db.collection('challengeSessions').get()).empty);

  console.log('\n=== start ===');
  const st = await post('challenge/start', { assignmentId: A1, endsAt: latest }, COACH);
  const SID = st.body.sessionId;
  check('coach starts with 23:59 → 200', st.status === 200 && typeof SID === 'string' && st.body.endsAt === latest, st);
  const sess = (await doc(`challengeSessions/${SID}`)).data();
  check('session: active, ids, template, endsAt, UB date, empty progress', sess.status === 'active' && sess.studentUid === s1 &&
    sess.coachUid === coachU.localId && sess.assignmentId === A1 && sess.template.metric === 'mo3' && sess.endsAt.toMillis() === latest &&
    sess.ubDate === ubDate(now()) && sess.solves.length === 0 && sess.currentStreak === 0 && sess.visibleToCoach === true, sess);
  const live = (await doc(`challengeLive/${s1}`)).data();
  check('challengeLive points the student\'s timer at it', live.sessionId === SID && live.assignmentId === A1 &&
    live.template.event === '222' && live.endsAt.toMillis() === latest, live);
  check('the challenge is now locked', (await doc(`challenges/${C1}`)).get('locked') === true);
  const a1 = (await doc(`challengeAssignments/${A1}`)).data();
  check('assignment: in-progress, first start recorded, 1 session, active pointer', a1.status === 'in-progress' &&
    a1.firstStartedUbDate === ubDate(now()) && a1.firstStartedAt != null && a1.sessionsCount === 1 && a1.activeSessionId === SID, a1);
  check('editing the started challenge → 409 locked', (await post('challenge/update', { challengeId: C1, event: '222', metric: 'mo3', targetMs: 2000, streak: 2 }, COACH)).status === 409);
  const busy = await post('challenge/start', { assignmentId: A2 }, COACH);
  check('a second running session for the same student → 409 student-busy', busy.status === 409 && busy.body.error === 'student-busy', busy);
  check('the same assignment again while running → 409', (await post('challenge/start', { assignmentId: A1 }, COACH)).status === 409);
  const stB = await post('challenge/start', { assignmentId: A1b }, COACH);
  check('another student can run the same challenge at the same time', stB.status === 200, stB);

  console.log('\n=== solve ===');
  await backdate(SID);
  const solve = (token, b) => post('challenge/solve', b, token);
  check('another student cannot submit → 403', (await solve(S2, solveBody(SID, 1, 1000))).status === 403);
  check('a stranger cannot submit → 403', (await solve(STRANGER, solveBody(SID, 1, 1000))).status === 403);
  check('a Bluetooth / manual solve → 400', (await solve(S1, solveBody(SID, 1, 1000, 'none', { input: 'bluetooth' }))).status === 400);
  check('bad penalty → 400', (await solve(S1, solveBody(SID, 1, 1000, 'plus2'))).status === 400);
  check('seq out of order → 409', (await solve(S1, solveBody(SID, 2, 1000))).status === 409);
  const tooFast = await solve(S1, solveBody(SID, 1, 300));
  check('2x2 0.30 (below the 0.40 floor) → 409 too-fast', tooFast.status === 409 && tooFast.body.error === 'too-fast', tooFast);
  check('…and flagged on the session for the coach', (await doc(`challengeSessions/${SID}`)).get('flags')[0]?.reason === 'too-fast');
  const b1 = solveBody(SID, 1, 1000);
  const r1 = await solve(S1, b1);
  check('solve 1 accepted: block 1/3', r1.status === 200 && r1.body.progress.inBlock === 1 && r1.body.status === 'active', r1);
  const again = await solve(S1, b1);
  check('identical retry is idempotent (no duplicate)', again.status === 200 && (await doc(`challengeSessions/${SID}`)).get('solves').length === 1, again);
  check('same seq with a different time → 409', (await solve(S1, { ...b1, ms: 1200 })).status === 409);
  const close = { sessionId: SID, seq: 2, ms: 4000, penalty: 'none', stoppedAt: b1.stoppedAt + 1000, input: 'timer' };
  const tooClose = await solve(S1, close);
  check('stopped 1 s after the previous stop but lasted 4 s → 409 too-close', tooClose.status === 409 && tooClose.body.error === 'too-close', tooClose);
  await solve(S1, solveBody(SID, 2, 1000));
  const r3 = await solve(S1, solveBody(SID, 3, 1000, 'dnf'));
  check('Mo3 with a DNF fails the block: streak 0, block marked failed', r3.status === 200 && r3.body.progress.blocksAttempted === 1 &&
    r3.body.progress.blocks[0].pass === false && r3.body.progress.currentStreak === 0, r3);
  await solve(S1, solveBody(SID, 4, 1000));
  await solve(S1, solveBody(SID, 5, 1000, '+2'));
  const r6 = await solve(S1, solveBody(SID, 6, 1000));
  check('Mo3 1.00 / 3.00 (+2) / 1.00 = 1.66 → pass, streak 1', r6.body.progress.currentStreak === 1 && r6.body.progress.blocks[1].displayCs === 166, r6);
  await solve(S1, solveBody(SID, 7, 1000));

  console.log('\n=== comment ===');
  const cm = await post('challenge/comment', { sessionId: SID, seq: 5, comment: '  гулссан  ' }, S1);
  const s5 = (await doc(`challengeSessions/${SID}`)).get('solves')[4];
  check('own comment saved; time and penalty unchanged', cm.status === 200 && s5.comment === 'гулссан' && s5.ms === 1000 && s5.penalty === '+2', s5);
  check('commenting someone else\'s solve → 403', (await post('challenge/comment', { sessionId: SID, seq: 1, comment: 'x' }, S2)).status === 403);

  console.log('\n=== student ends early ===');
  check('a stranger cannot end it → 403', (await post('challenge/end', { sessionId: SID }, STRANGER)).status === 403);
  const en = await post('challenge/end', { sessionId: SID }, S1);
  check('"Өнөөдрийг дуусгах" → ended', en.status === 200 && en.body.status === 'ended', en);
  const ended = (await doc(`challengeSessions/${SID}`)).data();
  check('the unfinished block (1 of 3) is dropped: 2 complete blocks', ended.blocksAttempted === 2 && ended.status === 'ended' && ended.endedAt != null, ended);
  check('pointer cleared', (await doc(`challengeLive/${s1}`)).get('sessionId') === null);
  const a1e = (await doc(`challengeAssignments/${A1}`)).data();
  check('assignment rolled up: 2 blocks, best streak 1, no active session', a1e.blocksAttempted === 2 && a1e.bestStreak === 1 &&
    a1e.activeSessionId === null && a1e.status === 'in-progress', a1e);
  check('a solve after the end → 409 not-active', (await solve(S1, solveBody(SID, 8, 1000))).status === 409);
  check('ending again is a no-op', (await post('challenge/end', { sessionId: SID }, S1)).body.status === 'ended');
  check('comments still work after the end (N7)', (await post('challenge/comment', { sessionId: SID, seq: 1, comment: '' }, S1)).status === 200);

  console.log('\n=== second session the same day starts from 0 ===');
  const st2 = await post('challenge/start', { assignmentId: A1 }, COACH);
  const SID2 = st2.body.sessionId;
  check('second start the same day (default 23:59) → 200', st2.status === 200 && st2.body.endsAt === latest, st2);
  await backdate(SID2);
  const n1 = await solve(S1, solveBody(SID2, 1, 1000));
  check('progress restarts at 0 (seq 1, no blocks, streak 0)', n1.status === 200 && n1.body.progress.blocksAttempted === 0 && n1.body.progress.currentStreak === 0, n1);
  check('sessions counted: 2', (await doc(`challengeAssignments/${A1}`)).get('sessionsCount') === 2);

  console.log('\n=== coach "Зогсоох" ===');
  check('another coach cannot stop it → 403', (await post('challenge/end', { sessionId: SID2 }, COACH2)).status === 403);
  const stop = await post('challenge/end', { sessionId: SID2 }, COACH);
  check('the coach stops it → ended, pointer cleared', stop.body.status === 'ended' && (await doc(`challengeLive/${s1}`)).get('sessionId') === null, stop);

  console.log('\n=== end time passed (lazy close) ===');
  const st3 = await post('challenge/start', { assignmentId: A1 }, COACH);
  const SID3 = st3.body.sessionId;
  await db.doc(`challengeSessions/${SID3}`).update({ endsAt: Ts.fromMillis(now() - 1000), startedAt: Ts.fromMillis(now() - 600_000) });
  const late = await solve(S1, solveBody(SID3, 1, 1000));
  check('a solve after the end time → 409 ended', late.status === 409 && late.body.error === 'ended', late);
  check('…and the session is auto-closed, pointer cleared', (await doc(`challengeSessions/${SID3}`)).get('status') === 'auto-closed' &&
    (await doc(`challengeLive/${s1}`)).get('sessionId') === null);
  // A pointer left on an expired session (student never came back) does
  // not block the next start: start closes it first.
  const st4 = await post('challenge/start', { assignmentId: A2 }, COACH);
  await db.doc(`challengeSessions/${st4.body.sessionId}`).update({ endsAt: Ts.fromMillis(now() - 1000) });
  const st5 = await post('challenge/start', { assignmentId: A1 }, COACH);
  check('start over an expired running session → closes it, starts the new one', st5.status === 200 &&
    (await doc(`challengeSessions/${st4.body.sessionId}`)).get('status') === 'auto-closed' &&
    (await doc(`challengeLive/${s1}`)).get('sessionId') === st5.body.sessionId, st5);
  const endExpired = await post('challenge/end', { sessionId: st5.body.sessionId }, COACH);
  check('ending (not expired) → ended', endExpired.body.status === 'ended');

  console.log('\n=== completion ===');
  const st6 = await post('challenge/start', { assignmentId: A1 }, COACH);
  const SID6 = st6.body.sessionId;
  await backdate(SID6);
  let last;
  for (let i = 1; i <= 6; i++) last = await solve(S1, solveBody(SID6, i, 1500));
  check('2 passing Mo3 blocks in a row → completed', last.status === 200 && last.body.completed === true && last.body.status === 'completed', last);
  const res = last.body.result;
  check('the completing solve returns the celebration numbers', res && res.daysTaken === 1 && res.sessionsCount === 5 &&
    res.blocksAttempted === 4 && res.bestStreak === 2 && res.completedUbDate === ubDate(now()), res);
  const done = (await doc(`challengeAssignments/${A1}`)).data();
  check('assignment: completed, dates, days taken 1, sessions, blocks, best streak', done.status === 'completed' && done.completedAt != null &&
    done.completedUbDate === ubDate(now()) && done.daysTaken === 1 && done.sessionsCount === 5 &&
    done.blocksAttempted === 2 + 0 + 0 + 0 + 2 && done.bestStreak === 2 && done.activeSessionId === null, done);
  check('session completed, pointer cleared', (await doc(`challengeSessions/${SID6}`)).get('status') === 'completed' &&
    (await doc(`challengeLive/${s1}`)).get('sessionId') === null);
  check('no more solves after completion → 409', (await solve(S1, solveBody(SID6, 7, 1500))).status === 409);
  check('starting a completed challenge → 409 completed', (await post('challenge/start', { assignmentId: A1 }, COACH)).body.error === 'completed');

  console.log('\n=== admin in their own room; removal hides sessions from the coach ===');
  const CA = await mk(ADMIN, 'roomA', { event: '333', metric: 'single', targetMs: 10000, streak: 1 });
  await post('challenge/assign', { challengeId: CA, uids: [s2] }, ADMIN);
  await post('challenge/end', { sessionId: stB.body.sessionId }, COACH); // free s2
  const stA = await post('challenge/start', { assignmentId: `${CA}_${s2}` }, ADMIN);
  check('an admin starts in their own room (admins are coaches)', stA.status === 200, stA);
  await post('challenge/end', { sessionId: stA.body.sessionId }, ADMIN);
  check('coach removes s2 from room1', (await post('rooms/member', { roomId: 'room1', uid: s2, action: 'remove' }, COACH)).status === 200);
  check('s2\'s room1 session hidden from the coach', (await doc(`challengeSessions/${stB.body.sessionId}`)).get('visibleToCoach') === false);
  check('s2\'s roomA session untouched', (await doc(`challengeSessions/${stA.body.sessionId}`)).get('visibleToCoach') === true);
  check('starting for a removed student → 409', (await post('challenge/start', { assignmentId: A1b }, COACH)).body.error === 'not-active-member');

  console.log('\n=== daily cleanup cron (close-stale) ===');
  const cron = async (method, authorization, base = BASE) => {
    const res = await fetch(`${base}/api/challenge/close-stale`, { method, headers: authorization ? { authorization } : {} });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  check('no Authorization → 401', (await cron('GET')).status === 401);
  check('wrong secret → 401', (await cron('GET', 'Bearer nope')).status === 401);
  check('secret without "Bearer " → 401', (await cron('GET', CRON_SECRET)).status === 401);
  check('a student\'s ID token is not the secret → 401', (await cron('GET', `Bearer ${S1}`)).status === 401);
  // An expired session the student never came back to (4 Mo3 solves: one
  // passing block + one unfinished), one still running, one already ended.
  const C3 = await mk(COACH, 'room1', { event: '222', metric: 'mo3', targetMs: 3000, streak: 5 });
  await post('challenge/assign', { challengeId: C3, uids: [s1] }, COACH);
  const A3 = `${C3}_${s1}`;
  const tpl = { event: '222', metric: 'mo3', targetMs: 3000, streak: 5, title: 't', note: '' };
  const seedSession = (id, status, endsAt, extra = {}) => db.doc(`challengeSessions/${id}`).set({
    assignmentId: A3, challengeId: C3, roomId: 'room1', coachUid: coachU.localId, studentUid: s1,
    template: tpl, startedAt: Ts.fromMillis(now() - 3 * 3600_000), endsAt: Ts.fromMillis(endsAt),
    ubDate: ubDate(now()), status, endedAt: null, solves: [], blocks: [], currentStreak: 0, bestStreak: 0,
    blocksAttempted: 0, flags: [], visibleToCoach: true, ...extra,
  });
  const fourSolves = [1, 2, 3, 4].map(i => ({ seq: i, ms: 1000, penalty: 'none', stoppedAt: 1000 * i }));
  await seedSession('staleA', 'active', now() - 3600_000, {
    solves: fourSolves, blocks: [{ resultMs: 1000, displayCs: 100, pass: true }], currentStreak: 1, bestStreak: 1, blocksAttempted: 1,
  });
  await seedSession('freshB', 'active', now() + 3600_000);
  await seedSession('oldC', 'ended', now() - 7200_000);
  await db.doc(`challengeLive/${s1}`).set({ sessionId: 'staleA', assignmentId: A3, template: tpl, endsAt: Ts.fromMillis(now() - 3600_000) });
  await db.doc(`challengeAssignments/${A3}`).update({ status: 'in-progress', sessionsCount: 1, activeSessionId: 'staleA', activeEndsAt: Ts.fromMillis(now() - 3600_000) });
  const run1 = await cron('GET', `Bearer ${CRON_SECRET}`);
  check('the cron (GET, as Vercel calls it) closes exactly the expired session', run1.status === 200 && run1.body.closed === 1, run1);
  const stale = (await doc('challengeSessions/staleA')).data();
  check('expired → auto-closed; the unfinished block dropped (1 complete block)', stale.status === 'auto-closed' && stale.blocksAttempted === 1 && stale.endedAt != null, stale);
  check('a still-running session is left alone', (await doc('challengeSessions/freshB')).get('status') === 'active');
  check('an already-ended session is left alone', (await doc('challengeSessions/oldC')).get('status') === 'ended' && (await doc('challengeSessions/oldC')).get('endedAt') === null);
  check('the student\'s pointer is cleared', (await doc(`challengeLive/${s1}`)).get('sessionId') === null);
  const a3 = (await doc(`challengeAssignments/${A3}`)).data();
  check('assignment rolled up: 1 block, best streak 1, no active session, still in progress', a3.blocksAttempted === 1 &&
    a3.bestStreak === 1 && a3.activeSessionId === null && a3.status === 'in-progress', a3);
  const run2 = await cron('GET', `Bearer ${CRON_SECRET}`);
  check('running it again closes nothing (idempotent)', run2.status === 200 && run2.body.closed === 0, run2);
  check('…and changes nothing (blocks not counted twice)', (await doc(`challengeAssignments/${A3}`)).get('blocksAttempted') === 1);
  const run3 = await cron('POST', `Bearer ${CRON_SECRET}`);
  check('a manual POST run works too', run3.status === 200 && run3.body.closed === 0, run3);
  await db.doc('challengeSessions/freshB').update({ status: 'ended' }); // tidy

  console.log('\n=== 23:50 UB (late server): rules still hold, nothing depends on the real clock ===');
  const lateStart = await post('challenge/start', { assignmentId: A3 }, COACH, LATE);
  check('at 23:50 the default 23:59 end is < 10 min away → 400 end-too-soon', lateStart.status === 400 && lateStart.body.error === 'end-too-soon', lateStart);
  const lateDay = ubDayStart(lateNow());
  check('23:59 explicitly → 400 end-too-soon', (await post('challenge/start', { assignmentId: A3, endsAt: lateDay + (23 * 60 + 59) * 60_000 }, COACH, LATE)).body.error === 'end-too-soon');
  check('00:30 tomorrow → 400 end-other-day', (await post('challenge/start', { assignmentId: A3, endsAt: lateDay + DAY + 30 * 60_000 }, COACH, LATE)).body.error === 'end-other-day');
  // A session started earlier that ends at 23:55 is still running at 23:50.
  await seedSession('lateRun', 'active', lateDay + (23 * 60 + 55) * 60_000, { startedAt: Ts.fromMillis(lateNow() - 20 * 60_000) });
  await db.doc(`challengeLive/${s1}`).set({ sessionId: 'lateRun', assignmentId: A3, template: tpl, endsAt: Ts.fromMillis(lateDay + (23 * 60 + 55) * 60_000) });
  await db.doc(`challengeAssignments/${A3}`).update({ activeSessionId: 'lateRun' });
  const lateSolve = await post('challenge/solve', solveBody('lateRun', 1, 1000), S1, LATE);
  check('a solve at 23:50 in a session ending 23:55 → accepted', lateSolve.status === 200 && lateSolve.body.status === 'active', lateSolve);
  const lateEnd = await post('challenge/end', { sessionId: 'lateRun' }, S1, LATE);
  check('the student ends it at 23:50 → ended (not expired yet)', lateEnd.body.status === 'ended', lateEnd);
  await seedSession('lateGone', 'active', lateDay + (23 * 60 + 45) * 60_000);
  const goneEnd = await post('challenge/end', { sessionId: 'lateGone' }, S1, LATE);
  check('a session that ended at 23:45 → closed as auto-closed', goneEnd.body.status === 'auto-closed', goneEnd);
  check('the cron refuses to run without CRON_SECRET configured → 503', (await cron('GET', `Bearer ${CRON_SECRET}`, LATE)).status === 503);
} catch (e) {
  fail++;
  console.error('SESSION ROUTES ERROR', e, '\n--- server log ---\n' + serverLog.slice(-3000));
} finally {
  server.kill();
  lateServer.kill();
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) console.log('--- server log ---\n' + serverLog.slice(-2000));
process.exit(fail === 0 ? 0 : 1);
