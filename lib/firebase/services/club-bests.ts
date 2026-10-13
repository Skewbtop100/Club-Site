import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';
import { getAllResults } from '@/lib/firebase/services/results';
import { getCompetitions } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { computeClubBests, type ClubBests } from '@/lib/club-bests';

// settings/clubBests — one document holding every club athlete's personal
// bests and the club records, from finished competitions (lib/club-bests.ts).
// Public to read like the rest of `settings` (it is derived entirely from
// results that are public already), admin-only to write.

const clubBestsDoc = doc(db, COL.SETTINGS, 'clubBests');

export interface ClubBestsDoc extends ClubBests {
  updatedAt: Date | null;
}

/** The stored summary, or null when it has never been computed. One read. */
export async function getClubBests(): Promise<ClubBestsDoc | null> {
  const snap = await getDoc(clubBestsDoc);
  if (!snap.exists()) return null;
  const data = snap.data();
  const updatedAt = data.updatedAt as { toDate?: () => Date } | undefined;
  return { athletes: data.athletes || {}, club: data.club || {}, updatedAt: updatedAt?.toDate?.() ?? null };
}

/**
 * Admin: rebuild the summary from scratch — every result, every competition,
 * the current roster — and store it. A full recompute rather than an
 * increment on purpose: it can't drift, and it absorbs results that were
 * edited or deleted after their competition finished. Costs one read of the
 * whole results collection, so it runs only when a competition is finished
 * and from the "recalculate" button, never from a public page.
 */
export async function recomputeClubBests(): Promise<{ athletes: number; events: number }> {
  const [results, competitions, athletes] = await Promise.all([getAllResults(), getCompetitions(), getAthletes()]);
  const bests = computeClubBests(
    results,
    new Set(competitions.filter(c => c.status === 'finished').map(c => c.id)),
    new Set(athletes.map(a => a.id)),
  );
  await setDoc(clubBestsDoc, { ...bests, updatedAt: Timestamp.now() });
  return { athletes: Object.keys(bests.athletes).length, events: Object.keys(bests.club).length };
}
