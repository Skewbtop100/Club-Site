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
    // AN ERROR IS AN ERROR. This used to answer 200 with { events: {} } —
    // which every caller reads as "no round is open" — so during a
    // Firestore hiccup athletes were told their open round was closed, and
    // the solve page's fail-closed handling never fired. 503: the lookup is
    // temporarily unavailable and worth retrying. Callers show that as its
    // own state with a retry, never as a closed round.
    console.error('round-access lookup failed:', e);
    return NextResponse.json(
      {
        error: 'round-access-unavailable',
        message: 'Раундын мэдээллийг шалгаж чадсангүй. Түр хүлээгээд дахин оролдоно уу.',
      },
      { status: 503 },
    );
  }
}
