import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { recomputeSeasonPointsForCompetition } from '@/lib/online-competition/seasonPoints';

// Admin-triggered recompute (the "Онооны тооцоо шинэчлэх" button per
// finished competition in CompetitionsTab) — deliberately not a live
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

  try {
    const result = await recomputeSeasonPointsForCompetition(body.competitionId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 });
  }
}
