// Firebase Admin SDK for the club project, for server routes only
// (app/api/judge/*, app/api/staged/*). Never import this from client code —
// it reads the service-account key.
//
// Env (set in .env.local and in Vercel → Settings → Environment Variables):
//   FIREBASE_ADMIN_CLIENT_EMAIL  service account's client_email
//   FIREBASE_ADMIN_PRIVATE_KEY   its private_key, on one line with the
//                                newlines written as \n (turned back here)
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID  already set — the project id
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/** Thrown when the service-account env vars are missing — routes turn it
 *  into a 503 that names the variables (never their values). */
export class AdminNotConfiguredError extends Error {}

function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const missing = [
    !projectId && 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    !clientEmail && 'FIREBASE_ADMIN_CLIENT_EMAIL',
    !privateKey && 'FIREBASE_ADMIN_PRIVATE_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new AdminNotConfiguredError(`Server is missing: ${missing.join(', ')}`);
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());

/** Verified caller of a route, from its `Authorization: Bearer <ID token>`
 *  header; null when the header is missing or the token is invalid. */
export async function verifyBearer(req: Request): Promise<DecodedIdToken | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    return await adminAuth().verifyIdToken(token);
  } catch (e) {
    if (e instanceof AdminNotConfiguredError) throw e;
    return null;
  }
}

/** The club admin, same definition as firestore.rules' isAdmin():
 *  users/{uid}.role is exactly 'admin'. */
export async function isAdminUid(uid: string): Promise<boolean> {
  const snap = await adminDb().doc(`users/${uid}`).get();
  return snap.exists && snap.get('role') === 'admin';
}

/** Whether a decoded token is a live judge session for `competitionId` —
 *  the same checks firestore.rules' isJudgeOf() makes: right competition,
 *  not expired, competition not finished, and issued for the PIN that is
 *  still the current, enabled one. */
export async function isJudgeOf(token: DecodedIdToken, competitionId: string): Promise<boolean> {
  if (token.role !== 'judge' || token.competitionId !== competitionId) return false;
  if (typeof token.validUntil !== 'number' || Date.now() >= token.validUntil) return false;
  const db = adminDb();
  const [comp, access] = await Promise.all([
    db.doc(`competitions/${competitionId}`).get(),
    db.doc(`competitions/${competitionId}/private/judgeAccess`).get(),
  ]);
  if (!comp.exists || comp.get('status') === 'finished') return false;
  return access.exists && access.get('enabled') === true && access.get('version') === token.pinVersion;
}
