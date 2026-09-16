import { NextResponse } from 'next/server';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { isCompetingRegistration } from '@/lib/online-competition/registration-shape';
import { normalizeCompetitionStatus } from '@/lib/online-competition/admin-competitions';
import { isPubliclyVerified } from '@/lib/online-competition/verification';

// ── Public athlete counts, every competition at once ────────────────────
// GET /api/online-competition/competitions/athlete-counts
//
// PUBLIC, no auth. Exists for the competitions list's ТАМИРЧИН column,
// which showed a literal "—" for every row: registrations live under
// onlineParticipants/{uid}/registrations, readable by their OWNER ONLY, so
// no client can count them and there is no public per-competition count in
// the competition document.
//
// WHY NOT the per-competition roster route: it answers exactly this
// question (its `approvedCount`), but each call does a full unfiltered
// collection-group read — a filtered one needs a COLLECTION_GROUP index
// this project does not have, see countRegistrationsFor in
// admin-competitions.ts — so a list of N competitions would cost N full
// scans. This does ONE scan and buckets it by competitionId.
//
// It counts the SAME athletes the roster route lists, by the same two
// rules, so a row's count and the detail page's ТАМИРЧИН agree:
//   - APPROVED registrations only (a pending one may still be refused)
//   - PUBLICLY VERIFIED athletes only (an unverified athlete is not
//     published, so they are not counted either)

export interface CompetitionAthleteCounts {
  /** competitionId -> athlete count. Every non-draft competition is
   *  present, including those with none (0) — so a missing key means the
   *  competition is not public, never "not counted yet". */
  counts: Record<string, number>;
}

export async function GET() {
  const db = getOnlineCompAdminDb();

  // Drafts are unannounced. fetchAllCompetitions filters them out and the
  // roster route 404s them; their counts must not be the one public thing
  // about them either. Read the ids first so the buckets below can only
  // ever be keyed by a public competition.
  const compSnap = await db.collection('onlineCompetitions').get();
  const counts: Record<string, number> = {};
  for (const doc of compSnap.docs) {
    if (normalizeCompetitionStatus(doc.get('status')) === 'draft') continue;
    counts[doc.id] = 0;
  }

  const snap = await db.collectionGroup('registrations').get();
  const matches = snap.docs.filter((d) => {
    // Only documents under onlineParticipants: this database has an
    // unrelated top-level `registrations` collection.
    if (d.ref.parent.parent?.parent.id !== 'onlineParticipants') return false;
    const competitionId = d.data().competitionId;
    return (
      typeof competitionId === 'string' &&
      // Keyed off the map built above, so a registration pointing at a
      // draft (or a deleted) competition is dropped rather than creating
      // an entry for it.
      Object.prototype.hasOwnProperty.call(counts, competitionId) &&
      isCompetingRegistration(d.data().status)
    );
  });

  const uids = [...new Set(matches.map((d) => d.ref.parent.parent!.id))];
  const profiles =
    uids.length > 0
      ? await db.getAll(...uids.map((uid) => db.collection('onlineParticipants').doc(uid)))
      : [];
  const verified = new Set(
    profiles.filter((p) => isPubliclyVerified(p.data() ?? {})).map((p) => p.id),
  );

  // Counted per (competition, athlete), not per document: two approved
  // registration docs for one athlete in one competition is one athlete.
  const seen = new Set<string>();
  for (const d of matches) {
    const uid = d.ref.parent.parent!.id;
    if (!verified.has(uid)) continue;
    const competitionId = d.data().competitionId as string;
    const key = `${competitionId}\u0000${uid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[competitionId] += 1;
  }

  const payload: CompetitionAthleteCounts = { counts };

  // Same cache posture as the roster route, for the same reasons: the
  // inputs only move when an admin approves a registration or verifies a
  // profile, and no `max-age` means an athlete who reloads after being
  // approved is not served their own browser's stale copy.
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
