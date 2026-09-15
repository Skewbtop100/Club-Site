import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { recomputeAthleteStatsForCompetition } from '@/lib/online-competition/athleteStats';

// Admin-triggered refresh of per-athlete stats — PR, best Ao5/Mo3, solve
// count — for everyone judged in one competition: the "Статистик шинэчлэх"
// button per finished competition in CompetitionsList. Deliberately not a
// live aggregation; the admin re-runs it after approving more submissions.
//
// This was admin-recompute-points, which also recomputed season points.
// Season points were removed; this is the half other features still read
// (the public roster's PRs and averages, the solve page's PR check, group
// seeding).
export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { competitionId?: string } | null;
  if (!body?.competitionId) {
    return NextResponse.json({ error: 'Missing competitionId' }, { status: 400 });
  }

  try {
    const stats = await recomputeAthleteStatsForCompetition(body.competitionId);
    return NextResponse.json(stats);
  } catch (err) {
    console.error('admin-recompute-stats: the stats recompute failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
