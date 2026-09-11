// ── Registration documents: status, read shape, what a save writes ──────
// Pure unit tests for registration-shape.ts. No emulator.
//
// The load-bearing group is WHAT AN EDIT WRITES. The old writer replaced
// the whole document on every save, erasing recordAo5Result's `results`
// map and rewriting registeredAt; once review exists it would also have
// erased an admin's status. These pin that an edit sends exactly
// events + updatedAt + note, and nothing else.
//
// The same builder is then run against the REAL rules on the emulator, in
// a real transaction, by tests/firestore-rules/participants.test.mjs.
//
// Run: npm run test:regshape

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-regshape-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/registration-shape.ts',
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

const {
  REGISTRATION_STATUSES,
  normalizeRegistrationStatus,
  normalizeStoredRegistration,
  buildRegistrationWrite,
  isCompetingRegistration,
  isFeeQuotedRegistration,
} = require(path.join(OUT, 'registration-shape.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`          -> ${detail}`);
  }
}
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const keys = (o) => Object.keys(o).sort().join(',');

console.log('\n  -- status: the legacy value reads as approved --');
eq('"registered" (every doc before review) -> approved', normalizeRegistrationStatus('registered'), 'approved');
eq('absent -> approved (a registration existing meant registered)', normalizeRegistrationStatus(undefined), 'approved');
eq('null -> approved', normalizeRegistrationStatus(null), 'approved');
for (const s of ['pending', 'waitlisted', 'approved', 'cancelled', 'rejected']) {
  eq(`"${s}" passes through`, normalizeRegistrationStatus(s), s);
}
// Fail CLOSED: a status will gate things, and junk must never read as approved.
for (const junk of ['APPROVED', 'accepted', '', 1, {}, true]) {
  eq(`unrecognised ${JSON.stringify(junk)} -> pending, never approved`, normalizeRegistrationStatus(junk), 'pending');
}
eq('the list covers exactly the five states', REGISTRATION_STATUSES.join(','), 'pending,waitlisted,approved,cancelled,rejected');
ok('"registered" is NOT a member of the enum — a stored spelling only', !REGISTRATION_STATUSES.includes('registered'));

console.log('\n  -- what a status MEANS: the two questions (D7) --');
// COMPETING — the roster, the ТАМИРЧИН count, round progress, Эхлүүлэх.
eq('approved competes', isCompetingRegistration('approved'), true);
for (const s of ['pending', 'waitlisted', 'cancelled', 'rejected']) {
  eq(`${s} does NOT compete`, isCompetingRegistration(s), false);
}
// The legacy spellings: these athletes registered under a system with no
// review, and must not drop out of a roster they are already in.
eq('the legacy "registered" competes', isCompetingRegistration('registered'), true);
eq('an absent status competes', isCompetingRegistration(undefined), true);
eq('junk does NOT compete (fail closed)', isCompetingRegistration('APPROVED'), false);

// QUOTED A FEE — the fee-change warning, and only it.
for (const s of ['pending', 'waitlisted', 'approved']) {
  eq(`${s} was quoted the fee`, isFeeQuotedRegistration(s), true);
}
eq('cancelled was NOT', isFeeQuotedRegistration('cancelled'), false);
eq('rejected was NOT', isFeeQuotedRegistration('rejected'), false);
eq('the legacy "registered" was quoted the fee', isFeeQuotedRegistration('registered'), true);
// Junk reads as pending, which IS quoted — the two predicates disagree
// about it deliberately: fail closed on who competes, fail open on
// warning the admin that someone may be affected by a re-pricing.
eq('junk counts as quoted (a warning is the safe side)', isFeeQuotedRegistration('APPROVED'), true);
ok('the two questions differ for exactly pending and waitlisted',
  REGISTRATION_STATUSES.filter((s) => isCompetingRegistration(s) !== isFeeQuotedRegistration(s)).join(',') ===
    'pending,waitlisted');

console.log('\n  -- D7 call sites: every reader asks one of the two questions --');
// A source audit, not a behaviour test: these five sites are React
// components and Next route handlers that cannot be loaded here, and the
// whole point of PR-2 is that NONE of them treats a registration as a
// competitor on its own. The roster's and the counts' real behaviour is
// pinned against the emulator in roundtrip.test.cjs.
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const uses = (rel, needle) => ok(`${rel} -> ${needle}`, src(rel).includes(needle));

  // Approved only.
  uses('lib/online-competition/scramble-roster.ts', 'isCompetingRegistration(d.data().status)');
  uses('app/api/online-competition/admin-competitions/route.ts', "isCompetingRegistration(d.get('status'))");
  // The overview's round-progress arithmetic moved into its own pure
  // module when it was found to be counting attempt indices as rounds;
  // the D7 filter moved with it and is tested there directly.
  uses('lib/online-competition/round-progress.ts', "r.status === 'approved'");
  // Everyone who was quoted a price — the ONE site that is deliberately wider.
  uses('lib/online-competition/admin-competitions.ts', 'isFeeQuotedRegistration(d.data().status)');

  // The athlete's own views, all through the same copy function.
  for (const rel of [
    'app/online-competition/dashboard/_components/LiveCard.tsx',
    'app/online-competition/dashboard/_components/UpcomingCard.tsx',
    'app/online-competition/_components/hub/v3/MyCompetitions.tsx',
    'app/online-competition/[competitionId]/details/_components/RegistrationPanel.tsx',
  ]) {
    uses(rel, 'competeGateCopy(');
  }
  // The start button is behind the gate, not merely styled differently.
  const live = src('app/online-competition/dashboard/_components/LiveCard.tsx');
  ok('LiveCard returns the locked chip BEFORE it can reach the Эхлүүлэх link',
    live.indexOf('if (gate) {') < live.indexOf('oc-v3-start-btn"'));
  // The admin review LISTING must not be filtered — the review table is
  // the one place that has to see every status. Scoped to that function:
  // the same file's applyRegistrationPatch counts approved registrations
  // for the participant limit, which is a different question.
  {
    const adminRegs = src('lib/online-competition/admin-registrations.ts');
    const listing = adminRegs.slice(
      adminRegs.indexOf('export async function listCompetitionRegistrations'),
      adminRegs.indexOf('export class RegistrationPatchError'),
    );
    ok('the admin registrations listing stays unfiltered',
      !listing.includes('isCompetingRegistration') && !listing.includes("status ==="));
    // ...and the limit count, which is not the listing, uses the shared
    // predicate rather than a second spelling of "approved".
    ok('the participant-limit count asks the same D7 question',
      adminRegs.includes('isCompetingRegistration(d.data().status)'));
  }
}

console.log('\n  -- read shape --');
{
  const TS = { toMillis: () => 1 }; // stands in for a Firestore Timestamp
  const r = normalizeStoredRegistration(
    { competitionId: 'c1', events: ['333', '222'], status: 'registered', registeredAt: TS, note: 'Утас 9911',
      results: { '333': { ao5: 1234 } } },
    'fallback',
  );
  eq('the legacy status is converted', r.status, 'approved');
  eq('events kept', r.events.join(','), '333,222');
  eq('note kept', r.note, 'Утас 9911');
  ok('registeredAt passes through untouched', r.registeredAt === TS);
  eq('updatedAt absent on an old doc stays absent', 'updatedAt' in r, false);
  // Left out of the READ shape — safe now, because nothing writes this
  // shape back. Under the old whole-document replace it would have been
  // data loss.
  eq('results is not part of the read shape', 'results' in r, false);
}
eq('a missing competitionId falls back to the document id',
  normalizeStoredRegistration({ events: ['333'] }, 'doc-id').competitionId, 'doc-id');
eq('non-string events are dropped', normalizeStoredRegistration({ events: ['333', 7, null, ''] }, 'c').events.join(','), '333');
eq('a non-string note reads as no note', 'note' in normalizeStoredRegistration({ note: { x: 1 } }, 'c'), false);
eq('a blank note reads as no note', 'note' in normalizeStoredRegistration({ note: '   ' }, 'c'), false);
eq('the admin statusNote is read', normalizeStoredRegistration({ statusNote: 'Төлбөр хүлээгдэж буй' }, 'c').statusNote,
  'Төлбөр хүлээгдэж буй');
eq('a non-string statusNote reads as none', 'statusNote' in normalizeStoredRegistration({ statusNote: 7 }, 'c'), false);
eq('junk in, a usable shape out', normalizeStoredRegistration(null, 'c').status, 'approved');

console.log('\n  -- what a FIRST registration writes --');
const S = { now: '<serverTimestamp>', remove: '<deleteField>' };
{
  const w = buildRegistrationWrite(false, { competitionId: 'c1', events: ['333'], note: '  хамт ирнэ  ' }, S);
  eq('kind', w.kind, 'create');
  eq('fields: exactly these six', keys(w.data), 'competitionId,events,note,registeredAt,status,updatedAt');
  // PR-1: an athlete registers as 'pending' — the only status the rules
  // let them create with. An admin moves it on.
  eq('status is "pending" (review)', w.data.status, 'pending');
  eq('registeredAt is stamped', w.data.registeredAt, S.now);
  eq('updatedAt is stamped', w.data.updatedAt, S.now);
  eq('the note is trimmed', w.data.note, 'хамт ирнэ');
}
{
  const w = buildRegistrationWrite(false, { competitionId: 'c1', events: ['333'], note: '   ' }, S);
  eq('a blank note is OMITTED on create (absent = no note)', keys(w.data), 'competitionId,events,registeredAt,status,updatedAt');
}

console.log('\n  -- what an EDIT writes: the athlete’s own fields and nothing else --');
{
  const w = buildRegistrationWrite(true, { competitionId: 'c1', events: ['333', '444'], note: 'шинэ' }, S);
  eq('kind', w.kind, 'update');
  eq('fields: EXACTLY events, note, updatedAt', keys(w.data), 'events,note,updatedAt');
  ok('never status — an admin will set it', !('status' in w.data));
  ok('never registeredAt — set once', !('registeredAt' in w.data));
  ok('never competitionId — it mirrors the document id', !('competitionId' in w.data));
  ok('never results — recordAo5Result’s map survives', !('results' in w.data));
  eq('events replaced', w.data.events.join(','), '333,444');
  eq('updatedAt stamped', w.data.updatedAt, S.now);
}
{
  const w = buildRegistrationWrite(true, { competitionId: 'c1', events: ['333'], note: '' }, S);
  // A merge cannot remove a field by omitting it; clearing must delete.
  eq('clearing the note on an edit DELETES it', w.data.note, S.remove);
}
{
  // An edit NEVER writes the admin's fields — D4: an approved athlete who
  // changes events stays approved, and the admin's note stays.
  const w = buildRegistrationWrite(true, { competitionId: 'c', events: ['333'], note: 'x' }, S);
  ok('an edit never writes statusNote', !('statusNote' in w.data));
  ok('an edit never writes status', !('status' in w.data));
}
{
  const long = 'а'.repeat(350);
  eq('a note over the limit is capped at 300 (create)',
    buildRegistrationWrite(false, { competitionId: 'c', events: ['333'], note: long }, S).data.note.length, 300);
  eq('  ...and on an edit',
    buildRegistrationWrite(true, { competitionId: 'c', events: ['333'], note: long }, S).data.note.length, 300);
}

console.log('\n  -- data.ts uses this builder, and no longer overwrites --');
{
  const data = fs.readFileSync(path.join(ROOT, 'lib/online-competition/data.ts'), 'utf8');
  const fn = data.slice(data.indexOf('export async function registerForCompetition'), data.indexOf('export async function fetchRegistration'));
  ok('registerForCompetition calls buildRegistrationWrite', fn.includes('buildRegistrationWrite('));
  ok('  ...inside a transaction', fn.includes('runTransaction('));
  ok('  ...and updates on an edit', fn.includes('tx.update(ref, write.data)'));
  ok('  ...never a whole-document setDoc on the registration', !/setDoc\(\s*registrationRef/.test(fn) && !/setDoc\(ref/.test(fn));
  ok('fetchRegistration reads through the normaliser', /fetchRegistration[\s\S]*?normalizeStoredRegistration\(/.test(data));
  ok('fetchMyRegistrations reads through the normaliser', /fetchMyRegistrations[\s\S]*?normalizeStoredRegistration\(/.test(data));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
