'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';

export type UserRole = 'member' | 'athlete' | 'admin';

export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  role: UserRole;
  points: number;
  athleteId: string | null;
  unlockedTools: string[];
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<AppUser | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// First-login document shape. Subsequent logins only refresh lastLoginAt
// (and any photoURL/displayName drift from the Google profile, since users
// often update their Google avatar and we want it reflected here).
async function upsertUserDoc(fbUser: FirebaseUser): Promise<AppUser> {
  const ref = doc(db, 'users', fbUser.uid);
  const snap = await getDoc(ref);

  const displayName = fbUser.displayName ?? fbUser.email ?? 'Player';
  const email = fbUser.email ?? '';
  const photoURL = fbUser.photoURL;

  if (!snap.exists()) {
    const fresh = {
      uid: fbUser.uid,
      displayName,
      email,
      photoURL,
      role: 'member' as UserRole,
      points: 0,
      athleteId: null as string | null,
      unlockedTools: [] as string[],
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    };
    await setDoc(ref, fresh);
    return {
      uid: fresh.uid,
      displayName: fresh.displayName,
      email: fresh.email,
      photoURL: fresh.photoURL,
      role: fresh.role,
      points: fresh.points,
      athleteId: fresh.athleteId,
      unlockedTools: fresh.unlockedTools,
    };
  }

  const data = snap.data() as Partial<AppUser> & { role?: UserRole };
  await updateDoc(ref, {
    lastLoginAt: serverTimestamp(),
    displayName,
    photoURL,
  });
  return {
    uid: fbUser.uid,
    displayName,
    email,
    photoURL,
    role: data.role ?? 'member',
    points: typeof data.points === 'number' ? data.points : 0,
    athleteId: data.athleteId ?? null,
    unlockedTools: Array.isArray(data.unlockedTools) ? data.unlockedTools : [],
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks the uid currently being upserted so a fast sign-in→sign-out
  // sequence can't write a stale user back into state.
  const inFlightRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        inFlightRef.current = null;
        setUser(null);
        setLoading(false);
        return;
      }
      inFlightRef.current = fbUser.uid;
      try {
        const appUser = await upsertUserDoc(fbUser);
        if (inFlightRef.current === fbUser.uid) setUser(appUser);
      } catch (err) {
        console.error('[auth] upsertUserDoc failed', err);
        if (inFlightRef.current === fbUser.uid) {
          // Fall back to a minimal user so the UI still reflects sign-in.
          setUser({
            uid: fbUser.uid,
            displayName: fbUser.displayName ?? fbUser.email ?? 'Player',
            email: fbUser.email ?? '',
            photoURL: fbUser.photoURL,
            role: 'member',
            points: 0,
            athleteId: null,
            unlockedTools: [],
          });
        }
      } finally {
        if (inFlightRef.current === fbUser.uid) setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged also fires, but we resolve eagerly so callers can
    // branch on role immediately without a second roundtrip.
    return upsertUserDoc(cred.user);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signInWithGoogle, signOut }),
    [user, loading, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
