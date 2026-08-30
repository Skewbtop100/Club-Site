import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { normalizeCompetitionStatus, toFirestoreDoc, validateCompetitionInput } from '@/lib/online-competition/admin-competitions';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getOnlineCompAdminDb();
  const snap = await db.collection('onlineCompetitions').doc(id).get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const data = snap.data()!;
  const competition: OnlineCompetitionAdminView = {
    id: snap.id,
    name: data.name ?? '',
    description: data.description ?? '',
    startAt: data.startAt?.toMillis?.() ?? null,
    registrationDeadline: data.registrationDeadline?.toMillis?.() ?? null,
    participantLimit: typeof data.participantLimit === 'number' ? data.participantLimit : null,
    events: Array.isArray(data.events) ? data.events : [],
    status: normalizeCompetitionStatus(data.status),
    createdAt: data.createdAt?.toMillis?.() ?? null,
    // Not needed for the edit form (only the list view shows it) — skip
    // the extra onlineSubmissions query here.
    participantCount: 0,
    season: typeof data.season === 'string' ? data.season : '',
  };

  return NextResponse.json({ competition });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = validateCompetitionInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  await db.collection('onlineCompetitions').doc(id).set(toFirestoreDoc(result.data), { merge: true });

  return NextResponse.json({ ok: true });
}
