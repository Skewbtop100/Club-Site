import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  CompetitionWriteError,
  lockedFormatEventIds,
  normalizeCompetitionStatus,
  validateCompetitionInput,
  writeCompetitionDoc,
} from '@/lib/online-competition/admin-competitions';
import { resolveEventLiveRounds } from '@/lib/online-competition/round-access';
import { DEFAULT_COMPETITION_FORMAT } from '@/lib/online-competition/types';
import { resolveResultFormat } from '@/lib/online-competition/ao5';
import type { OnlineCompetitionEventConfig } from '@/lib/online-competition/types';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';

/** Stored events, with resultFormat resolved. Every event saved before
 *  that field existed reads back as 'ao5' — the read-time default, so no
 *  backfill is needed (same pattern as normalizeCompetitionStatus). */
function normalizeStoredEvents(raw: unknown): OnlineCompetitionEventConfig[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((e) => ({
    eventId: typeof e?.eventId === 'string' ? e.eventId : '',
    label: typeof e?.label === 'string' ? e.label : '',
    rounds: typeof e?.rounds === 'number' ? e.rounds : 1,
    resultFormat: resolveResultFormat(e?.resultFormat),
    // null = no limit. Never defaulted to a real value.
    timeLimitCs: typeof e?.timeLimitCs === 'number' ? e.timeLimitCs : null,
    // Per-round cutoffs; absent/empty means none anywhere.
    cutoffs: Array.isArray(e?.cutoffs) ? (e.cutoffs as OnlineCompetitionEventConfig['cutoffs']) : [],
    advancement: Array.isArray(e?.advancement) ? (e.advancement as OnlineCompetitionEventConfig['advancement']) : [],
  }));
}

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
  // One extra query, only on the endpoint the EDITOR loads, so the ФОРМАТ
  // control can be disabled with a reason instead of the admin finding out
  // by having their save refused.
  const lockedEventIds = await lockedFormatEventIds(db, id);
  const competition: OnlineCompetitionAdminView = {
    id: snap.id,
    name: data.name ?? '',
    description: data.description ?? '',
    startAt: data.startAt?.toMillis?.() ?? null,
    registrationDeadline: data.registrationDeadline?.toMillis?.() ?? null,
    participantLimit: typeof data.participantLimit === 'number' ? data.participantLimit : null,
    events: normalizeStoredEvents(data.events),
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
    posterUrl: typeof data.posterUrl === 'string' && data.posterUrl ? data.posterUrl : null,
    posterPublicId: typeof data.posterPublicId === 'string' && data.posterPublicId ? data.posterPublicId : null,
    bannerUrl: typeof data.bannerUrl === 'string' && data.bannerUrl ? data.bannerUrl : null,
    bannerPublicId: typeof data.bannerPublicId === 'string' && data.bannerPublicId ? data.bannerPublicId : null,
    createdAt: data.createdAt?.toMillis?.() ?? null,
    // Neither count is needed for the edit form (only the list view shows
    // them) — skip the extra queries here.
    participantCount: 0,
    registeredCount: 0,
    season: typeof data.season === 'string' ? data.season : '',
    lockedEventIds,
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
  try {
    await writeCompetitionDoc(db, id, result.data);
  } catch (err) {
    // The resultFormat lock — a reason only the stored document knows.
    if (err instanceof CompetitionWriteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
