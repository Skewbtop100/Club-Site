// ── Added events on an approved registration ─────────────────────────────
// REAL unit tests for the pure halves — registration-shape.ts (the athlete's
// save), event-requests.ts (the admin's decision), registration-review.ts
// (the summary) — plus source checks on every screen that shows them. The
// same rules run end to end, with the real scramble gate, in
// tests/firestore-rules/event-requests.test.mjs.
//
// Run: npm run test:eventrequests

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-eventrequests-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/registration-shape.ts',
    'lib/online-competition/event-requests.ts',
    'lib/online-competition/registration-review.ts',
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
const shape = require(path.join(OUT, 'registration-shape.js'));
const req = require(path.join(OUT, 'event-requests.js'));
const review = require(path.join(OUT, 'registration-review.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const S = { now: '<now>', remove: '<delete>' };

console.log('\n  -- reading a registration\'s events --');
eq('an EXISTING approved registration: all its events approved, nothing else',
  shape.registrationEvents({ status: 'approved', events: ['333', '222'] }),
  { competing: true, approved: ['333', '222'], requested: [], withdrawn: [], declined: [] });
eq('  ...the legacy "registered" too', shape.registrationEvents({ status: 'registered', events: ['333'] }).approved, ['333']);
eq('  ...and an absent status', shape.registrationEvents({ events: ['333'] }).competing, true);
eq('a pending registration is not competing: no per-event lists',
  shape.registrationEvents({ status: 'pending', events: ['333'], requestedEvents: ['222'] }),
  { competing: false, approved: [], requested: [], withdrawn: [], declined: [] });
eq('nothing stored: nothing', shape.registrationEvents(null).competing, false);
eq('an event is in ONE list: approved wins, then requested',
  shape.registrationEvents({ status: 'approved', events: ['333'], requestedEvents: ['333', '222'], withdrawnEvents: ['222', '444'], declinedEvents: ['222', '555'] }),
  { competing: true, approved: ['333'], requested: ['222'], withdrawn: ['444'], declined: ['555'] });
eq('junk in the lists is dropped', shape.storedEventList(['333', 7, '', null, '333', '222']), ['333', '222']);
eq('the reader passes the lists to the athlete only when there are some',
  Object.keys(shape.normalizeStoredRegistration({ status: 'approved', events: ['333'] }, 'c')).sort().join(','),
  'competitionId,events,status');
eq('  ...and when there are', shape.normalizeStoredRegistration({ status: 'approved', events: ['333'], requestedEvents: ['222'] }, 'c').requestedEvents, ['222']);

console.log('\n  -- what an approved athlete\'s save means --');
const APPROVED = { status: 'approved', events: ['333', '222'] };
eq('adding: a request, the approved events kept', shape.splitApprovedEdit(APPROVED, ['333', '222', '444']),
  { ok: true, events: ['333', '222'], requestedEvents: ['444'], withdrawnEvents: [] });
eq('removing: gone from events, recorded as withdrawn', shape.splitApprovedEdit(APPROVED, ['333']),
  { ok: true, events: ['333'], requestedEvents: [], withdrawnEvents: ['222'] });
eq('both at once', shape.splitApprovedEdit(APPROVED, ['333', '444']),
  { ok: true, events: ['333'], requestedEvents: ['444'], withdrawnEvents: ['222'] });
eq('earlier withdrawals are kept', shape.splitApprovedEdit({ ...APPROVED, withdrawnEvents: ['555'] }, ['333', '222']),
  { ok: true, events: ['333', '222'], requestedEvents: [], withdrawnEvents: ['555'] });
eq('re-adding a withdrawn event is a new request', shape.splitApprovedEdit({ status: 'approved', events: ['333'], withdrawnEvents: ['222'] }, ['333', '222']).requestedEvents, ['222']);
eq('cancelling a request: just no longer requested', shape.splitApprovedEdit({ status: 'approved', events: ['333'], requestedEvents: ['222'] }, ['333']),
  { ok: true, events: ['333'], requestedEvents: [], withdrawnEvents: [] });
eq('deselecting every approved event is refused', shape.splitApprovedEdit(APPROVED, ['444']), { ok: false, reason: 'keep-one-approved' });

console.log('\n  -- what the save writes --');
{
  const w = shape.buildRegistrationWrite(true, { competitionId: 'c', events: ['333', '444'], note: 'x' }, S, APPROVED);
  eq('approved: exactly events, requestedEvents, withdrawnEvents, note, updatedAt',
    Object.keys(w.data).sort().join(','), 'events,note,requestedEvents,updatedAt,withdrawnEvents');
  eq('  ...the added event is NOT in events', w.data.events, ['333']);
  eq('  ...it is requested', w.data.requestedEvents, ['444']);
  ok('  ...never status', !('status' in w.data));
  ok('  ...never declinedEvents — the admin\'s', !('declinedEvents' in w.data));
  eq('refused: nothing written', shape.buildRegistrationWrite(true, { competitionId: 'c', events: ['444'], note: '' }, S, APPROVED),
    { kind: 'refused', reason: 'keep-one-approved' });
  eq('pending: events replaced directly, as before',
    shape.buildRegistrationWrite(true, { competitionId: 'c', events: ['333', '444'], note: '' }, S, { status: 'pending', events: ['333'] }).data.events,
    ['333', '444']);
  eq('  ...no request lists written for it',
    Object.keys(shape.buildRegistrationWrite(true, { competitionId: 'c', events: ['333'], note: '' }, S, { status: 'waitlisted', events: ['333'] }).data).sort().join(','),
    'events,note,updatedAt');
  eq('a first registration is unchanged', shape.buildRegistrationWrite(false, { competitionId: 'c', events: ['333'], note: '' }, S, null).data.status, 'pending');
}

console.log('\n  -- the admin\'s decision: one event at a time --');
{
  const stored = { status: 'approved', events: ['333'], requestedEvents: ['222', '444'], withdrawnEvents: ['222'], declinedEvents: ['222'] };
  const configured = ['333', '222', '444'];
  const approve = req.planEventDecision(stored, '222', 'approve', configured);
  eq('approve 2x2x2: into events, out of every other list, 4x4x4 still requested', approve,
    { ok: true, update: { events: ['333', '222'], requestedEvents: ['444'], declinedEvents: [], withdrawnEvents: [] } });
  ok('  ...never writes status', !('status' in approve.update));
  const decline = req.planEventDecision({ status: 'approved', events: ['333'], requestedEvents: ['444'] }, '444', 'decline', configured);
  eq('decline 4x4x4: out of requested, recorded, events untouched', decline,
    { ok: true, update: { requestedEvents: [], declinedEvents: ['444'] } });
  ok('  ...never writes events', !('events' in decline.update));
  eq('no registration: 404', req.planEventDecision(null, '222', 'approve', configured).status, 404);
  eq('a registration that is itself pending: 409',
    req.planEventDecision({ status: 'pending', events: ['333'], requestedEvents: ['222'] }, '222', 'approve', configured).status, 409);
  eq('an event no longer requested (the athlete changed it): 409',
    req.planEventDecision({ status: 'approved', events: ['333'] }, '222', 'approve', configured).status, 409);
  eq('approving an event the competition does not have: 400',
    req.planEventDecision({ status: 'approved', events: ['333'], requestedEvents: ['999'] }, '999', 'approve', configured).status, 400);
  eq('the body: one event, one decision', req.parseEventDecision({ eventId: ' 222 ', decision: 'approve' }), { ok: true, eventId: '222', decision: 'approve' });
  eq('  ...an unknown decision is refused', req.parseEventDecision({ eventId: '222', decision: 'maybe' }).ok, false);
  eq('  ...no event is refused', req.parseEventDecision({ decision: 'decline' }).ok, false);
  eq('  ...there is no "all events" body', req.parseEventDecision({ eventIds: ['222', '444'], decision: 'approve' }).ok, false);
}

console.log('\n  -- the wording and the counts --');
eq('the row\'s words', req.EVENT_STATE_WORD, { approved: 'БАТЛАГДСАН', requested: 'ХҮСЭЛТ', withdrawn: 'ХАССАН', declined: 'ТАТГАЛЗСАН' });
{
  const regs = [
    { status: 'approved', requestedEvents: ['222', '444'] },
    { status: 'approved', requestedEvents: [] },
    { status: 'pending' },
  ];
  eq('outstanding requests counted across registrations', req.countEventRequests(regs), 2);
  eq('the review header names them', review.reviewSummary(regs, 64), 'БҮРТГЭЛ · 1 ХҮЛЭЭГДЭЖ · 2/64 БАТАЛГААЖСАН · 0 ЦУЦЛАГДСАН · 2 ТӨРӨЛ НЭМЭХ ХҮСЭЛТ');
  eq('  ...and says nothing when there are none', review.reviewSummary([{ status: 'approved' }], null), 'БҮРТГЭЛ · 0 ХҮЛЭЭГДЭЖ · 1/∞ БАТАЛГААЖСАН · 0 ЦУЦЛАГДСАН');
}

console.log('\n  -- the screens --');
{
  const table = src('app/online-competition/admin/competitions/[id]/_components/RegistrationReview.tsx');
  ok('the review row shows each event\'s state in the athlete\'s own row',
    table.includes('<EventChanges') && table.includes('word(id, EVENT_STATE_WORD.approved') && table.includes('word(id, EVENT_STATE_WORD.requested') &&
      table.includes('ТӨРЛИЙН ӨӨРЧЛӨЛТ'));
  ok('  ...each requested event with its own БАТЛАХ and ТАТГАЛЗАХ',
    table.includes("onClick={() => onDecide(id, 'approve')}") && table.includes("onClick={() => onDecide(id, 'decline')}"));
  ok('  ...shown whether or not the Төрлүүд column is on', !/columns\.events && \(\s*<EventChanges/.test(table));
  ok('  ...the header counts them', table.includes('reviewSummary(rows, competition.participantLimit)'));
  const list = src('app/online-competition/admin/_components/CompetitionsList.tsx');
  ok('the competitions list badges БҮРТГЭЛ with the count', list.includes('setEventRequests(data.eventRequests ?? {})') && list.includes('{eventRequests[c.id]}'));
  ok('  ...from the list route, off the read it already makes', src('app/api/online-competition/admin-competitions/route.ts').includes('eventRequests: Object.fromEntries(eventRequests)'));

  const schedule = src('app/online-competition/[competitionId]/live/_components/SchedulePanel.tsx');
  const body = schedule.slice(schedule.indexOf('function RowBody'));
  const requestedBranch = body.slice(body.indexOf('if (item.requested)'), body.indexOf('switch (item.state)'));
  ok('LIVE VIEW: a requested event shows no button', requestedBranch.includes('ТӨРӨЛ НЭМЭХ ХҮСЭЛТ ХЯНАГДАЖ БАЙНА') && !/StartButton|solveHref|href=/.test(requestedBranch));
  ok('  ...decided before any round state', body.indexOf('if (item.requested)') < body.indexOf('switch (item.state)'));
  ok('  ...and cannot be selected as the current round', schedule.includes("const selectable = !item.requested && ("));
  const page = src('app/online-competition/[competitionId]/live/page.tsx');
  ok('  ...listed from the registration\'s requested events', page.includes("(view.registration?.requestedEvents ?? []).includes(e.eventId)") && page.includes('requested: true'));
  const banner = src('app/online-competition/[competitionId]/details/_components/StartRoundPanel.tsx');
  const reqRows = banner.slice(banner.indexOf('{requested.map((e) => ('), banner.indexOf('{failed && !loading && ('));
  ok('DETAILS BANNER: a requested event shows its state, no start link', reqRows.includes('ХҮСЭЛТ ХЯНАГДАЖ БАЙНА') && !/<Link|href=/.test(reqRows));
  const panel = src('app/online-competition/[competitionId]/details/_components/RegistrationPanel.tsx');
  ok('THE PANEL says what adding and removing do', panel.includes('Нэмсэн төрөл зохион байгуулагч баталсны дараа нэмэгдэнэ'));
  ok('  ...lists requested and declined events under the approved ones', panel.includes("'ХҮСЭЛТ ИЛГЭЭСЭН' : 'ТАТГАЛЗСАН'"));
  ok('  ...refuses dropping every approved event, with a reason', panel.includes('setSaveError(KEEP_ONE_APPROVED)'));
  const data = src('lib/online-competition/data.ts');
  ok('the save passes the stored document to the builder', data.includes('snap.exists() ? snap.data() : null,') && data.includes('throw new RegistrationEditRefused(write.reason)'));
  const rules = src('firestore.rules');
  ok('the rules let an athlete write only the request and withdrawal lists',
    rules.includes(".hasOnly(['events', 'note', 'updatedAt', 'results', 'requestedEvents', 'withdrawnEvents'])") && rules.includes('approvedEventsChangeOk()'));
  ok('  ...and the window still covers every change', rules.includes(".hasAny(['events', 'note', 'requestedEvents', 'withdrawnEvents'])"));
  ok('THE SCRAMBLE GATE is unchanged: it still reads events alone',
    src('lib/online-competition/scramble-gate.ts').includes("const events = Array.isArray(registration.events) ? registration.events : [];") &&
      !src('lib/online-competition/scramble-gate.ts').includes('requestedEvents'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
