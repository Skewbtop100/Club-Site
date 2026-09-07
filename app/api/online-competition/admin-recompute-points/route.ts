import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { recomputeSeasonPointsForCompetition } from '@/lib/online-competition/seasonPoints';
import { recomputeAthleteStatsForCompetition } from '@/lib/online-competition/athleteStats';

// Admin-triggered recompute (the "Онооны тооцоо шинэчлэх" button per
// finished competition in CompetitionsList) — deliberately not a live
// aggregation on every hub page load. Cheaper, and gives the admin a
// clear moment to re-run it after approving more submissions.
export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { competitionId?: string } | null;
  if (!body?.competitionId) {
    return NextResponse.json({ error: 'Missing competitionId' }, { status: 400 });
  }

  // Per-athlete stats run FIRST and independently: a PR is a fact about
  // an athlete's solves, not about a season, and the points recompute
  // below throws outright when the competition has no `season` set. Doing
  // stats first means a season-less competition still updates PRs.
  let stats: Awaited<ReturnType<typeof recomputeAthleteStatsForCompetition>> | null = null;
  let statsError: string | null = null;
  try {
    stats = await recomputeAthleteStatsForCompetition(body.competitionId);
  } catch (err) {
    statsError = err instanceof Error ? err.message : 'Stats failed';
  }

  try {
    const result = await recomputeSeasonPointsForCompetition(body.competitionId);
    return NextResponse.json({ ...result, stats, statsError });
  } catch (err) {
    const pointsError = err instanceof Error ? err.message : 'Failed';
    // Points failed, but stats may well have succeeded — say so rather
    // than letting the admin think nothing happened.
    return NextResponse.json(
      {
        error: stats
          ? `${pointsError} (статистик шинэчлэгдсэн: ${stats.athletesUpdated} тамирчин)`
          : pointsError,
        stats,
        statsError,
      },
      { status: 400 },
    );
  }
}
