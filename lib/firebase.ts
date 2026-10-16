import { initializeApp, getApps } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithEmailAndPassword } from 'firebase/auth';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const databaseURL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined);

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  databaseURL,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    '[Firebase] Missing env vars — NEXT_PUBLIC_FIREBASE_API_KEY or NEXT_PUBLIC_FIREBASE_PROJECT_ID is undefined.\n' +
    'Set these in Vercel Dashboard → Settings → Environment Variables and redeploy.'
  );
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

// IMPORTANT: Google sign-in must be enabled in Firebase Console
// (Authentication → Sign-in method → Google → Enable). The
// authDomain in env vars must also be added to Firebase Auth's
// authorised domains list, or popup sign-in will fail with
// auth/unauthorized-domain.
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// ── TEST-ONLY emulator mode (docs/challenge-plan.md B6) ─────────────────
// Points Auth / Firestore / Realtime Database at the LOCAL emulators and
// exposes window.__pvTestAuth (email+password sign-in, which the Auth
// emulator accepts) so Playwright can sign two accounts in without Google.
//
// It can never switch on in production: BOTH conditions are build-time
// constants. `next build` inlines NODE_ENV as "production", so the test is
// `false && …` and the whole block — emulator hosts and the test hook — is
// removed from the bundle. tests/e2e/emulator-guard.mjs builds the app WITH
// NEXT_PUBLIC_FIREBASE_EMULATORS=1 and checks exactly that.
export const EMULATOR_MODE =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1';

if (EMULATOR_MODE) {
  const g = globalThis as typeof globalThis & { __pvEmulatorsConnected?: boolean };
  if (!g.__pvEmulatorsConnected) {
    g.__pvEmulatorsConnected = true;
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
  }
  if (typeof window !== 'undefined') {
    (window as unknown as { __pvTestAuth?: object }).__pvTestAuth = {
      signIn: (email: string, password: string) => signInWithEmailAndPassword(auth, email, password),
    };
  }
}
