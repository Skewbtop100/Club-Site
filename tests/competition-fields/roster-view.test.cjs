// ── The public athlete roster ───────────────────────────────────────────
// REAL unit tests — roster-view.ts is pure.
//
// Three things are load-bearing here, and each is a different kind of
// wrong if it slips:
//
//   THE WHITELIST — this payload goes to anyone on the internet, with no
//     sign-in. The admin listing of the same athletes carries `note`
//     (whose placeholder asks for a contact phone number), statusNote,
//     email, dateOfBirth, citizenship, wcaId and registeredAt. The test
//     asserts the EXACT key list, so publishing one more field has to be a
//     decision rather than a field that came along for the ride.
//
//   THE AVERAGE — ao5 and mo3 are separate stored fields because a mean of
//     3 is systematically slower than an Ao5, and a bo-N event has no
//     average at all. Reading `ao5` unconditionally would leave the ДУНДАЖ
//     column permanently empty for an Mo3 event.
//
//   THE UNRANKED TAIL — an athlete with no result is listed last, not
//     omitted, and sorted by NAME rather than registration order, which is
//     not otherwise public.
//
// Run: npm run test:roster

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-roster-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/roster-view.ts',
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
  averageFieldFor,
  averageFor,
  rosterName,
  initialsFor,
  toRosterAthlete,
  rankRoster,
  eventHasAverage,
  attemptsFor,
} = require(path.join(OUT, 'roster-view.js'));

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

console.log('\n  -- the average follows the FORMAT, never a guess --');
eq('ao5 events use the ao5 field', averageFieldFor('ao5'), 'ao5');
eq('mo3 events use the mo3 field', averageFieldFor('mo3'), 'mo3');
for (const f of ['bo1', 'bo2', 'bo3']) {
  eq(`${f} has no average at all`, averageFieldFor(f), null);
  eq(`  ...so the column is hidden for ${f}`, eventHasAverage(f), false);
}
ok('the averaging formats show the column', eventHasAverage('ao5') && eventHasAverage('mo3'));
{
  const stats = { pr: 900, ao5: 1100, mo3: 1300 };
  eq('an ao5 event reads ao5', averageFor(stats, 'ao5'), 1100);
  // THE TRAP: this is the one that would silently show the wrong number.
  eq('an mo3 event reads mo3, NOT ao5', averageFor(stats, 'mo3'), 1300);
  eq('a bo3 event reads neither', averageFor(stats, 'bo3'), null);
  eq('a missing mo3 on an mo3 event is no average', averageFor({ pr: 900, ao5: 1100 }, 'mo3'), null);
  eq('a null value is no average', averageFor({ pr: 900, ao5: null }, 'ao5'), null);
  eq('no stats at all', averageFor(undefined, 'ao5'), null);
}
// The mapping must stay in step with ao5.ts rather than being a second
// list of format names: every format the attempt-count knows about is
// answered here, and none throws or falls through to undefined.
ok('every ResultFormat is answered',
  ['ao5', 'mo3', 'bo1', 'bo2', 'bo3'].every((f) => averageFieldFor(f) !== undefined && attemptsFor(f) >= 1));

console.log('\n  -- the name published --');
{
  const full = {
    approvedLastName: 'Батаа', approvedFirstName: 'Эрдэнэ',
    lastName: 'Бат', firstName: 'Эрдэнэбат', displayName: 'Google Name',
  };
  eq('the APPROVED identity wins', rosterName(full, 'u1'), 'Батаа Эрдэнэ');
  eq('  ...falling back to the self-entered one',
    rosterName({ lastName: 'Бат', firstName: 'Эрдэнэ', displayName: 'G' }, 'u1'), 'Бат Эрдэнэ');
  eq('  ...then the Google display name', rosterName({ displayName: 'Ганбаа' }, 'u1'), 'Ганбаа');
  eq('  ...then the uid, so a row is never nameless', rosterName({}, 'u1'), 'u1');
  eq('one name only is still a name', rosterName({ firstName: 'Сараа' }, 'u1'), 'Сараа');
  eq('blank strings do not count as a name', rosterName({ firstName: '   ', displayName: 'G' }, 'u1'), 'G');
}
eq('initials from two names', initialsFor('Батаа Эрдэнэ'), 'БЭ');
eq('  ...from one', initialsFor('Сараа'), 'СА');
eq('  ...from three takes the first two', initialsFor('Ган Бат Эрдэнэ'), 'ГБ');
eq('  ...and never blank', initialsFor('   '), '—');

console.log('\n  -- THE WHITELIST: what reaches the public payload --');
{
  // A profile carrying everything the admin listing publishes, plus the
  // verification photo and the merge markers.
  const profile = {
    displayName: 'Google Name',
    approvedLastName: 'Батаа', approvedFirstName: 'Эрдэнэ',
    lastName: 'Бат', firstName: 'Эрдэнэбат',
    email: 'someone@example.com',
    phone: '99112233',
    dateOfBirth: '2003-04-12', approvedDateOfBirth: '2003-04-12',
    citizenship: 'mn', approvedCitizenship: 'mn',
    wcaId: '2019BATA01',
    photoUrl: 'https://example.com/pending.jpg',
    approvedPhotoUrl: 'https://example.com/approved.jpg',
    photoURL: 'https://lh3.googleusercontent.com/a/x',
    profileStatus: 'approved',
    rejectionReason: null,
    mergedInto: null,
    stats: { 333: { pr: 900, ao5: 1100, mo3: 1300, solveCount: 40 } },
  };
  const row = toRosterAthlete({
    uid: 'u1',
    profile,
    events: ['333'],
    formatByEvent: { 333: 'ao5' },
  });

  eq('EXACTLY these keys are published',
    keys(row), 'avgByEvent,events,initials,name,prByEvent,uid');
  // Named individually as well as by the key list: a reader of this test
  // should be able to see WHICH fields were the danger.
  for (const leaked of [
    'email', 'phone', 'dateOfBirth', 'approvedDateOfBirth', 'citizenship', 'approvedCitizenship',
    'wcaId', 'photoUrl', 'approvedPhotoUrl', 'photoURL', 'profileStatus', 'rejectionReason',
    'note', 'statusNote', 'registeredAt', 'status', 'results', 'stats', 'displayName', 'solveCount',
  ]) {
    ok(`  ...and NOT ${leaked}`, !(leaked in row));
  }
  // No photo at all: the mockup uses initials, so no image url crosses the
  // boundary even though an approved one exists on the profile.
  ok('no value in the payload is a url',
    !JSON.stringify(row).includes('http'), JSON.stringify(row));
  eq('the name is the approved identity', row.name, 'Батаа Эрдэнэ');
  eq('  ...with initials precomputed', row.initials, 'БЭ');
  eq('the personal best is published', row.prByEvent['333'], 900);
  eq('  ...and the format-appropriate average', row.avgByEvent['333'], 1100);
  eq('  ...and solveCount is not', keys(row.prByEvent), '333');
}
{
  // An mo3 event: the average must be the mo3, and an event the athlete is
  // not registered for contributes nothing.
  const row = toRosterAthlete({
    uid: 'u2',
    profile: { displayName: 'A', stats: { 333: { pr: 900, ao5: 1100, mo3: 1300 }, 222: { pr: 300, ao5: 400 } } },
    events: ['333'],
    formatByEvent: { 333: 'mo3', 222: 'ao5' },
  });
  eq('an mo3 event publishes the mo3', row.avgByEvent['333'], 1300);
  eq('an event they are not in is absent from prByEvent', '222' in row.prByEvent, false);
  eq('  ...and from avgByEvent', '222' in row.avgByEvent, false);
}
{
  const row = toRosterAthlete({
    uid: 'u3',
    profile: { displayName: 'B', stats: { 333: { pr: null, ao5: null } } },
    events: ['333', '444'],
    formatByEvent: { 333: 'ao5', 444: 'ao5' },
  });
  eq('a null pr is simply absent', '333' in row.prByEvent, false);
  eq('an event with no stats at all is absent', '444' in row.prByEvent, false);
  eq('  ...but the registration is still published', row.events.join(','), '333,444');
}
{
  const row = toRosterAthlete({ uid: 'u4', profile: {}, events: [], formatByEvent: {} });
  eq('an athlete with no profile still produces the same keys',
    keys(row), 'avgByEvent,events,initials,name,prByEvent,uid');
  eq('  ...named by uid', row.name, 'u4');
}

console.log('\n  -- the ranking --');
const athlete = (uid, name, pr, avg, events = ['333']) => ({
  uid,
  name,
  initials: 'XX',
  prByEvent: pr === null ? {} : { 333: pr },
  avgByEvent: avg === null ? {} : { 333: avg },
  events,
});
{
  const rows = rankRoster(
    [
      athlete('c', 'Гантөмөр', 1200, 1400),
      athlete('a', 'Алтан', 900, 1100),
      athlete('b', 'Болд', 1050, 1250),
    ],
    '333',
  );
  eq('fastest personal best first', rows.map((r) => r.athlete.uid).join(','), 'a,b,c');
  eq('  ...ranked 1,2,3', rows.map((r) => r.rank).join(','), '1,2,3');
  eq('  ...carrying the single', rows[0].pr, 900);
  eq('  ...and the average', rows[0].average, 1100);
}
{
  // THE TAIL: listed last, unranked, and by NAME — registration order is
  // not otherwise public and must not be leaked by the sort.
  const rows = rankRoster(
    [
      athlete('z', 'Янжин', null, null),
      athlete('a', 'Алтан', 900, 1100),
      athlete('m', 'Бат', null, null),
    ],
    '333',
  );
  eq('the ranked come first', rows[0].athlete.uid, 'a');
  eq('the unranked follow, sorted by NAME not by input order',
    rows.slice(1).map((r) => r.athlete.name).join(','), 'Бат,Янжин');
  eq('  ...with no rank number', rows.slice(1).every((r) => r.rank === null), true);
  eq('  ...and a dash for the time', rows[1].pr, null);
  ok('  ...but they are NOT omitted', rows.length === 3);
}
{
  // Not registered for the event: omitted entirely. They are not in it.
  const rows = rankRoster(
    [athlete('a', 'Алтан', 900, 1100), athlete('b', 'Болд', 800, 1000, ['222'])],
    '333',
  );
  eq('an athlete not in this event is omitted', rows.map((r) => r.athlete.uid).join(','), 'a');
}
{
  // Two athletes on the same time must not shuffle between page loads.
  const rows = rankRoster(
    [athlete('b', 'Ням', 1000, 1200), athlete('a', 'Дорж', 1000, 1100)],
    '333',
  );
  eq('equal bests are broken by name, stably', rows.map((r) => r.athlete.name).join(','), 'Дорж,Ням');
  eq('  ...and both are still ranked', rows.map((r) => r.rank).join(','), '1,2');
}
{
  const rows = rankRoster([athlete('a', 'A', null, 1100)], '333');
  eq('an average with no single still shows the average', rows[0].average, 1100);
  eq('  ...and remains unranked', rows[0].rank, null);
}
eq('nobody approved: no rows', rankRoster([], '333').length, 0);

console.log('\n  -- the route publishes through this module --');
{
  const route = fs.readFileSync(
    path.join(ROOT, 'app/api/online-competition/competitions/[id]/roster/route.ts'),
    'utf8',
  );
  ok('every athlete row is built by toRosterAthlete', route.includes('toRosterAthlete({'));
  // The admin listing carries note/email/dateOfBirth/wcaId/statusNote.
  ok('  ...and the admin listing is NOT reused',
    !route.includes('RegistrationAdminView') && !route.includes('listCompetitionRegistrations'));
  ok('approved registrations only (D7)', route.includes('isCompetingRegistration(d.data().status)'));
  ok('a draft competition has no public roster', route.includes("=== 'draft'"));
  ok('the response is cached at the edge',
    route.includes("'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'"));
  // The unfiltered collection-group read, for the reason recorded in
  // countRegistrationsFor: the filtered form needs an index that does not
  // exist and took the editor down in production.
  ok('  ...with the proven query shape', route.includes("db.collectionGroup('registrations').get()"));
  // Code, not prose: the file's own header comment says what it does not
  // read, and would otherwise fail its own assertion.
  const code = route.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('nothing here reads submissions or round results',
    !/collection\(['"]onlineSubmissions/.test(code) && !/round-results/.test(code));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
