// ── The admin view must actually carry what the review panel reads ─────
// THREE FIELDS IN A ROW REACHED PRODUCTION DOING NOTHING. `marks` was
// stored on the document and never mapped, so the jump buttons would have
// rendered permanently disabled. `coverStart` was added to the mark
// allowlist everywhere except the one array the mapper filters by, so the
// КОВЕР button would have silently kept using its fallback forever.
// `timerShotIds`/`cubeShotIds` were on OnlineSubmission but not on the
// admin view, so every submission would have rendered as "no stills",
// indistinguishable from a legacy one.
//
// Every one of them typechecked. Every one of them looked like working
// software: the feature simply behaved as though the data were absent,
// which is a state all three of those features are REQUIRED to handle
// gracefully. That is what makes this class of bug invisible — the
// graceful path and the broken path are the same path.
//
// GET /api/online-competition/submissions builds its result field by
// field, deliberately (see the note there about not spreading raw
// documents). This suite is the cost of that decision: it checks the
// three places that have to agree — what the panel reads, what the view
// declares, and what the mapper assigns.
//
// Run: npm run test:adminview

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const types = read('lib/online-competition/types.ts');
const mapper = read('app/api/online-competition/submissions/route.ts');
const panel = read('app/online-competition/admin/_components/SubmissionDetailPanel.tsx');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`          -> ${detail}`);
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The field names declared on OnlineSubmissionAdminView. */
function viewFields() {
  const start = types.indexOf('export interface OnlineSubmissionAdminView {');
  const body = types.slice(start, types.indexOf('\n}', start));
  return new Set(
    [...stripComments(body).matchAll(/^\s{2}([a-zA-Z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]),
  );
}

/** The keys the mapper assigns into the object it returns. */
function mappedFields() {
  const start = mapper.indexOf('const submissions: OnlineSubmissionAdminView[]');
  const body = stripComments(mapper.slice(start, mapper.indexOf('return NextResponse.json', start)));
  return new Set([...body.matchAll(/^\s{6}([a-zA-Z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]));
}

/** Every `submission.x` the review panel touches. */
function panelReads() {
  return new Set(
    [...stripComments(panel).matchAll(/\bsubmission\.([a-zA-Z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );
}

const declared = viewFields();
const mapped = mappedFields();
const reads = panelReads();

console.log('\n=== admin view field coverage ===\n');

// Sanity: if a parser silently matched nothing, every assertion below
// would pass vacuously. That is exactly the failure mode this suite
// exists to prevent, so it is checked first.
ok('the view interface parses to a real field list', declared.size >= 10, [...declared].join(','));
ok('the mapper parses to a real field list', mapped.size >= 10, [...mapped].join(','));
ok('the panel parses to a real read list', reads.size >= 5, [...reads].join(','));

// ── The rule the three regressions all broke ──────────────────────────
const declaredNotMapped = [...declared].filter((f) => !mapped.has(f));
ok('every field the admin view declares is assigned by the mapper',
  declaredNotMapped.length === 0,
  `declared but never mapped: ${declaredNotMapped.join(', ')}`);

const readNotDeclared = [...reads].filter((f) => !declared.has(f));
ok('every field the review panel reads exists on the admin view',
  readNotDeclared.length === 0,
  `read by the panel but absent from the view: ${readNotDeclared.join(', ')}`);

const readNotMapped = [...reads].filter((f) => !mapped.has(f));
ok('  ...and is actually populated, not merely declared',
  readNotMapped.length === 0,
  `read by the panel but never mapped: ${readNotMapped.join(', ')}`);

// ── The specific fields that got dropped, named ───────────────────────
// Redundant with the rule above, and kept anyway: a failure here names
// the exact field that went missing rather than a general invariant.
for (const field of ['marks', 'checks', 'timerShotIds', 'cubeShotIds', 'videoDurationMs']) {
  ok(`  ${field} survives the boundary`, declared.has(field) && mapped.has(field),
    `declared=${declared.has(field)} mapped=${mapped.has(field)}`);
}

// coverStart is not a top-level field — it lives inside `marks`, and it
// was dropped by the mapper's own key allowlist rather than by the view.
// Different hole, same shape, so it gets its own check.
ok('  coverStart survives the mark allowlist',
  /'coverStart'/.test(mapper),
  'MARK_KEYS in the submissions route does not list coverStart');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
