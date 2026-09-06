import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  signOut,
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

const googleProvider = new GoogleAuthProvider();

// Google sign-in — the only identity participants get. (Anonymous auth
// used to exist alongside it for the old solve flow; that flow now reads
// its user from useOnlineAuth() like every other page, so the anonymous
// helper was removed. Submissions filed under the old anonymous uids are
// still in Firestore — consumers that care, such as the nav badge and the
// registration gate, keep treating `isAnonymous` as signed-out.)
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
