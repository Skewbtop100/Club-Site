#!/usr/bin/env node
// One-off maintenance script: delete ALL documents in the `practiceSessions`
// collection. The Practice Log feature (app code, admin tab, nav link,
// Firestore rules) has been removed from the codebase — this clears out the
// now-orphaned production data behind it.
//
// Usage:
//   1. Download a service account key from Firebase Console →
//      Project Settings → Service Accounts → Generate new private key.
//   2. Save it locally (NOT inside the repo — see .gitignore's
//      serviceAccountKey.json entry) and set:
//        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
//   3. Dry run (default — prints doc count + samples, deletes nothing):
//        node scripts/cleanup-practice-sessions.mjs
//   4. Actually delete, after reviewing the dry run:
//        node scripts/cleanup-practice-sessions.mjs --confirm
//
// Safe to re-run: if a targeted doc was already deleted, it's just
// skipped (Firestore batch deletes are idempotent).

import admin from 'firebase-admin';

const CONFIRM = process.argv.includes('--confirm');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'Missing GOOGLE_APPLICATION_CREDENTIALS.\n' +
    'Download a service account key (Firebase Console → Project Settings → ' +
    'Service Accounts) and set:\n' +
    '  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/cleanup-practice-sessions.mjs',
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

function fmtMs(cs) {
  if (cs === null || cs === undefined) return 'DNF';
  const s = Math.floor(cs / 100);
  const c = cs % 100;
  return `${s}.${String(c).padStart(2, '0')}`;
}

async function main() {
  const snap = await db.collection('practiceSessions').get();

  console.log(`\nTotal practiceSessions docs: ${snap.size}\n`);

  if (snap.size === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const byEvent = {};
  snap.forEach(doc => {
    const s = doc.data();
    (byEvent[s.event] ??= []).push({ id: doc.id, ...s });
  });

  for (const [event, docs] of Object.entries(byEvent)) {
    console.log(`event=${event}: ${docs.length} doc(s)`);
    for (const d of docs.slice(0, 3)) {
      console.log(`  ${d.id}  athlete=${d.athleteName ?? d.athleteId} date=${d.date} ao5=${fmtMs(d.ao5)}`);
    }
    if (docs.length > 3) console.log(`  ...and ${docs.length - 3} more`);
  }

  if (!CONFIRM) {
    console.log('\nDry run only — no documents deleted. Re-run with --confirm to delete.');
    return;
  }

  // Firestore caps a batch at 500 ops; chunk at 400 for headroom.
  const allDocs = snap.docs;
  const CHUNK = 400;
  let deleted = 0;
  for (let i = 0; i < allDocs.length; i += CHUNK) {
    const batch = db.batch();
    const chunk = allDocs.slice(i, i + CHUNK);
    for (const doc of chunk) batch.delete(doc.ref);
    await batch.commit();
    deleted += chunk.length;
    console.log(`Deleted ${deleted}/${allDocs.length}...`);
  }
  console.log(`\nDone. Deleted ${deleted} practiceSessions document(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
