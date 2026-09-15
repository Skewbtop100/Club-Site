// ── The competition details page on a phone ──────────────────────────────
// Source checks on the page, the athletes tab and theme.css. The photo's
// visibility rule itself is unit-tested in roster-view.test.cjs.
//
// Run: npm run test:detailsmobile

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail !== undefined) console.log(`          -> ${detail}`);
}

const page = src('app/online-competition/[competitionId]/details/page.tsx');
const tab = src('app/online-competition/[competitionId]/details/_components/AthletesTab.tsx');
const css = src('app/online-competition/theme.css');
/** The body of the phone rules that hold the details-page fixes. */
const phone = (() => {
  const at = css.indexOf('  .oc-cd-fact-wide {');
  const start = css.lastIndexOf('@media (max-width: 640px) {', at);
  return css.slice(start, css.indexOf('\n}\n', at));
})();
const rule = (block, sel) => (block.match(new RegExp(`\\n\\s*${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`)) || [])[1] || '';

console.log('\n  -- 1. no grey text over the Бүртгүүлэх tab --');
ok('the count is not shown on a phone', /\.oc-cd-side-count,\s*\.oc-cd-side-label-full \{\s*display: none;/.test(phone));
ok('  ...and the label cannot shrink under anything', /flex: none;/.test(rule(phone, '.oc-cd-side-label')) && /white-space: nowrap;/.test(rule(phone, '.oc-cd-side-label')));

console.log('\n  -- 2. three tabs on one line --');
ok('Ерөнхий мэдээлэл has a short phone label', page.includes('label="Ерөнхий мэдээлэл"') && page.includes('shortLabel="Ерөнхий"'));
ok('  ...swapped in only below 640px', /\.oc-cd-side-label-short \{\s*display: none;/.test(css) && /\.oc-cd-side-label-short \{\s*display: inline;/.test(phone));
ok('each tab an equal third, no minimum width, 12px type, 8px side padding',
  /flex: 1 1 0;/.test(rule(phone, '.oc-cd-side-item')) && /min-width: 0;/.test(rule(phone, '.oc-cd-side-item')) &&
    /padding: 12px 8px;/.test(rule(phone, '.oc-cd-side-item')) && /font-size: 12px;/.test(rule(phone, '.oc-cd-side-label')));
ok('  ...keeping the 44px tap target', /min-height: 44px;/.test(rule(phone, '.oc-cd-side-item')));

console.log('\n  -- 3. the Тамирчид caption and footnote are gone --');
ok('no "Тамирчид" caption above the event chips', !page.includes('<h2 className="oc-cd-section-label">Тамирчид</h2>'));
ok('no personal-best footnote', !tab.includes('Хувийн дээд амжилтаар эрэмбэлэв') && !tab.includes('oc-ro-note') && !css.includes('.oc-ro-note'));

console.log('\n  -- 4. a tighter rank column --');
ok('the rank sizes to its digits, 4px from the avatar',
  /width: 1%;[\s\S]*padding-right: 4px;/.test(rule(phone, '.oc-ro-table td.oc-ro-col-rank')) &&
    /padding-left: 0;/.test(rule(phone, '.oc-ro-table td.oc-ro-col-avatar')));

console.log('\n  -- 5. the approved photo --');
ok('the avatar shows photoUrl, else the initials', tab.includes('r.athlete.photoUrl ? (') && tab.includes('r.athlete.initials'));
ok('  ...clipped to its square', /overflow: hidden;/.test(rule(css, '.oc-ro-avatar')));

console.log('\n  -- 6. AVERAGE beside SINGLE, on screen --');
ok('the header reads AVERAGE', tab.includes('>AVERAGE</th>') && !tab.includes('ДУНДАЖ'));
ok('no minimum table width on a phone', /min-width: 0;/.test(rule(phone, '.oc-ro-table')));
ok('the times size to their text; the name wraps', /width: 1%;/.test(rule(phone, '.oc-ro-table td.oc-ro-col-num')) &&
  /overflow-wrap: anywhere;/.test(rule(phone, '.oc-ro-table td.oc-ro-col-name')));
ok('  ...inside the frame that scrolls only on overflow', tab.includes('className="oc-cd-table-wrap"') && /overflow-x: auto;/.test(rule(css, '.oc-cd-table-wrap')));

console.log('\n  -- 7. dates in pairs --');
for (const label of ['БҮРТГЭЛ НЭЭГДЭХ', 'БҮРТГЭЛ ХААГДАХ', 'ТЭМЦЭЭН ЭХЛЭХ', 'ТЭМЦЭЭН ДУУСАХ']) {
  ok(`${label} is paired`, new RegExp(`label: '${label}',[^}]*paired: true`).test(page));
}
for (const label of ['ФОРМАТ', 'ТАМИРЧНЫ ХЯЗГААР', 'СУУРЬ ХУРААМЖ', 'НЭМЭЛТ ХУРААМЖ']) {
  ok(`${label} keeps its own row`, !new RegExp(`label: '${label}',[^}]*paired: true`).test(page));
}
ok('two columns on a phone; unpaired facts span both',
  /repeat\(2, minmax\(0, 1fr\)\)/.test(rule(phone, '.oc-cd-facts')) && /grid-column: 1 \/ -1;/.test(rule(phone, '.oc-cd-fact-wide')) &&
    page.includes("className={`oc-cd-fact${f.paired ? '' : ' oc-cd-fact-wide'}`}"));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
