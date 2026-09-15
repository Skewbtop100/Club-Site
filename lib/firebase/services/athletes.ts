import {
  getDocs,
  getDoc,
  doc,
  deleteField,
  onSnapshot,
  getCountFromServer,
  runTransaction,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL, athletesCol, athleteDoc, athletePrivateDoc } from '@/lib/firebase/collections';
import type { Athlete, AthletePrivate } from '@/lib/types';

// ── Public profile vs private identity ──────────────────────────────────
// athletes/{id} is readable by anyone (the club site's public pages read it
// directly), so date of birth and phone live in athletes/{id}/private/identity,
// readable only by an admin and the linked account. firestore.rules refuses
// either key on the public document; every write here keeps them apart.

const PRIVATE_KEYS = ['birthDate', 'phone'] as const;

function pickPrivate(source: Record<string, unknown> | undefined): AthletePrivate {
  const out: AthletePrivate = {};
  for (const key of PRIVATE_KEYS) {
    const value = source?.[key];
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

function withoutPrivate<T extends object>(data: T): T {
  const copy = { ...data } as Record<string, unknown>;
  for (const key of PRIVATE_KEYS) delete copy[key];
  return copy as T;
}

/** The private fields an athlete document still carries from before the
 *  split — present only until scripts/move-athlete-private-fields.mjs has
 *  run. The admin table falls back to these so it never shows a blank. */
export function legacyPrivateFields(athlete: Athlete): AthletePrivate {
  return pickPrivate(athlete as unknown as Record<string, unknown>);
}

/** One-time fetch of all athletes. */
export async function getAthletes(): Promise<Athlete[]> {
  const snap = await getDocs(athletesCol);
  return snap.docs.map((d) => d.data());
}

/** Real-time subscription. Returns unsubscribe function. */
export function subscribeAthletes(
  onData: (athletes: Athlete[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    athletesCol,
    (snap) => onData(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  );
}

/** Fetch a single athlete by id. */
export async function getAthlete(id: string): Promise<Athlete | null> {
  const snap = await getDoc(athleteDoc(id));
  return snap.exists() ? snap.data() : null;
}

/** An athlete's private identity. Admins and the linked account only —
 *  anyone else is refused by firestore.rules, so callers that may not be
 *  either must treat a rejection as "not available". Null when the athlete
 *  has no private document. */
export async function getAthletePrivate(id: string): Promise<AthletePrivate | null> {
  const snap = await getDoc(athletePrivateDoc(id));
  return snap.exists() ? pickPrivate(snap.data()) : null;
}

/** Total athlete count (cheap server-side count). */
export async function getAthleteCount(): Promise<number> {
  const snap = await getCountFromServer(athletesCol);
  return snap.data().count;
}

export type AthleteInput = Omit<Athlete, 'id'> & AthletePrivate & { athleteId?: string };

/** Create a new athlete: the public profile and, if given, the private
 *  identity, in one batch. */
export async function addAthlete(data: AthleteInput): Promise<string> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const batch = writeBatch(db);
  batch.set(athleteDoc(id), { id, athleteId: id, ...withoutPrivate(data), createdAt: Timestamp.now() } as Athlete);
  const priv = pickPrivate(data as unknown as Record<string, unknown>);
  if (Object.keys(priv).length > 0) batch.set(athletePrivateDoc(id), priv);
  await batch.commit();
  return id;
}

/** Update an existing athlete.
 *
 *  A transaction because an athlete not yet moved by the migration still
 *  carries its private fields on the public document: they are carried into
 *  the private one (a value passed in wins) and removed from the public one
 *  in the same write, so an edit never loses them and never leaves them
 *  public. */
export async function updateAthlete(
  id: string,
  data: Partial<Omit<Athlete, 'id'>> & AthletePrivate,
): Promise<void> {
  const publicRef = doc(db, COL.ATHLETES, id);
  await runTransaction(db, async (t) => {
    const current = await t.get(publicRef);
    const priv = { ...pickPrivate(current.data()), ...pickPrivate(data as Record<string, unknown>) };
    t.update(publicRef, {
      ...withoutPrivate(data),
      updatedAt: Timestamp.now(),
      birthDate: deleteField(),
      phone: deleteField(),
    });
    if (Object.keys(priv).length > 0) t.set(athletePrivateDoc(id), priv, { merge: true });
  });
}

/** Delete an athlete permanently — the private identity with it. */
export async function deleteAthlete(id: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(athletePrivateDoc(id));
  batch.delete(athleteDoc(id));
  await batch.commit();
}
