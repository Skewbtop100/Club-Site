#!/usr/bin/env node
// READ-ONLY report: practice runs filed by athletes whose profile is NOT
// verified. Writes nothing, deletes nothing, and has no --commit flag.
//
// Usage:
//   node scripts/report-unverified-practice-runs.mjs
//
// WHY IT EXISTS: practice now requires a verified profile (practiceGate,
// checked in the filing transaction and before presign). A gate judges the
// next run, never the ones already stored, so every run filed before it is
// still in practiceRuns and still in the admin queue. This counts them.
//
// VERIFIED means what resolveVerification means, restated in plain JS below
// exactly as report-unverified-registrations.mjs restates it.
//
// Prints counts only. NO athlete uid, name or email.

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

async function main() {
  const db = initAdmin().firestore();
  const runs = (await db.collection('practiceRuns').get()).docs;
  const uids = [...new Set(runs.map((d) => d.get('uid')).filter((u) => typeof u === 'string' && u))];
  const profiles = new Map();
  for (let i = 0; i < uids.length; i += 300) {
    const chunk = uids.slice(i, i + 300);
    const docs = await db.getAll(...chunk.map((uid) => db.collection('onlineParticipants').doc(uid)));
    for (const p of docs) profiles.set(p.id, p.exists ? p.data() : null);
  }

  const byState = { incomplete: 0, pending: 0, rejected: 0, missing: 0 };
  const byStatus = {};
  const athletes = new Set();
  let unverified = 0;
  for (const d of runs) {
    const uid = d.get('uid');
    const profile = profiles.get(uid);
    const state = profile == null ? 'missing' : profileState(profile);
    if (state === 'approved') continue;
    unverified++;
    athletes.add(uid);
    byState[state] += 1;
    const st = typeof d.get('status') === 'string' ? d.get('status') : 'pending';
    byStatus[st] = (byStatus[st] ?? 0) + 1;
  }

  console.log('\n── Practice runs filed by unverified athletes ─────────────────\n');
  console.log(`  practice runs in total            ${runs.length}`);
  console.log(`  athletes with any run             ${uids.length}`);
  console.log(`  filed by an unverified athlete    ${unverified}`);
  console.log(`  distinct athletes affected        ${athletes.size}`);
  console.log('\n  by profile state:');
  console.log(`    never submitted (incomplete)    ${byState.incomplete}`);
  console.log(`    submitted, awaiting review      ${byState.pending}`);
  console.log(`    rejected                        ${byState.rejected}`);
  console.log(`    no participant document at all  ${byState.missing}`);
  console.log('\n  by review status of those runs:');
  for (const [k, v] of Object.entries(byStatus)) console.log(`    ${k.padEnd(32)}${v}`);
  console.log('\n  NOTHING WAS CHANGED.\n');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
