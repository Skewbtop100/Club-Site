// ── The admin's view of one athlete ─────────────────────────────────────
// REAL unit tests for participant-admin-view.ts (pure), plus source checks
// on the route, the list and the read-only detail panel.
//
// What must hold:
//   * the admin athletes route sends every field verification needs —
//     surname, given name, date of birth, gender, WCA ID, country, email,
//     status, photos, registration / submission / review dates, and the
//     approved snapshot — and nothing verification does not;
//   * it is still admin-gated before any read;
//   * the panel is read-only, and the table keeps its seven columns and
//     МЭЙЛ СОЛИХ.
//
// Run: npm run test:athleteadmin

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-athlete-admin-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/participant-admin-view.ts',
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

const { toParticipantAdminView } = require(path.join(OUT, 'participant-admin-view.js'));

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
const ts = (ms) => ({ toMillis: () => ms });
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('\n  -- the full record reaches the admin --');
{
  // Everything a stored participant can carry, including what the admin
  // view must NOT pass on.
  const stored = {
    uid: 'u1',
    displayName: 'Google Name',
    email: 'athlete@example.com',
    lastName: 'Бат', firstName: 'Эрдэнэ',
    dateOfBirth: '2011-04-12',
    gender: 'female',
    citizenship: 'mn',
    wcaId: '2019BATA01',
    photoUrl: 'https://res.cloudinary.com/x/new.jpg',
    photoPublicId: 'new',
    photoURL: 'https://lh3.googleusercontent.com/a/x',
    profileStatus: 'pending',
    approvedPhotoUrl: 'https://res.cloudinary.com/x/old.jpg',
    approvedLastName: 'Батаа', approvedFirstName: 'Эрдэнэ',
    approvedDateOfBirth: '2011-04-12', approvedGender: 'female', approvedCitizenship: 'mn',
    createdAt: ts(1_700_000_000_000),
    submittedAt: ts(1_700_100_000_000),
    reviewedAt: ts(1_700_200_000_000),
    rejectionReason: null,
    stats: { 333: { pr: 900, ao5: 1100, solveCount: 4 } },
    mergedInto: 'someone', mergedAt: ts(1),
  };
  const v = toParticipantAdminView('u1', stored, 'pending');

  eq('EXACTLY these keys are sent',
    keys(v),
    'approvedCitizenship,approvedDateOfBirth,approvedFirstName,approvedGender,approvedLastName,approvedPhotoUrl,' +
      'citizenship,createdAt,dateOfBirth,displayName,email,firstName,gender,lastName,photoUrl,profileStatus,' +
      'rejectionReason,reviewedAt,submittedAt,uid,wcaId');
  eq('surname', v.lastName, 'Бат');
  eq('given name', v.firstName, 'Эрдэнэ');
  eq('date of birth', v.dateOfBirth, '2011-04-12');
  eq('gender', v.gender, 'female');
  eq('WCA ID', v.wcaId, '2019BATA01');
  eq('country', v.citizenship, 'mn');
  eq('email', v.email, 'athlete@example.com');
  eq('verification status', v.profileStatus, 'pending');
  eq('submitted photo', v.photoUrl, 'https://res.cloudinary.com/x/new.jpg');
  eq('approved photo', v.approvedPhotoUrl, 'https://res.cloudinary.com/x/old.jpg');
  eq('registration date (first sign-in), as epoch ms', v.createdAt, 1_700_000_000_000);
  eq('submitted date', v.submittedAt, 1_700_100_000_000);
  eq('reviewed date', v.reviewedAt, 1_700_200_000_000);
  eq('the approved surname, for the difference line', v.approvedLastName, 'Батаа');
  for (const absent of ['stats', 'photoPublicId', 'photoURL', 'mergedInto', 'mergedAt']) {
    ok(`  ...and not ${absent}`, !(absent in v));
  }
}
{
  const v = toParticipantAdminView('u2', { displayName: 'Only Google', gender: 'robot', createdAt: 'not a timestamp' }, 'approved');
  eq('a sparse record still yields every key', keys(v).split(',').length, 21);
  eq('  ...missing text is empty', v.lastName, '');
  eq('  ...missing email is null', v.email, null);
  eq('  ...an unknown gender is null, not passed through', v.gender, null);
  eq('  ...a non-timestamp date is null', v.createdAt, null);
  eq('  ...no photo is null', v.photoUrl, null);
}

console.log('\n  -- the route --');
{
  const route = src('app/api/online-competition/admin-athletes/route.ts');
  const gate = route.indexOf('isOnlineCompAdmin()');
  ok('still refuses a non-admin before reading', gate > -1 && gate < route.indexOf("collection('onlineParticipants')"));
  ok('builds every row with toParticipantAdminView', route.includes('toParticipantAdminView(d.id, d.data(), status)'));
}

console.log('\n  -- the list and the panel --');
{
  const list = src('app/online-competition/admin/_components/VerifiedAthletesTable.tsx');
  const panel = src('app/online-competition/admin/_components/AthleteDetailPanel.tsx');
  ok('the verified table keeps МЭЙЛ СОЛИХ', list.includes('МЭЙЛ СОЛИХ') && list.includes('setMerging(a)'));
  ok('the avatar opens the panel, for the photo', list.includes('onClick={() => setViewingUid(a.uid)}'));
  ok('the panel is read-only: no inputs, no requests',
    !/<input|<textarea|<select|<form|fetch\(/.test(panel));
  for (const label of ['ОВОГ', 'НЭР', 'ТӨРСӨН ОГНОО', 'ХҮЙС', 'WCA ID', 'УЛС', 'И-МЭЙЛ', 'ТӨЛӨВ', 'БҮРТГҮҮЛСЭН']) {
    ok(`the panel shows ${label}`, panel.includes(`label="${label}"`));
  }
  ok('the photo is never cropped and fits the screen',
    panel.includes("objectFit: 'contain'") && panel.includes("maxHeight: '70vh'") && panel.includes("width: '100%'"));
  ok('  ...and the original opens full size', panel.includes('target="_blank"') && panel.includes('rel="noopener noreferrer"'));
}

console.log('\n  -- the two athlete pages --');
{
  const table = src('app/online-competition/admin/_components/VerifiedAthletesTable.tsx');
  const requests = src('app/online-competition/admin/_components/AthleteRequests.tsx');
  ok('Тамирчдын бүртгэл lists VERIFIED athletes only', table.includes("admin-athletes?status=approved'") && !table.includes('status=pending'));
  for (const head of ['ОВОГ · НЭР', 'И-МЭЙЛ', 'WCA ID', 'ТӨРСӨН', 'НАС', 'ХҮЙС', 'УЛС', 'БАТАЛГААЖСАН', 'ХҮСЭЛТ ИЛГЭЭСЭН', 'БҮРТГҮҮЛСЭН', 'GOOGLE НЭР']) {
    ok(`  ...column ${head}`, table.includes(`>${head}</th>`) || table.includes(`>\n                  ${head}\n                </th>`));
  }
  ok('  ...scrolls sideways in its own box, name column pinned',
    table.includes("<div style={{ overflowX: 'auto' }}>") && table.includes('className="oc-adm-people-sticky"'));
  ok('Бүртгэлийн хүсэлт lists PENDING requests only', requests.includes("admin-athletes?status=pending'") && !requests.includes('status=approved'));
  ok('  ...one request expanded at a time', requests.includes('onClick={() => setOpenUid(open ? null : a.uid)}'));
  ok('  ...through the existing verification route, unchanged',
    requests.includes('`/api/online-competition/admin-athletes/${encodeURIComponent(a.uid)}`') &&
      requests.includes("decide(a, { action: 'approve' })") && requests.includes("decide(a, { action: 'reject', reason })"));
  ok('  ...admitting needs BOTH approvals (approve records details and photo together)',
    requests.includes('{bothApproved && !anyRejected ? ('));
  ok('  ...closing needs a reason for every rejected part', requests.includes('disabled={busy || !reasonsComplete}'));
  ok('the requests page is behind the admin gate',
    src('app/online-competition/admin/athletes/requests/page.tsx').includes('<AdminGate current="athleteRequests">'));
  ok('the old combined list is gone', !fs.existsSync(path.join(ROOT, 'app/online-competition/admin/_components/AthletesList.tsx')));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
