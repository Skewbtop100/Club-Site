// Standalone correctness check for lib/judge-conflict.ts (who may compete in
// which group after judging) and lib/judge-pin.ts (PIN hashing, verification
// and the brute-force lockout). No test runner in this project — plain
// script, like scripts/test-scramble-import.ts. Run via:
//   npx tsc lib/judge-conflict.ts lib/judge-pin.ts scripts/test-judge.ts \
//     --outDir .tmp-test-build --module commonjs --target es2020 --esModuleInterop --skipLibCheck
//   node .tmp-test-build/scripts/test-judge.js

import { isSelfJudging, judgedGroups, groupAvailability } from '../lib/judge-conflict';
import {
  generatePin, generateSalt, generateVersion, isPinFormat, hashPin, verifyPin,
  lockRemainingMs, registerFailure, type LockState,
  CLIENT_MAX_FAILURES, COMPETITION_MAX_FAILURES, LOCK_WINDOW_MS, JUDGE_SESSION_MS,
} from '../lib/judge-pin';

let failures = 0;

function check(label: string, pass: boolean, detail?: unknown) {
  if (pass) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}`);
    if (detail !== undefined) console.log('      got: ' + JSON.stringify(detail));
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

// ═══ Conflict rules ══════════════════════════════════════════════════════════

{
  eq('self: a judge cannot be the athlete', isSelfJudging('athX', 'athX'), true);
  eq('self: different people are fine', isSelfJudging('athX', 'athY'), false);
  eq('self: nothing chosen yet is not a conflict', [isSelfJudging('', ''), isSelfJudging('', 'athY'), isSelfJudging('athX', '')], [false, false, false]);

  // X judged group 1 (A) of 3x3 round 1, and group 2 of 3x3 round 2.
  const results = [
    { eventId: '333', round: 1, group: 1, athleteId: 'athA', judgeAthleteId: 'athX' },
    { eventId: '333', round: 1, group: 1, athleteId: 'athB', judgeAthleteId: 'athX' },
    { eventId: '333', round: 1, group: 2, athleteId: 'athC', judgeAthleteId: 'athY' },
    { eventId: '333', round: 2, group: 2, athleteId: 'athA', judgeAthleteId: 'athX' },
    { eventId: '222', round: 1, group: 3, athleteId: 'athA', judgeAthleteId: 'athX' },
    { eventId: '333', round: 1, group: 2, athleteId: 'athX', judgeAthleteId: 'athY' }, // X competed in group 2
    { eventId: '333', round: 1, group: 3, athleteId: 'athD' },                          // no judge recorded
    { eventId: '333', round: 1, athleteId: 'athE', judgeAthleteId: 'athX' },             // old row, no group
  ];
  const set = (s: Set<number>) => [...s].sort();

  eq('judged: the group X judged in that event+round', set(judgedGroups(results, 'athX', '333', 1)), [1]);
  eq('judged: rounds are independent', set(judgedGroups(results, 'athX', '333', 2)), [2]);
  eq('judged: events are independent', set(judgedGroups(results, 'athX', '222', 1)), [3]);
  eq('judged: someone who judged nothing there', set(judgedGroups(results, 'athA', '333', 1)), []);
  eq('judged: competing in a group is not judging it', set(judgedGroups(results, 'athC', '333', 1)), []);
  eq('judged: a result with no group recorded blocks nothing', set(judgedGroups([results[7]], 'athX', '333', 1)), []);
  eq('judged: nothing chosen → nothing blocked', [set(judgedGroups(results, '', '333', 1)), set(judgedGroups(results, 'athX', '', 1))], [[], []]);

  const a = groupAvailability([1, 2, 3], results, 'athX', '333', 1);
  eq('groups: the judged group is blocked, the others stay open', [set(a.blocked), a.open, a.roundBlocked], [[1], [2, 3], false]);
  const r2 = groupAvailability([1, 2, 3], results, 'athX', '333', 2);
  eq('groups: a different round blocks only what was judged in THAT round', [set(r2.blocked), r2.open], [[2], [1, 3]]);
  const free = groupAvailability([1, 2, 3], results, 'athA', '333', 1);
  eq('groups: an athlete who judged nothing can pick any group', [set(free.blocked), free.open, free.roundBlocked], [[], [1, 2, 3], false]);

  // Reverse case: Y already competed in group 2, then judges it — allowed,
  // and judging it afterwards does not retroactively matter for their own
  // finished result; it only blocks them from competing there AGAIN.
  const y = groupAvailability([1, 2], results, 'athY', '333', 1);
  eq('reverse: Y judged group 2 → only group 2 is closed to Y, group 1 open', [set(y.blocked), y.open], [[2], [1]]);
  check('reverse: competing first never blocks judging (no rule consults the athlete\'s own results)',
    set(judgedGroups(results, 'athX', '333', 1)).includes(2) === false);

  // One-group round.
  const single = groupAvailability([1], results, 'athX', '333', 1);
  eq('one group, judged by X → X cannot compete in the round', [set(single.blocked), single.open, single.roundBlocked], [[1], [], true]);
  const singleOther = groupAvailability([1], results, 'athA', '333', 1);
  eq('one group, not judged by A → A competes normally', [singleOther.open, singleOther.roundBlocked], [[1], false]);
  const all = groupAvailability([1, 2], [...results, { eventId: '333', round: 1, group: 2, athleteId: 'athF', judgeAthleteId: 'athX' }], 'athX', '333', 1);
  eq('every offered group judged → round blocked', [all.open, all.roundBlocked], [[], true]);
  const outside = groupAvailability([2, 3], results, 'athX', '333', 1);
  eq('a judged group that is not offered blocks nothing', [set(outside.blocked), outside.open, outside.roundBlocked], [[], [2, 3], false]);
  eq('no groups offered is not "round blocked"', groupAvailability([], results, 'athX', '333', 1).roundBlocked, false);
}

// ═══ PIN ═════════════════════════════════════════════════════════════════════

{
  const pins = Array.from({ length: 300 }, generatePin);
  check('pin: always 6 digits (leading zeros kept)', pins.every(p => /^\d{6}$/.test(p)), pins.find(p => !/^\d{6}$/.test(p)));
  check('pin: not a constant', new Set(pins).size > 250);
  eq('pin format: accepts 6 digits only', ['123456', '000000', '12345', '1234567', '12a456', ' 123456', '', '１２３４５６'].map(isPinFormat),
    [true, true, false, false, false, false, false, false]);
  eq('pin format: non-strings rejected', [isPinFormat(123456), isPinFormat(null), isPinFormat(undefined), isPinFormat({})], [false, false, false, false]);

  const salt = generateSalt(), pepper = 'server-secret';
  const hash = hashPin('482913', salt, pepper);
  check('hash: is not the PIN, and is 64 hex chars', !hash.includes('482913') && /^[0-9a-f]{64}$/.test(hash), hash);
  eq('hash: deterministic for the same pin+salt+pepper', hashPin('482913', salt, pepper), hash);
  check('hash: a different salt gives a different hash', hashPin('482913', generateSalt(), pepper) !== hash);
  check('hash: a different pepper gives a different hash (a leaked hash+salt is not enough)', hashPin('482913', salt, 'other') !== hash);
  check('salt/version: random each time', generateSalt() !== generateSalt() && generateVersion() !== generateVersion());

  eq('verify: the right PIN', verifyPin('482913', salt, pepper, hash), true);
  eq('verify: a wrong PIN', verifyPin('482914', salt, pepper, hash), false);
  eq('verify: right PIN, wrong pepper', verifyPin('482913', salt, 'other', hash), false);
  eq('verify: right PIN, wrong salt', verifyPin('482913', generateSalt(), pepper, hash), false);
  eq('verify: malformed PINs never pass', ['', '48291', '4829133', 'abcdef', '482913 '].map(p => verifyPin(p, salt, pepper, hash)), [false, false, false, false, false]);
  eq('verify: missing hash / salt never pass (PIN disabled or never set)', [verifyPin('482913', salt, pepper, ''), verifyPin('482913', '', pepper, hash)], [false, false]);
  eq('verify: a truncated or non-hex stored hash never passes, never throws',
    [verifyPin('482913', salt, pepper, hash.slice(0, 10)), verifyPin('482913', salt, pepper, 'zz')], [false, false]);

  // Regenerate: the old PIN stops verifying against the new record.
  const salt2 = generateSalt();
  const hash2 = hashPin('771204', salt2, pepper);
  eq('regenerate: old PIN fails against the new hash, new PIN passes', [verifyPin('482913', salt2, pepper, hash2), verifyPin('771204', salt2, pepper, hash2)], [false, true]);
}

// ═══ Lockout ═════════════════════════════════════════════════════════════════

{
  eq('limits: 5 per client, 30 per competition, 15 minutes, 24 h sessions',
    [CLIENT_MAX_FAILURES, COMPETITION_MAX_FAILURES, LOCK_WINDOW_MS, JUDGE_SESSION_MS], [5, 30, 15 * 60 * 1000, 24 * 60 * 60 * 1000]);

  const T0 = 1_700_000_000_000;
  const MIN = 60 * 1000;
  eq('lock: no state is not locked', [lockRemainingMs(undefined, T0), lockRemainingMs({ failures: [] }, T0)], [0, 0]);

  let s: LockState | undefined;
  const locks: number[] = [];
  for (let i = 0; i < 5; i++) {
    s = registerFailure(s, T0 + i * 1000, CLIENT_MAX_FAILURES);
    locks.push(lockRemainingMs(s, T0 + i * 1000));
  }
  eq('client: 4 wrong tries do not lock, the 5th locks for 15 minutes', locks, [0, 0, 0, 0, 15 * MIN]);
  const lockedAt = T0 + 4000;
  eq('client: still locked just before 15 minutes', lockRemainingMs(s, lockedAt + 15 * MIN - 1), 1);
  eq('client: free again at 15 minutes', lockRemainingMs(s, lockedAt + 15 * MIN), 0);

  // After the lock: a fresh 5 tries, not an instant re-lock.
  let after = s;
  const again: number[] = [];
  for (let i = 0; i < 5; i++) {
    const now = lockedAt + 15 * MIN + i * 1000;
    after = registerFailure(after, now, CLIENT_MAX_FAILURES);
    again.push(lockRemainingMs(after, now));
  }
  eq('client: after a lock expires, it takes 5 new wrong tries to lock again', again, [0, 0, 0, 0, 15 * MIN]);

  // Old failures fall out of the window.
  let slow: LockState | undefined;
  for (let i = 0; i < 12; i++) slow = registerFailure(slow, T0 + i * 4 * MIN, CLIENT_MAX_FAILURES);
  eq('window: one wrong try every 4 minutes never reaches 5 inside 15 minutes', [lockRemainingMs(slow, T0 + 44 * MIN), slow!.failures.length], [0, 4]);
  let burst: LockState | undefined;
  for (const t of [0, 1, 2, 3]) burst = registerFailure(burst, T0 + t * MIN, CLIENT_MAX_FAILURES);
  eq('window: the 5th try 16 minutes after the first is only the 4th in the window', lockRemainingMs(registerFailure(burst, T0 + 16 * MIN, CLIENT_MAX_FAILURES), T0 + 16 * MIN), 0);
  eq('window: ...but inside the window it locks', lockRemainingMs(registerFailure(burst, T0 + 14 * MIN, CLIENT_MAX_FAILURES), T0 + 14 * MIN), 15 * MIN);

  // Per-competition cap, fed by many clients.
  let comp: LockState | undefined;
  const compLocks: number[] = [];
  for (let i = 0; i < 30; i++) {
    comp = registerFailure(comp, T0 + i * 1000, COMPETITION_MAX_FAILURES);
    compLocks.push(lockRemainingMs(comp, T0 + i * 1000));
  }
  eq('competition: 29 wrong tries from any clients do not lock, the 30th locks PIN login for 15 minutes',
    [compLocks.slice(0, 29).every(v => v === 0), compLocks[29]], [true, 15 * MIN]);

  // A successful login in between (client doc deleted = undefined state) starts the count over.
  let c: LockState | undefined;
  for (let i = 0; i < 4; i++) c = registerFailure(c, T0 + i, CLIENT_MAX_FAILURES);
  c = undefined; // success → server deletes the client counter
  c = registerFailure(c, T0 + 10, CLIENT_MAX_FAILURES);
  eq('client: a successful login clears the count', [c.failures.length, lockRemainingMs(c, T0 + 10)], [1, 0]);

  const input: LockState = { failures: [T0] };
  registerFailure(input, T0 + 1, CLIENT_MAX_FAILURES);
  eq('registerFailure does not mutate its input', input, { failures: [T0] });
  check('stored state has no undefined fields (Firestore would refuse them)',
    Object.values(registerFailure(undefined, T0, CLIENT_MAX_FAILURES)).every(v => v !== undefined));
}

console.log(failures === 0 ? '\nAll judge checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
