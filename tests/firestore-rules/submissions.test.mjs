import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

// Rules tests for onlineSubmissions — the attempt an athlete files.
//
// THE HOLE THESE CLOSE: `create` used to check nothing but the uid. An
// athlete could file a submission already marked status:'approved' with any
// time on it, and round-results.ts, seasonPoints.ts and athleteStats.ts all
// trust status == 'approved'. That is a judge's verdict written by the
// person being judged. A second, quieter hole sat next to it: `update` let
// an athlete rewrite their OWN pending attempt's reportedTime and videoUrl,
// which is the same thing as re-solving an attempt that went badly.
//
// The other half of the contract lives in the client: the document id is
// built by submissionDocId (lib/online-competition/submission-id.ts) and
// the rules here REQUIRE it to describe the document's own contents, so
// the deterministic id cannot be made to describe a lie.
//
// Same conventions as competitions.test.mjs: RULES_PATH overrides the rules
// file, the emulator is assumed to be up (npm run test:rules wraps that).
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const ATHLETE = 'athlete1';
const OTHER = 'athlete2';
const CLUB_ADMIN = 'clubadmin1';

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-submissions',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

const COMP = 'comp1';
const EVENT = '333';
/** The id the client writer produces for (uid, competition, event, round,
 *  attempt) — mirrored here rather than imported, so a change to either
 *  side has to be made deliberately on both. */
const idFor = (uid, attempt, round = 1, comp = COMP, event = EVENT) =>
  `${uid}__${comp}__${event}__r${round}__a${attempt}`;

/** Exactly what createSubmission writes. `createdAt` is serverTimestamp()
 *  at the call site; the rule requires request.time, which is what that
 *  resolves to. */
const attemptDoc = (over = {}) => ({
  competitionId: COMP,
  uid: ATHLETE,
  event: EVENT,
  round: 1,
  competitionRound: 1,
  videoUrl: 'https://res.cloudinary.com/x/video/upload/v1/a.webm',
  cloudinaryPublicId: 'oc/a',
  reportedTime: 1234,
  isDnf: false,
  penalty: null,
  status: 'pending',
  // serverTimestamp(), not a client Date: the rule pins createdAt to
  // request.time, so a client-chosen value cannot backdate a submission.
  createdAt: serverTimestamp(),
  retentionExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  ...over,
});

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // isAdmin() reads users/{uid}.role — the club's Firebase Auth admin.
  await setDoc(doc(db, 'users', CLUB_ADMIN), { role: 'admin' });
  await setDoc(doc(db, 'users', ATHLETE), { role: 'athlete' });
});

const anon = () => testEnv.unauthenticatedContext().firestore();
const athlete = () => testEnv.authenticatedContext(ATHLETE).firestore();
const other = () => testEnv.authenticatedContext(OTHER).firestore();
const clubAdmin = () => testEnv.authenticatedContext(CLUB_ADMIN).firestore();

async function check(name, expect, fn) {
  let ok;
  let detail;
  try {
    if (expect === 'ALLOW') await assertSucceeds(fn());
    else await assertFails(fn());
    ok = true;
  } catch (e) {
    ok = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [expected ${expect}] ${name}`);
  if (!ok) console.log(`          -> ${detail}`);
}

/** Seeds a filed attempt the way a previous session (or the Admin SDK)
 *  would, bypassing rules. */
async function seed(id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'onlineSubmissions', id), data);
  });
}

console.log('\n=== onlineSubmissions rules — an athlete files an attempt ===\n');

// ── CREATE: the legitimate write ────────────────────────────────────────
await check('1. the athlete files their own pending attempt', 'ALLOW', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 1)), attemptDoc()),
);
await check('2. ...and each attempt of the run', 'ALLOW', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 5)), attemptDoc({ round: 5 })),
);
await check('3. ...a DNF, which stores reportedTime 0', 'ALLOW', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 4)), attemptDoc({ round: 4, reportedTime: 0, isDnf: true })),
);
await check('4. ...in a later competition round', 'ALLOW', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 1, 2)), attemptDoc({ competitionRound: 2 })),
);
await check('5. not signed in at all', 'DENY', () =>
  setDoc(doc(anon(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2 })),
);
await check("6. filing under ANOTHER athlete's uid", 'DENY', () =>
  setDoc(doc(other(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2 })),
);

// ── CREATE: the verdict is not the athlete's to write ───────────────────
// THE HOLE. Everything downstream reads status == 'approved' as "a judge
// approved this".
await check("7. THE HOLE: filing an attempt already marked 'approved'", 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, status: 'approved' })),
);
await check("8. ...or 'rejected' (a judge's DNF)", 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, status: 'rejected' })),
);
await check('9. ...or any other status', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, status: 'judged' })),
);
await check('10. ...or with a penalty already resolved', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, penalty: 'none' })),
);
await check('11. ...or with a +2 assigned to themselves', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, penalty: '+2' })),
);

// ── CREATE: the id must describe the document ───────────────────────────
// The client picks the id. Without this, a run could file attempt 3's
// solve at attempt 5's id — the deterministic id describing a lie.
await check("12. an id whose ATTEMPT does not match the document", 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 5)), attemptDoc({ round: 3 })),
);
await check('13. an id whose ROUND does not match', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 1)), attemptDoc({ round: 2, competitionRound: 2 })),
);
await check('14. an id whose EVENT does not match', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 1, COMP, '222')), attemptDoc({ round: 2 })),
);
await check('15. an id whose COMPETITION does not match', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 1, 'other-comp')), attemptDoc({ round: 2 })),
);
await check("16. an id carrying someone else's uid (contents say it is theirs)", 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(OTHER, 2)), attemptDoc({ round: 2 })),
);
await check('17. a random id', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', 'BFq2Kz9dLm3pXn1'), attemptDoc({ round: 2 })),
);

// ── CREATE: shape ───────────────────────────────────────────────────────
await check('18. a field nobody validates, smuggled in alongside', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, points: 999 })),
);
await check('19. ...even one that looks official', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, judgedBy: CLUB_ADMIN })),
);
await check('20. a document with a field missing', 'DENY', () => {
  const d = attemptDoc({ round: 2 });
  delete d.videoUrl;
  return setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), d);
});
await check('21. a reportedTime that is not a number', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, reportedTime: '12.34' })),
);
await check('22. a negative reportedTime', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, reportedTime: -1 })),
);
await check('23. an isDnf that is not a boolean', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, isDnf: 'yes' })),
);
await check('24. attempt 0', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 0)), attemptDoc({ round: 0 })),
);
await check('25. an attempt beyond any format’s run length', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 6)), attemptDoc({ round: 6 })),
);
await check('26. competition round 0', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 0)), attemptDoc({ round: 2, competitionRound: 0 })),
);
await check('27. an empty videoUrl — a submission with no evidence', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, videoUrl: '' })),
);
await check('28. a backdated createdAt', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2)), attemptDoc({ round: 2, createdAt: new Date(2020, 0, 1) })),
);

// ── CREATE: the stage marks ─────────────────────────────────────────────
// Where each stage button was pressed, in ms from the first frame of the
// attempt's video (SolveMarks in types.ts). They are seek positions for a
// reviewer, NOT a timing authority — reportedTime is still the athlete's
// own stopwatch, read off the video — so the rule's job here is only to
// keep the map well-formed, never to make a solve unfileable.
//
// Filed in competition round 3, so these land at ids nothing else in this
// file uses: attempt 2 of round 1 must stay non-existent for the "a get of
// an attempt that does not exist is denied" check further down.
//
// Note that every ALLOW above already covers the other half of "optional":
// attemptDoc() carries no marks at all.
const MARKS = { scrambleShown: 8100, solveStart: 24300, solveEnd: 39750, cubeShown: 48200, recordingEnd: 56400 };
await check('29. an attempt filed WITH its stage marks', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 3)),
    attemptDoc({ round: 2, competitionRound: 3, marks: MARKS }),
  ),
);
// The requirement the whole field is subordinate to: a recorder that never
// fired `onstart`, or an attempt whose marks are half-gathered, must still
// file. An empty map and a partial one are both normal outcomes.
await check('30. ...or with only some of them', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3, 3)),
    attemptDoc({ round: 3, competitionRound: 3, marks: { solveStart: 24300, recordingEnd: 56400 } }),
  ),
);
await check('31. ...or with none gathered at all', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 4, 3)),
    attemptDoc({ round: 4, competitionRound: 3, marks: {} }),
  ),
);
await check('32. a mark that is not a number', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 4)),
    attemptDoc({ round: 2, competitionRound: 4, marks: { ...MARKS, solveEnd: '39750' } }),
  ),
);
await check('33. ...or a null one', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 4)),
    attemptDoc({ round: 2, competitionRound: 4, marks: { ...MARKS, cubeShown: null } }),
  ),
);
// A mark is an offset from the first frame; there is no video before it.
await check('34. ...or a negative one', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 4)),
    attemptDoc({ round: 2, competitionRound: 4, marks: { ...MARKS, scrambleShown: -1 } }),
  ),
);
// The same hole submissionKeysOk closes at the top level, one level down:
// an unvalidated field must not be smuggled in INSIDE the map either.
await check('35. an unknown key smuggled into the map', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 4)),
    attemptDoc({ round: 2, competitionRound: 4, marks: { ...MARKS, judgedBy: CLUB_ADMIN } }),
  ),
);
await check('36. marks that are not a map at all', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 4)),
    attemptDoc({ round: 2, competitionRound: 4, marks: 56400 }),
  ),
);

// ── CREATE: coverStart, the one automatic mark ──────────────────────────
// Every other mark names a button the athlete pressed. This one names the
// scramble reveal running itself out and handing over to the cover stage,
// which is what the judge's КОВЕР jump aims at.
//
// It is OPTIONAL IN A SECOND SENSE, which is what these three cover: not
// merely "the recorder might not have gathered it" like the others, but
// "every attempt filed before this mark existed has the other five and
// never this one". Both shapes have to keep filing, forever.
await check('36a. an attempt filed WITH coverStart', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 5, 3)),
    attemptDoc({ round: 5, competitionRound: 3, marks: { ...MARKS, coverStart: 14200 } }),
  ),
);
// The legacy shape, and the reason the field could not be made required.
await check('36b. ...or without it, as every older attempt is', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 1, 5)),
    attemptDoc({ round: 1, competitionRound: 5, marks: MARKS }),
  ),
);
await check('36c. a negative coverStart', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 5)),
    attemptDoc({ round: 2, competitionRound: 5, marks: { ...MARKS, coverStart: -1 } }),
  ),
);
await check('36d. ...or a non-numeric one', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3, 5)),
    attemptDoc({ round: 3, competitionRound: 5, marks: { ...MARKS, coverStart: '14200' } }),
  ),
);

// ── CREATE: the still ids ───────────────────────────────────────────────
// Cloudinary public ids for the full-resolution frames grabbed during the
// two 8-second holds — the video is 250kbps and cannot carry a legible
// timer face, so the digits are read off these instead. At most three per
// hold, which is what the client schedules.
//
// As with marks, the rule's job is to keep the field well-formed and
// NEVER to make a solve unfileable: a run that captured nothing files
// with two empty lists and reviews exactly like any other.
const SHOTS = ['oc/t1', 'oc/t2', 'oc/t3'];
await check('37. an attempt filed with a full set of stills, both holds', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 5)),
    attemptDoc({ round: 2, competitionRound: 5, timerShotIds: SHOTS, cubeShotIds: SHOTS }),
  ),
);
await check('38. ...or a partial set, which a dropped grab leaves behind', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3, 5)),
    attemptDoc({ round: 3, competitionRound: 5, timerShotIds: ['oc/t1'], cubeShotIds: [] }),
  ),
);
// THE REQUIREMENT THE FEATURE IS SUBORDINATE TO: no stills, still files.
await check('39. ...or none at all, the field absent entirely', 'ALLOW', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 4, 5)),
    attemptDoc({ round: 4, competitionRound: 5 }),
  ),
);
await check('40. a fourth still, beyond what the run can capture', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 6)),
    attemptDoc({ round: 2, competitionRound: 6, timerShotIds: [...SHOTS, 'oc/t4'] }),
  ),
);
await check('41. ...on the cube hold too', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 6)),
    attemptDoc({ round: 2, competitionRound: 6, cubeShotIds: [...SHOTS, 'oc/c4'] }),
  ),
);
await check('42. a still id that is not a string', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 6)),
    attemptDoc({ round: 2, competitionRound: 6, timerShotIds: ['oc/t1', 42, 'oc/t3'] }),
  ),
);
await check('43. ...including in the last slot, which the size guard reaches', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 6)),
    attemptDoc({ round: 2, competitionRound: 6, cubeShotIds: ['oc/c1', 'oc/c2', null] }),
  ),
);
await check('44. shot ids that are not a list at all', 'DENY', () =>
  setDoc(
    doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2, 6)),
    attemptDoc({ round: 2, competitionRound: 6, timerShotIds: 'oc/t1' }),
  ),
);

// ── UPDATE: a filed attempt is immutable to the athlete ─────────────────
// The quieter half of the hole: rewriting your own pending attempt is
// re-solving it.
await seed(idFor(ATHLETE, 3), attemptDoc({ round: 3, reportedTime: 2500 }));
await check('45. THE OTHER HOLE: rewriting their own pending attempt’s time', 'DENY', () =>
  updateDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), { reportedTime: 900 }),
);
await check('46. ...or its video', 'DENY', () =>
  updateDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), { videoUrl: 'https://example.com/better.webm' }),
);
await check('47. ...or by re-filing the whole document at the same id', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), attemptDoc({ round: 3, reportedTime: 900 })),
);
await check('48. ...even re-filing it IDENTICALLY (the client treats this denial as success)', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), attemptDoc({ round: 3, reportedTime: 2500 })),
);
await check('49. ...or flipping their own status to approved', 'DENY', () =>
  updateDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), { status: 'approved' }),
);
await check("50. ...or touching another athlete's", 'DENY', () =>
  updateDoc(doc(other(), 'onlineSubmissions', idFor(ATHLETE, 3)), { reportedTime: 900 }),
);
await check('51. deleting a filed attempt', 'DENY', () =>
  deleteDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3))),
);

// ── READ: unchanged ─────────────────────────────────────────────────────
await check('52. the athlete reads their own attempt', 'ALLOW', () =>
  getDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3))),
);
await check("53. another athlete cannot read it", 'DENY', () =>
  getDoc(doc(other(), 'onlineSubmissions', idFor(ATHLETE, 3))),
);
// Known and relied upon by createSubmission's already-filed check: a get
// of a document that does not exist is DENIED, not empty, because the read
// rule dereferences resource.data.uid.
await check('54. a get of an attempt that does not exist is denied, not empty', 'DENY', () =>
  getDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2))),
);

// ── The club admin, and the judge ───────────────────────────────────────
await check('55. the club admin may still correct a submission', 'ALLOW', () =>
  updateDoc(doc(clubAdmin(), 'onlineSubmissions', idFor(ATHLETE, 3)), { status: 'approved', penalty: '+2' }),
);
await check('56. the club admin may still delete one', 'ALLOW', () =>
  deleteDoc(doc(clubAdmin(), 'onlineSubmissions', idFor(ATHLETE, 5))),
);
// The khorom judge dashboard has no Firebase Auth identity at all — it is
// gated by a password cookie and writes through the Admin SDK, which
// bypasses these rules entirely. withSecurityRulesDisabled is how that is
// modelled here, the same way participants.test.mjs models the admin
// registration write.
await check('57. the judge’s verdict (Admin SDK: rules bypassed) still lands', 'ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'onlineSubmissions', idFor(ATHLETE, 1)),
      attemptDoc({ status: 'approved', penalty: '+2' }),
    );
  });
});
await check('58. ...including a shape the athlete could never write', 'ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'onlineSubmissions', 'legacy-random-id-from-addDoc'), {
      ...attemptDoc({ status: 'rejected' }),
      judgeNote: 'бичлэг тод биш',
    });
  });
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
