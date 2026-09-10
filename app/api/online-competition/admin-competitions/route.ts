import { NextResponse } from 'next/server';
import { type Firestore } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  CompetitionWriteError,
  normalizeCompetitionStatus,
  normalizeStoredEvents,
  normalizeStoredSections,
  validateCompetitionInput,
  writeCompetitionDoc,
} from '@/lib/online-competition/admin-competitions';
import { resolveEventLiveRounds } from '@/lib/online-competition/round-access';
import { DEFAULT_COMPETITION_FORMAT } from '@/lib/online-competition/types';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';

// Distinct-uid count of onlineSubmissions for this competition — a
// submissions-based proxy for "participants" (see OnlineCompetitionAdminView
// in lib/online-competition/types.ts for why: there's no separate
// registration collection yet).
async function countDistinctParticipants(db: Firestore, competitionId: string): Promise<number> {
  const snap = await db
    .collection('onlineSubmissions')
    .where('competitionId', '==', competitionId)
    .select('uid')
    .get();
  const uids = new Set<string>();
  snap.docs.forEach((d) => {
    const uid = d.get('uid');
    if (typeof uid === 'string') uids.add(uid);
  });
  return uids.size;
}

/** competitionId -> how many athletes have REGISTERED, in ONE query for
 *  the whole list rather than one per competition.
 *
 *  The grandparent guard is load-bearing: the club site has an unrelated
 *  top-level `registrations` collection that a bare collectionGroup query
 *  also matches (see the same guard in scramble-roster.ts). */
async function countRegistrationsByCompetition(db: Firestore): Promise<Map<string, number>> {
  const snap = await db.collectionGroup('registrations').get();
  const counts = new Map<string, number>();
  for (const d of snap.docs) {
    if (d.ref.parent.parent?.parent.id !== 'onlineParticipants') continue;
    const competitionId = d.get('competitionId');
    if (typeof competitionId !== 'string') continue;
    counts.set(competitionId, (counts.get(competitionId) ?? 0) + 1);
  }
  return counts;
}

export async function GET() {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getOnlineCompAdminDb();
  // No server-side orderBy: the original test-comp-1 seed doc predates the
  // createdAt field, and Firestore silently excludes docs missing the
  // orderBy field from the results — sorting in JS (nulls last) keeps it
  // visible in the admin list instead of vanishing.
  const snap = await db.collection('onlineCompetitions').get();
  const registeredByCompetition = await countRegistrationsByCompetition(db);

  const competitions: OnlineCompetitionAdminView[] = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      const status = normalizeCompetitionStatus(data.status);
      // Only live competitions can strand an athlete on the blocked
      // screen, and this costs a roundState subcollection read each — so
      // the others report an empty gap list rather than paying for it.
      const liveRounds = status === 'live' ? await resolveEventLiveRounds(db, d.id) : [];
      return {
        id: d.id,
        name: data.name ?? '',
        description: data.description ?? '',
        startAt: data.startAt?.toMillis?.() ?? null,
        registrationDeadline: data.registrationDeadline?.toMillis?.() ?? null,
        participantLimit: typeof data.participantLimit === 'number' ? data.participantLimit : null,
        events: normalizeStoredEvents(data.events),
        status,
        registrationOpensAt: data.registrationOpensAt?.toMillis?.() ?? null,
        endAt: data.endAt?.toMillis?.() ?? null,
        format: typeof data.format === 'string' && data.format ? data.format : DEFAULT_COMPETITION_FORMAT,
        featured: data.featured === true,
        featuredHeading: typeof data.featuredHeading === 'string' ? data.featuredHeading : '',
        featuredCtaLabel: typeof data.featuredCtaLabel === 'string' ? data.featuredCtaLabel : '',
        featuredUntil: data.featuredUntil?.toMillis?.() ?? null,
        instructions: typeof data.instructions === 'string' ? data.instructions : '',
        paid: data.paid === true,
        baseFeeMnt: typeof data.baseFeeMnt === 'number' ? data.baseFeeMnt : null,
        posterUrl: typeof data.posterUrl === 'string' && data.posterUrl ? data.posterUrl : null,
        posterPublicId: typeof data.posterPublicId === 'string' && data.posterPublicId ? data.posterPublicId : null,
        bannerUrl: typeof data.bannerUrl === 'string' && data.bannerUrl ? data.bannerUrl : null,
        bannerPublicId: typeof data.bannerPublicId === 'string' && data.bannerPublicId ? data.bannerPublicId : null,
        // Returned in FULL here, unlike lockedEventIds below. This is
        // stored content, not a derived hint: handing the list an empty
        // array would be handing a future writer an empty structure to
        // save back over a real one.
        sections: normalizeStoredSections(data.sections),
        createdAt: data.createdAt?.toMillis?.() ?? null,
        participantCount: await countDistinctParticipants(db, d.id),
        registeredCount: registeredByCompetition.get(d.id) ?? 0,
        season: typeof data.season === 'string' ? data.season : '',
        // Not computed here — the list has no format editor and this
        // would cost a query per competition. See the field's comment.
        lockedEventIds: [],
        eventsWithoutLiveRound: liveRounds
          .filter((e) => e.liveRound === null)
          .map((e) => ({ eventId: e.eventId, label: e.label })),
      };
    }),
  );

  competitions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return NextResponse.json({ competitions });
}

export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const result = validateCompetitionInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // writeCompetitionDoc allocates the id, stamps createdAt, and keeps
  // `featured` exclusive across the collection — see its comment.
  const db = getOnlineCompAdminDb();
  try {
    const id = await writeCompetitionDoc(db, null, result.data);
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof CompetitionWriteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
