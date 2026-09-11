// ── The participant limit ───────────────────────────────────────────────
// REAL unit tests — participant-limit.ts is pure. The transaction that
// makes the check atomic is exercised against the emulator in
// roundtrip.test.cjs, including two admins approving at once.
//
// What it protects: participantLimit was displayed from the beginning and
// enforced by nothing. An admin could approve a 65th athlete into a
// 64-place competition, and the only sign was the review table honestly
// reading "65/64".
//
// Run: npm run test:limit

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-limit-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/participant-limit.ts',
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

const { checkApprovalLimit, limitRefusalMessage } = require(path.join(OUT, 'participant-limit.js'));

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

const uids = (n, prefix = 'a') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const check = (approved, patch, limit) =>
  checkApprovalLimit({ approvedUids: approved, patchUids: patch, limit });

console.log('\n  -- does it fit --');
eq('room for one more', check(uids(3), ['new'], 4).ok, true);
eq('the last place exactly', check(uids(63), ['new'], 64).ok, true);
eq('one past the last place', check(uids(64), ['new'], 64).ok, false);
eq('an empty competition', check([], ['new'], 1).ok, true);
eq('a bulk that exactly fills it', check(uids(60), uids(4, 'b'), 64).ok, true);
eq('a bulk one too large', check(uids(60), uids(5, 'b'), 64).ok, false);

console.log('\n  -- unlimited never refuses --');
eq('null limit, a thousand approved', check(uids(1000), uids(50, 'b'), null).ok, true);
eq('  ...and an empty one', check([], ['new'], null).ok, true);

console.log('\n  -- re-approving takes no place --');
{
  // The bulk includes someone already approved: they are not a new
  // occupant, so a competition with one place left still takes it.
  eq('a bulk of one already-approved athlete always fits',
    check(uids(64), ['a1'], 64).ok, true);
  eq('already-approved members do not count toward what is needed',
    check(uids(63), ['a1', 'new'], 64).ok, true);
  eq('  ...but the genuinely new ones still do',
    check(uids(63), ['a1', 'new1', 'new2'], 64).ok, false);
  const refused = check(uids(63), ['a1', 'new1', 'new2'], 64);
  eq('  ...and "needed" counts only those', refused.needed, 2);
  // Nothing to approve at all: a note-only patch on approved athletes.
  eq('a patch that approves nobody new is never refused', check(uids(64), uids(64), 64).ok, true);
}

console.log('\n  -- already over the limit --');
{
  // Approved past the limit before this existed, or the limit was lowered
  // afterwards. Further approvals refuse; nothing here un-approves anyone.
  const over = check(uids(70), ['new'], 64);
  eq('a further approval is refused', over.ok, false);
  eq('  ...reporting what is actually approved', over.approved, 70);
  eq('  ...against the limit as configured', over.limit, 64);
  eq('  ...with no negative places left', over.remaining, 0);
  ok('  ...and no result field asks anyone to be removed',
    Object.keys(over).sort().join(',') === 'approved,limit,needed,ok,remaining');
  // Re-approving one of the 70 is still fine: it takes no new place.
  eq('re-approving an existing member still works when over', check(uids(70), ['a5'], 64).ok, true);
}

console.log('\n  -- what the admin is told --');
{
  const full = check(uids(64), ['new'], 64);
  const msg = limitRefusalMessage(full);
  ok('a full competition says so, with the numbers', /64\/64/.test(msg), msg);
  ok('  ...and offers the waitlist as the next step', /ХҮЛЭЭЛГЭНД/.test(msg), msg);

  const partial = check(uids(60), uids(8, 'b'), 64);
  const msg2 = limitRefusalMessage(partial);
  eq('  ...places remaining', partial.remaining, 4);
  eq('  ...places needed', partial.needed, 8);
  ok('a partial fit names both numbers', /4 орон зай/.test(msg2) && /8 тамирчин/.test(msg2), msg2);
  ok('  ...and also offers the waitlist', /ХҮЛЭЭЛГЭНД/.test(msg2), msg2);

  const over = limitRefusalMessage(check(uids(70), ['new'], 64));
  ok('an over-limit competition reports the real count, not a clamped one',
    /70\/64/.test(over), over);
}

console.log('\n  -- the call sites --');
{
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const admin = src('lib/online-competition/admin-registrations.ts');
  // TRANSACTION, NOT CHECK-THEN-WRITE: two admins approving at once must
  // not both pass a check that was true for each of them separately.
  ok('the count happens inside the write transaction',
    admin.indexOf('db.runTransaction') < admin.indexOf('checkApprovalLimit({'));
  ok('  ...before any write', admin.indexOf('checkApprovalLimit({') < admin.indexOf('tx.update(ref, update)'));
  ok('  ...reading the registrations transactionally, so a concurrent approval retries it',
    admin.includes("await tx.get(db.collectionGroup('registrations'))"));
  ok('  ...and the limit from the competition document, also in the transaction',
    admin.includes("await tx.get(db.collection('onlineCompetitions').doc(competitionId))"));
  ok('only an APPROVAL is checked — cancelling must work when full',
    admin.includes("if (patch.status === 'approved') {"));
  ok('the refusal is a 409 carrying the message', admin.includes('limitRefusalMessage(limitCheck)'));

  const review = src('app/online-competition/admin/competitions/[id]/_components/RegistrationReview.tsx');
  ok('the table shows a 409 as the decision it is, not as a failed save',
    review.includes('if (res.status === 409 && data.error)'));
  ok('  ...and keeps the selection so ХҮЛЭЭЛГЭНД is one click away',
    /const ok = await patch\([\s\S]{0,200}?if \(ok\) \{/.test(review));

  const editor = src('app/online-competition/admin/_components/CompetitionEditor.tsx');
  ok('lowering the limit below the approved count warns rather than refusing',
    editor.includes('limitLoweredWarning'));
  ok('  ...saying nobody is un-approved', editor.includes('Хэний ч бүртгэл цуцлагдахгүй'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
