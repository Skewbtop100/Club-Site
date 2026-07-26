#!/usr/bin/env node
// One-off maintenance script: delete `results` documents whose
// competitionId has no matching document in `competitions` (orphaned —
// left behind by a deleted/test competition).
//
// Usage:
//   1. Download a service account key from Firebase Console →
//      Project Settings → Service Accounts → Generate new private key.
//   2. Save it locally (NOT inside the repo — see .gitignore's
//      serviceAccountKey.json entry) and set:
//        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
//   3. Dry run (default — prints counts + samples, deletes nothing):
//        node scripts/cleanup-orphaned-results.mjs
//   4. Actually delete, after reviewing the dry run:
//        node scripts/cleanup-orphaned-results.mjs --confirm
//
// Safe to re-run: if a targeted doc was already deleted, it's just
// skipped (Firestore batch deletes are idempotent).

import admin from 'firebase-admin';

// Confirmed via manual investigation (see conversation) — these three
// competitionIds have zero matching /competitions documents:
//   mojjffm3 ("Bayankhongor Cup 2026") — 93 orphaned results
//   moo43svo ("t4gr")                  — 29 orphaned results
//   mnt1fogd ("test2025")              — 13 orphaned results
const ORPHANED_COMPETITION_IDS = ['mojjffm3', 'moo43svo', 'mnt1fogd'];

const CONFIRM = process.argv.includes('--confirm');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'Missing GOOGLE_APPLICATION_CREDENTIALS.\n' +
    'Download a service account key (Firebase Console → Project Settings → ' +
    'Service Accounts) and set:\n' +
    '  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/cleanup-orphaned-results.mjs',
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

function fmtTime(cs) {
  if (cs === -1) return 'DNF';
  if (cs === -2) return 'DNS';
  if (cs === null || cs === undefined) return '—';
  if (cs >= 6000) {
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }
  const s = Math.floor(cs / 100);
  const c = cs % 100;
  return `${s}.${String(c).padStart(2, '0')}`;
}

async function main() {
  // 1. Re-verify these competitionIds are still orphaned (defensive — in
  //    case someone re-created a competition with the same id since the
  //    investigation).
  for (const cid of ORPHANED_COMPETITION_IDS) {
    const compDoc = await db.collection('competitions').doc(cid).get();
    if (compDoc.exists) {
      console.error(
        `ABORT: competitionId "${cid}" now HAS a matching /competitions doc ` +
        `(status=${compDoc.data().status}). Refusing to delete its results — ` +
        `re-investigate before proceeding.`,
      );
      process.exit(1);
    }
  }

  // 2. Query + group.
  const snap = await db.collection('results')
    .where('competitionId', 'in', ORPHANED_COMPETITION_IDS)
    .get();

  console.log(`\nTotal matching docs: ${snap.size}\n`);

  const byComp = {};
  snap.forEach(doc => {
    const r = doc.data();
    (byComp[r.competitionId] ??= []).push({ id: doc.id, ...r });
  });

  for (const cid of ORPHANED_COMPETITION_IDS) {
    const docs = byComp[cid] || [];
    console.log(`competitionId=${cid}  (${docs[0]?.competitionName ?? 'n/a'}): ${docs.length} doc(s)`);
    for (const d of docs.slice(0, 5)) {
      console.log(`  ${d.id}  event=${d.eventId} round=${d.round ?? '-'} athlete=${d.athleteName ?? d.athleteId} single=${fmtTime(d.single)} average=${fmtTime(d.average)} status=${d.status} source=${d.source}`);
    }
    if (docs.length > 5) console.log(`  ...and ${docs.length - 5} more`);
    console.log('');
  }

  if (!CONFIRM) {
    console.log('Dry run only — no documents deleted. Re-run with --confirm to delete.');
    return;
  }

  // 3. Batched delete (Firestore caps a batch at 500 ops; chunk at 400 for headroom).
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
  console.log(`\nDone. Deleted ${deleted} orphaned result document(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
