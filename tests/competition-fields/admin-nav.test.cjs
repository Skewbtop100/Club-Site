// ── The admin sidebar's grouped sections ─────────────────────────────────
// Source checks on AdminShell.tsx and theme.css against
// design-mockups/Khorom Admin.dc.html.
//
// Run: npm run test:adminnav

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

const shell = src('app/online-competition/admin/_components/AdminShell.tsx');
const nav = shell.slice(shell.indexOf('<nav className="oc-adm-navlist">'), shell.indexOf('</nav>'));
const at = (s) => nav.indexOf(s);

console.log('\n  -- structure --');
ok('Хяналтын самбар, then Тэмцээн, then Тамирчид, then Тохиргоо',
  at('label="Хяналтын самбар"') > -1 &&
    at('label="Хяналтын самбар"') < at('label="Тэмцээн"') &&
    at('label="Тэмцээн"') < at('label="Тамирчид"') &&
    at('label="Тамирчид"') < at('label="Тохиргоо"'));

const comp = nav.slice(at('label="Тэмцээн"'), at('label="Тамирчид"'));
const children = [
  ['Тэмцээнүүд', '/competitions`'],
  ['Шинэ тэмцээн', '/competitions/new`'],
  ['Холилт ба групп', '/scrambles`'],
  ['Раунд удирдах', '/rounds`'],
  ['Шүүлт', '/review`'],
];
let last = -1;
for (const [label, route] of children) {
  const i = comp.indexOf(`label="${label}"`);
  ok(`Тэмцээн > ${label}, in order, to ${route.slice(0, -1)}`, i > last && comp.lastIndexOf(route, i) > last, comp.slice(Math.max(0, i - 120), i + 40));
  last = i;
}
const people = nav.slice(at('label="Тамирчид"'), at('label="Тохиргоо"'));
ok('Тамирчид > Тамирчдын бүртгэл, to /athletes', people.includes('label="Тамирчдын бүртгэл"') && people.includes('/athletes`'));
ok('Бүртгэлийн хүсэлт has no page yet, so no item — not a dead link', !nav.includes('Бүртгэлийн хүсэлт'));

console.log('\n  -- every item goes to a page that exists --');
for (const route of ['', '/competitions', '/competitions/new', '/scrambles', '/rounds', '/review', '/athletes', '/settings']) {
  ok(`app/online-competition/admin${route}/page.tsx exists`, fs.existsSync(path.join(ROOT, `app/online-competition/admin${route}/page.tsx`)));
}
ok('the new-competition page marks its own item', src('app/online-competition/admin/competitions/new/page.tsx').includes('<AdminGate current="newCompetition">'));

console.log('\n  -- behaviour --');
ok('a group toggles on click and says whether it is open', shell.includes('aria-expanded={open}') && shell.includes('onClick={onToggle}'));
ok('the group holding the current page is open on load',
  shell.includes("competitions: currentGroup === 'competitions' || stored.competitions === true") &&
    shell.includes("athletes: currentGroup === 'athletes' || stored.athletes === true"));
ok('other opened groups are remembered for the tab, failing safely',
  shell.includes('window.sessionStorage.getItem(OPEN_KEY)') && shell.includes('window.sessionStorage.setItem(OPEN_KEY') &&
    (shell.match(/try \{\s*(stored = JSON\.parse|window\.sessionStorage\.setItem)/g) || []).length === 2);
ok('the current item is marked (aria-current + class)',
  shell.includes("className={`oc-adm-navchild${active ? ' oc-adm-navchild-active' : ''}`}") && shell.includes("aria-current={active ? 'page' : undefined}"));
ok('counts: Тэмцээнүүд, Шүүлт (urgent), Тамирчдын бүртгэл (urgent)',
  /label="Тэмцээнүүд"[\s\S]{0,80}count=\{counts\.competitions\}/.test(nav) &&
    /label="Шүүлт"[\s\S]{0,80}count=\{counts\.review\}\s*urgent/.test(nav) &&
    /label="Тамирчдын бүртгэл"[\s\S]{0,80}count=\{counts\.athletes\}\s*urgent/.test(nav));

console.log('\n  -- the mockup\'s values --');
const css = src('app/online-competition/theme.css');
const rule = (sel) => (css.match(new RegExp(`\\n${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`)) || [])[1] || '';
ok('group header: 13px 16px, 600 12px, #9A958A', /padding: 13px 16px;/.test(rule('.oc-adm-navgroup')) && /font: 600 12px\/1/.test(rule('.oc-adm-navgroup')) && /color: #9A958A;/.test(rule('.oc-adm-navgroup')));
ok('the current group: #131318 / #F4F1EA', /background: #131318;/.test(rule('.oc-adm-navgroup-current')) && /color: #F4F1EA;/.test(rule('.oc-adm-navgroup-current')));
ok('children: #0A0A0C with #16161B rules', /background: #0A0A0C;/.test(rule('.oc-adm-navchildren')) && /border-top: 1px solid #16161B;/.test(rule('.oc-adm-navchildren')));
ok('child: 12px 16px 12px 26px, 500 11px/1.3', /padding: 12px 16px 12px 26px;/.test(rule('.oc-adm-navchild')) && /font: 500 11px\/1\.3/.test(rule('.oc-adm-navchild')));
ok('active child: #16161B, #F4F1EA, #DFFF4F rule', /border-left-color: #DFFF4F;/.test(rule('.oc-adm-navchild-active')) && /background: #16161B;/.test(rule('.oc-adm-navchild-active')));
ok('arrow: 4px/5px, volt open, muted closed', shell.includes("borderBottom: '5px solid #DFFF4F'") && shell.includes("borderTop: '5px solid #6E6A62'"));
ok('phone: groups and children keep 44px tap targets', /\.oc-adm-navitem,\s*\.oc-adm-navgroup,\s*\.oc-adm-navchild \{\s*min-height: 44px;/.test(css));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
