#!/usr/bin/env node
// READ-ONLY report: registrations held by athletes whose profile is NOT
// verified. Writes nothing, deletes nothing, and has no --commit flag.
//
// Usage:
//   node scripts/report-unverified-registrations.mjs
//
// Credentials: loaded exactly as scripts/report-registration-window.mjs
// loads them (@next/env, .env and .env.local from the project root).
//
// WHY IT EXISTS: firestore.rules now refuse a registration unless the
// athlete's profile is verified — details and photo both approved
// (athleteVerified, in the registrations block). Rules judge WRITES, never
// stored documents, so every registration written before that gate existed
// is still there, and so is every registration whose owner was verified at
// the time and has since been rejected or re-opened for review. This finds
// them. Deciding what to do with one is the admin's registration review,
// not a script's.
//
// VERIFIED means what resolveVerification means (lib/online-competition/
// verification.ts): a record carrying both part statuses is read from those,
// and one carrying neither is read from the single legacy profileStatus. The
// same mapping is restated here in plain JS, because this file cannot import
// TypeScript — keep the three (the module, firestore.rules, this) together.
//
// Prints competition ids, names and counts, plus a breakdown by profile
// state. NO athlete uid, name or email — the same discretion
// report-registration-window.mjs keeps.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import admin from 'firebase-admin';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function initAdmin() {
  nextEnv.loadEnvConfig(PROJECT_ROOT, false, { info: () => {}, error: console.error });
  const projectId = process.env.ONLINE_COMP_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.ONLINE_COMP_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.ONLINE_COMP_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const missing = [
    !projectId && 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    !clientEmail && 'ONLINE_COMP_FIREBASE_CLIENT_EMAIL',
    !privateKey && 'ONLINE_COMP_FIREBASE_PRIVATE_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Cannot initialise the Admin SDK — not set: ${missing.join(', ')}`);
    process.exit(1);
  }
  return admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

const STORED = ['pending', 'approved', 'rejected'];

/** resolveVerification's status, in plain JS. Returns one of
 *  'approved' | 'pending' | 'rejected' | 'incomplete'. */
function profileState(data) {
  const d = data ?? {};
  const parts = STORED.includes(d.detailsStatus) && STORED.includes(d.photoStatus);
  const details = parts ? d.detailsStatus : STORED.includes(d.profileStatus) ? d.profileStatus : 'incomplete';
  const photo = parts ? d.photoStatus : STORED.includes(d.profileStatus) ? d.profileStatus : 'incomplete';
  if (details === 'approved' && photo === 'approved') return 'approved';
  if (details === 'incomplete' || photo === 'incomplete') return 'incomplete';
  if (details === 'pending' || photo === 'pending') return 'pending';
  return 'rejected';
}

/** Which registration statuses count as a live entry. Mirrors
 *  normalizeRegistrationStatus: an absent status, and the legacy
 *  'registered', both mean approved. */
function registrationState(status) {
  if (status == null) return 'approved';
  return STORED.includes(status) || status === 'cancelled' ? (status === 'registered' ? 'approved' : status) : 'approved';
}

async function main() {
  const db = initAdmin().firestore();

  const compNames = new Map();
  for (const d of (await db.collection('onlineCompetitions').get()).docs) {
    compNames.set(d.id, typeof d.get('name') === 'string' ? d.get('name') : '');
  }

  // The same unfiltered collection-group read every other caller uses — a
  // filtered one needs a COLLECTION_GROUP index this project does not have.
  const snap = await db.collectionGroup('registrations').get();
  const regs = snap.docs.filter((d) => d.ref.parent.parent?.parent.id === 'onlineParticipants');

  const uids = [...new Set(regs.map((d) => d.ref.parent.parent.id))];
  const profiles = new Map();
  // getAll has a 1000-document ceiling; chunk so this keeps working as the
  // athlete list grows.
  for (let i = 0; i < uids.length; i += 300) {
    const chunk = uids.slice(i, i + 300);
    const docs = await db.getAll(...chunk.map((uid) => db.collection('onlineParticipants').doc(uid)));
    for (const p of docs) profiles.set(p.id, p.exists ? p.data() : null);
  }

  const byState = { incomplete: 0, pending: 0, rejected: 0, missing: 0 };
  const byComp = new Map();
  const affectedUids = new Set();
  let total = 0;
  let unverified = 0;

  for (const d of regs) {
    total++;
    const uid = d.ref.parent.parent.id;
    const profile = profiles.get(uid);
    const state = profile == null ? 'missing' : profileState(profile);
    if (state === 'approved') continue;
    unverified++;
    affectedUids.add(uid);
    byState[state] += 1;
    const competitionId = typeof d.get('competitionId') === 'string' ? d.get('competitionId') : d.id;
    const row = byComp.get(competitionId) ?? { total: 0, approved: 0, pending: 0, other: 0 };
    row.total++;
    const rs = registrationState(d.get('status'));
    if (rs === 'approved') row.approved++;
    else if (rs === 'pending') row.pending++;
    else row.other++;
    byComp.set(competitionId, row);
  }

  console.log('\n── Registrations held by unverified athletes ─────────────────\n');
  console.log(`  registrations in total            ${total}`);
  console.log(`  held by an unverified athlete     ${unverified}`);
  console.log(`  distinct athletes affected        ${affectedUids.size}`);
  console.log('\n  by profile state:');
  console.log(`    never submitted (incomplete)    ${byState.incomplete}`);
  console.log(`    submitted, awaiting review      ${byState.pending}`);
  console.log(`    rejected                        ${byState.rejected}`);
  console.log(`    no participant document at all  ${byState.missing}`);

  if (byComp.size > 0) {
    console.log('\n  by competition (registration review status of each):\n');
    const rows = [...byComp.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [id, r] of rows) {
      const name = compNames.get(id) ?? '(no such competition)';
      console.log(`    ${String(r.total).padStart(4)}  ${id}  ${name}`);
      console.log(`          approved ${r.approved}, pending ${r.pending}, cancelled/rejected ${r.other}`);
    }
    console.log(
      '\n  NOTHING WAS CHANGED. An approved registration here is an athlete\n' +
      '  who is in a competition without a verified profile — the admin\n' +
      '  registration review is where that gets decided.',
    );
  } else {
    console.log('\n  None. Every stored registration belongs to a verified athlete.');
  }
  console.log('');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
