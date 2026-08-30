import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  signOut,
  type Auth,
} from 'firebase/auth';

// ── Isolated Firebase client for the public online-competition feature ──────
//
// This deliberately initializes a SECOND, separately-named Firebase app
// (same project/config as the club site's default app in lib/firebase.ts)
// rather than importing `auth`/`db` from lib/firebase.ts directly. Reasons:
//
// 1. The club site wraps its entire tree in <AuthProvider> (lib/auth-context
//    .tsx), which listens to the DEFAULT app's onAuthStateChanged and, on
//    every sign-in, upserts a doc into the club's `users` collection (role,
//    points, athleteId, etc). Public competition participants (anonymous
//    randoms off the internet) must never end up as ghost rows in that
//    collection — this feature has its own `onlineParticipants` collection
//    for that purpose.
// 2. Firebase Auth only allows one active user per Auth instance. If this
//    feature called signInAnonymously() on the SAME `auth` instance the
//    club site uses, opening this page in a tab where a club admin is
//    already signed in (e.g. while testing) would silently sign them out
//    and replace their session with a fresh anonymous user.
//
// A second named app gives this feature its own independent Auth session
// and Firestore client — still talking to the exact same Firebase
// project/backend (so security rules and `request.auth.uid` work
// normally), just without touching the club site's signed-in session or
// its onAuthStateChanged listener.
//
// Note: video uploads go to Cloudinary, not Firebase Storage — this
// project's Firebase plan doesn't support enabling Storage without
// upgrading to a paid tier, so there is no Storage client here at all.
const ONLINE_COMPETITION_APP_NAME = 'online-competition';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const existing = getApps().find((a) => a.name === ONLINE_COMPETITION_APP_NAME);
const onlineCompApp = existing ?? initializeApp(firebaseConfig, ONLINE_COMPETITION_APP_NAME);

export const onlineCompAuth = getAuth(onlineCompApp);
export const onlineCompDb = getFirestore(onlineCompApp);

// Ensures the visitor has some Firebase Auth identity before touching
// Firestore. Anonymous auth is used — not email — because this is a
// public, one-off competition entry flow: requiring an account/password
// would add friction for a participant who just wants to record one solve.
// If already signed in (anonymous or otherwise) on this app instance, this
// is a no-op and resolves with the current user.
export async function ensureOnlineCompAuth(): Promise<Auth['currentUser']> {
  if (onlineCompAuth.currentUser) return onlineCompAuth.currentUser;
  const cred = await signInAnonymously(onlineCompAuth);
  return cred.user;
}

const googleProvider = new GoogleAuthProvider();

// Google sign-in — the primary identity for participants going forward
// (registration, the nav bar's profile badge). Anonymous auth
// (ensureOnlineCompAuth above) stays as-is for the existing solve page,
// which already has submissions filed under anonymous uids; the two
// coexist fine since Firebase Auth only ever has one *or* the other as
// `onlineCompAuth.currentUser` at a time, and both read/write through
// this same isolated app instance.
//
// Popup vs. redirect tradeoff: signInWithPopup is used by default — it
// resolves in place with no extra wiring (no need to check
// getRedirectResult() on every page load) and works fine on desktop and
// most mobile browsers. It fails in two known cases: in-app webviews
// (Instagram/Facebook/TikTok's built-in browser, common for Mongolian
// mobile traffic reached via social links) which block window.open()
// entirely, and browsers/extensions with aggressive popup blocking —
// both surface as `auth/popup-blocked` (or, for the webview case,
// `auth/operation-not-supported-in-this-environment`). We fall back to
// signInWithRedirect() there; useOnlineAuth.tsx's provider calls
// getRedirectResult() once on mount to pick up the result when the user
// is navigated back.
export async function signInWithGoogle(): Promise<void> {
  try {
    await signInWithPopup(onlineCompAuth, googleProvider);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(onlineCompAuth, googleProvider);
      return;
    }
    throw err;
  }
}

export async function signOutOnlineComp(): Promise<void> {
  await signOut(onlineCompAuth);
}
