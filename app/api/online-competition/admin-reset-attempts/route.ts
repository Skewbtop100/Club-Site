import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { resetAthleteRoundAttempts } from '@/lib/online-competition/reset-attempts';

// Admin-only: deletes one athlete's attempts for one event in one
// competition round, so a competition can be run through again without
// re-registering anyone. Triggered from the review grid's row control —
// the grid already shows exactly this scope.
//
// Admin SDK behind the shared password cookie, same reasoning as
// app/api/online-competition/review/route.ts: there is no Firebase Auth
// admin identity here, and firestore.rules denies onlineSubmissions
// deletes to every client, so this route is the only path. Nothing
// client-callable can reach resetAthleteRoundAttempts — it imports
// firebase-admin, which cannot load in a browser bundle.
//
// POST, not DELETE, and modelled on admin-recompute-points: the scope is
// four fields, which belong in a body rather than smuggled into a path or
// a query string.
export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { competitionId?: string; uid?: string; event?: string; competitionRound?: number }
    | null;

  // Every field is required and none is defaulted. A missing competitionId
  // or event would silently widen the delete to "this athlete's whole
  // history", and a defaulted round would hit round 1 — the one most
  // likely to hold real results.
  if (!body?.competitionId || !body.uid || !body.event) {
    return NextResponse.json({ error: 'Missing competitionId, uid or event' }, { status: 400 });
  }
  if (!Number.isInteger(body.competitionRound) || (body.competitionRound as number) < 1) {
    return NextResponse.json({ error: 'Invalid competitionRound' }, { status: 400 });
  }

  const result = await resetAthleteRoundAttempts({
    competitionId: body.competitionId,
    uid: body.uid,
    event: body.event,
    competitionRound: body.competitionRound as number,
  });

  console.warn(
    `[online-competition] attempt reset: ${result.deleted} submission(s) deleted ` +
      `(${result.judged} already judged) for uid ${body.uid}, event ${body.event}, ` +
      `round ${body.competitionRound} of competition ${body.competitionId}. ` +
      `Cloudinary: ${result.videosDeleted} deleted, ${result.videosFailed} failed.`,
  );

  return NextResponse.json({ ok: true, ...result });
}
