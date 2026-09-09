import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { normalizeCompetitionStatus, validateCompetitionInput, writeCompetitionDoc } from '@/lib/online-competition/admin-competitions';
import { resolveEventLiveRounds } from '@/lib/online-competition/round-access';
import { DEFAULT_COMPETITION_FORMAT } from '@/lib/online-competition/types';
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
  // Always computed here (unlike the list endpoint, which only pays for
  // live competitions): this single-competition response also backs the
  // edit form's "switching to live with no round open" confirmation,
  // which by definition asks about a competition that is not live yet.
  const liveRounds = await resolveEventLiveRounds(db, id);
  const competition: OnlineCompetitionAdminView = {
    id: snap.id,
    name: data.name ?? '',
    description: data.description ?? '',
    startAt: data.startAt?.toMillis?.() ?? null,
    registrationDeadline: data.registrationDeadline?.toMillis?.() ?? null,
    participantLimit: typeof data.participantLimit === 'number' ? data.participantLimit : null,
    events: Array.isArray(data.events) ? data.events : [],
    status: normalizeCompetitionStatus(data.status),
    registrationOpensAt: data.registrationOpensAt?.toMillis?.() ?? null,
    endAt: data.endAt?.toMillis?.() ?? null,
    format: typeof data.format === 'string' && data.format ? data.format : DEFAULT_COMPETITION_FORMAT,
    featured: data.featured === true,
    featuredHeading: typeof data.featuredHeading === 'string' ? data.featuredHeading : '',
    featuredCtaLabel: typeof data.featuredCtaLabel === 'string' ? data.featuredCtaLabel : '',
    featuredUntil: data.featuredUntil?.toMillis?.() ?? null,
    instructions: typeof data.instructions === 'string' ? data.instructions : '',
    paid: data.paid === true,
    createdAt: data.createdAt?.toMillis?.() ?? null,
    // Neither count is needed for the edit form (only the list view shows
    // them) — skip the extra queries here.
    participantCount: 0,
    registeredCount: 0,
    season: typeof data.season === 'string' ? data.season : '',
    eventsWithoutLiveRound: liveRounds
      .filter((e) => e.liveRound === null)
      .map((e) => ({ eventId: e.eventId, label: e.label })),
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

  // Same shared writer as POST — keeps `featured` exclusive, and keeps the
  // merge:true semantics this route has always had.
  const db = getOnlineCompAdminDb();
  await writeCompetitionDoc(db, id, result.data);

  return NextResponse.json({ ok: true });
}
