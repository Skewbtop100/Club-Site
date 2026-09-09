import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

// Rules tests for onlineCompetitions/{competitionId} — specifically the
// draft guard. See ./README.md.
//
// Same conventions as participants.test.mjs: RULES_PATH overrides the rules
// file, the emulator is assumed to be up (npm run test:rules wraps that).
const RULES = process.env.RULES_PATH ?? 'firestore.rules';
const ADMIN_UID = 'clubadmin1';
const ATHLETE_UID = 'athlete1';

let pass = 0;
let fail = 0;

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check-competitions',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

// One fixed corpus for every case below — seeded once, bypassing rules.
// `legacyActive` and `legacyNoStatus` are the two pre-migration shapes
// normalizeStatus in lib/online-competition/data.ts still tolerates. They
// land differently under these rules and that difference is the point:
// `legacyActive` stays public (case 7), `legacyNoStatus` does not (case 8).
const DOCS = {
  draftComp: { name: 'Ноорог тэмцээн', status: 'draft', events: [], season: '' },
  upcomingComp: { name: 'Удахгүй', status: 'upcoming', events: [], season: '' },
  liveComp: { name: 'Явагдаж буй', status: 'live', events: [], season: '' },
  finishedComp: { name: 'Дууссан', status: 'finished', events: [], season: '' },
  legacyActive: { name: 'Хуучин', status: 'active', events: [], season: '' },
  legacyNoStatus: { name: 'Статусгүй', events: [], season: '' },
};

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, data] of Object.entries(DOCS)) {
    await setDoc(doc(db, 'onlineCompetitions', id), data);
  }
  // isAdmin() reads users/{uid}.role — the club's Firebase Auth admin.
  await setDoc(doc(db, 'users', ADMIN_UID), { role: 'admin' });
  await setDoc(doc(db, 'users', ATHLETE_UID), { role: 'athlete' });
  // A subcollection doc under the DRAFT competition, for the gap case at
  // the bottom of this file.
  await setDoc(doc(db, 'onlineCompetitions', 'draftComp', 'scrambles', '333_1'), {
    event: '333',
    round: 1,
    scramble: "R U R' U'",
  });
});

const anon = () => testEnv.unauthenticatedContext().firestore();
const athlete = () => testEnv.authenticatedContext(ATHLETE_UID).firestore();
const admin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();

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

/** Assert a permitted query returns exactly the ids given. A rule that
 *  merely ALLOWS the query would still be wrong if the query returned a
 *  draft, so the allow-cases below check the payload too. */
async function checkIds(name, db, q, expected) {
  let ok;
  let detail;
  try {
    const snap = await getDocs(q(db));
    const got = snap.docs.map((d) => d.id).sort();
    const want = [...expected].sort();
    ok = got.length === want.length && got.every((v, i) => v === want[i]);
    if (!ok) detail = `got [${got.join(', ')}], want [${want.join(', ')}]`;
  } catch (e) {
    ok = false;
    detail = String(e?.message ?? e).split('\n')[0];
  }
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [returns] ${name}`);
  if (!ok) console.log(`          -> ${detail}`);
}

console.log('\n=== onlineCompetitions rules — the draft guard ===\n');

// ── get() by id ─────────────────────────────────────────────────────────
// The headline assertion: a draft is not publicly readable, not even by
// someone who knows its document id.
await check('1. anonymous get of a DRAFT competition', 'DENY', () =>
  getDoc(doc(anon(), 'onlineCompetitions', 'draftComp')),
);
await check('2. signed-in non-admin get of a DRAFT competition', 'DENY', () =>
  getDoc(doc(athlete(), 'onlineCompetitions', 'draftComp')),
);
await check('3. club admin get of a DRAFT competition', 'ALLOW', () =>
  getDoc(doc(admin(), 'onlineCompetitions', 'draftComp')),
);

// Everything non-draft stays as publicly readable as it was before.
await check('4. anonymous get of an upcoming competition', 'ALLOW', () =>
  getDoc(doc(anon(), 'onlineCompetitions', 'upcomingComp')),
);
await check('5. anonymous get of a live competition', 'ALLOW', () =>
  getDoc(doc(anon(), 'onlineCompetitions', 'liveComp')),
);
await check('6. anonymous get of a finished competition', 'ALLOW', () =>
  getDoc(doc(anon(), 'onlineCompetitions', 'finishedComp')),
);
await check("7. anonymous get of a legacy doc with status 'active'", 'ALLOW', () =>
  getDoc(doc(anon(), 'onlineCompetitions', 'legacyActive')),
);
// THE TRADE-OFF, pinned. virtualCompetitions guards drafts with
//   isAdmin() || !('status' in resource.data) || status != 'draft'
// and that middle clause makes the guard fail open on list queries: with
// it, an anonymous UNFILTERED getDocs() of the collection succeeds and
// returns every draft (case 9 below). onlineCompetitions therefore omits
// it, and the price is this case — a doc with no `status` field is
// unreadable rather than public.
//
// Deliberate, and cheap: every doc toFirestoreDoc writes has a status, and
// the public list already cannot see field-less docs either way (case 11b).
// Asserted as DENY so that if anyone "fixes" this by restoring the `in`
// clause, case 9 fails and says why.
await check('8. anonymous get of a legacy doc with NO status field (see comment)', 'DENY', () =>
  getDoc(doc(anon(), 'onlineCompetitions', 'legacyNoStatus')),
);
await check('8b. club admin CAN still get a doc with no status field', 'ALLOW', () =>
  getDoc(doc(admin(), 'onlineCompetitions', 'legacyNoStatus')),
);

// ── list() ──────────────────────────────────────────────────────────────
// Rules are not filters: a list query is allowed only if Firestore can
// prove from the query itself that nothing the rule refuses can come back.
//
// Case 9 is the assertion the whole guard rests on. If it ever flips to
// ALLOW, the draft feature is broken — a permitted unfiltered query hands
// back the drafts along with everything else, which is exactly what the
// virtualCompetitions rule shape does today.
await check('9. anonymous UNFILTERED list of the collection', 'DENY', () =>
  getDocs(collection(anon(), 'onlineCompetitions')),
);
await check('9b. signed-in non-admin UNFILTERED list', 'DENY', () =>
  getDocs(collection(athlete(), 'onlineCompetitions')),
);
await check('9c. club admin UNFILTERED list', 'ALLOW', () =>
  getDocs(collection(admin(), 'onlineCompetitions')),
);
await check("10. anonymous list filtered where status == 'draft'", 'DENY', () =>
  getDocs(query(collection(anon(), 'onlineCompetitions'), where('status', '==', 'draft'))),
);
// The exact query fetchAllCompetitions() issues. If this ever starts
// failing, the public hub and competitions page go blank.
await check("11. anonymous list filtered where status != 'draft'", 'ALLOW', () =>
  getDocs(query(collection(anon(), 'onlineCompetitions'), where('status', '!=', 'draft'))),
);
await checkIds(
  "11b. ...and it returns every non-draft doc that HAS a status, and no draft",
  anon(),
  (db) => query(collection(db, 'onlineCompetitions'), where('status', '!=', 'draft')),
  // legacyNoStatus is absent by design: an inequality filter only matches
  // docs that have the field, whatever the rule says. Documented as a known
  // limitation on fetchAllCompetitions in lib/online-competition/data.ts —
  // asserted rather than pretended away, so it cannot regress unnoticed
  // into "drafts leak" or be silently "fixed" by loosening the rule.
  ['upcomingComp', 'liveComp', 'finishedComp', 'legacyActive'],
);

// ── writes ──────────────────────────────────────────────────────────────
// Unchanged by this work; asserted so the read changes above can't quietly
// take the write guard with them.
await check('12. anonymous write', 'DENY', () =>
  setDoc(doc(anon(), 'onlineCompetitions', 'newComp'), { name: 'x', status: 'draft' }),
);
await check('13. signed-in non-admin write', 'DENY', () =>
  setDoc(doc(athlete(), 'onlineCompetitions', 'newComp'), { name: 'x', status: 'draft' }),
);
await check('14. club admin write', 'ALLOW', () =>
  setDoc(doc(admin(), 'onlineCompetitions', 'newComp'), { name: 'x', status: 'draft' }),
);

// ── Known gap, recorded on purpose ──────────────────────────────────────
// The draft guard is on the competition document only. Subcollection rules
// are unchanged, and `scrambles` is `allow read: if isSignedIn()` with no
// reference to the parent — so a signed-in athlete who knows a draft's id
// can still read its scrambles.
//
// Left as-is deliberately: closing it means a get() of the parent doc on
// every scramble read (the shape virtualCompetitions uses for its `rounds`
// subcollection), which is a billed read per access, and a draft has no
// rounds opened and so no scrambles to leak in the first place. This
// assertion exists so the gap is a recorded, tested fact rather than an
// oversight — if the subcollection is ever guarded, flip it to DENY.
await check(
  "15. GAP: signed-in athlete reads a DRAFT's scrambles subcollection (parent guard does not cascade)",
  'ALLOW',
  () => getDoc(doc(athlete(), 'onlineCompetitions', 'draftComp', 'scrambles', '333_1')),
);
// roundState/qualifiers/scrambleData are `if false` for every client, so a
// draft's round configuration is closed regardless of the parent.
await check("16. signed-in athlete reads a DRAFT's roundState", 'DENY', () =>
  getDoc(doc(athlete(), 'onlineCompetitions', 'draftComp', 'roundState', '333_1')),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await testEnv.cleanup();
process.exit(fail === 0 ? 0 : 1);
