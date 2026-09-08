// ── Athlete uid merge: the one implementation ────────────────────────────
// Moves one athlete's online-competition data from an OLD Firebase Auth uid
// to a NEW one, for the case where they lose access to the Gmail they signed
// up with and sign in again with a different one.
//
// Imported by BOTH callers, deliberately:
//   * scripts/merge-athlete-uid.mjs   — the CLI, with --resume
//   * app/api/online-competition/admin-athletes/merge/route.ts — the admin UI
// If the UI and the script had separate implementations, the tested code
// would not be the code that runs. tests/merge-athlete-uid drives the CLI,
// so it covers this module for both.
//
// Written as .mjs rather than .ts so the plain-node CLI can import it
// directly without a build step; tsconfig has allowJs, so the Next route
// imports it just as happily.
//
// IDENTITY IS VERIFIED OFF-PLATFORM. This performs the move; it cannot
// decide that two accounts are the same person.
//
// ── Order of operations, and why ─────────────────────────────────────────
// The old participant doc is the anchor: it is the only record of which uid
// the data came FROM. Destroy it first and an interrupted run cannot be
// resumed. So references move first and the profile last:
//
//   pre-flight -> C,E (field rewrites) -> B (registrations) -> D (season
//   points) -> F,G (shared containers) -> A (profile, last)
//
// Every step is copy-before-delete and re-runnable. A crash between a copy
// and its delete leaves a duplicate that the next run cleans up; the reverse
// order would lose the document.
//
// ── What is NOT touched ──────────────────────────────────────────────────
//   * Firebase Auth user records — the old account still exists.
//   * Cloudinary — assets carry no uid, so the videos and photos stay put
//     and the retention sweep keeps working off the moved documents.
//   * The club site. In particular this NEVER uses
//     collectionGroup('registrations'): the club has an unrelated top-level
//     `registrations` collection that such a query matches. Registrations
//     are read from onlineParticipants/{uid}/registrations directly.

import { FieldValue } from 'firebase-admin/firestore';

export const PARTICIPANTS = 'onlineParticipants';

/** Fields taken from the NEW (live Google) account. Everything else on the
 *  participant doc comes from the OLD one — including createdAt, the
 *  athlete's real first join. */
export const FROM_NEW = ['uid', 'email', 'displayName', 'photoURL'];

/** The only fields a tombstoned OLD document keeps: its own Google identity
 *  (the Auth account still exists and can still sign in) plus the tombstone
 *  markers. Everything else was migrated and must not survive on both
 *  documents — a complete-looking old profile is the same athlete twice.
 *
 *  The tombstone is a RECORD, not a lock. A merged-away account is empty,
 *  which is indistinguishable from a brand-new sign-in, so it stays fully
 *  reusable: the athlete may fill in a fresh profile on it, and a later
 *  merge may move another account's data INTO it. Both paths clear the
 *  markers, because at that point the account has data again. What stops a
 *  careless double-merge is not this flag but the freshness pre-flight
 *  (no submissions, no registrations, no season points, no profile) — all
 *  four of which a tombstoned document passes, by construction. */
export const KEPT_ON_OLD = [...FROM_NEW, 'createdAt'];
export const TOMBSTONE_MARKERS = ['mergedInto', 'mergedAt'];

/**
 * Which fields to FieldValue.delete() from the old document.
 *
 * ── The single-list guarantee ─────────────────────────────────────────
 * The caller passes the keys of the object the merge COPIED across, so the
 * copy list and the strip list are the same list, read twice. `merged` is
 * built by walking every key on the old document, so a profile field added
 * later is copied automatically — and therefore stripped automatically,
 * with no second list to remember to update. Only KEPT_ON_OLD and the
 * tombstone markers are ever exempt, and both are explicit here.
 */
export function tombstoneStrip(candidateKeys) {
  return candidateKeys.filter(
    (k) => !KEPT_ON_OLD.includes(k) && !TOMBSTONE_MARKERS.includes(k),
  );
}

/** Every way a merge can be refused. The CLI prints the code and detail;
 *  the admin UI maps each code to Mongolian guidance. */
export const MERGE_ERRORS = {
  OLD_EMAIL_NOT_FOUND: 'OLD_EMAIL_NOT_FOUND',
  NEW_EMAIL_NOT_FOUND: 'NEW_EMAIL_NOT_FOUND',
  OLD_EMAIL_AMBIGUOUS: 'OLD_EMAIL_AMBIGUOUS',
  NEW_EMAIL_AMBIGUOUS: 'NEW_EMAIL_AMBIGUOUS',
  SAME_ACCOUNT: 'SAME_ACCOUNT',
  OLD_UID_MALFORMED: 'OLD_UID_MALFORMED',
  NEW_UID_MALFORMED: 'NEW_UID_MALFORMED',
  OLD_UID_FIELD_MISMATCH: 'OLD_UID_FIELD_MISMATCH',
  NEW_UID_FIELD_MISMATCH: 'NEW_UID_FIELD_MISMATCH',
  NEW_HAS_SUBMISSIONS: 'NEW_HAS_SUBMISSIONS',
  NEW_HAS_REGISTRATIONS: 'NEW_HAS_REGISTRATIONS',
  NEW_HAS_SEASON_POINTS: 'NEW_HAS_SEASON_POINTS',
  NEW_HAS_PROFILE: 'NEW_HAS_PROFILE',
};

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

/** Rename the oldUid key to newUid in a groupAssignments `assignments` map,
 *  preserving its value and every other athlete's entry. A map key cannot be
 *  renamed in place, so this rebuilds the map. Returns null when there is
 *  nothing to do. */
export function rekeyAssignments(map, oldUid, newUid) {
  if (!map || typeof map !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(map, oldUid)) return null;
  const next = {};
  for (const [k, v] of Object.entries(map)) next[k === oldUid ? newUid : k] = v;
  return next;
}

/** Firebase Auth uids are short alphanumeric strings; anything carrying a
 *  path separator or a relative-path segment must never reach a doc ref. */
export function uidLooksValid(uid) {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

async function resolveByEmail(db, email, side) {
  const snap = await db.collection(PARTICIPANTS).where('email', '==', email).get();
  if (snap.size === 0) {
    return { error: { code: side === 'OLD' ? MERGE_ERRORS.OLD_EMAIL_NOT_FOUND : MERGE_ERRORS.NEW_EMAIL_NOT_FOUND, email } };
  }
  if (snap.size > 1) {
    return {
      error: {
        code: side === 'OLD' ? MERGE_ERRORS.OLD_EMAIL_AMBIGUOUS : MERGE_ERRORS.NEW_EMAIL_AMBIGUOUS,
        email,
        uids: snap.docs.map((d) => d.id),
      },
    };
  }
  return { doc: snap.docs[0] };
}

/**
 * Read-only. Resolves both accounts, builds the full move plan, and runs
 * every pre-flight assertion. Writes nothing, ever — this is what the admin
 * UI renders as its preview and what `--commit` re-runs before committing,
 * so the thing shown and the thing done are produced by one code path.
 *
 * @param {object} db  firebase-admin Firestore
 * @param {{ oldEmail: string, newEmail: string, resume?: boolean }} params
 *   `resume` relaxes ONLY the "new account is fresh" checks, for finishing a
 *   run that died halfway. Every other assertion still holds.
 */
export async function planMerge(db, { oldEmail, newEmail, resume = false }) {
  const oldResolved = await resolveByEmail(db, oldEmail, 'OLD');
  if (oldResolved.error) return { ok: false, errors: [oldResolved.error], plan: null };
  const newResolved = await resolveByEmail(db, newEmail, 'NEW');
  if (newResolved.error) return { ok: false, errors: [newResolved.error], plan: null };

  const oldSnap = oldResolved.doc;
  const newSnap = newResolved.doc;
  const oldUid = oldSnap.id;
  const newUid = newSnap.id;
  const oldData = oldSnap.data() ?? {};
  const newData = newSnap.data() ?? {};

  // ── The plan (reads only) ──
  const plan = { A: null, B: [], C: [], D: [], E: [], F: [], G: [] };

  const subs = await db.collection('onlineSubmissions').where('uid', '==', oldUid).get();
  plan.C = subs.docs.map((d) => d.id);

  const notifs = await db.collection('onlineNotifications').where('uid', '==', oldUid).get();
  plan.E = notifs.docs.map((d) => d.id);

  const regs = await oldSnap.ref.collection('registrations').get();
  plan.B = regs.docs.map((d) => ({ id: d.id, data: d.data() }));

  for (const seasonRef of await db.collection('onlineSeasonPoints').listDocuments()) {
    const athlete = await seasonRef.collection('athletes').doc(oldUid).get();
    if (athlete.exists) plan.D.push({ season: seasonRef.id, data: athlete.data() });
  }

  for (const compRef of await db.collection('onlineCompetitions').listDocuments()) {
    for (const d of (await compRef.collection('qualifiers').get()).docs) {
      const before = d.get('uids');
      const after = replaceUidInArray(before, oldUid, newUid);
      if (after) plan.F.push({ path: d.ref.path, before, after, index: before.indexOf(oldUid) });
    }
    for (const d of (await compRef.collection('groupAssignments').get()).docs) {
      const before = d.get('assignments');
      const after = rekeyAssignments(before, oldUid, newUid);
      if (after) plan.G.push({ path: d.ref.path, before, after });
    }
  }

  // The merged participant document.
  const merged = {};
  for (const [k, v] of Object.entries(oldData)) {
    if (FROM_NEW.includes(k) || k === 'mergedInto' || k === 'mergedAt') continue;
    if (v !== undefined) merged[k] = v;
  }
  for (const k of FROM_NEW) if (newData[k] !== undefined) merged[k] = newData[k];
  merged.uid = newUid;
  plan.A = { oldUid, newUid, merged, fromNew: FROM_NEW };

  // ── Pre-flight ──
  const newSubs = (await db.collection('onlineSubmissions').where('uid', '==', newUid).get()).size;
  const newRegs = (await newSnap.ref.collection('registrations').get()).size;
  let newSeasonDocs = 0;
  for (const seasonRef of await db.collection('onlineSeasonPoints').listDocuments()) {
    if ((await seasonRef.collection('athletes').doc(newUid).get()).exists) newSeasonDocs += 1;
  }
  const newStatus = newData.profileStatus;

  const checks = [
    { code: MERGE_ERRORS.OLD_UID_MALFORMED, ok: uidLooksValid(oldUid), label: `old uid is well formed (${oldUid})` },
    { code: MERGE_ERRORS.NEW_UID_MALFORMED, ok: uidLooksValid(newUid), label: `new uid is well formed (${newUid})` },
    { code: MERGE_ERRORS.SAME_ACCOUNT, ok: oldUid !== newUid, label: 'old and new uid differ' },
    { code: MERGE_ERRORS.OLD_UID_FIELD_MISMATCH, ok: oldData.uid === oldUid, label: "old doc's uid field matches its document id" },
    { code: MERGE_ERRORS.NEW_UID_FIELD_MISMATCH, ok: newData.uid === newUid, label: "new doc's uid field matches its document id" },
  ];

  if (!resume) {
    checks.push(
      { code: MERGE_ERRORS.NEW_HAS_SUBMISSIONS, ok: newSubs === 0, label: `new uid has no submissions (found ${newSubs})`, count: newSubs },
      { code: MERGE_ERRORS.NEW_HAS_REGISTRATIONS, ok: newRegs === 0, label: `new uid has no registrations (found ${newRegs})`, count: newRegs },
      { code: MERGE_ERRORS.NEW_HAS_SEASON_POINTS, ok: newSeasonDocs === 0, label: `new uid has no season-points doc (found ${newSeasonDocs})`, count: newSeasonDocs },
      {
        code: MERGE_ERRORS.NEW_HAS_PROFILE,
        ok: newStatus === undefined || newStatus === 'incomplete',
        label: `new uid's profileStatus is absent or 'incomplete' (is ${JSON.stringify(newStatus ?? null)})`,
        status: newStatus ?? null,
      },
    );
  }

  const errors = checks.filter((c) => !c.ok).map(({ ok, ...rest }) => rest);

  return {
    ok: errors.length === 0,
    oldUid,
    newUid,
    oldEmail,
    newEmail,
    oldData,
    newData,
    plan,
    checks,
    errors,
    resumeUsed: resume,
    newAccountState: { submissions: newSubs, registrations: newRegs, seasonDocs: newSeasonDocs, profileStatus: newStatus ?? null },
  };
}

/**
 * Applies a plan produced by planMerge. Callers MUST re-run planMerge
 * immediately before this so the commit acts on current data and a fresh
 * pre-flight; commitMerge itself refuses a plan that is not `ok`.
 */
export async function commitMerge(db, planned) {
  if (!planned?.ok) throw new Error('commitMerge called with a plan that failed pre-flight');
  const { oldUid, newUid, plan, newData } = planned;
  const oldRef = db.collection(PARTICIPANTS).doc(oldUid);
  const newRef = db.collection(PARTICIPANTS).doc(newUid);
  const counts = { A: 2, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };

  // ── C, E: field rewrites. Idempotent — a re-run finds fewer docs. ──
  for (const [col, ids, key] of [
    ['onlineSubmissions', plan.C, 'C'],
    ['onlineNotifications', plan.E, 'E'],
  ]) {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + 400)) batch.update(db.collection(col).doc(id), { uid: newUid });
      await batch.commit();
    }
    counts[key] = ids.length;
  }

  // ── B: registrations, copy then delete. ──
  for (const r of plan.B) {
    await newRef.collection('registrations').doc(r.id).set(r.data);
    await oldRef.collection('registrations').doc(r.id).delete();
    counts.B += 1;
  }

  // ── D: season points, copy then delete; identity fields refreshed. ──
  for (const d of plan.D) {
    const athletes = db.collection('onlineSeasonPoints').doc(d.season).collection('athletes');
    await athletes.doc(newUid).set({
      ...d.data,
      uid: newUid,
      displayName: newData.displayName ?? d.data.displayName ?? '',
      photoURL: newData.photoURL ?? null,
    });
    await athletes.doc(oldUid).delete();
    counts.D += 1;
  }

  // ── F, G: shared documents — other athletes live in these same docs, so
  //    each is a read-verify-write transaction rather than a blind update.
  //    "Already migrated" is a SKIP, not a failure, so a resumed run
  //    finishes cleanly. ──
  for (const f of plan.F) {
    await db.runTransaction(async (tx) => {
      const ref = db.doc(f.path);
      const next = replaceUidInArray((await tx.get(ref)).get('uids'), oldUid, newUid);
      if (!next) return;
      tx.update(ref, { uids: next });
    });
    counts.F += 1;
  }
  for (const g of plan.G) {
    await db.runTransaction(async (tx) => {
      const ref = db.doc(g.path);
      const next = rekeyAssignments((await tx.get(ref)).get('assignments'), oldUid, newUid);
      if (!next) return;
      tx.update(ref, { assignments: next });
    });
    counts.G += 1;
  }

  // ── A: the profile, last. profileStatus and the approved* snapshot
  //    travel inside `merged` as one object, so they cannot be split.
  //    `stats` is a per-event map: set(merge:true) deep-merges nested maps,
  //    which would UNION the two accounts' rollups, so it goes in its own
  //    update() — which replaces a map field wholesale. ──
  // Receiving data un-tombstones the destination. If it had been merged
  // away previously, it has content again, so the record of that earlier
  // move no longer describes it.
  const { stats: oldStats, ...mergedScalars } = plan.A.merged;
  await newRef.set(
    { ...mergedScalars, mergedInto: FieldValue.delete(), mergedAt: FieldValue.delete() },
    { merge: true },
  );
  if (oldStats !== undefined) await newRef.update({ stats: oldStats });
  // The old document is EMPTIED, not merely flagged. Leaving the profile
  // on it means signing in with the old Gmail shows a complete-looking
  // athlete who also exists under the new uid. Per-field deletes rather
  // than a rewrite, so nothing unlisted is silently dropped.
  const stripped = tombstoneStrip(Object.keys(plan.A.merged));
  const tombstone = {
    mergedInto: newUid,
    mergedAt: FieldValue.serverTimestamp(),
  };
  for (const key of stripped) tombstone[key] = FieldValue.delete();
  await oldRef.update(tombstone);
  counts.stripped = stripped.length;

  return counts;
}
