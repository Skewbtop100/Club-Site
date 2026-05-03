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
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { awardDailyLoginIfNew, consumeAthleteLinkedToast } from './points';
import { showToast } from './toast';

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
  // Lifetime count of committed solves across all events/sessions.
  // Drives the Ao5-PB award threshold (only awards once user has ≥100
  // total solves) and any future "experience"-style features.
  totalSolves: number;
  // Epoch ms; null if the field is missing or hasn't been written yet
  // (serverTimestamp() resolves to null for the writing client until the
  // server round-trip completes).
  createdAt: number | null;
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<AppUser | null>;
  signOut: () => Promise<void>;
  updateProfile: (patch: { displayName?: string }) => Promise<void>;
}

function tsToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return null;
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
      totalSolves: 0,
      // serverTimestamp() returns null on the writing client until the
      // round-trip resolves; the next sign-in will surface a concrete value.
      createdAt: null,
    };
  }

  const data = snap.data() as Partial<AppUser> & { role?: UserRole; createdAt?: unknown };
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
    totalSolves: typeof (data as { totalSolves?: unknown }).totalSolves === 'number'
      ? (data as { totalSolves: number }).totalSolves
      : 0,
    createdAt: tsToMs(data.createdAt),
  };
}

// Best-effort awards/toasts that run AFTER the user doc is upserted.
// AuthProvider's live user-doc snapshot picks up any resulting balance
// change automatically, so this helper only needs to fire side effects
// (the award + the celebratory toast) — no return value plumbing.
async function runPostLoginAwards(uid: string): Promise<void> {
  // 1. Daily login bonus — idempotent on local calendar day.
  try {
    const r = await awardDailyLoginIfNew(uid);
    if (r.awarded) {
      showToast({ msg: 'Өдөр тутмын бонус +5 💎', tone: 'success' });
    }
  } catch (err) {
    console.warn('[auth] daily-login award failed', err);
  }
  // 2. Athlete-linked toast — fires once after admin approval. The points
  //    were already awarded at approval time; this just surfaces the
  //    celebration on first login afterwards.
  try {
    const linked = await consumeAthleteLinkedToast(uid);
    if (linked) {
      showToast({ msg: 'Тамирчинтай холбогдсон! +100 💎', tone: 'success' });
    }
  } catch (err) {
    console.warn('[auth] athlete-linked toast check failed', err);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks the uid currently being upserted so a fast sign-in→sign-out
  // sequence can't write a stale user back into state.
  const inFlightRef = useRef<string | null>(null);

  useEffect(() => {
    // Live user-doc subscription tracker. We want every points / role /
    // totalSolves update to flow into in-memory state without requiring
    // a page reload, so a single onSnapshot is set up alongside each
    // sign-in and torn down on sign-out (or before re-subscribing for a
    // different uid).
    let userDocUnsub: (() => void) | null = null;
    const cleanupUserDoc = () => {
      if (userDocUnsub) {
        userDocUnsub();
        userDocUnsub = null;
      }
    };
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      cleanupUserDoc();
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
        // Live mirror — points/role/athleteId/totalSolves stay current
        // even when other parts of the app increment them (timer solves,
        // multiplayer match end, achievements, admin grants).
        userDocUnsub = onSnapshot(
          doc(db, 'users', fbUser.uid),
          (snap) => {
            if (inFlightRef.current !== fbUser.uid) return;
            if (!snap.exists()) return;
            const data = snap.data() as Record<string, unknown>;
            setUser(prev => prev && prev.uid === fbUser.uid ? {
              ...prev,
              points: typeof data.points === 'number' ? data.points : prev.points,
              role: typeof data.role === 'string' ? (data.role as UserRole) : prev.role,
              athleteId: typeof data.athleteId === 'string' ? (data.athleteId as string)
                : data.athleteId === null ? null
                : prev.athleteId,
              unlockedTools: Array.isArray(data.unlockedTools)
                ? (data.unlockedTools as string[])
                : prev.unlockedTools,
              totalSolves: typeof data.totalSolves === 'number'
                ? data.totalSolves
                : prev.totalSolves,
            } : prev);
          },
          (err) => console.warn('[auth] user-doc subscription error', err),
        );
        // Best-effort post-login awards — daily bonus + athlete-linked
        // toast consumption. The live snapshot above will pick up the
        // resulting balance change automatically, so we don't need to
        // mirror the new balance manually.
        runPostLoginAwards(fbUser.uid).catch(err =>
          console.warn('[auth] post-login awards failed', err),
        );
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
            totalSolves: 0,
            createdAt: null,
          });
        }
      } finally {
        if (inFlightRef.current === fbUser.uid) setLoading(false);
      }
    });
    return () => {
      cleanupUserDoc();
      unsub();
    };
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

  // Persists a partial profile patch (currently just displayName) and
  // mirrors it into local state so consumers (Navbar, Profile) update
  // without waiting for a re-fetch.
  const updateProfile = useCallback(async (patch: { displayName?: string }) => {
    const current = auth.currentUser;
    if (!current) throw new Error('Not signed in');
    const trimmed = patch.displayName?.trim();
    const next: Record<string, unknown> = {};
    if (trimmed !== undefined) next.displayName = trimmed;
    if (Object.keys(next).length === 0) return;
    await updateDoc(doc(db, 'users', current.uid), next);
    setUser(prev => (prev ? { ...prev, ...(trimmed !== undefined ? { displayName: trimmed } : {}) } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signInWithGoogle, signOut, updateProfile }),
    [user, loading, signInWithGoogle, signOut, updateProfile],
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
