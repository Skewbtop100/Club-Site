#!/usr/bin/env node
// One-off maintenance script: give already-approved athletes the
// `approved*` identity snapshot that approval now writes.
//
// Background: approval has always snapshotted the reviewed photo into
// `approvedPhotoUrl`, so a later edit could never retroactively change the
// photo an admin actually saw. The reviewed NAME, birth date, gender and
// citizenship had no such snapshot — they are now written by
// app/api/online-competition/admin-athletes/[uid]/route.ts at approval
// time, and locked against client writes by firestore.rules
// (judgeFieldsUntouched). Athletes approved BEFORE that change have no
// snapshot and would not get one until re-approved. This copies their
// current live values across once.
//
// DRY RUN BY DEFAULT. Nothing is written without --commit.
//
// Usage:
//   # credentials: either a service account key file...
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//     node scripts/backfill-approved-identity.mjs
//   # ...or the same env vars the app's API routes use, e.g.
//   node --env-file=.env --env-file=.env.local scripts/backfill-approved-identity.mjs
//
//   # after reviewing the dry run:
//   ... scripts/backfill-approved-identity.mjs --commit
//
// Safety rules this script holds to:
//   * only participants whose profileStatus is exactly 'approved'
//   * only the five approved* identity fields, never any other field
//   * never overwrites an approved* value that is already present —
//     including one deliberately set to null
//   * never deletes anything
//   * targets documents by document ID only
//
// Re-runnable: a second pass finds nothing left to do.

import admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');

/** live field -> snapshot field */
const SNAPSHOT_FIELDS = [
  ['lastName', 'approvedLastName'],
  ['firstName', 'approvedFirstName'],
  ['dateOfBirth', 'approvedDateOfBirth'],
  ['gender', 'approvedGender'],
  ['citizenship', 'approvedCitizenship'],
];

/** Exactly the coercion the approval route uses, so a backfilled document
 *  is indistinguishable from a freshly-approved one: a missing or
 *  non-string live value stores null rather than undefined (which
 *  Firestore rejects outright). */
const str = (value) => (typeof value === 'string' ? value : null);

function initAdmin() {
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

function show(value) {
  return value === null ? 'null' : JSON.stringify(value);
}

async function main() {
  const db = initAdmin().firestore();

  console.log(`\n=== backfill approved* identity snapshot — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ===\n`);

  const snap = await db.collection('onlineParticipants').get();

  const skippedNotApproved = [];
  const skippedComplete = [];
  /** [{ id, updates, before }] */
  const planned = [];

  for (const d of snap.docs) {
    const data = d.data();
    if (data.profileStatus !== 'approved') {
      skippedNotApproved.push(d.id);
      continue;
    }

    // A field already present is left ALONE, even when its value is null —
    // an admin-written null is a real answer ("this athlete gave no
    // citizenship"), not a gap to be filled from the live doc, which may
    // have moved on since.
    const updates = {};
    const before = {};
    for (const [live, snapshotField] of SNAPSHOT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, snapshotField)) continue;
      updates[snapshotField] = str(data[live]);
      before[snapshotField] = data[live];
    }

    if (Object.keys(updates).length === 0) {
      skippedComplete.push(d.id);
      continue;
    }
    planned.push({ id: d.id, displayName: data.displayName ?? '', updates, before });
  }

  console.log('── Totals ──────────────────────────────────────────────');
  console.log(`  participants scanned          : ${snap.size}`);
  console.log(`  not approved (untouched)      : ${skippedNotApproved.length}`);
  console.log(`  approved, snapshot already set: ${skippedComplete.length}`);
  console.log(`  approved, would be backfilled : ${planned.length}`);
  console.log('');

  console.log('── Per-document diff ───────────────────────────────────');
  if (planned.length === 0) console.log('  (nothing to write)');
  for (const p of planned) {
    console.log(`\n  onlineParticipants/${p.id}  "${p.displayName}"`);
    for (const [field, value] of Object.entries(p.updates)) {
      const source = SNAPSHOT_FIELDS.find(([, s]) => s === field)[0];
      console.log(`      + ${field.padEnd(22)} = ${show(value)}   (from ${source}: ${show(p.before[field] ?? null)})`);
    }
  }
  console.log('');

  if (!COMMIT) {
    console.log(
      `DRY RUN — nothing written. Re-run with --commit to update ${planned.length} document(s).\n`,
    );
    return;
  }

  // Batched, and `update` rather than `set` so a document that vanished
  // between the read and the write fails loudly instead of being recreated
  // from a partial payload.
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < planned.length; i += CHUNK) {
    const batch = db.batch();
    for (const p of planned.slice(i, i + CHUNK)) {
      batch.update(db.collection('onlineParticipants').doc(p.id), p.updates);
    }
    await batch.commit();
    written += Math.min(CHUNK, planned.length - i);
    console.log(`  committed ${written}/${planned.length}`);
  }
  console.log(`\nDone — ${written} document(s) updated.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
