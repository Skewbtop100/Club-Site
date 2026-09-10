// ── Registration review: validation, summary, sections ──────────────────
// Pure unit tests for registration-review.ts — what the admin API accepts
// and what the review table's summary and section footers say.
//
// The load-bearing group is VALIDATION: the admin API is the only code
// that may set a status, so an unknown status must be refused rather than
// defaulted (a typo that became 'pending' would un-review someone), and
// the legacy 'registered' must never be writable.
//
// The write itself (all-or-nothing, against the emulator with the Admin
// SDK) is in roundtrip.test.cjs.
//
// Run: npm run test:review

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-review-build');

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
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

const {
  REVIEW_ORDER,
  REVIEW_SECTION_LABEL,
  BULK_ACTIONS,
  BULK_MAX,
  parseStatusPatch,
  parseBulkPatch,
  countByStatus,
  reviewSummary,
  sectionFooter,
} = require(path.join(OUT, 'registration-review.js'));

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
const j = (v) => JSON.stringify(v);

console.log('\n  -- parseStatusPatch: what the admin API accepts --');
for (const s of ['pending', 'waitlisted', 'approved', 'cancelled', 'rejected']) {
  eq(`accepts status "${s}"`, j(parseStatusPatch({ status: s })), j({ ok: true, value: { status: s } }));
}
for (const bad of ['APPROVED', 'accepted', '', 1, null, {}]) {
  eq(`REFUSES status ${JSON.stringify(bad)}`, parseStatusPatch({ status: bad }).ok, false);
}
// The legacy spelling is a stored value only — nobody may write it.
eq('REFUSES the legacy "registered"', parseStatusPatch({ status: 'registered' }).ok, false);
eq('a statusNote alone is a valid patch', j(parseStatusPatch({ statusNote: 'Төлбөр хүлээгдэж буй' })),
  j({ ok: true, value: { statusNote: 'Төлбөр хүлээгдэж буй' } }));
eq('status and note together', j(parseStatusPatch({ status: 'rejected', statusNote: 'Мэдээлэл дутуу' }).value),
  j({ status: 'rejected', statusNote: 'Мэдээлэл дутуу' }));
eq('a null statusNote CLEARS it', parseStatusPatch({ statusNote: null }).value.statusNote, null);
eq('a blank statusNote clears it too', parseStatusPatch({ statusNote: '   ' }).value.statusNote, null);
eq('the note is trimmed', parseStatusPatch({ statusNote: '  хамт  ' }).value.statusNote, 'хамт');
eq('exactly 200 characters is accepted', parseStatusPatch({ statusNote: 'а'.repeat(200) }).ok, true);
eq('201 characters is REFUSED', parseStatusPatch({ statusNote: 'а'.repeat(201) }).ok, false);
eq('a non-string note is REFUSED', parseStatusPatch({ statusNote: 42 }).ok, false);
eq('an empty patch is REFUSED', parseStatusPatch({}).ok, false);
eq('a non-object body is REFUSED', parseStatusPatch('approved').ok, false);
eq('an undefined status with a note leaves the status alone',
  'status' in parseStatusPatch({ statusNote: 'x' }).value, false);

console.log('\n  -- parseBulkPatch --');
{
  const r = parseBulkPatch({ uids: ['a', 'b', 'a', ' c '], status: 'approved' });
  eq('valid', r.ok, true);
  eq('uids are de-duplicated and trimmed', r.value.uids.join(','), 'a,b,c');
  eq('the patch comes through', r.value.patch.status, 'approved');
}
eq('empty uids REFUSED', parseBulkPatch({ uids: [], status: 'approved' }).ok, false);
eq('missing uids REFUSED', parseBulkPatch({ status: 'approved' }).ok, false);
eq('a non-string uid REFUSED', parseBulkPatch({ uids: ['a', 7], status: 'approved' }).ok, false);
eq('an unknown status in a bulk REFUSED', parseBulkPatch({ uids: ['a'], status: 'yes' }).ok, false);
eq(`exactly ${BULK_MAX} uids accepted`, parseBulkPatch({ uids: Array.from({ length: BULK_MAX }, (_, i) => `u${i}`), status: 'approved' }).ok, true);
eq(`${BULK_MAX + 1} uids REFUSED`, parseBulkPatch({ uids: Array.from({ length: BULK_MAX + 1 }, (_, i) => `u${i}`), status: 'approved' }).ok, false);

console.log('\n  -- the table: order, actions, summary, footer --');
eq('sections in the mockup order', REVIEW_ORDER.join(','), 'pending,waitlisted,approved,cancelled,rejected');
eq('section labels', REVIEW_ORDER.map((s) => REVIEW_SECTION_LABEL[s]).join(' · '),
  'Хүлээгдэж буй · Хүлээлгийн жагсаалт · Баталгаажсан · Цуцлагдсан · Татгалзсан');
eq('bulk actions in the mockup order', BULK_ACTIONS.map((a) => a.label).join(' · '), 'БАТЛАХ · ХҮЛЭЭЛГЭНД · ЦУЦЛАХ · ТАТГАЛЗАХ');
eq('bulk actions map to statuses', BULK_ACTIONS.map((a) => a.status).join(','), 'approved,waitlisted,cancelled,rejected');
ok('every bulk status is one the API accepts', BULK_ACTIONS.every((a) => parseStatusPatch({ status: a.status }).ok));

const REGS = [
  ...Array.from({ length: 3 }, () => ({ status: 'pending', isNew: true })),
  ...Array.from({ length: 2 }, () => ({ status: 'approved', isNew: false })),
  { status: 'approved', isNew: true },
  { status: 'cancelled', isNew: false },
  { status: 'rejected', isNew: true },
];
eq('countByStatus', j(countByStatus(REGS)), j({ pending: 3, waitlisted: 0, approved: 3, cancelled: 1, rejected: 1 }));
eq('summary line with a limit', reviewSummary(REGS, 64), 'БҮРТГЭЛ · 3 ХҮЛЭЭГДЭЖ · 3/64 БАТАЛГААЖСАН · 1 ЦУЦЛАГДСАН');
eq('summary line, unlimited', reviewSummary(REGS, null), 'БҮРТГЭЛ · 3 ХҮЛЭЭГДЭЖ · 3/∞ БАТАЛГААЖСАН · 1 ЦУЦЛАГДСАН');
// The limit is NOT enforced (PR-4): an overrun must be SHOWN, not hidden.
eq('an overrun reads as exactly that', reviewSummary(Array.from({ length: 5 }, () => ({ status: 'approved' })), 4),
  'БҮРТГЭЛ · 0 ХҮЛЭЭГДЭЖ · 5/4 БАТАЛГААЖСАН · 0 ЦУЦЛАГДСАН');
eq('no registrations', reviewSummary([], 20), 'БҮРТГЭЛ · 0 ХҮЛЭЭГДЭЖ · 0/20 БАТАЛГААЖСАН · 0 ЦУЦЛАГДСАН');
eq('section footer counts the new ones', sectionFooter(REGS.filter((r) => r.status === 'approved')), '3 тамирчин · 1 шинэ');
eq('an empty section footer', sectionFooter([]), '0 тамирчин · 0 шинэ');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
