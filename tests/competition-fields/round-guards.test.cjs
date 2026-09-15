// ── Round management guards ─────────────────────────────────────────────
// The real compiled round-cut.ts, round-open.ts and round-access.ts against
// the Firestore emulator.
//
// THE TWO HOLES THIS PINS:
//   1. ШАЛГАРУУЛАХ could be committed again while the next round was live,
//      rewriting the qualifier list that round's access reads on every
//      scramble request — athletes mid-round were suddenly "not qualified".
//   2. Reopening an earlier round while a later one was live succeeded, and
//      the gate took the LOWEST live round: round-2 qualifiers got round-1
//      scrambles and filed into round 1.
//
// Run: npm run test:roundguards

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-roundguards-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/round-cut.ts',
    'lib/online-competition/round-open.ts',
    'lib/online-competition/round-access.ts',
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
const { commitRoundCut, resetRound, roundHasStarted, RoundCutError } = require(path.join(OUT, 'round-cut.js'));
const { openRound, RoundOpenError } = require(path.join(OUT, 'round-open.js'));
const { resolveRoundAccess, resolveEventLiveRounds, liveRoundsForEvent } = require(path.join(OUT, 'round-access.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const db = getFirestore(initializeApp({ projectId: 'rt-roundguards' }, 'roundguards'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}

const comp = (id) => db.collection('onlineCompetitions').doc(id);
const state = async (id, key) => (await comp(id).collection('roundState').doc(key).get()).data();
const quals = async (id, key) => (await comp(id).collection('qualifiers').doc(key).get()).get('uids');
const setState = (id, key, data) => comp(id).collection('roundState').doc(key).set(data);
async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const cut = (id, round, uids, value = uids.length) =>
  commitRoundCut(db, { competitionId: id, eventId: '333', round, method: 'count', value, qualifierUids: uids });
// Closing is a plain write in the admin-rounds route; mirrored here.
const close = (id, round) => comp(id).collection('roundState').doc(`333_${round}`).set({ status: 'done' }, { merge: true });

(async () => {
  await db.recursiveDelete(db.collection('onlineCompetitions'));
  await db.recursiveDelete(db.collection('onlineSubmissions'));

  console.log('\n=== BUG 1: a cut is fixed once the next round starts ===\n');
  {
    const ID = 'g-cut';
    await comp(ID).set({ name: ID, status: 'live', events: [] });
    await setState(ID, '333_1', { eventId: '333', round: 1, status: 'live', openedAt: Timestamp.now() });

    await cut(ID, 1, ['a', 'b']);
    ok('Q1. round 1\'s cut commits while round 2 has never opened', JSON.stringify(await quals(ID, '333_1')) === '["a","b"]');
    ok('    ...and ends round 1', (await state(ID, '333_1')).status === 'done');

    await cut(ID, 1, ['a', 'b', 'x'], 3);
    ok('Q2. re-committing before round 2 opens is still allowed', (await quals(ID, '333_1')).length === 3);
    await cut(ID, 1, ['a', 'b'], 2);

    await openRound(db, ID, '333', 2);
    ok('    (round 2 is now live)', (await state(ID, '333_2')).status === 'live');

    const err = await caught(() => cut(ID, 1, ['a', 'c'], 2));
    ok('Q3. THE HOLE: re-committing round 1\'s cut while round 2 is LIVE is refused',
      err instanceof RoundCutError && err.status === 409, String(err));
    ok('    ...the message names the round and the way out', /2-р раунд/.test(err?.message ?? '') && /БУЦААХ/.test(err?.message ?? ''), err?.message);
    ok('    ...the qualifier list round 2 reads is untouched', JSON.stringify(await quals(ID, '333_1')) === '["a","b"]');
    ok('    ...and so is round 1\'s recorded cut', (await state(ID, '333_1')).qualifierValue === 2);
    const access = await resolveRoundAccess(db, ID, '333', 'b');
    ok('    ...so athlete b, mid-round 2, is still admitted', access.allowed && access.liveRound === 2, JSON.stringify(access));

    await close(ID, 2);
    const err2 = await caught(() => cut(ID, 1, ['a', 'c'], 2));
    ok('Q4. ...still refused once round 2 has been opened and CLOSED', err2 instanceof RoundCutError);

    // ── the way back: БУЦААХ ──
    await setState(ID, '333_2', { eventId: '333', round: 2, status: 'live', openedAt: Timestamp.now() });
    const live = await caught(() => resetRound(db, ID, '333', 2));
    ok('R1. БУЦААХ is refused while round 2 is live', live instanceof RoundCutError && /РАУНД ХААХ/.test(live.message), String(live));
    await close(ID, 2);

    await db.collection('onlineSubmissions').doc('b__g-cut__333__r2__a1').set({
      uid: 'b', competitionId: ID, event: '333', round: 1, competitionRound: 2, status: 'pending',
    });
    const filed = await caught(() => resetRound(db, ID, '333', 2));
    ok('R2. ...refused while anything is filed in round 2, saying how many',
      filed instanceof RoundCutError && /1 оролдлого/.test(filed.message), String(filed));
    ok('    ...leaving round 2 as it was', (await state(ID, '333_2')).status === 'done');
    await db.collection('onlineSubmissions').doc('b__g-cut__333__r2__a1').delete();

    await setState(ID, '333_3', { eventId: '333', round: 3, status: 'done', openedAt: Timestamp.now() });
    const later = await caught(() => resetRound(db, ID, '333', 2));
    ok('R3. ...refused while round 3 has started (undo from the end)', later instanceof RoundCutError && /3-р раунд/.test(later.message), String(later));
    await comp(ID).collection('roundState').doc('333_3').delete();

    await resetRound(db, ID, '333', 2);
    const s2 = await state(ID, '333_2');
    ok('R4. with nothing filed, БУЦААХ returns round 2 to never-opened', s2.status === 'closed' && s2.openedAt === undefined, JSON.stringify(s2));
    ok('    ...and roundHasStarted agrees', roundHasStarted(s2) === false);

    await cut(ID, 1, ['a', 'c'], 2);
    ok('R5. ...after which round 1\'s cut can be redone', JSON.stringify(await quals(ID, '333_1')) === '["a","c"]');

    const never = await caught(() => resetRound(db, ID, '333', 2));
    ok('R6. БУЦААХ on a round that never started has nothing to undo', never instanceof RoundCutError && never.status === 400);
  }
  {
    const ID = 'g-cut-final';
    await comp(ID).set({ name: ID, status: 'live', events: [] });
    await cut(ID, 3, ['a']);
    await cut(ID, 3, ['a', 'b'], 2);
    ok('Q5. a round with no next round at all may be re-cut', (await quals(ID, '333_3')).length === 2);
  }
  {
    const ID = 'g-cut-weird';
    await comp(ID).set({ name: ID, status: 'live', events: [] });
    await setState(ID, '333_2', { eventId: '333', round: 2 }); // no status at all
    const err = await caught(() => cut(ID, 1, ['a']));
    ok('Q6. FAILS CLOSED: a next-round state with no readable status counts as started', err instanceof RoundCutError, String(err));
    const missing = await caught(() => commitRoundCut(db, { competitionId: 'nope', eventId: '333', round: 1, method: 'count', value: 1, qualifierUids: [] }));
    ok('Q7. a competition that does not exist is a 404, nothing written', missing instanceof RoundCutError && missing.status === 404);
  }

  console.log('\n=== BUG 2: one live round per event ===\n');
  {
    const ID = 'g-open';
    await comp(ID).set({ name: ID, status: 'live', events: [] });
    await setState(ID, '333_1', { eventId: '333', round: 1, status: 'done', openedAt: Timestamp.now() });
    await comp(ID).collection('qualifiers').doc('333_1').set({ uids: ['q'] });
    await openRound(db, ID, '333', 2);

    const err = await caught(() => openRound(db, ID, '333', 1));
    ok('O1. THE HOLE: reopening round 1 while round 2 is live is refused',
      err instanceof RoundOpenError && err.status === 409, String(err));
    ok('    ...and the message names the live round', /2-р раунд одоо нээлттэй/.test(err?.message ?? ''), err?.message);
    ok('    ...round 1 stays closed', (await state(ID, '333_1')).status === 'done');

    await comp(ID).collection('qualifiers').doc('333_2').set({ uids: ['q'] });
    const err3 = await caught(() => openRound(db, ID, '333', 3));
    ok('O2. opening a LATER round while round 2 is live is refused too', err3 instanceof RoundOpenError && /2-р раунд/.test(err3.message), String(err3));
    ok('    ...round 3 not written', (await state(ID, '333_3')) === undefined);

    const again = await caught(() => openRound(db, ID, '333', 2));
    ok('O3. re-opening the round that is already live is not a conflict', again === null, String(again));

    const other = await caught(() => openRound(db, ID, '222', 1));
    ok('O4. another event\'s round opens alongside', other === null && (await state(ID, '222_1')).status === 'live', String(other));

    await close(ID, 2);
    const reopen = await caught(() => openRound(db, ID, '333', 1));
    ok('O5. with round 2 closed, round 1 may be reopened (a correction)', reopen === null, String(reopen));
  }

  console.log('\n=== resolveRoundAccess ===\n');
  {
    const ID = 'g-two-live';
    // Created directly: openRound no longer can. This is the state an
    // in-flight competition may already be in.
    await comp(ID).set({
      name: ID, status: 'live',
      events: [{ eventId: '333', label: '3x3x3', rounds: 3 }, { eventId: '222', label: '2x2x2', rounds: 1 }],
    });
    await setState(ID, '333_1', { eventId: '333', round: 1, status: 'live' });
    await setState(ID, '333_2', { eventId: '333', round: 2, status: 'live' });
    await comp(ID).collection('qualifiers').doc('333_1').set({ uids: ['q'] });

    const q = await resolveRoundAccess(db, ID, '333', 'q');
    ok('A1. TWO LIVE ROUNDS: a round-2 qualifier is refused, not sent to round 1',
      !q.allowed && q.reason === 'conflicting-live-rounds' && q.liveRound === null, JSON.stringify(q));
    const r1 = await resolveRoundAccess(db, ID, '333', 'someone');
    ok('    ...and so is a round-1 athlete — an ambiguous state admits nobody',
      !r1.allowed && r1.reason === 'conflicting-live-rounds' && r1.liveRound === null, JSON.stringify(r1));

    const events = await resolveEventLiveRounds(db, ID);
    const e333 = events.find((e) => e.eventId === '333');
    const e222 = events.find((e) => e.eventId === '222');
    ok('A2. the admin status lists both live rounds', JSON.stringify(e333?.liveRounds) === '[1,2]' && e333?.liveRound === null, JSON.stringify(e333));
    ok('    ...and an event with none is a gap, not a conflict', e222?.liveRounds.length === 0, JSON.stringify(e222));
  }
  {
    const ID = 'g-round3';
    await comp(ID).set({ name: ID, status: 'live', events: [] });
    await setState(ID, '333_1', { eventId: '333', round: 1, status: 'done' });
    await setState(ID, '333_2', { eventId: '333', round: 2, status: 'done' });
    await setState(ID, '333_3', { eventId: '333', round: 3, status: 'live' });
    await comp(ID).collection('qualifiers').doc('333_1').set({ uids: ['a', 'b'] });
    await comp(ID).collection('qualifiers').doc('333_2').set({ uids: ['a'] });

    const a = await resolveRoundAccess(db, ID, '333', 'a');
    ok('A3. ROUND 3: an athlete on round 2\'s qualifier list is admitted', a.allowed && a.liveRound === 3, JSON.stringify(a));
    const b = await resolveRoundAccess(db, ID, '333', 'b');
    ok('A4. ...one who qualified out of round 1 but NOT round 2 is refused',
      !b.allowed && b.reason === 'not-qualified' && b.liveRound === 3, JSON.stringify(b));
    await comp(ID).collection('qualifiers').doc('333_2').delete();
    const a2 = await resolveRoundAccess(db, ID, '333', 'a');
    ok('A5. ...and with no round-2 cut at all, nobody is admitted to round 3', !a2.allowed && a2.reason === 'not-qualified', JSON.stringify(a2));

    await setState(ID, '333_4', { eventId: '333', round: 4, status: 'live' });
    const four = await resolveRoundAccess(db, ID, '333', 'a');
    ok('A6. rounds 3 AND 4 live: refused', !four.allowed && four.reason === 'conflicting-live-rounds', JSON.stringify(four));
  }
  {
    const ID = 'g-single';
    await comp(ID).set({ name: ID, status: 'live', events: [] });
    await setState(ID, '333_1', { eventId: '333', round: 1, status: 'live' });
    const r = await resolveRoundAccess(db, ID, '333', 'anyone');
    ok('A7. one live round 1: any registered athlete is admitted', r.allowed && r.liveRound === 1, JSON.stringify(r));
  }
  ok('A8. liveRoundsForEvent ignores other events, closed rounds and junk keys',
    JSON.stringify(liveRoundsForEvent(new Map([
      ['333_2', { status: 'live' }], ['333_1', { status: 'done' }], ['3333_1', { status: 'live' }],
      ['333_x', { status: 'live' }], ['222_1', { status: 'live' }], ['333_10', { status: 'live' }],
    ]), '333')) === '[2,10]');

  console.log('\n=== wiring ===\n');
  {
    const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
    const qualify = src('app/api/online-competition/admin-rounds/qualify/route.ts');
    ok('the qualify route commits through commitRoundCut', qualify.includes('await commitRoundCut(db, {'));
    ok('  ...with no write of its own left behind', !/\.batch\(\)|\.set\(|\.update\(/.test(qualify));
    ok('  ...and preview still writes nothing', qualify.indexOf('if (!commit)') < qualify.indexOf('commitRoundCut(db'));
    const rounds = src('app/api/online-competition/admin-rounds/route.ts');
    ok('the rounds route offers БУЦААХ through resetRound', rounds.includes('resetRound(db, competitionId, eventId, round)'));
    ok('the gate refuses every non-ok reason with its message',
      /if \(!access\.allowed \|\| access\.liveRound === null\)/.test(src('lib/online-competition/scramble-gate.ts')));
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
