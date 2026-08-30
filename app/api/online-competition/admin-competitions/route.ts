import { NextResponse } from 'next/server';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { normalizeCompetitionStatus, toFirestoreDoc, validateCompetitionInput } from '@/lib/online-competition/admin-competitions';
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

  const competitions: OnlineCompetitionAdminView[] = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name ?? '',
        description: data.description ?? '',
        startAt: data.startAt?.toMillis?.() ?? null,
        registrationDeadline: data.registrationDeadline?.toMillis?.() ?? null,
        participantLimit: typeof data.participantLimit === 'number' ? data.participantLimit : null,
        events: Array.isArray(data.events) ? data.events : [],
        status: normalizeCompetitionStatus(data.status),
        createdAt: data.createdAt?.toMillis?.() ?? null,
        participantCount: await countDistinctParticipants(db, d.id),
        season: typeof data.season === 'string' ? data.season : '',
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

  const db = getOnlineCompAdminDb();
  const docRef = await db.collection('onlineCompetitions').add({
    ...toFirestoreDoc(result.data),
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ id: docRef.id });
}
