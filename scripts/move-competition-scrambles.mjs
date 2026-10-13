#!/usr/bin/env node
// One-off maintenance script: move imported WCA scrambles off the PUBLIC
// competitions/{id} document into competitions/{id}/private/scrambles.
//
// Background: competitions/{id} is readable by anyone (every public page
// reads it), so a `scrambleSets` field there let any visitor read a round's
// scrambles before it was held. The app now reads and writes them only in
// the admin-only private document (firestore.rules), and no longer looks at
// the public field at all — a competition still carrying it shows no
// scrambles in results entry until it is moved.
//
// DRY RUN BY DEFAULT. Nothing is written without --commit.
//
// Usage (from anywhere — the env files are found relative to this script):
//   node scripts/move-competition-scrambles.mjs            # dry run
//   node scripts/move-competition-scrambles.mjs --commit
//
// Credentials are read exactly as scripts/move-athlete-private-fields.mjs
// reads them: @next/env's loadEnvConfig loads .env.local and .env from the
// project root (a variable already set in the shell wins).
//
// Safety rules this script holds to:
//   * only the one field scrambleSets, never any other field
//   * never overwrites an event+round block the private document already
//     holds; a competition where such a block DIFFERS from the public one is
//     skipped and listed, for a person to decide
//   * the copy and the removal are one batch per competition: the field is
//     never removed without being written, nor left public once written
//   * prints ids and event/round keys only — never a scramble
//   * verifies every committed competition by reading both documents back
//
// Re-runnable: a second pass finds nothing left to do.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');
const FIELD = 'scrambleSets';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Loads the env files the way Next does, then initialises the Admin SDK.
 *  On failure, names every variable that could not be used and why — never
 *  its value. Same as scripts/move-athlete-private-fields.mjs. */
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

/** "333/1, 333/2" — the event/round blocks of a scrambleSets map. */
function blockKeys(sets) {
  return Object.entries(sets ?? {}).flatMap(([eventId, rounds]) =>
    Object.keys(rounds ?? {}).map((roundId) => `${eventId}/${roundId}`),
  );
}

async function main() {
  const db = initAdmin().firestore();
  const { FieldValue, FieldPath } = admin.firestore;
  console.log(`\n=== move competition scrambles — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ===\n`);

  const snap = await db.collection('competitions').get();
  const planned = [];
  const conflicts = [];
  let alreadyClean = 0;

  for (const d of snap.docs) {
    const pub = d.data();
    if (!(FIELD in pub)) {
      alreadyClean += 1;
      continue;
    }
    const publicSets = pub[FIELD] && typeof pub[FIELD] === 'object' ? pub[FIELD] : {};
    const privRef = d.ref.collection('private').doc('scrambles');
    const privateSets = (await privRef.get()).data()?.[FIELD] ?? {};
    const copy = [];      // [eventId, roundId] blocks to write to the private doc
    const clashing = [];
    for (const key of blockKeys(publicSets)) {
      const [eventId, roundId] = key.split('/');
      const existing = privateSets[eventId]?.[roundId];
      if (existing === undefined) copy.push([eventId, roundId]);
      else if (!isDeepStrictEqual(existing, publicSets[eventId][roundId])) clashing.push(key);
    }
    if (clashing.length > 0) {
      conflicts.push({ id: d.id, blocks: clashing });
      continue;
    }
    planned.push({ ref: d.ref, privRef, publicSets, copy });
  }

  console.log(`competitions: ${snap.size}   without ${FIELD}: ${alreadyClean}   to move: ${planned.length}   conflicts: ${conflicts.length}\n`);
  for (const p of planned) {
    console.log(`  competitions/${p.ref.id}: remove ${FIELD} from public; copy [${p.copy.map((b) => b.join('/')).join(', ') || 'nothing'}] to private/scrambles`);
  }
  for (const c of conflicts) {
    console.log(`  SKIPPED competitions/${c.id}: private/scrambles already holds a DIFFERENT ${c.blocks.join(', ')} — resolve by hand`);
  }
  if (planned.length === 0 && conflicts.length === 0) {
    console.log(`No competition carries ${FIELD} on its public document — nothing to move.`);
  }

  if (!COMMIT) {
    console.log('\nDry run — nothing written. Re-run with --commit to apply.\n');
    return;
  }

  let verified = 0;
  for (const p of planned) {
    const batch = db.batch();
    if (p.copy.length > 0) {
      batch.set(p.privRef, { [FIELD]: p.publicSets }, {
        mergeFields: p.copy.map(([eventId, roundId]) => new FieldPath(FIELD, eventId, roundId)),
      });
    }
    batch.update(p.ref, { [FIELD]: FieldValue.delete() });
    await batch.commit();

    const [pubAfter, privAfter] = await Promise.all([p.ref.get(), p.privRef.get()]);
    const stillPublic = FIELD in (pubAfter.data() ?? {});
    const privSets = privAfter.data()?.[FIELD] ?? {};
    const missing = p.copy
      .filter(([eventId, roundId]) => !isDeepStrictEqual(privSets[eventId]?.[roundId], p.publicSets[eventId][roundId]))
      .map((b) => b.join('/'));
    if (!stillPublic && missing.length === 0) verified += 1;
    else console.error(`  VERIFY FAILED competitions/${p.ref.id}: ${stillPublic ? 'still public; ' : ''}not copied [${missing.join(', ')}]`);
  }
  console.log(`\nCommitted ${planned.length}; verified ${verified}.\n`);
  if (verified !== planned.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
