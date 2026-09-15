// ── Who may be given a scramble, and for which attempt ──────────────────
// Exercises the real compiled scramble gate (scramble-gate.ts) against the
// Firestore emulator — the same function the scramble route calls.
//
// THE TWO HOLES THIS PINS:
//   1. Nothing checked registration: any signed-in account could solve
//      round 1, and competitionRound was whatever the client wrote.
//   2. The attempt came from the client: attempt=1..5 handed out every
//      scramble in the group before anything was solved.
//
// Run: npm run test:scramblegate

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-scramblegate-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/scramble-gate.ts',
    '--outDir', path.basename(OUT),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--strict',
    '--skipLibCheck',
    '--esModuleInterop',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const gate = require(path.join(OUT, 'scramble-gate.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-scramblegate' }, 'scramblegate'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}

const COMP = 'gate-comp';
const S = ['R U R\'', 'F2 D2', 'L B L\'', 'U2 F2', 'D R D\''];
const comp = () => db.collection('onlineCompetitions').doc(COMP);
const register = (uid, status, events = ['333']) =>
  db.collection('onlineParticipants').doc(uid).collection('registrations').doc(COMP)
    .set(status === undefined ? { competitionId: COMP, events } : { competitionId: COMP, status, events });
const file = (uid, attempt, competitionRound = 1) =>
  db.collection('onlineSubmissions').doc(`${uid}__${COMP}__333__r${competitionRound}__a${attempt}`).set({
    uid, competitionId: COMP, event: '333', round: attempt, competitionRound,
    reportedTime: 1000 + attempt, isDnf: false, status: 'pending', penalty: null,
  });

const FAST = { waitForFilingMs: 0, pollMs: 1 };
const ask = (uid, requestedAttempt = null, deps = FAST, eventId = '333') =>
  gate.authorizeScrambleRequest(db, { competitionId: COMP, eventId, uid, requestedAttempt }, deps);

async function seed() {
  await comp().set({
    name: 'Gate', status: 'live',
    events: [
      { eventId: '333', label: '3x3x3', rounds: 2, resultFormat: 'ao5' },
      { eventId: '222', label: '2x2x2', rounds: 1, resultFormat: 'ao5' },
    ],
  });
  await comp().collection('roundState').doc('333_1').set({ eventId: '333', round: 1, status: 'live' });
  await comp().collection('scrambleData').doc('333_1').set({ eventId: '333', round: 1, groups: [{ label: 'A', scrambles: S }] });
  await comp().collection('groupAssignments').doc('333_1').set({
    assignments: { approved: 0, legacy: 0, retrier: 0, ahead: 0, done: 0, qualifier: 0, nonqualifier: 0 },
  });
  await register('approved', 'approved');
  await register('legacy', 'registered');
  await register('retrier', 'approved');
  await register('ahead', 'approved');
  await register('done', 'approved');
  await register('pending', 'pending');
  await register('waitlisted', 'waitlisted');
  await register('cancelled', 'cancelled');
  await register('rejected', 'rejected');
  await register('otherevent', 'approved', ['222']);
}

(async () => {
  await seed();

  console.log('\n=== registration ===\n');
  {
    const r = await ask('nobody');
    ok('1. UNREGISTERED: refused', !r.ok && r.status === 403 && r.error === 'not-registered', JSON.stringify(r));
    ok('   ...with nothing to solve', !('official' in r) && !('attempt' in r));
  }
  for (const status of ['pending', 'waitlisted', 'cancelled', 'rejected']) {
    const r = await ask(status);
    ok(`2. a ${status.toUpperCase()} registration: refused`, !r.ok && r.status === 403 && r.error === 'registration-not-approved' && r.message.length > 0, JSON.stringify(r));
  }
  {
    const r = await ask('otherevent');
    ok('3. approved, but for another event: refused', !r.ok && r.error === 'event-not-registered', JSON.stringify(r));
  }
  {
    const r = await ask('approved');
    ok('4. APPROVED: admitted, attempt 1, the group\'s first scramble',
      r.ok && r.round === 1 && r.attempt === 1 && r.official && r.official.scramble === S[0], JSON.stringify(r));
    const legacy = await ask('legacy');
    ok('5. a legacy "registered" registration counts as approved', legacy.ok && legacy.attempt === 1, JSON.stringify(legacy));
  }
  {
    // FAIL CLOSED: a registration that cannot be read refuses — the
    // promise rejects, and the route answers 500 with no scramble.
    const broken = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get: async () => { throw new Error('unavailable'); } }) }) }) }) };
    let threw = false;
    try {
      await gate.authorizeScrambleRequest(broken, { competitionId: COMP, eventId: '333', uid: 'approved', requestedAttempt: null }, FAST);
    } catch {
      threw = true;
    }
    ok('6. an unreadable registration denies (throws), never admits', threw);
  }

  console.log('\n=== the attempt is the server\'s ===\n');
  {
    const r = await ask('approved', 3);
    ok('7. CLIENT ASKS FOR ATTEMPT 3 with nothing filed: refused', !r.ok && r.error === 'attempt-mismatch' && r.nextAttempt === 1, JSON.stringify(r));
    ok('   ...and is given no scramble', !('official' in r));
    const five = await ask('approved', 5);
    ok('8. ...attempt 5 likewise', !five.ok && !('official' in five), JSON.stringify(five));
    const none = await ask('approved', null);
    ok('9. no attempt parameter at all: attempt 1', none.ok && none.attempt === 1 && none.official.scramble === S[0], JSON.stringify(none));
    const bad = await ask('approved', NaN);
    ok('10. a malformed attempt parameter: refused', !bad.ok && bad.status === 400, JSON.stringify(bad));
  }
  {
    await file('retrier', 1);
    await file('retrier', 2);
    const first = await ask('retrier', 3);
    ok('11. two attempts filed: attempt 3, scramble 3', first.ok && first.attempt === 3 && first.official.scramble === S[2], JSON.stringify(first));
    // THE RETRY: attempt 3's upload failed, or the page was reloaded.
    // Nothing new is filed, so the next attempt is still 3.
    const again = await ask('retrier', 3);
    ok('12. RETRY of the unfiled attempt gets THE SAME scramble', again.ok && again.attempt === 3 && again.official.scramble === S[2], JSON.stringify(again));
    const reload = await ask('retrier', null);
    ok('13. ...and so does a reloaded page asking afresh', reload.ok && reload.official.scramble === S[2], JSON.stringify(reload));
    const peek = await ask('retrier', 5);
    ok('14. still no way to reach attempt 5 early', !peek.ok && !('official' in peek), JSON.stringify(peek));
  }
  {
    // The solve page asks for N+1 as soon as N is QUEUED for upload.
    await file('ahead', 1);
    const noLanding = await ask('ahead', 3, { waitForFilingMs: 0, pollMs: 1 });
    ok('15. one ahead, and attempt 2 never lands: refused as not-yet-filed',
      !noLanding.ok && noLanding.error === 'previous-attempt-unfiled' && noLanding.nextAttempt === 2, JSON.stringify(noLanding));
    ok('   ...with no scramble', !('official' in noLanding));
    let polls = 0;
    const landed = await ask('ahead', 3, {
      waitForFilingMs: 10_000,
      pollMs: 1,
      sleep: async () => {
        polls++;
        if (polls === 1) await file('ahead', 2); // attempt 2's upload lands while waiting
      },
    });
    ok('16. one ahead, and attempt 2 lands during the wait: attempt 3 served',
      landed.ok && landed.attempt === 3 && landed.official.scramble === S[2], JSON.stringify(landed));
  }
  {
    for (let a = 1; a <= 5; a++) await file('done', a);
    const r = await ask('done');
    ok('17. every attempt filed: refused, the run is complete', !r.ok && r.error === 'run-complete', JSON.stringify(r));
  }

  console.log('\n=== rounds ===\n');
  {
    await comp().collection('roundState').doc('333_1').set({ status: 'done' }, { merge: true });
    await comp().collection('roundState').doc('333_2').set({ eventId: '333', round: 2, status: 'live' });
    await comp().collection('qualifiers').doc('333_1').set({ eventId: '333', round: 1, uids: ['qualifier'] });
    await register('qualifier', 'approved');
    await register('nonqualifier', 'approved');
    const no = await ask('nonqualifier');
    ok('18. NON-QUALIFIER, approved and registered: refused from round 2',
      !no.ok && no.status === 403 && no.error === 'not-qualified', JSON.stringify(no));
    const yes = await ask('qualifier');
    ok('19. the qualifier: admitted to round 2, attempt 1', yes.ok && yes.round === 2 && yes.attempt === 1, JSON.stringify(yes));
    ok('   ...on a random scramble (round 2 has no import)', yes.ok && yes.official === null);
    const approvedR1 = await ask('approved');
    ok('20. round 1 is closed to everyone now, qualified or not',
      !approvedR1.ok && approvedR1.error === 'not-qualified', JSON.stringify(approvedR1));
  }
  {
    await register('nolive', 'approved', ['222']);
    const r = await ask('nolive', null, FAST, '222');
    ok('21. no live round for the event: refused', !r.ok && r.error === 'no-live-round', JSON.stringify(r));
  }

  console.log('\n=== the run ticket ===\n');
  {
    await gate.recordScrambleServed(db, { competitionId: COMP, uid: 'qualifier', eventId: '333', round: 2, attempt: 1 });
    const t = await comp().collection('runTickets').doc(gate.runTicketId('qualifier', '333', 2)).get();
    ok('22. serving records a ticket at the id the rules read', t.exists && t.id === 'qualifier__333__r2', t.id);
    ok('   ...with what was served', t.get('servedThrough') === 1 && t.get('competitionRound') === 2 && t.get('uid') === 'qualifier');
    await gate.recordScrambleServed(db, { competitionId: COMP, uid: 'qualifier', eventId: '333', round: 2, attempt: 2 });
    const t2 = await comp().collection('runTickets').doc('qualifier__333__r2').get();
    ok('23. ...and moves forward with the run', t2.get('servedThrough') === 2);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
