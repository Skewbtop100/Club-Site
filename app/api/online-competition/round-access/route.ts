import { NextResponse } from 'next/server';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  resolveRoundAccessForCompetition,
  type RoundAccess,
} from '@/lib/online-competition/round-access';
import { AthleteAuthError, requireAthlete } from '@/lib/online-competition/athlete-auth';

// firebase-admin (token verification and the Firestore reads) does not run
// on edge.
export const runtime = 'nodejs';

// Read-only companion to the solve flow's gating: tells the athlete's
// dashboard, per event, which round is live and whether they may attempt
// it. Deliberately the SAME resolver the scramble route enforces with, so
// the dashboard can never offer "Эхлүүлэх" for something that would then
// be refused.
//
// No admin cookie — this answers a question about the ATHLETE ASKING, and
// it now proves who that is. It used to take `?uid=` unverified, which
// made it a free probe: anyone could ask whether a given uid had qualified
// for a round. Lower stakes than handing out someone else's scramble, but
// it shares the resolver with that route and there is no reason to leave
// half of a pair unverified.
//
// The uid parameter is GONE, not cross-checked — same reasoning as the
// scramble route.
export async function GET(req: Request) {
  let uid: string;
  try {
    uid = await requireAthlete(req);
  } catch (e) {
    if (e instanceof AthleteAuthError) {
      return NextResponse.json({ error: e.reason }, { status: e.status });
    }
    throw e;
  }

  const url = new URL(req.url);
  const competitionId = url.searchParams.get('competitionId') ?? '';
  if (!competitionId) {
    return NextResponse.json({ error: 'Missing competitionId' }, { status: 400 });
  }

  try {
    const db = getOnlineCompAdminDb();
    const events: Record<string, RoundAccess> = await resolveRoundAccessForCompetition(
      db,
      competitionId,
      uid,
    );
    return NextResponse.json({ events });
  } catch (e) {
    // The dashboard falls back to its previous behaviour when this fails,
    // so a lookup problem degrades the badge rather than the page.
    console.error('round-access lookup failed:', e);
    return NextResponse.json({ events: {} });
  }
}
