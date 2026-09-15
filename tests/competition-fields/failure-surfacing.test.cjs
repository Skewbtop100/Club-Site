// ── Failures that must not look like answers ────────────────────────────
// REAL unit tests for bulk-review.ts (pure), plus source checks on the three
// places a failure used to be dressed up as innocent output:
//
//   1. Bulk approve stopped at the first failed approval, silently.
//   2. A failed review-grid load rendered as an empty queue.
//   3. A round-access server error answered 200 { events: {} } — "no round
//      open" — so athletes were told their open round was closed.
//
// Run: npm run test:failures

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-failures-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/bulk-review.ts',
    '--outDir', path.basename(OUT),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
const { runBulkReview } = require(path.join(OUT, 'bulk-review.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  console.log('\n  -- 1. bulk approve --');
  {
    const tried = [];
    const outcome = await runBulkReview(['a1', 'a2', 'a3', 'a4'], async (id) => {
      tried.push(id);
      if (id === 'a2') throw new Error('review failed');
    });
    ok('THE BUG: a failure on attempt 2 no longer stops attempts 3 and 4', tried.join(',') === 'a1,a2,a3,a4', tried.join(','));
    ok('  ...the ones that went through are reported', outcome.succeeded.join(',') === 'a1,a3,a4');
    ok('  ...and the one that did not, with its error',
      outcome.failed.length === 1 && outcome.failed[0].item === 'a2' && outcome.failed[0].error === 'review failed');
  }
  {
    const outcome = await runBulkReview(['x', 'y'], async () => {
      throw 'offline';
    });
    ok('every attempt failing is reported as every attempt failing', outcome.succeeded.length === 0 && outcome.failed.length === 2);
    ok('  ...a non-Error rejection still yields a message', outcome.failed[0].error === 'offline');
  }
  {
    const order = [];
    await runBulkReview([1, 2, 3], async (n) => {
      await new Promise((r) => setTimeout(r, 5 * (4 - n)));
      order.push(n);
    });
    ok('still one at a time, in order (same POSTs as before)', order.join(',') === '1,2,3', order.join(','));
  }
  {
    const outcome = await runBulkReview([], async () => {});
    ok('nothing pending: nothing tried, nothing failed', outcome.succeeded.length === 0 && outcome.failed.length === 0);
  }

  const grid = src('app/online-competition/admin/_components/ReviewGrid.tsx');
  const bulk = grid.slice(grid.indexOf('const bulkApprove = useCallback('), grid.indexOf('// The selected event'));
  ok('the grid runs bulk approve through runBulkReview', bulk.includes('runBulkReview(mine, (s) => review(s.id, \'approve\'))'));
  ok('  ...and records what happened for the judge', bulk.includes('setBulkNote({'));
  ok('the note says how many succeeded, which failed, and offers a retry',
    grid.includes('{bulkNote.succeeded}/{bulkNote.total} оролдлого зөвшөөрөгдлөө') &&
      grid.includes('{bulkNote.failedLabels.join') &&
      grid.includes('ҮЛДСЭНИЙГ ДАХИН ЗӨВШӨӨРӨХ') &&
      grid.includes('onClick={() => bulkApprove(bulkNote.row)}'));

  console.log('\n  -- 2. the review grid load --');
  const load = grid.slice(grid.indexOf('const load = useCallback('), grid.indexOf('}, [competitionId]);', grid.indexOf('const load = useCallback(')));
  ok('THE BUG: no failure is turned into an empty list any more',
    !/\.catch\(\(\) => \[\]\)|\.catch\(\(\) => null\)|: \{ submissions: \[\] \}|: \{ registrations: \[\] \}/.test(load), load);
  ok('  ...a non-ok answer rejects', load.includes('if (!r.ok) throw new Error('));
  ok('  ...registrations and submissions are applied only when BOTH loaded',
    load.includes("if (regs.status === 'fulfilled' && subs.status === 'fulfilled')") && load.includes('setLoadError('));
  ok('could-not-load is drawn instead of rows, with a retry',
    /submissions === null \? \(\s*loadError \?/.test(grid) && grid.includes('ДАХИН АЧААЛАХ') && grid.includes('onClick={() => load()}'));
  ok('loaded-and-empty keeps its own wording', grid.includes('Энэ төрөлд тамирчин алга.'));
  ok('a scramble failure is a warning beside a working grid', grid.includes('{scramblesError && ('));

  console.log('\n  -- 3. round access --');
  const route = src('app/api/online-competition/round-access/route.ts');
  ok('THE BUG: the error path no longer answers 200 { events: {} }', !route.includes('return NextResponse.json({ events: {} });'));
  ok('  ...it answers 503 with a reason', route.includes("error: 'round-access-unavailable'") && route.includes('{ status: 503 }'));

  const page = src('app/online-competition/[competitionId]/solve/[eventId]/page.tsx');
  const resume = page.slice(page.indexOf('// ── RESUME ─'), page.indexOf('}, [solverUid, runShape !== null]);'));
  ok('the solve page no longer reads a non-ok answer as "no events"', !resume.includes(': { events: {} }'));
  ok('  ...a non-ok answer fails closed before any plan is made',
    resume.indexOf('if (!accessRes.ok)') > -1 && resume.indexOf('if (!accessRes.ok)') < resume.indexOf('planResume('));
  ok('  ...with a message that says it could NOT CHECK, not that the round is closed',
    resume.includes('Раунд нээлттэй эсэхийг шалгаж чадсангүй — энэ нь раунд хаагдсан гэсэн үг биш'));
  ok('  ...and a retry on that screen', page.includes('{blockedRetry && (') && page.includes('ДАХИН ОРОЛДОХ'));
  ok('a genuinely closed round still gets the closed-round message, without the retry',
    resume.includes("'Энэ төрлийн раунд одоогоор нээлттэй биш байна.'") &&
      !/plan\.kind === 'no-live-round'[\s\S]{0,700}setBlockedRetry\(true\)/.test(resume));

  const details = src('app/online-competition/[competitionId]/details/page.tsx');
  const panel = src('app/online-competition/[competitionId]/details/_components/StartRoundPanel.tsx');
  ok('the details page tracks a failed lookup separately', details.includes('setAccessFailed(true)') && details.includes('failed={accessFailed}'));
  ok('  ...and the start panel shows it as its own state with a retry',
    panel.includes("'ШАЛГАЖ ЧАДСАНГҮЙ'") && panel.includes('ДАХИН ШАЛГАХ'));

  // ══ Second set ═══════════════════════════════════════════════════════
  console.log('\n  -- 4. the athlete\'s own registration --');
  const hook = src('app/online-competition/[competitionId]/details/_components/useMyRegistration.ts');
  ok('THE BUG: a failed read is no longer swallowed', /\.catch\(\(err\) => \{[\s\S]{0,160}setError\(true\)/.test(hook));
  ok('  ...and the hook reports it', hook.includes('return { registration, loading, error, refresh };'));
  const regPanel = src('app/online-competition/[competitionId]/details/_components/RegistrationPanel.tsx');
  ok('the registration panel shows the failure BEFORE "closed" or the form',
    regPanel.indexOf('if (registrationError)') > -1 &&
      regPanel.indexOf('if (registrationError)') < regPanel.indexOf('Бүртгэл хаагдсан') &&
      regPanel.includes('энэ нь та бүртгүүлээгүй гэсэн үг биш'));
  ok('the start panel says it could not load, instead of vanishing',
    panel.includes('if (!registrationFailed || loading) return null;') && panel.includes('Таны бүртгэлийг ачаалж чадсангүй'));
  ok('the details page wires both, and the sidebar shows "—", not an event count',
    details.includes('registrationFailed={myRegistration.error && !myRegistration.registration}') &&
      details.includes('registrationError={myRegistration.error && !myRegistration.registration}') &&
      /myRegistration\.error \? \(/.test(details));

  console.log('\n  -- 5. round notifications --');
  const notify = src('lib/online-competition/notifications-server.ts');
  ok('notifyRoundFinalised reports failure instead of only logging it',
    notify.includes('}): Promise<{ ok: boolean }> {') && /catch \(err\) \{[\s\S]{0,300}return \{ ok: false \};/.test(notify));
  ok('  ...and still never throws (no rethrow in the catch)', !/catch \(err\) \{[\s\S]{0,300}throw /.test(notify));
  const roundsRoute = src('app/api/online-competition/admin-rounds/route.ts');
  const qualifyRoute = src('app/api/online-competition/admin-rounds/qualify/route.ts');
  ok('closing a round tells the admin whether athletes were notified', roundsRoute.includes("NextResponse.json({ status: 'done', notified })"));
  ok('committing a cut does too', qualifyRoute.includes('committed: true, notified }'));
  ok('a failed send can be retried, for a finished round only',
    roundsRoute.includes("if (action === 'notify')") && roundsRoute.includes("stateSnap.get('status') !== 'done'"));
  const roundsUi = src('app/online-competition/admin/_components/RoundsManager.tsx');
  ok('the rounds screen shows the failure with a resend button',
    roundsUi.includes('МЭДЭГДЭЛ ДАХИН ИЛГЭЭХ') && roundsUi.includes("action === 'close' && data.notified === false") &&
      roundsUi.includes('if (!notified) setNotifyNote('));

  console.log('\n  -- 6. the judge\'s video --');
  const judge = src('app/online-competition/admin/_components/SubmissionDetailPanel.tsx');
  ok('a video that fails to load is caught', judge.includes('onError={() => setVideoFailedFor(submission.id)}'));
  ok('each cause gets its own message',
    judge.includes("'БИЧЛЭГ ХАВСАРГААГҮЙ'") && judge.includes("'БИЧЛЭГ ХАРУУЛАХ БОЛОМЖГҮЙ'") && judge.includes("'БИЧЛЭГ АЧААЛАГДСАНГҮЙ'"));
  ok('  ...a load failure offers a reload', /videoProblem === 'failed' && \([\s\S]{0,300}videoRef\.current\?\.load\(\)/.test(judge));
  ok('the decision buttons are NOT disabled by a video problem (judging unchanged)', !/disabled=\{[^}]*video/i.test(judge));
  ok('  ...but a warning sits beside them', /\{videoProblem && \(\s*<p\s+role="note"/.test(judge));

  console.log('\n  -- 7. the admin overview --');
  const overview = src('app/online-competition/admin/_components/AdminOverview.tsx');
  ok('THE BUG: no load is caught into an empty list', !/\.catch\(\(\) => \[\]\)/.test(overview));
  ok('every card has its own failure state',
    ['pending', 'athletes', 'names', 'competitions', 'progress'].every((k) => overview.includes(`markFailed('${k}'`)));
  ok('a failed queue is not "Хянах илгээмж алга."', /failed\.pending \? \(\s*<ErrorRow/.test(overview));
  ok('a failed competition list is not "Явагдаж буй тэмцээн алга."', /failed\.competitions \? \(\s*<ErrorRow/.test(overview));
  ok('the counts show "—" marked as failed, not 0', overview.includes("{failed ? 'ачаалж чадсангүй' : note}"));
  ok('one retry reloads everything', overview.includes('}, [attempt]);') && overview.includes('ДАХИН АЧААЛАХ'));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
