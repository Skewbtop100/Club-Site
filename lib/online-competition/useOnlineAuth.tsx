'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRedirectResult, onAuthStateChanged, type User } from 'firebase/auth';
import { onlineCompAuth, signInWithGoogle, signOutOnlineComp } from './firebase';
import { upsertGoogleParticipant } from './data';

export interface OnlineAuthUser {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  /** True for the solve page's ensureOnlineCompAuth() sessions. Consumers
   *  that need a "really signed in" check (the nav badge, the
   *  registration gate) should treat an anonymous user the same as
   *  signed-out. */
  isAnonymous: boolean;
}

interface OnlineAuthContextValue {
  user: OnlineAuthUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const OnlineAuthContext = createContext<OnlineAuthContextValue | null>(null);

function toOnlineAuthUser(fbUser: User | null): OnlineAuthUser | null {
  if (!fbUser) return null;
  return {
    uid: fbUser.uid,
    displayName: fbUser.displayName,
    photoURL: fbUser.photoURL,
    email: fbUser.email,
    isAnonymous: fbUser.isAnonymous,
  };
}

/** Wraps app/online-competition/layout.tsx so the hub, detail, and solve
 *  pages all share one onAuthStateChanged subscription instead of each
 *  standing up their own. Deliberately does NOT call ensureOnlineCompAuth()
 *  (anonymous sign-in) itself — just browsing the hub shouldn't create an
 *  identity; only actions that need one (registering, submitting a solve)
 *  should, and those already trigger it themselves. */
export function OnlineAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OnlineAuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Best-effort: completes a signInWithRedirect() flow if one is in
    // flight (the popup-blocked fallback in firebase.ts's
    // signInWithGoogle). onAuthStateChanged below is the source of truth
    // either way, so a failure here (e.g. no redirect was pending) is
    // silently ignored.
    getRedirectResult(onlineCompAuth).catch(() => {});

    const unsub = onAuthStateChanged(onlineCompAuth, (fbUser) => {
      setUser(toOnlineAuthUser(fbUser));
      setLoading(false);

      if (fbUser && !fbUser.isAnonymous) {
        upsertGoogleParticipant({
          uid: fbUser.uid,
          displayName: fbUser.displayName,
          photoURL: fbUser.photoURL,
          email: fbUser.email,
        }).catch((err) => console.warn('[online-competition] participant upsert failed', err));
      }
    });
    return unsub;
  }, []);

  const value: OnlineAuthContextValue = { user, loading, signInWithGoogle, signOut: signOutOnlineComp };

  return <OnlineAuthContext.Provider value={value}>{children}</OnlineAuthContext.Provider>;
}

export function useOnlineAuth(): OnlineAuthContextValue {
  const ctx = useContext(OnlineAuthContext);
  if (!ctx) throw new Error('useOnlineAuth must be used inside <OnlineAuthProvider>');
  return ctx;
}
