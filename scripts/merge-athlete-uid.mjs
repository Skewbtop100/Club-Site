#!/usr/bin/env node
// CLI for the athlete uid merge. All of the logic lives in
// lib/online-competition/merge-athlete.mjs, which the admin UI's API route
// imports too — there is exactly one implementation, so the code this
// script's tests exercise is the code the admin button runs.
//
// The case this exists for: an athlete loses access to the Gmail they
// signed up with, signs in with a new one, and Firebase issues a new uid
// with an empty participant doc. Everything they have done — profile
// verification, registrations, submissions, season points, group
// assignments, qualification — hangs off the old uid.
//
// IDENTITY IS VERIFIED OFF-PLATFORM. This performs the move; it does not
// and cannot decide that the two accounts are the same person.
//
// DRY RUN BY DEFAULT. Nothing is written without --commit.
//
// Usage:
//   node --env-file=.env --env-file=.env.local scripts/merge-athlete-uid.mjs \
//     --old-email old@gmail.com --new-email new@gmail.com
//
//   # after reviewing the plan:
//   ... --old-email old@gmail.com --new-email new@gmail.com --commit
//
//   # only to finish a run that died halfway:
//   ... --commit --resume
//
// ── RESUMING ─────────────────────────────────────────────────────────────
// The "new account is fresh" pre-flight is what stops this being pointed at
// two real athletes and silently fusing them. But a run interrupted partway
// has already put data on the new uid, so that same assertion blocks the
// resume. --resume relaxes ONLY those freshness checks; every other
// assertion still holds. Use it exclusively to finish an interrupted run.
// Deliberately CLI-only — the admin UI has no such escape hatch.

import admin from 'firebase-admin';
import { pathToFileURL } from 'node:url';
import {
  MERGE_ERRORS,
  PARTICIPANTS,
  commitMerge,
  planMerge,
  rekeyAssignments,
  replaceUidInArray,
} from '../lib/online-competition/merge-athlete.mjs';

// Re-exported so the tests can unit-test the two container edits directly.
export { replaceUidInArray, rekeyAssignments };

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const RESUME = argv.includes('--resume');

function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

const OLD_EMAIL = flag('--old-email');
const NEW_EMAIL = flag('--new-email');

function initAdmin() {
  // Under the Firestore emulator there is nothing to authenticate against,
  // and firebase-admin routes to it purely off FIRESTORE_EMULATOR_HOST.
  // This is how tests/merge-athlete-uid drives the script for real rather
  // than re-implementing it.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'merge-test' });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const projectId =
    process.env.ONLINE_COMP_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.ONLINE_COMP_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.ONLINE_COMP_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'No credentials. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, or the\n' +
        'ONLINE_COMP_FIREBASE_CLIENT_EMAIL / ONLINE_COMP_FIREBASE_PRIVATE_KEY /\n' +
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID env vars used by the app.',
    );
    process.exit(1);
  }
  return admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

const short = (uid) => `${uid.slice(0, 10)}…`;
const show = (v) => (v === undefined ? '(absent)' : JSON.stringify(v));

/** Resolution failures have no plan to print, so they end the run here. */
function reportResolutionError(err) {
  const lines = {
    [MERGE_ERRORS.OLD_EMAIL_NOT_FOUND]: `No OLD participant has email "${err.email}".`,
    [MERGE_ERRORS.NEW_EMAIL_NOT_FOUND]:
      `No NEW participant has email "${err.email}". The athlete must sign in with the new ` +
      'Gmail first — that sign-in is what creates the destination account.',
    [MERGE_ERRORS.OLD_EMAIL_AMBIGUOUS]: `Several participants share the OLD email "${err.email}": ${err.uids?.join(', ')}. Refusing to guess.`,
    [MERGE_ERRORS.NEW_EMAIL_AMBIGUOUS]: `Several participants share the NEW email "${err.email}": ${err.uids?.join(', ')}. Refusing to guess.`,
  };
  console.error(`\n${lines[err.code] ?? `${err.code}: ${JSON.stringify(err)}`}`);
}

function printPlan(planned) {
  const { oldUid, newUid, plan, newData } = planned;

  console.log('── A — participant document (moves LAST) ───────────────────');
  console.log(`  merge  ${PARTICIPANTS}/${oldUid}`);
  console.log(`  into   ${PARTICIPANTS}/${newUid}`);
  for (const k of Object.keys(plan.A.merged).sort()) {
    console.log(`      ${plan.A.fromNew.includes(k) ? 'NEW' : 'OLD'}  ${k.padEnd(22)} = ${show(plan.A.merged[k])}`);
  }
  const dropped = Object.keys(newData).filter((k) => !(k in plan.A.merged));
  if (dropped.length) console.log(`      (new-doc fields with no old counterpart, left as-is: ${dropped.join(', ')})`);
  if ('stats' in plan.A.merged) {
    console.log('      NOTE  stats is written with update(), so the old rollup REPLACES');
    console.log('            the new doc’s wholesale. set(merge:true) deep-merges nested');
    console.log('            maps, which would fuse two athletes’ per-event rollups.');
  }
  console.log(`  then tombstone ${PARTICIPANTS}/${oldUid}: mergedInto="${newUid}", profileStatus deleted`);
  console.log('');

  console.log('── B — registrations (copy, then delete) ──────────────────');
  if (!plan.B.length) console.log('  (none)');
  for (const r of plan.B) {
    console.log(`  ${PARTICIPANTS}/${oldUid}/registrations/${r.id}`);
    console.log(`      -> ${PARTICIPANTS}/${newUid}/registrations/${r.id}   events=${JSON.stringify(r.data.events ?? [])}`);
  }
  console.log('');

  console.log('── C — onlineSubmissions.uid (field rewrite) ──────────────');
  console.log(`  ${plan.C.length} document(s)${plan.C.length ? ':' : ''}`);
  for (const id of plan.C) console.log(`      onlineSubmissions/${id}  uid: ${short(oldUid)} -> ${short(newUid)}`);
  console.log('');

  console.log('── D — season points (copy, then delete) ─────────────────');
  if (!plan.D.length) console.log('  (none)');
  for (const d of plan.D) {
    console.log(`  onlineSeasonPoints/${d.season}/athletes/${oldUid}  totalPoints=${d.data.totalPoints}`);
    console.log(`      -> .../athletes/${newUid}   uid + displayName + photoURL refreshed from the new account`);
  }
  console.log('');

  console.log('── E — onlineNotifications.uid (field rewrite) ────────────');
  console.log(`  ${plan.E.length} document(s)${plan.E.length ? ':' : ''}`);
  for (const id of plan.E) console.log(`      onlineNotifications/${id}  uid: ${short(oldUid)} -> ${short(newUid)}`);
  console.log('');

  console.log('── F — qualifiers uids[] (in-place, order preserved) ──────');
  if (!plan.F.length) console.log('  (none)');
  for (const f of plan.F) {
    console.log(`  ${f.path}`);
    console.log(`      before: ${JSON.stringify(f.before.map(short))}`);
    console.log(`      after : ${JSON.stringify(f.after.map(short))}`);
    console.log(`      index ${f.index} of ${f.before.length} — position unchanged`);
  }
  console.log('');

  console.log('── G — groupAssignments map key (rekey) ─────────────────');
  if (!plan.G.length) console.log('  (none)');
  for (const g of plan.G) {
    const fmt = (m) => JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [short(k), v])));
    console.log(`  ${g.path}`);
    console.log(`      before: ${fmt(g.before)}`);
    console.log(`      after : ${fmt(g.after)}`);
  }
  console.log('');
}

async function main() {
  if (!OLD_EMAIL || !NEW_EMAIL) {
    console.error('Usage: merge-athlete-uid.mjs --old-email <email> --new-email <email> [--commit] [--resume]');
    process.exit(1);
  }

  const db = initAdmin().firestore();

  console.log(`\n=== merge athlete uid — ${COMMIT ? 'COMMIT' : 'DRY RUN'}${RESUME ? ' (RESUME)' : ''} ===\n`);
  console.log(`  old email: ${OLD_EMAIL}`);
  console.log(`  new email: ${NEW_EMAIL}\n`);

  const planned = await planMerge(db, { oldEmail: OLD_EMAIL, newEmail: NEW_EMAIL, resume: RESUME });

  if (!planned.plan) {
    reportResolutionError(planned.errors[0]);
    process.exit(1);
  }

  console.log(`  resolved OLD uid: ${planned.oldUid}`);
  console.log(`  resolved NEW uid: ${planned.newUid}\n`);

  printPlan(planned);

  console.log('── Pre-flight ───────────────────────────────────────');
  for (const c of planned.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
  if (RESUME) {
    const s = planned.newAccountState;
    console.log('  SKIP  new-account freshness checks (--resume)');
    console.log(
      `          new uid currently holds: ${s.submissions} submission(s), ${s.registrations} registration(s), ` +
        `${s.seasonDocs} season doc(s), profileStatus=${show(s.profileStatus ?? undefined)}`,
    );
  }

  const { plan } = planned;
  const total = plan.B.length + plan.C.length + plan.D.length + plan.E.length + plan.F.length + plan.G.length + 2;
  console.log('');
  console.log('── Total ───────────────────────────────────────────');
  console.log('  A participant docs written : 2 (merge target + tombstone)');
  console.log(`  B registrations moved      : ${plan.B.length}`);
  console.log(`  C submissions rewritten    : ${plan.C.length}`);
  console.log(`  D season-points docs moved : ${plan.D.length}`);
  console.log(`  E notifications rewritten  : ${plan.E.length}`);
  console.log(`  F qualifier arrays edited  : ${plan.F.length}`);
  console.log(`  G assignment maps rekeyed  : ${plan.G.length}`);
  console.log(`  TOTAL document writes      : ${total}`);
  console.log('');

  if (!planned.ok) {
    console.error('ABORTED — pre-flight failed:');
    for (const c of planned.checks.filter((x) => !x.ok)) console.error(`  * ${c.label}`);
    process.exit(1);
  }

  if (!COMMIT) {
    console.log('DRY RUN — nothing written. Re-run with --commit to apply.\n');
    return;
  }

  const counts = await commitMerge(db, planned);
  console.log(`  C submissions: ${counts.C} rewritten`);
  console.log(`  E notifications: ${counts.E} rewritten`);
  console.log(`  B registrations: ${counts.B} moved`);
  console.log(`  D season points: ${counts.D} moved`);
  console.log(`  F qualifier arrays: ${counts.F} edited`);
  console.log(`  G assignment maps: ${counts.G} rekeyed`);
  console.log(`  A participant: merged into ${planned.newUid}, old doc tombstoned`);
  console.log('\nDone.\n');
}

// Importing this file (the tests do, for the pure functions above) must not
// kick off a merge — only running it directly does.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
