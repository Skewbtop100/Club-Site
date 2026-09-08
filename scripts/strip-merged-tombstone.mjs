#!/usr/bin/env node
// One-off repair: strip a participant document that was tombstoned by an
// EARLIER version of the merge tool, which only deleted profileStatus and
// left the rest of the profile behind.
//
// The consequence of that older behaviour: signing in with the old Gmail
// showed a complete-looking profile — name, photo, verification, stats —
// for an athlete who also exists under the new uid. The same person twice.
// The merge now empties the old document at commit time; this brings
// already-merged documents to that same shape.
//
// The field list is NOT written out here. It comes from tombstoneStrip()
// in lib/online-competition/merge-athlete.mjs — the same function the merge
// itself uses — so this script and the merge can never disagree about what
// a tombstone keeps.
//
// DRY RUN BY DEFAULT. Nothing is written without --commit.
//
// Usage:
//   node --env-file=.env --env-file=.env.local scripts/strip-merged-tombstone.mjs \
//     --email old@gmail.com
//   # or by uid:
//   ... --uid G7rpGaBo2XaMrJRrE9XdUAdbeRg2
//
//   # after reviewing:
//   ... --email old@gmail.com --commit
//
// Refuses any document without a `mergedInto` field: this only ever repairs
// an already-merged account, never empties a live one.

import admin from 'firebase-admin';
import {
  KEPT_ON_OLD,
  PARTICIPANTS,
  TOMBSTONE_MARKERS,
  tombstoneStrip,
} from '../lib/online-competition/merge-athlete.mjs';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');

function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

const EMAIL = flag('--email');
const UID = flag('--uid');

function initAdmin() {
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

function preview(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object' && typeof value.toMillis === 'function') {
    return `Timestamp(${new Date(value.toMillis()).toISOString()})`;
  }
  const s = JSON.stringify(value);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

async function main() {
  if (!EMAIL && !UID) {
    console.error('Usage: strip-merged-tombstone.mjs (--email <email> | --uid <uid>) [--commit]');
    process.exit(1);
  }

  const db = initAdmin().firestore();

  console.log(`\n=== strip merged tombstone — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ===\n`);

  let doc;
  if (UID) {
    doc = await db.collection(PARTICIPANTS).doc(UID).get();
    if (!doc.exists) {
      console.error(`No participant with uid "${UID}".`);
      process.exit(1);
    }
  } else {
    const snap = await db.collection(PARTICIPANTS).where('email', '==', EMAIL).get();
    if (snap.size === 0) {
      console.error(`No participant has email "${EMAIL}".`);
      process.exit(1);
    }
    if (snap.size > 1) {
      console.error(
        `${snap.size} participants share "${EMAIL}": ${snap.docs.map((d) => d.id).join(', ')}. ` +
          'Re-run with --uid to name one.',
      );
      process.exit(1);
    }
    doc = snap.docs[0];
  }

  const data = doc.data() ?? {};
  console.log(`  document : ${PARTICIPANTS}/${doc.id}`);
  console.log(`  email    : ${data.email ?? '—'}`);
  console.log(`  mergedInto: ${data.mergedInto ?? '(absent)'}\n`);

  if (!data.mergedInto) {
    console.error(
      'ABORTED — this document has no `mergedInto` field, so it is a LIVE profile, not a\n' +
        'tombstone. This script only ever repairs an account whose data has already been\n' +
        'moved elsewhere.',
    );
    process.exit(1);
  }

  const strip = tombstoneStrip(Object.keys(data));
  const kept = Object.keys(data).filter((k) => !strip.includes(k)).sort();

  console.log('── Would DELETE ────────────────────────────────────────');
  if (strip.length === 0) console.log('  (nothing — already in the correct shape)');
  for (const key of strip.sort()) console.log(`  - ${key.padEnd(22)} = ${preview(data[key])}`);
  console.log('');

  console.log('── Would KEEP ──────────────────────────────────────────');
  for (const key of kept) console.log(`  = ${key.padEnd(22)} = ${preview(data[key])}`);
  console.log(`\n  (the tombstone keeps ${KEPT_ON_OLD.join(', ')} plus ${TOMBSTONE_MARKERS.join(', ')})`);
  console.log('');

  if (strip.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  if (!COMMIT) {
    console.log(`DRY RUN — nothing written. Re-run with --commit to delete ${strip.length} field(s).\n`);
    return;
  }

  const update = {};
  for (const key of strip) update[key] = admin.firestore.FieldValue.delete();
  await doc.ref.update(update);
  console.log(`Done — ${strip.length} field(s) deleted from ${PARTICIPANTS}/${doc.id}.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
