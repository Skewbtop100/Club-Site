#!/usr/bin/env node
// READ-ONLY report: registrations created outside their competition's
// registration window. Writes nothing, deletes nothing.
//
// Usage:
//   node scripts/report-registration-window.mjs
//
// Credentials: loaded exactly as scripts/move-athlete-private-fields.mjs
// loads them (@next/env, .env and .env.local from the project root).
//
// WHAT "CREATED" MEANS HERE: registeredAt. Since PR-0 it is stamped once, by
// the server, on the first save. A registration from BEFORE that (stored
// status 'registered', or no status) had registeredAt re-stamped on every
// save, so for those it is the LAST save, not the first — they are counted
// separately. The comparison is against the window as it is stored TODAY;
// an admin who moved the opening time after people registered changes what
// this reports.
//
// Prints competition ids, names and counts only — no athlete uid, name or
// email.

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

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : null);
const fmt = (t) => (t === null ? '—' : new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');

async function main() {
  const db = initAdmin().firestore();

  const comps = new Map();
  for (const d of (await db.collection('onlineCompetitions').get()).docs) {
    const c = d.data();
    comps.set(d.id, {
      name: typeof c.name === 'string' ? c.name : '',
      status: c.status ?? null,
      opens: ms(c.registrationOpensAt),
      closes: ms(c.registrationDeadline),
      deleting: !!c.deletion,
    });
  }

  const regs = (await db.collectionGroup('registrations').get()).docs.filter(
    (d) => d.ref.parent.parent?.parent.id === 'onlineParticipants',
  );

  const per = new Map();
  const bucket = (id) => {
    if (!per.has(id)) {
      per.set(id, { total: 0, inside: 0, beforeOpen: 0, afterClose: 0, windowUnset: 0, noRegisteredAt: 0, legacy: 0, outsideByStatus: {} });
    }
    return per.get(id);
  };

  for (const d of regs) {
    const r = d.data();
    const id = typeof r.competitionId === 'string' ? r.competitionId : d.id;
    const b = bucket(id);
    b.total += 1;
    const legacy = r.status === 'registered' || r.status === undefined || r.status === null;
    if (legacy) b.legacy += 1;
    const at = ms(r.registeredAt);
    const comp = comps.get(id);
    if (at === null) {
      b.noRegisteredAt += 1;
      continue;
    }
    let outside = null;
    if (comp?.opens != null && at < comp.opens) outside = 'beforeOpen';
    else if (comp?.closes != null && at >= comp.closes) outside = 'afterClose';
    if (outside) {
      b[outside] += 1;
      const key = `${outside}:${String(r.status ?? 'none')}${legacy ? ' (legacy registeredAt = last save)' : ''}`;
      b.outsideByStatus[key] = (b.outsideByStatus[key] ?? 0) + 1;
    } else if (comp?.opens == null || comp?.closes == null) {
      b.windowUnset += 1;
    } else {
      b.inside += 1;
    }
  }

  console.log(`\n=== registrations vs. registration window (read-only) ===`);
  console.log(`competitions: ${comps.size}   registrations: ${regs.length}\n`);

  let before = 0;
  let after = 0;
  for (const [id, b] of per) {
    const c = comps.get(id);
    before += b.beforeOpen;
    after += b.afterClose;
    console.log(`${id}  "${c?.name ?? '(competition document missing)'}"`);
    if (c) console.log(`  status ${JSON.stringify(c.status)}${c.deleting ? ' (deletion under way)' : ''}   opens ${fmt(c.opens)}   closes ${fmt(c.closes)}`);
    console.log(
      `  ${b.total} registrations: inside ${b.inside} · BEFORE OPEN ${b.beforeOpen} · AFTER CLOSE ${b.afterClose} · ` +
        `window unset ${b.windowUnset} · no registeredAt ${b.noRegisteredAt} · legacy ${b.legacy}`,
    );
    for (const [k, n] of Object.entries(b.outsideByStatus)) console.log(`    ${k}: ${n}`);
  }

  console.log(`\nTOTAL outside the stored window: ${before + after} (before open ${before}, after close ${after})`);

  // What the new rule would refuse from the moment it is deployed.
  const unsettable = [...comps].filter(([, c]) => (c.status === 'upcoming' || c.status === 'live') && (c.opens === null || c.closes === null));
  console.log(`\nPUBLIC competitions with no complete window (the new rules refuse every registration): ${unsettable.length}`);
  for (const [id, c] of unsettable) console.log(`  ${id}  "${c.name}"  status ${c.status}  opens ${fmt(c.opens)}  closes ${fmt(c.closes)}`);
  const legacyStatus = [...comps].filter(([, c]) => !['draft', 'upcoming', 'live', 'finished'].includes(c.status));
  console.log(`competitions with a legacy or missing status (refused by the new rules): ${legacyStatus.length}`);
  for (const [id, c] of legacyStatus) console.log(`  ${id}  "${c.name}"  status ${JSON.stringify(c.status)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
