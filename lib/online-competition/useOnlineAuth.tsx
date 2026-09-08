'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRedirectResult, onAuthStateChanged, type User } from 'firebase/auth';
import { onlineCompAuth, signInWithGoogle, signOutOnlineComp } from './firebase';
import { fetchParticipant, upsertGoogleParticipant } from './data';
import type { OnlineParticipant } from './types';

export interface OnlineAuthUser {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  /** True for legacy anonymous sessions (the solve page created these
   *  before it moved to this provider). Consumers
   *  that need a "really signed in" check (the nav badge, the
   *  registration gate) should treat an anonymous user the same as
   *  signed-out. */
  isAnonymous: boolean;
}

interface OnlineAuthContextValue {
  user: OnlineAuthUser | null;
  /** The signed-in athlete's onlineParticipants document, loaded ONCE per
   *  session here rather than re-read by every surface that needs it. The
   *  nav needs it for the athlete's verification photo, which is on this
   *  document and not on the Firebase user. null while it loads, for an
   *  anonymous session, or if the read fails — consumers fall back to
   *  initials, which is the same thing they do for an athlete who has not
   *  submitted a photo yet. */
  participant: OnlineParticipant | null;
  /** Re-read the participant after a write that changes it (the profile
   *  form's submit), so the nav avatar updates without a page reload. */
  refreshParticipant: () => Promise<void>;
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
 *  standing up their own. Deliberately never signs anyone in on its own —
 *  just browsing the hub shouldn't create an identity; only actions that
 *  need one (registering, submitting a solve) trigger sign-in themselves. */
export function OnlineAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OnlineAuthUser | null>(null);
  const [participant, setParticipant] = useState<OnlineParticipant | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshParticipant = useCallback(async () => {
    const uid = onlineCompAuth.currentUser?.uid;
    if (!uid || onlineCompAuth.currentUser?.isAnonymous) {
      setParticipant(null);
      return;
    }
    try {
      setParticipant(await fetchParticipant(uid));
    } catch {
      setParticipant(null);
    }
  }, []);

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
        })
          .catch((err) => console.warn('[online-competition] participant upsert failed', err))
          // AFTER the upsert, not in parallel: fetchParticipant waits on
          // pending writes precisely because this read races that write
          // (see its comment in data.ts).
          .finally(() => {
            void refreshParticipant();
          });
      } else {
        setParticipant(null);
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: OnlineAuthContextValue = {
    user,
    participant,
    refreshParticipant,
    loading,
    signInWithGoogle,
    signOut: signOutOnlineComp,
  };

  return <OnlineAuthContext.Provider value={value}>{children}</OnlineAuthContext.Provider>;
}

export function useOnlineAuth(): OnlineAuthContextValue {
  const ctx = useContext(OnlineAuthContext);
  if (!ctx) throw new Error('useOnlineAuth must be used inside <OnlineAuthProvider>');
  return ctx;
}
