// ── Two verification parts, each with its own decision ───────────────────
// REAL unit tests for verification.ts (pure), plus source checks on its
// callers. The same rules run against firestore.rules in
// tests/firestore-rules/verification.test.mjs.
//
// What must hold:
//   * approve details + reject photo; the athlete resubmits the photo; the
//     admin approves the photo — verified, and the details were never
//     decided again;
//   * an athlete approved under the old single approval stays verified;
//   * the athlete is told which part was approved and which rejected, with
//     the reason;
//   * a public screen names only an athlete an admin has verified.
//
// Run: npm run test:verification

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-verification-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/verification.ts',
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
const V = require(path.join(OUT, 'verification.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const SUBMITTED = {
  lastName: 'Бат',
  firstName: 'Эрдэнэ',
  dateOfBirth: '2011-04-12',
  gender: 'female',
  citizenship: 'mn',
  photoUrl: 'https://res.cloudinary.com/x/1.jpg',
};
const SNAPSHOT = {
  approvedLastName: 'Бат',
  approvedFirstName: 'Эрдэнэ',
  approvedDateOfBirth: '2011-04-12',
  approvedGender: 'female',
  approvedCitizenship: 'mn',
  approvedPhotoUrl: 'https://res.cloudinary.com/x/1.jpg',
};
/** What submitParticipantProfile stores. */
function submit(prior, identity, submittedAt) {
  const s = V.resubmissionStatuses(prior, identity);
  return {
    doc: {
      ...(prior ?? {}),
      ...identity,
      detailsStatus: s.detailsStatus,
      photoStatus: s.photoStatus,
      profileStatus: s.profileStatus,
      ...(s.anyPending ? { submittedAt } : {}),
    },
    s,
  };
}

console.log('\n  -- THE REQUIRED FLOW: approve details, reject photo, resubmit photo, approve photo --');
{
  let { doc } = submit({ uid: 'u1' }, SUBMITTED, 1000);
  eq('first submission: details pending', doc.detailsStatus, 'pending');
  eq('  ...photo pending', doc.photoStatus, 'pending');
  eq('  ...overall pending', doc.profileStatus, 'pending');

  const first = V.planDecision(doc, 1000, {
    submittedAt: 1000,
    details: { decision: 'approve' },
    photo: { decision: 'reject', reason: 'Царай харагдахгүй' },
  });
  ok('the admin approves details and rejects the photo', first.ok, JSON.stringify(first));
  doc = { ...doc, ...first.update };
  eq('  ...details stored approved', doc.detailsStatus, 'approved');
  eq('  ...photo stored rejected', doc.photoStatus, 'rejected');
  eq('  ...with the photo reason', doc.photoRejectionReason, 'Царай харагдахгүй');
  eq('  ...and no details reason', doc.detailsRejectionReason, null);
  eq('  ...overall rejected (the athlete has something to fix)', doc.profileStatus, 'rejected');
  eq('  ...the approved details are snapshotted', doc.approvedLastName, 'Бат');
  ok('  ...the rejected photo is NOT snapshotted', !('approvedPhotoUrl' in first.update));
  eq('  ...not verified', V.resolveVerification(doc).verified, false);
  eq('  ...the athlete is told which part, and why',
    first.notice, 'Мэдээлэл баталгаажлаа. Зураг татгалзагдлаа: Царай харагдахгүй. Зургаа солиод дахин илгээнэ үү.');
  eq('  ...the single field still reads sensibly', doc.rejectionReason, 'Зураг: Царай харагдахгүй');

  const resub = submit(doc, { ...SUBMITTED, photoUrl: 'https://res.cloudinary.com/x/2.jpg' }, 2000);
  doc = resub.doc;
  eq('resubmitting the photo: details STAY approved', doc.detailsStatus, 'approved');
  eq('  ...only the photo returns to pending', doc.photoStatus, 'pending');
  eq('  ...overall pending', doc.profileStatus, 'pending');

  const again = V.planDecision(doc, 2000, { submittedAt: 2000, details: { decision: 'approve' }, photo: { decision: 'approve' } });
  ok('the details cannot be decided again', !again.ok && again.status === 400 && /Мэдээлэл аль хэдийн/.test(again.error), JSON.stringify(again));

  const second = V.planDecision(doc, 2000, { submittedAt: 2000, photo: { decision: 'approve' } });
  ok('the admin approves the photo ALONE', second.ok, JSON.stringify(second));
  eq('  ...deciding nothing about the details', second.decided.details, undefined);
  ok('  ...and leaving the approved details snapshot untouched', !('approvedLastName' in second.update));
  doc = { ...doc, ...second.update };
  eq('  ...the new photo is the approved one', doc.approvedPhotoUrl, 'https://res.cloudinary.com/x/2.jpg');
  eq('  ...VERIFIED', V.resolveVerification(doc).verified, true);
  eq('  ...overall approved', doc.profileStatus, 'approved');
  eq('  ...no reason left', doc.rejectionReason, null);
  eq('  ...told', second.notice, 'Зураг баталгаажлаа. Профайл бүрэн баталгаажлаа — тэмцээнд бүртгүүлэх боломжтой.');
  eq('  ...and now publicly visible', V.isPubliclyVerified(doc), true);
}

console.log('\n  -- an old single-approval athlete stays verified --');
const LEGACY_APPROVED = { uid: 'old', ...SUBMITTED, ...SNAPSHOT, profileStatus: 'approved', rejectionReason: null };
{
  const v = V.resolveVerification(LEGACY_APPROVED);
  eq('read as verified', v.verified, true);
  eq('  ...details approved', v.details.status, 'approved');
  eq('  ...photo approved', v.photo.status, 'approved');
  eq('  ...marked as an old record', v.legacy, true);
  eq('  ...publicly visible', V.isPubliclyVerified(LEGACY_APPROVED), true);
  const same = submit(LEGACY_APPROVED, SUBMITTED, 5);
  eq('saving without a reviewed change keeps them approved', same.doc.profileStatus, 'approved');
  eq('  ...and is not a new request', same.s.anyPending, false);
  const photo = submit(LEGACY_APPROVED, { ...SUBMITTED, photoUrl: 'https://res.cloudinary.com/x/new.jpg' }, 5);
  eq('a new photo re-reviews the photo only: details approved', photo.doc.detailsStatus, 'approved');
  eq('  ...photo pending', photo.doc.photoStatus, 'pending');
  // Approved before the name snapshot existed, never backfilled.
  const noSnapshot = { uid: 'older', ...SUBMITTED, approvedPhotoUrl: SUBMITTED.photoUrl, profileStatus: 'approved' };
  eq('approved before name snapshots: still verified', V.resolveVerification(noSnapshot).verified, true);
  eq('  ...a photo-only resubmission keeps the untouched details approved',
    submit(noSnapshot, { ...SUBMITTED, photoUrl: 'https://res.cloudinary.com/x/n.jpg' }, 5).doc.detailsStatus, 'approved');
  eq('  ...still public', V.isPubliclyVerified(noSnapshot), true);
}
{
  eq('old pending: both parts pending', V.resolveVerification({ profileStatus: 'pending' }).photo.status, 'pending');
  eq('no status at all: incomplete', V.resolveVerification({ displayName: 'G' }).status, 'incomplete');
  eq('nothing: incomplete', V.resolveVerification(null).status, 'incomplete');
  const r = V.resolveVerification({ profileStatus: 'rejected', rejectionReason: 'Мэдээлэл: Нэр буруу; Зураг: Бүдэг' });
  eq('an old two-part reason is split: details', r.details.reason, 'Нэр буруу');
  eq('  ...photo', r.photo.reason, 'Бүдэг');
  const plain = V.resolveVerification({ profileStatus: 'rejected', rejectionReason: 'blurry' });
  eq('an old plain reason belongs to both', `${plain.details.reason}|${plain.photo.reason}`, 'blurry|blurry');
  eq('an invalid part value is ignored, the old status read',
    V.resolveVerification({ profileStatus: 'approved', detailsStatus: 'approved!', photoStatus: 'approved' }).legacy, true);
  const legacyPending = { ...SUBMITTED, profileStatus: 'pending', submittedAt: 7 };
  const half = V.planDecision(legacyPending, 7, { submittedAt: 7, details: { decision: 'approve' } });
  ok('an old pending request needs BOTH decisions', !half.ok && /Зураг: шийдвэр гаргана уу/.test(half.error), JSON.stringify(half));
  const full = V.planDecision(legacyPending, 7, { submittedAt: 7, details: { decision: 'approve' }, photo: { decision: 'approve' } });
  eq('  ...and gains its part fields on the first decision', `${full.update.detailsStatus}/${full.update.photoStatus}`, 'approved/approved');
}

console.log('\n  -- resubmission: what returns to pending --');
{
  const base = { ...SUBMITTED, ...SNAPSHOT, detailsStatus: 'approved', photoStatus: 'rejected', profileStatus: 'rejected' };
  eq('an edited approved detail returns to pending',
    V.resubmissionStatuses(base, { ...SUBMITTED, lastName: 'Батаа' }).detailsStatus, 'pending');
  eq('  ...and returns to approved if set back to exactly what was approved',
    V.resubmissionStatuses({ ...base, lastName: 'Typo' }, SUBMITTED).detailsStatus, 'approved');
  eq('a rejected part resubmitted unchanged still goes to pending',
    V.resubmissionStatuses(base, SUBMITTED).photoStatus, 'pending');
  eq('a first submission: both pending', V.resubmissionStatuses(null, SUBMITTED).profileStatus, 'pending');
  const both = { ...base, photoStatus: 'approved', profileStatus: 'approved' };
  eq('changing a detail and the photo: overall pending',
    V.resubmissionStatuses(both, { ...SUBMITTED, gender: 'male', photoUrl: 'https://x/3.jpg' }).profileStatus, 'pending');
}

console.log('\n  -- the admin decision: refused when it should be --');
{
  const pending = { ...SUBMITTED, detailsStatus: 'pending', photoStatus: 'pending', profileStatus: 'pending' };
  const stale = V.planDecision(pending, 3000, { submittedAt: 2000, details: { decision: 'approve' }, photo: { decision: 'approve' } });
  eq('a resubmission since the admin looked: 409', stale.status, 409);
  const decided = V.planDecision({ ...pending, profileStatus: 'approved', detailsStatus: 'approved', photoStatus: 'approved' }, null,
    { submittedAt: null, photo: { decision: 'approve' } });
  eq('nothing pending: 409', decided.status, 409);
  eq('no record: 404', V.planDecision(null, null, { submittedAt: null }).status, 404);
  const parse = (b) => V.parseDecisionBody(b);
  eq('the old single approve is refused', parse({ action: 'approve' }).status, 400);
  eq('a reject needs its reason', parse({ submittedAt: 1, photo: { decision: 'reject', reason: '  ' } }).status, 400);
  eq('  ...of at most 300 characters', parse({ submittedAt: 1, photo: { decision: 'reject', reason: 'x'.repeat(301) } }).status, 400);
  ok('  ...300 is fine', parse({ submittedAt: 1, photo: { decision: 'reject', reason: 'x'.repeat(300) } }).ok);
  eq('an unknown decision is refused', parse({ submittedAt: 1, details: { decision: 'maybe' } }).status, 400);
  eq('no decision at all is refused', parse({ submittedAt: 1 }).status, 400);
  eq('a reason is trimmed', parse({ submittedAt: null, details: { decision: 'reject', reason: ' Нэр ' } }).input.details.reason, 'Нэр');
}

console.log('\n  -- the notification wording --');
{
  const pending = { ...SUBMITTED, detailsStatus: 'pending', photoStatus: 'pending', profileStatus: 'pending', submittedAt: 1 };
  const notice = (details, photo) => {
    const p = V.planDecision(pending, 1, { submittedAt: 1, details, photo });
    return p.notice;
  };
  const A = { decision: 'approve' };
  const R = (reason) => ({ decision: 'reject', reason });
  eq('both approved', notice(A, A), 'Мэдээлэл болон зураг баталгаажлаа. Тэмцээнд бүртгүүлэх боломжтой.');
  eq('details rejected, photo approved', notice(R('Нэр буруу'), A),
    'Зураг баталгаажлаа. Мэдээлэл татгалзагдлаа: Нэр буруу. Мэдээллээ засаад дахин илгээнэ үү.');
  eq('both rejected', notice(R('Нэр буруу'), R('Бүдэг.')),
    'Мэдээлэл татгалзагдлаа: Нэр буруу. Зураг татгалзагдлаа: Бүдэг. Мэдээлэл, зургаа засаад дахин илгээнэ үү.');
  eq('a reason ending in a full stop is not doubled', notice(A, R('Бүдэг!')),
    'Мэдээлэл баталгаажлаа. Зураг татгалзагдлаа: Бүдэг. Зургаа солиод дахин илгээнэ үү.');
}

console.log('\n  -- public visibility --');
{
  eq('never submitted: hidden', V.isPubliclyVerified({ displayName: 'G' }), false);
  eq('waiting for a first review: hidden', V.isPubliclyVerified({ ...SUBMITTED, profileStatus: 'pending' }), false);
  eq('details approved, photo rejected, never verified: hidden',
    V.isPubliclyVerified({ ...SUBMITTED, approvedLastName: 'Бат', approvedFirstName: 'Эрдэнэ', detailsStatus: 'approved', photoStatus: 'rejected', profileStatus: 'rejected' }),
    false);
  eq('old rejected, never approved: hidden', V.isPubliclyVerified({ ...SUBMITTED, profileStatus: 'rejected' }), false);
  eq('verified: shown', V.isPubliclyVerified({ ...SUBMITTED, ...SNAPSHOT, detailsStatus: 'approved', photoStatus: 'approved' }), true);
  eq('verified earlier, an edit under re-review: still shown (by the approved name)',
    V.isPubliclyVerified({ ...SUBMITTED, lastName: 'Батаа', ...SNAPSHOT, detailsStatus: 'pending', photoStatus: 'approved', profileStatus: 'pending' }),
    true);
}

console.log('\n  -- the wiring --');
{
  const route = src('app/api/online-competition/admin-athletes/[uid]/route.ts');
  const gate = route.indexOf('isOnlineCompAdmin()');
  ok('the decision route refuses a non-admin before reading', gate > -1 && gate < route.indexOf("collection('onlineParticipants')"));
  ok('  ...decides inside a transaction, with planDecision',
    /db\.runTransaction\(async \(tx\) => \{[\s\S]*?planDecision\(/.test(route));
  ok('  ...and writes the notification in the SAME transaction',
    /tx\.update\(ref[\s\S]*?tx\.create\(db\.collection\(ONLINE_NOTIFICATIONS\)/.test(route) && route.includes("type: 'profile_verification'"));
  ok('  ...the old single approve/reject actions are gone', !route.includes("action === 'approve'") && !route.includes("action === 'reject'"));

  const data = src('lib/online-competition/data.ts');
  ok('the profile save decides each part against the STORED record, in a transaction',
    data.includes('return runTransaction(onlineCompDb, async (tx) => {') &&
      data.includes('resubmissionStatuses(snap.exists() ? snap.data() : null, input)'));
  ok('  ...and writes both part statuses', data.includes('detailsStatus: next.detailsStatus,') && data.includes('photoStatus: next.photoStatus,'));
  ok('"is this athlete verified" goes through the resolver', data.includes('return resolveVerification(participant).status;'));

  const panel = src('app/online-competition/[competitionId]/details/_components/RegistrationPanel.tsx');
  ok('the registration gate reads both parts, with each reason',
    panel.includes('resolveVerification(await fetchParticipant(uid))') && panel.includes('reason: rejectionSummary(verification)'));
  ok('the scramble roster reads both parts', src('lib/online-competition/scramble-roster.ts').includes('resolveVerification(profile).status'));

  const roster = src('app/api/online-competition/competitions/[id]/roster/route.ts');
  ok('the public roster lists verified athletes only', roster.includes('.filter((d) => isPubliclyVerified(profileByUid.get('));
  const live = src('app/api/online-competition/competitions/[id]/live/route.ts');
  ok('the live standings name only verified athletes', live.includes('publicRosterName(') && !/[^c]rosterName\(/.test(live));

  const requests = src('app/online-competition/admin/_components/AthleteRequests.tsx');
  ok('the requests screen sends the pending parts, with the submission it showed',
    requests.includes('submittedAt: a.submittedAt,') && requests.includes('decide(a, decisionBodyFor(a, checklistOf(a)))'));
  ok('  ...an earlier approval is locked, not decided again',
    requests.includes("const infoLocked = a.detailsStatus !== 'pending';") && requests.includes('ӨМНӨ БАТАЛГААЖСАН'));

  const profile = src('app/online-competition/profile/page.tsx');
  ok('the profile shows each part and each reason',
    profile.includes('<PartLines verification={verification} />') &&
      profile.includes('МЭДЭЭЛЛИЙГ ТАТГАЛЗСАН ШАЛТГААН') && profile.includes('ЗУРГИЙГ ТАТГАЛЗСАН ШАЛТГААН'));

  const rules = src('firestore.rules');
  ok('the rules check every athlete write of the parts', rules.includes('verificationWriteAllowed() &&'));
  ok('  ...and lock both reasons to the admin',
    rules.includes("request.resource.data.get('detailsRejectionReason', null) == resource.data.get('detailsRejectionReason', null)") &&
      rules.includes("request.resource.data.get('photoRejectionReason', null) == resource.data.get('photoRejectionReason', null)"));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
