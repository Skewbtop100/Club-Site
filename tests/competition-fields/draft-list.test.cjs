// ── Шинэ тэмцээн: the unannounced-competitions page ─────────────────────
// REAL unit tests for draft-list.ts (pure), plus source checks on the page,
// the create form it links to, and the sidebar.
//
// Run: npm run test:drafts

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-draftlist-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'lib/online-competition/draft-list.ts',
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
const D = require(path.join(OUT, 'draft-list.js'));
const { evaluateReadiness } = require(path.join(OUT, 'publish-readiness.js'));

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

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime();
const EV = (eventId, label, rounds = 1) => ({ eventId, label, rounds });
/** A draft with every section filled in. */
const FULL = {
  id: 'c1',
  name: 'Дархан цом 2026',
  status: 'draft',
  startAt: at(2026, 10, 4, 11, 0),
  registrationDeadline: at(2026, 10, 1, 23, 59),
  posterUrl: 'https://x/p.jpg',
  bannerUrl: 'https://x/b.jpg',
  paid: false,
  baseFeeMnt: null,
  events: [EV('333', '3x3x3', 3), EV('222', '2x2x2', 2), EV('444', '4x4x4'), EV('pyram', 'Pyraminx')],
  createdAt: 1,
  deletion: null,
};

console.log('\n  -- what counts as not yet announced --');
for (const [status, want] of [['draft', true], ['upcoming', false], ['live', false], ['finished', false]]) {
  eq(`${status}`, D.isUnannounced({ status, deletion: null }), want);
}
eq('a draft whose deletion has started is left out', D.isUnannounced({ status: 'draft', deletion: { startedAtMs: 5 } }), false);
{
  const rows = D.draftRows([
    { ...FULL, id: 'late', startAt: at(2026, 11, 7, 10, 0) },
    { ...FULL, id: 'public', status: 'upcoming' },
    { ...FULL, id: 'nodate-old', startAt: null, createdAt: 1 },
    { ...FULL, id: 'soon', startAt: at(2026, 10, 4, 11, 0) },
    { ...FULL, id: 'nodate-new', startAt: null, createdAt: 9 },
    { ...FULL, id: 'deleting', deletion: { startedAtMs: 1 } },
  ]);
  eq('drafts only, soonest first, undated last (newest first)', rows.map((r) => r.id).join(','), 'soon,late,nodate-new,nodate-old');
}

console.log('\n  -- a row --');
{
  const r = D.toDraftRow(FULL);
  eq('name', r.name, 'Дархан цом 2026');
  eq('start date and time', r.dateLabel, '2026.10.04 · 11:00');
  eq('event count', r.eventCount, 4);
  eq('every section filled: 4/4', r.doneLabel, '4/4 ХЭСЭГ БӨГЛӨСӨН');
  eq('  ...a full bar', r.pct, '100%');
  eq('  ...in volt', r.barColor, '#DFFF4F');
  eq('  ...tagged ready but unannounced', r.tag, 'БЭЛЭН · ЗАРЛААГҮЙ');
  eq('  ...in the mockup\'s green', r.tagColor, '#A8B96A');
  eq('ҮРГЭЛЖЛҮҮЛЭХ opens the editor', r.editHref, '/online-competition/admin/competitions/c1/edit');
}
{
  const r = D.toDraftRow({ ...FULL, posterUrl: null, bannerUrl: null });
  eq('no poster or banner: 3/4', r.doneLabel, '3/4 ХЭСЭГ БӨГЛӨСӨН');
  eq('  ...says what is missing', r.tag, 'НООРОГ · ПОСТЕР · БАННЕР ДУТУУ');
  eq('  ...muted tag, dim bar', `${r.tagColor} ${r.barColor}`, '#6E6A62 #3A4614');
  eq('  ...three quarters', r.pct, '75%');
}
{
  const r = D.toDraftRow({ ...FULL, name: '  ', startAt: null, events: [], posterUrl: null, paid: true, baseFeeMnt: null });
  eq('a bare draft: 0/4', r.doneLabel, '0/4 ХЭСЭГ БӨГЛӨСӨН');
  eq('  ...each missing section named, in checklist order', r.tag,
    'НООРОГ · НЭР · ЭХЛЭХ ЦАГ ДУТУУ · ПОСТЕР ДУТУУ · ТӨРӨЛ ОРООГҮЙ · СУУРЬ ХУРААМЖ ДУТУУ');
  eq('  ...never nameless', r.name, 'Нэргүй тэмцээн');
  eq('  ...no date shown as a dash', r.dateLabel, '—');
  eq('  ...an empty bar', r.pct, '0%');
}
{
  const r = D.toDraftRow({ ...FULL, events: [EV('333', '3x3x3', 0)] });
  eq('an event with no round is not a filled section', r.doneLabel, '3/4 ХЭСЭГ БӨГЛӨСӨН');
  eq('  ...and is named', r.tag, 'НООРОГ · 3x3x3 РАУНДГҮЙ');
}
eq('a paid competition with its fee set counts', D.toDraftRow({ ...FULL, paid: true, baseFeeMnt: 20000 }).met, 4);

console.log('\n  -- the bar is the editor\'s own checklist --');
{
  const input = { ...FULL, posterUrl: null };
  const direct = evaluateReadiness({
    name: input.name, startAt: input.startAt, registrationDeadline: input.registrationDeadline,
    posterUrl: input.posterUrl, bannerUrl: input.bannerUrl, paid: input.paid, baseFeeMnt: input.baseFeeMnt,
    events: input.events,
  });
  eq('same requirements, same order', D.readinessOf(input).requirements.map((r) => `${r.key}:${r.met}`).join(','),
    direct.requirements.map((r) => `${r.key}:${r.met}`).join(','));
  eq('four sections', direct.requirements.length, 4);
  ok('the editor evaluates the same module', src('app/online-competition/admin/_components/CompetitionEditor.tsx').includes('evaluateReadiness({'));
}

console.log('\n  -- the page --');
{
  const page = src('app/online-competition/admin/competitions/drafts/page.tsx');
  ok('behind the admin gate, lighting Шинэ тэмцээн', page.includes('<AdminGate current="newCompetition">') && page.includes('<DraftCompetitions />'));
  const ui = src('app/online-competition/admin/_components/DraftCompetitions.tsx');
  ok('reads the admin competitions list and nothing else', ui.includes("fetch('/api/online-competition/admin-competitions')") && (ui.match(/fetch\(/g) || []).length === 1);
  ok('  ...and writes nothing', !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(ui));
  ok('rows come from draftRows', ui.includes('setRows(draftRows(data.competitions ?? []))'));
  ok('+ Шинэ тэмцээн opens the existing create form', ui.includes('href={`${ADMIN_COMPETITIONS}/new`}') && ui.includes('+ Шинэ тэмцээн'));
  ok('ҮРГЭЛЖЛҮҮЛЭХ opens the editor', ui.includes('href={d.editHref}') && ui.includes('ҮРГЭЛЖЛҮҮЛЭХ'));
  ok('the mockup\'s header, columns and grid',
    ui.includes('Зарлагдаагүй тэмцээнүүд') && ui.includes('НООРОГ · БҮРЭН БАТАЛГААЖААГҮЙ') &&
      ui.includes("const COLUMNS = 'minmax(0,1.6fr) 132px 52px minmax(0,1fr) 110px';") &&
      /<span>ТЭМЦЭЭН<\/span>\s*<span>ЭХЛЭХ<\/span>\s*<span>ТӨРӨЛ<\/span>\s*<span>БЭЛЭН БАЙДАЛ<\/span>/.test(ui));
  ok('an empty state distinct from loading and from a failure',
    ui.includes('Зарлагдаагүй тэмцээн алга.') && ui.includes('Ачааллаж байна...') && ui.includes('ДАХИН АЧААЛАХ'));
  ok('no Tailwind classes', !/className="[^"]*\b(flex|grid|text-|bg-|p-|px-|py-|m-|gap-)/.test(ui));
  const css = src('app/online-competition/theme.css');
  ok('hover and phone rules exist for its classes',
    /\.oc-adm-draft-row:hover \{\s*background: #131318;/.test(css) && /\.oc-adm-draft-open:hover \{\s*border-color: #DFFF4F;\s*color: #DFFF4F;/.test(css) &&
      /\.oc-adm-draft-new:hover \{\s*background: #E9FF7A;/.test(css) && css.includes('.oc-adm-draft-head {\n    display: none !important;'));
}

console.log('\n  -- unchanged --');
{
  eq('the create form page', src('app/online-competition/admin/competitions/new/page.tsx').includes('<CompetitionEditor competitionId={null} />'), true);
  ok('the sidebar item goes to the drafts page',
    src('app/online-competition/admin/_components/AdminShell.tsx').includes('href={`${ADMIN}/competitions/drafts`} label="Шинэ тэмцээн"'));
  ok('Тэмцээнүүд still lists every competition, drafts included',
    !/status\s*[!=]==\s*'draft'/.test(src('app/online-competition/admin/_components/CompetitionsList.tsx')));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
