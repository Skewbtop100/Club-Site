import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Server-only Firebase Admin SDK client for the online-competition review
// dashboard's API routes (admin-auth, submissions, review). No existing
// firebase-admin initialization exists elsewhere in this Next.js app to
// reuse — the two scripts/cleanup-*.mjs maintenance scripts each call
// admin.initializeApp() themselves via GOOGLE_APPLICATION_CREDENTIALS +
// a locally-downloaded service account key, which only works for one-off
// manual runs from a developer machine, not a deployed API route.
//
// The review dashboard is gated by a shared password + httpOnly cookie
// (lib/online-competition/admin-auth.ts), not Firebase Auth, so there is
// no `request.auth` for Firestore security rules to check. Reads/writes
// of onlineSubmissions.status/penalty are instead only ever performed
// here, server-side, with the Admin SDK — which bypasses security rules
// entirely — so the client-side Firestore rules for that collection can
// safely deny those fields to every direct client write (see the rules
// snippet in the PR/commit description).
//
// Requires two server-only env vars from a Firebase service account key
// (Firebase Console → Project Settings → Service Accounts → Generate new
// private key). Project ID is reused from the existing public var since
// it isn't sensitive.
const ADMIN_APP_NAME = 'online-competition-admin';

function getAdminApp(): App {
  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) return existing;

  const projectId =
    process.env.ONLINE_COMP_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.ONLINE_COMP_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.ONLINE_COMP_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing ONLINE_COMP_FIREBASE_CLIENT_EMAIL / ONLINE_COMP_FIREBASE_PRIVATE_KEY ' +
        '(or NEXT_PUBLIC_FIREBASE_PROJECT_ID) env vars — see lib/online-competition/firebase-admin.ts',
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, ADMIN_APP_NAME);
}

export function getOnlineCompAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
