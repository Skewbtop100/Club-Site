#!/usr/bin/env node
// Admin tool: move one athlete's online-competition data from an OLD
// Firebase Auth uid to a NEW one.
//
// The case this exists for: an athlete loses access to the Gmail they
// signed up with, signs in with a new one, and Firebase issues a new uid
// with an empty participant doc. Everything they have done — profile
// verification, registrations, submissions, season points, group
// assignments, qualification — hangs off the old uid.
//
// IDENTITY IS VERIFIED OFF-PLATFORM. This script performs the move; it
// does not and cannot decide that the two accounts are the same person.
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
//   # only to finish a run that died halfway (see RESUMING below):
//   ... --commit --resume
//
// ── Order of operations, and why ─────────────────────────────────────────
// The old participant doc is the anchor: it is the only thing that records
// which uid the data is moving FROM. Destroy it first and an interrupted
// run cannot be resumed. So references move first and the profile last:
//
//   pre-flight -> C,E (field rewrites) -> B (registrations) -> D (season
//   points) -> F,G (shared containers) -> A (profile, last)
//
// Every step is copy-before-delete and re-runnable. A crash between a copy
// and its delete leaves a duplicate, which the next run cleans up; the
// reverse order would lose the document.
//
// ── RESUMING ─────────────────────────────────────────────────────────────
// The "new uid is a fresh empty account" pre-flight is what stops this
// being pointed at two real athletes and silently fusing them. But a run
// interrupted after step C has already put data on the new uid, so that
// same assertion blocks the resume. --resume relaxes ONLY those freshness
// checks; every other assertion still holds. Use it exclusively to finish
// an interrupted run.
//
// ── What is NOT touched ──────────────────────────────────────────────────
//   * Firebase Auth user records — the old account still exists.
//   * Cloudinary — assets carry no uid; only the Firestore docs that
//     reference them by URL/public_id move, so the videos and photos are
//     untouched and the retention sweep keeps working.
//   * The club site. In particular this NEVER uses
//     collectionGroup('registrations'): the club has an unrelated
//     top-level `registrations` collection that such a query matches.
//     Registrations are read from onlineParticipants/{uid}/registrations
//     directly, which cannot stray outside this feature.

import admin from 'firebase-admin';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const RESUME = argv.includes('--resume');

function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

const OLD_EMAIL = flag('--old-email');
const NEW_EMAIL = flag('--new-email');

/** Fields that come from the NEW (live Google) account. Everything else on
 *  the participant doc comes from the OLD one — including createdAt, the
 *  athlete's real first join. */
const FROM_NEW = ['uid', 'email', 'displayName', 'photoURL'];

const PARTICIPANTS = 'onlineParticipants';

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

/** Replace oldUid with newUid IN PLACE in a qualifiers `uids` array.
 *  Position is placement order, so the element must not move. Returns null
 *  when there is nothing to do — not an array, or the old uid is absent
 *  (which is also what an already-migrated document looks like). */
export function replaceUidInArray(uids, oldUid, newUid) {
  if (!Array.isArray(uids)) return null;
  const at = uids.indexOf(oldUid);
  if (at === -1) return null;
  const next = [...uids];
  next[at] = newUid;
  return next;
}

/** Rename the oldUid key to newUid in a groupAssignments `assignments`
 *  map, preserving its value and every other athlete's entry. A map key
 *  cannot be renamed in place, so this rebuilds the map. Returns null when
 *  there is nothing to do. */
export function rekeyAssignments(map, oldUid, newUid) {
  if (!map || typeof map !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(map, oldUid)) return null;
  const next = {};
  for (const [k, v] of Object.entries(map)) next[k === oldUid ? newUid : k] = v;
  return next;
}

const failures = [];
function assert(ok, message) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
}

/** Firebase Auth uids are short alphanumeric strings; anything with a path
 *  separator or a relative-path segment must never reach a doc ref. */
function uidLooksValid(uid) {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

function short(uid) {
  return `${uid.slice(0, 10)}…`;
}

async function resolveByEmail(db, email, label) {
  const snap = await db.collection(PARTICIPANTS).where('email', '==', email).get();
  if (snap.size === 0) {
    console.error(`\nNo ${label} participant has email "${email}".`);
    process.exit(1);
  }
  if (snap.size > 1) {
    console.error(
      `\n${snap.size} participants share the ${label} email "${email}": ` +
        `${snap.docs.map((d) => d.id).join(', ')}. Refusing to guess.`,
    );
    process.exit(1);
  }
  return snap.docs[0];
}

async function main() {
  if (!OLD_EMAIL || !NEW_EMAIL) {
    console.error(
      'Usage: merge-athlete-uid.mjs --old-email <email> --new-email <email> [--commit] [--resume]',
    );
    process.exit(1);
  }

  const db = initAdmin().firestore();

  console.log(`\n=== merge athlete uid — ${COMMIT ? 'COMMIT' : 'DRY RUN'}${RESUME ? ' (RESUME)' : ''} ===\n`);
  console.log(`  old email: ${OLD_EMAIL}`);
  console.log(`  new email: ${NEW_EMAIL}\n`);

  const oldSnap = await resolveByEmail(db, OLD_EMAIL, 'OLD');
  const newSnap = await resolveByEmail(db, NEW_EMAIL, 'NEW');
  const oldUid = oldSnap.id;
  const newUid = newSnap.id;
  const oldData = oldSnap.data() ?? {};
  const newData = newSnap.data() ?? {};

  console.log(`  resolved OLD uid: ${oldUid}`);
  console.log(`  resolved NEW uid: ${newUid}\n`);

  // ══════════════ Build the plan (reads only) ══════════════
  const plan = { C: [], E: [], B: [], D: [], F: [], G: [] };

  // C — onlineSubmissions.uid
  const subs = await db.collection('onlineSubmissions').where('uid', '==', oldUid).get();
  plan.C = subs.docs.map((d) => d.id);

  // E — onlineNotifications.uid
  const notifs = await db.collection('onlineNotifications').where('uid', '==', oldUid).get();
  plan.E = notifs.docs.map((d) => d.id);

  // B — registrations, read DIRECTLY off the old participant (never a
  //     collection-group query; see the header note).
  const regs = await oldSnap.ref.collection('registrations').get();
  plan.B = regs.docs.map((d) => ({ id: d.id, data: d.data() }));

  // D — season points, across every season
  for (const seasonRef of await db.collection('onlineSeasonPoints').listDocuments()) {
    const athlete = await seasonRef.collection('athletes').doc(oldUid).get();
    if (athlete.exists) plan.D.push({ season: seasonRef.id, data: athlete.data() });
  }

  // F, G — shared containers on every competition
  for (const compRef of await db.collection('onlineCompetitions').listDocuments()) {
    const quals = await compRef.collection('qualifiers').get();
    for (const d of quals.docs) {
      const uids = d.get('uids');
      const after = replaceUidInArray(uids, oldUid, newUid);
      if (after) plan.F.push({ path: d.ref.path, before: uids, after });
    }
    const assigns = await compRef.collection('groupAssignments').get();
    for (const d of assigns.docs) {
      const map = d.get('assignments');
      const after = rekeyAssignments(map, oldUid, newUid);
      if (after) plan.G.push({ path: d.ref.path, before: map, after });
    }
  }

  // A — the merged participant document
  const merged = {};
  for (const [k, v] of Object.entries(oldData)) {
    if (FROM_NEW.includes(k) || k === 'mergedInto' || k === 'mergedAt') continue;
    if (v !== undefined) merged[k] = v;
  }
  for (const k of FROM_NEW) if (newData[k] !== undefined) merged[k] = newData[k];
  merged.uid = newUid;

  // ══════════════ Report the plan ══════════════
  const show = (v) => (v === undefined ? '(absent)' : JSON.stringify(v));

  console.log('── A — participant document (moves LAST) ───────────────────');
  console.log(`  merge  ${PARTICIPANTS}/${oldUid}`);
  console.log(`  into   ${PARTICIPANTS}/${newUid}`);
  for (const k of Object.keys(merged).sort()) {
    const from = FROM_NEW.includes(k) ? 'NEW' : 'OLD';
    console.log(`      ${from}  ${k.padEnd(22)} = ${show(merged[k])}`);
  }
  const dropped = Object.keys(newData).filter((k) => !(k in merged));
  if (dropped.length) console.log(`      (new-doc fields with no old counterpart, left as-is: ${dropped.join(', ')})`);
  if ('stats' in merged) {
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
    console.log(`      index ${f.before.indexOf(oldUid)} of ${f.before.length} — position unchanged`);
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

  // ══════════════ Pre-flight ══════════════
  console.log('── Pre-flight ───────────────────────────────────────');
  assert(uidLooksValid(oldUid), `old uid is well formed (${oldUid})`);
  assert(uidLooksValid(newUid), `new uid is well formed (${newUid})`);
  assert(oldUid !== newUid, 'old and new uid differ');
  assert(oldData.uid === oldUid, "old doc's uid field matches its document id");
  assert(newData.uid === newUid, "new doc's uid field matches its document id");
  assert(oldData.mergedInto === undefined, 'old doc has not already been merged');

  // The freshness guard: what stops this fusing two real athletes.
  const newStatus = newData.profileStatus;
  const newSubs = (await db.collection('onlineSubmissions').where('uid', '==', newUid).get()).size;
  const newRegs = (await newSnap.ref.collection('registrations').get()).size;
  let newSeasonDocs = 0;
  for (const seasonRef of await db.collection('onlineSeasonPoints').listDocuments()) {
    if ((await seasonRef.collection('athletes').doc(newUid).get()).exists) newSeasonDocs += 1;
  }
  if (RESUME) {
    console.log('  SKIP  new-uid freshness checks (--resume)');
    console.log(`          new uid currently holds: ${newSubs} submission(s), ${newRegs} registration(s), ` +
      `${newSeasonDocs} season doc(s), profileStatus=${show(newStatus)}`);
  } else {
    assert(newSubs === 0, `new uid has no submissions (found ${newSubs})`);
    assert(newRegs === 0, `new uid has no registrations (found ${newRegs})`);
    assert(newSeasonDocs === 0, `new uid has no season-points doc (found ${newSeasonDocs})`);
    assert(
      newStatus === undefined || newStatus === 'incomplete',
      `new uid's profileStatus is absent or 'incomplete' (is ${show(newStatus)})`,
    );
  }

  const total = plan.B.length + plan.C.length + plan.D.length + plan.E.length + plan.F.length + plan.G.length + 2;
  console.log('');
  console.log('── Total ───────────────────────────────────────────');
  console.log(`  A participant docs written : 2 (merge target + tombstone)`);
  console.log(`  B registrations moved      : ${plan.B.length}`);
  console.log(`  C submissions rewritten    : ${plan.C.length}`);
  console.log(`  D season-points docs moved : ${plan.D.length}`);
  console.log(`  E notifications rewritten  : ${plan.E.length}`);
  console.log(`  F qualifier arrays edited  : ${plan.F.length}`);
  console.log(`  G assignment maps rekeyed  : ${plan.G.length}`);
  console.log(`  TOTAL document writes      : ${total}`);
  console.log('');

  if (failures.length) {
    console.error('ABORTED — pre-flight failed:');
    for (const f of failures) console.error(`  * ${f}`);
    process.exit(1);
  }

  if (!COMMIT) {
    console.log('DRY RUN — nothing written. Re-run with --commit to apply.\n');
    return;
  }

  // ══════════════ Commit, in the order the header describes ══════════════

  // ── C, E: field rewrites. Idempotent — a re-run finds fewer docs. ──
  for (const [label, snapshot, field] of [['C submissions', subs, 'uid'], ['E notifications', notifs, 'uid']]) {
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + 400)) batch.update(d.ref, { [field]: newUid });
      await batch.commit();
    }
    console.log(`  ${label}: ${docs.length} rewritten`);
  }

  // ── B: registrations, copy then delete. ──
  for (const r of plan.B) {
    await newSnap.ref.collection('registrations').doc(r.id).set(r.data);
    await oldSnap.ref.collection('registrations').doc(r.id).delete();
  }
  console.log(`  B registrations: ${plan.B.length} moved`);

  // ── D: season points, copy then delete; identity fields refreshed. ──
  for (const d of plan.D) {
    const target = db.collection('onlineSeasonPoints').doc(d.season).collection('athletes').doc(newUid);
    await target.set({
      ...d.data,
      uid: newUid,
      displayName: newData.displayName ?? d.data.displayName ?? '',
      photoURL: newData.photoURL ?? null,
    });
    await db.collection('onlineSeasonPoints').doc(d.season).collection('athletes').doc(oldUid).delete();
  }
  console.log(`  D season points: ${plan.D.length} moved`);

  // ── F, G: shared documents, one transaction each. Other athletes live
  //    in these same documents, so each is a read-verify-write rather than
  //    a blind update. Already-migrated is a SKIP, not a failure, so a
  //    resumed run finishes cleanly. ──
  for (const f of plan.F) {
    await db.runTransaction(async (tx) => {
      const ref = db.doc(f.path);
      const snap = await tx.get(ref);
      // null = already migrated by an earlier run; skipping is what makes
      // a resumed run finish cleanly instead of aborting.
      const next = replaceUidInArray(snap.get('uids'), oldUid, newUid);
      if (!next) return;
      tx.update(ref, { uids: next });
    });
  }
  console.log(`  F qualifier arrays: ${plan.F.length} edited`);

  for (const g of plan.G) {
    await db.runTransaction(async (tx) => {
      const ref = db.doc(g.path);
      const snap = await tx.get(ref);
      const next = rekeyAssignments(snap.get('assignments'), oldUid, newUid);
      if (!next) return; // already migrated
      tx.update(ref, { assignments: next });
    });
  }
  console.log(`  G assignment maps: ${plan.G.length} rekeyed`);

  // ── A: the profile, last. Merge into the new doc, then tombstone the
  //    old one. profileStatus and the approved* snapshot travel inside
  //    `merged` as one object, so they cannot be split. ──
  // `stats` is a per-event map. set(..., { merge: true }) deep-merges
  // nested maps, so writing it that way would UNION the two accounts'
  // rollups rather than replace one with the other. update() replaces a
  // map field wholesale, so it goes in a second write.
  const { stats: oldStats, ...mergedScalars } = merged;
  await newSnap.ref.set(mergedScalars, { merge: true });
  if (oldStats !== undefined) await newSnap.ref.update({ stats: oldStats });
  await oldSnap.ref.update({
    mergedInto: newUid,
    mergedAt: admin.firestore.FieldValue.serverTimestamp(),
    profileStatus: admin.firestore.FieldValue.delete(),
  });
  console.log(`  A participant: merged into ${newUid}, old doc tombstoned`);

  console.log('\nDone.\n');
}

// Importing this file (the tests do, for the pure functions above) must
// not kick off a merge — only running it directly does.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
