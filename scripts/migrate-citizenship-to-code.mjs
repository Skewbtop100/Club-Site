#!/usr/bin/env node
// One-off migration: `citizenship` moves from an English country NAME
// ("Mongolia") to an ISO 3166-1 alpha-2 CODE ("mn"), which is what the
// profile's country picker stores from now on.
//
// Both the live field and the admin-owned snapshot move together:
//   citizenship          — what the athlete submitted
//   approvedCitizenship  — what an admin actually reviewed
// Migrating only one would leave the snapshot describing a different value
// format from the field it snapshots, and the snapshot is client-locked by
// firestore.rules, so an Admin SDK script is the only thing that can fix it.
//
// DRY RUN BY DEFAULT. Nothing is written without --commit.
//
// Usage:
//   node --env-file=.env --env-file=.env.local scripts/migrate-citizenship-to-code.mjs
//   ... --commit
//
// ABORTS rather than guessing. Any value that is neither already a valid
// code nor a name in the table below stops the whole run with nothing
// written — a wrong country on a verified profile is worse than a manual fix.

import admin from 'firebase-admin';
import { COUNTRIES } from '../lib/online-competition/countries.ts';

const COMMIT = process.argv.includes('--commit');
const FIELDS = ['citizenship', 'approvedCitizenship'];

// English names for the codes in countries.ts. Deliberately NOT exhaustive:
// it covers what this database plausibly contains, and anything outside it
// aborts the run rather than being guessed at.
const ENGLISH_TO_CODE = {
  mongolia: 'mn',
  china: 'cn',
  'peoples republic of china': 'cn',
  russia: 'ru',
  'russian federation': 'ru',
  japan: 'jp',
  'south korea': 'kr',
  korea: 'kr',
  'united states': 'us',
  'united states of america': 'us',
  usa: 'us',
  'united kingdom': 'gb',
  uk: 'gb',
  germany: 'de',
  france: 'fr',
  canada: 'ca',
  australia: 'au',
  india: 'in',
  kazakhstan: 'kz',
  'inner mongolia': 'cn',
};

const VALID_CODES = new Set(COUNTRIES.map((c) => c.code));

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

/** null = already a code (nothing to do); undefined = cannot map (abort). */
function toCode(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();
  if (VALID_CODES.has(raw.toLowerCase()) && raw.length === 2) return null;
  return ENGLISH_TO_CODE[raw.toLowerCase()];
}

async function main() {
  const db = initAdmin().firestore();

  console.log(`\n=== citizenship name -> ISO code — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ===\n`);

  const snap = await db.collection('onlineParticipants').get();
  const planned = [];
  const unmapped = [];
  let alreadyCodes = 0;
  let noValue = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const updates = {};
    let touched = false;

    for (const field of FIELDS) {
      const value = data[field];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      const code = toCode(value);
      if (code === null) {
        alreadyCodes += 1;
        continue;
      }
      if (code === undefined) {
        unmapped.push({ id: d.id, field, value });
        continue;
      }
      updates[field] = code;
      touched = true;
    }

    if (!FIELDS.some((f) => data[f] !== undefined && data[f] !== null && data[f] !== '')) noValue += 1;
    if (touched) planned.push({ id: d.id, displayName: data.displayName ?? '', updates, before: data });
  }

  console.log('── Totals ──────────────────────────────────────────────');
  console.log(`  participants scanned          : ${snap.size}`);
  console.log(`  with no citizenship value     : ${noValue}`);
  console.log(`  values already an ISO code    : ${alreadyCodes}`);
  console.log(`  documents to migrate          : ${planned.length}`);
  console.log(`  values that CANNOT be mapped  : ${unmapped.length}`);
  console.log('');

  console.log('── Per-document change ─────────────────────────────────');
  if (planned.length === 0) console.log('  (nothing to migrate)');
  for (const p of planned) {
    console.log(`\n  onlineParticipants/${p.id}  "${p.displayName}"`);
    for (const [field, code] of Object.entries(p.updates)) {
      console.log(`      ${field.padEnd(20)} ${JSON.stringify(p.before[field])} -> ${JSON.stringify(code)}`);
    }
  }
  console.log('');

  if (unmapped.length > 0) {
    console.error('── UNMAPPED — nothing will be written ──────────────────');
    for (const u of unmapped) {
      console.error(`  onlineParticipants/${u.id}  ${u.field} = ${JSON.stringify(u.value)}`);
    }
    console.error(
      '\nABORTED. Add each value to ENGLISH_TO_CODE in this script (or correct the document\n' +
        'by hand) and re-run. Guessing a country on a verified profile is not acceptable.',
    );
    process.exit(1);
  }

  if (!COMMIT) {
    console.log(`DRY RUN — nothing written. Re-run with --commit to update ${planned.length} document(s).\n`);
    return;
  }

  const batch = db.batch();
  for (const p of planned) batch.update(db.collection('onlineParticipants').doc(p.id), p.updates);
  await batch.commit();
  console.log(`Done — ${planned.length} document(s) updated.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
