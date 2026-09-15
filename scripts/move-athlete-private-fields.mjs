#!/usr/bin/env node
// One-off maintenance script: move each club athlete's date of birth and
// phone off the PUBLIC athletes/{id} document into athletes/{id}/private/identity.
//
// Background: athletes/{id} is readable by anyone (the club site's public
// pages read it directly), and Firestore rules cannot hide one field of a
// readable document. firestore.rules now keeps birthDate and phone in the
// private document, readable only by an admin and the linked account, and
// refuses either key on the public one. Run this BEFORE deploying those
// rules: until an athlete is moved, an admin edit of it is refused.
//
// DRY RUN BY DEFAULT. Nothing is written without --commit.
//
// Usage (from anywhere — the env files are found relative to this script):
//   node scripts/move-athlete-private-fields.mjs            # dry run
//   node scripts/move-athlete-private-fields.mjs --commit
//
// Credentials are read exactly as the app reads them: @next/env's
// loadEnvConfig loads .env.local and .env from the project root (a variable
// already set in the shell wins). The project id lives in .env and the
// service-account email and key in .env.local, so loading only one of the
// two files is not enough — which is why `node --env-file=.env.local` failed.
//
// Safety rules this script holds to:
//   * only the two fields birthDate and phone, never any other field
//   * never overwrites a value the private document already holds; an
//     athlete whose private value DIFFERS from its public one is skipped
//     and listed, for a person to decide
//   * the copy and the removal are one batch per athlete: a value is never
//     removed without being written, nor left public once written
//   * prints ids and field NAMES only — never a date of birth or a phone
//   * verifies every committed athlete by reading both documents back
//
// Re-runnable: a second pass finds nothing left to do.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');
const FIELDS = ['birthDate', 'phone'];
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Loads the env files the way Next does, then initialises the Admin SDK
 *  with the same three variables lib/online-competition/firebase-admin.ts
 *  uses. On failure, names every variable that could not be used and why —
 *  never its value. */
function initAdmin() {
  const { loadedEnvFiles } = nextEnv.loadEnvConfig(PROJECT_ROOT, false, { info: () => {}, error: console.error });
  const loaded = loadedEnvFiles.map((f) => f.path).join(', ') || 'none';
  console.log(`env files loaded from ${PROJECT_ROOT}: ${loaded}`);

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFile) {
    if (!fs.existsSync(keyFile)) {
      console.error(`GOOGLE_APPLICATION_CREDENTIALS is set but no file exists at that path. Unset it to use the env vars.`);
      process.exit(1);
    }
    return admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const problems = [];
  const projectId =
    process.env.ONLINE_COMP_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    problems.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID (or ONLINE_COMP_FIREBASE_PROJECT_ID): not set or empty in the environment or any loaded env file');
  }
  const clientEmail = process.env.ONLINE_COMP_FIREBASE_CLIENT_EMAIL;
  if (!clientEmail) {
    problems.push('ONLINE_COMP_FIREBASE_CLIENT_EMAIL: not set or empty in the environment or any loaded env file');
  } else if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    problems.push('ONLINE_COMP_FIREBASE_CLIENT_EMAIL: set, but not a service-account address (…@….iam.gserviceaccount.com)');
  }
  const rawKey = process.env.ONLINE_COMP_FIREBASE_PRIVATE_KEY;
  // The key is stored on one line with its newlines escaped as the two
  // characters \n. Turned back into real newlines here, exactly as the app
  // does; a key already holding real newlines is unaffected.
  const privateKey = rawKey?.replace(/\\n/g, '\n');
  if (!rawKey) {
    problems.push('ONLINE_COMP_FIREBASE_PRIVATE_KEY: not set or empty in the environment or any loaded env file');
  } else if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
    problems.push(
      'ONLINE_COMP_FIREBASE_PRIVATE_KEY: set, but not a PEM private key after unescaping \\n ' +
        '(missing the BEGIN/END PRIVATE KEY lines — check the value is quoted and complete)',
    );
  }

  if (problems.length > 0) {
    console.error('Cannot initialise the Admin SDK:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  return admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

async function main() {
  const db = initAdmin().firestore();
  const del = admin.firestore.FieldValue.delete();
  console.log(`\n=== move athlete private fields — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ===\n`);

  const snap = await db.collection('athletes').get();
  const planned = [];
  const conflicts = [];
  let alreadyClean = 0;

  for (const d of snap.docs) {
    const pub = d.data();
    const present = FIELDS.filter((f) => f in pub);
    if (present.length === 0) {
      alreadyClean += 1;
      continue;
    }
    const privRef = d.ref.collection('private').doc('identity');
    const priv = (await privRef.get()).data() ?? {};
    const copy = {};
    const clashing = [];
    for (const f of present) {
      const value = pub[f];
      if (priv[f] === undefined) {
        // An empty or non-string value is removed but not copied.
        if (typeof value === 'string' && value.length > 0) copy[f] = value;
      } else if (priv[f] !== value) {
        clashing.push(f);
      }
    }
    if (clashing.length > 0) {
      conflicts.push({ id: d.id, fields: clashing });
      continue;
    }
    planned.push({ ref: d.ref, privRef, present, copy });
  }

  console.log(`athletes: ${snap.size}   already clean: ${alreadyClean}   to move: ${planned.length}   conflicts: ${conflicts.length}\n`);
  for (const p of planned) {
    console.log(`  athletes/${p.ref.id}: remove [${p.present.join(', ')}] from public; copy [${Object.keys(p.copy).join(', ') || 'nothing'}] to private`);
  }
  for (const c of conflicts) {
    console.log(`  SKIPPED athletes/${c.id}: private already holds a DIFFERENT ${c.fields.join(', ')} — resolve by hand`);
  }

  if (!COMMIT) {
    console.log('\nDry run — nothing written. Re-run with --commit to apply.\n');
    return;
  }

  let verified = 0;
  for (const p of planned) {
    const batch = db.batch();
    if (Object.keys(p.copy).length > 0) batch.set(p.privRef, p.copy, { merge: true });
    batch.update(p.ref, Object.fromEntries(p.present.map((f) => [f, del])));
    await batch.commit();

    const [pubAfter, privAfter] = await Promise.all([p.ref.get(), p.privRef.get()]);
    const stillPublic = FIELDS.filter((f) => f in (pubAfter.data() ?? {}));
    const missing = Object.keys(p.copy).filter((f) => privAfter.get(f) !== p.copy[f]);
    if (stillPublic.length === 0 && missing.length === 0) verified += 1;
    else console.error(`  VERIFY FAILED athletes/${p.ref.id}: still public [${stillPublic.join(', ')}], not copied [${missing.join(', ')}]`);
  }
  console.log(`\nCommitted ${planned.length}; verified ${verified}.\n`);
  if (verified !== planned.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
