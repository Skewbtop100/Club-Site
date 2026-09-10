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

// ── UPDATE: a filed attempt is immutable to the athlete ─────────────────
// The quieter half of the hole: rewriting your own pending attempt is
// re-solving it.
await seed(idFor(ATHLETE, 3), attemptDoc({ round: 3, reportedTime: 2500 }));
await check('29. THE OTHER HOLE: rewriting their own pending attempt’s time', 'DENY', () =>
  updateDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), { reportedTime: 900 }),
);
await check('30. ...or its video', 'DENY', () =>
  updateDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), { videoUrl: 'https://example.com/better.webm' }),
);
await check('31. ...or by re-filing the whole document at the same id', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), attemptDoc({ round: 3, reportedTime: 900 })),
);
await check('32. ...even re-filing it IDENTICALLY (the client treats this denial as success)', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), attemptDoc({ round: 3, reportedTime: 2500 })),
);
await check('33. ...or flipping their own status to approved', 'DENY', () =>
  updateDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3)), { status: 'approved' }),
);
await check("34. ...or touching another athlete's", 'DENY', () =>
  updateDoc(doc(other(), 'onlineSubmissions', idFor(ATHLETE, 3)), { reportedTime: 900 }),
);
await check('35. deleting a filed attempt', 'DENY', () =>
  deleteDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3))),
);

// ── READ: unchanged ─────────────────────────────────────────────────────
await check('36. the athlete reads their own attempt', 'ALLOW', () =>
  getDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 3))),
);
await check("37. another athlete cannot read it", 'DENY', () =>
  getDoc(doc(other(), 'onlineSubmissions', idFor(ATHLETE, 3))),
);
// Known and relied upon by createSubmission's already-filed check: a get
// of a document that does not exist is DENIED, not empty, because the read
// rule dereferences resource.data.uid.
await check('38. a get of an attempt that does not exist is denied, not empty', 'DENY', () =>
  getDoc(doc(athlete(), 'onlineSubmissions', idFor(ATHLETE, 2))),
);

// ── The club admin, and the judge ───────────────────────────────────────
await check('39. the club admin may still correct a submission', 'ALLOW', () =>
  updateDoc(doc(clubAdmin(), 'onlineSubmissions', idFor(ATHLETE, 3)), { status: 'approved', penalty: '+2' }),
);
await check('40. the club admin may still delete one', 'ALLOW', () =>
  deleteDoc(doc(clubAdmin(), 'onlineSubmissions', idFor(ATHLETE, 5))),
);
// The khorom judge dashboard has no Firebase Auth identity at all — it is
// gated by a password cookie and writes through the Admin SDK, which
// bypasses these rules entirely. withSecurityRulesDisabled is how that is
// modelled here, the same way participants.test.mjs models the admin
// registration write.
await check('41. the judge’s verdict (Admin SDK: rules bypassed) still lands', 'ALLOW', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'onlineSubmissions', idFor(ATHLETE, 1)),
      attemptDoc({ status: 'approved', penalty: '+2' }),
    );
  });
});
await check('42. ...including a shape the athlete could never write', 'ALLOW', async () => {
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
