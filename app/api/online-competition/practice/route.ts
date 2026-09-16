import { NextResponse } from 'next/server';
import { AthleteAuthError, requireAthlete } from '@/lib/online-competition/athlete-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  PRACTICE_RUN_LIMIT,
  practiceAllowance,
  readPracticeMarks,
  type PracticeGate,
} from '@/lib/online-competition/practice';
import {
  PracticeError,
  filePracticeRun,
  listAthletePracticeRuns,
  readPracticeGate,
  type PracticeRunView,
} from '@/lib/online-competition/practice-server';
import { PRACTICE_VIDEO_KEY_PREFIX } from '@/lib/online-competition/practice-video';

export const runtime = 'nodejs';

// ── The athlete's own practice runs ─────────────────────────────────────
// GET  — their runs and how many they have left
// POST — file one, spending one of the ten
//
// BOTH REQUIRE A VERIFIED, NON-ANONYMOUS IDENTITY, and the uid comes from
// the token, never from the body: a practice run is attributed to whoever
// filed it and nobody may file for another athlete.
//
// WHY THERE IS A ROUTE AT ALL, when a competition attempt is a client write:
// the ten-run cap has to be counted, firestore.rules cannot count, and a
// counter the client could write would be forgeable (the participant rule
// validates named fields but has no keys().hasOnly, so an athlete can add
// any field to their own profile). So the collection is closed to clients
// and this is its only writer — see the rules for practiceRuns.

export interface PracticeListResponse {
  /** THE SERVER'S ANSWER to "may this athlete practise", so the page renders
   *  the state the filing route will enforce rather than guessing from its
   *  own copy of the profile. The practice area is shown only when this is
   *  allowed; the four other states are explained instead. */
  gate: PracticeGate;
  runs: PracticeRunView[];
  used: number;
  remaining: number;
  limit: number;
}

export async function GET(req: Request) {
  let uid: string;
  try {
    uid = await requireAthlete(req);
  } catch (err) {
    const status = err instanceof AthleteAuthError ? 401 : 500;
    return NextResponse.json({ error: 'Нэвтрэлт шаардлагатай.' }, { status });
  }

  const db = getOnlineCompAdminDb();
  // Both reads, or neither: an unreadable profile fails the whole request,
  // so the page shows its load error rather than a practice area it may not
  // be allowed. Runs are still listed for an unverified athlete — they are
  // the athlete's own, and hiding them would look like deletion.
  const [gate, runs] = await Promise.all([readPracticeGate(db, uid), listAthletePracticeRuns(db, uid)]);
  const allowance = practiceAllowance(runs.map((r) => r.status));
  const payload: PracticeListResponse = {
    gate,
    runs,
    used: allowance.used,
    remaining: allowance.remaining,
    limit: PRACTICE_RUN_LIMIT,
  };
  // The athlete's own list, and it changes when they file. Never cached.
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  let uid: string;
  try {
    uid = await requireAthlete(req);
  } catch (err) {
    const status = err instanceof AthleteAuthError ? 401 : 500;
    return NextResponse.json({ error: 'Нэвтрэлт шаардлагатай.' }, { status });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const event = typeof body?.event === 'string' ? body.event : '';
  const scramble = typeof body?.scramble === 'string' ? body.scramble : '';
  const videoKey = typeof body?.videoKey === 'string' ? body.videoKey : '';
  // null is legal and means the athlete never typed one — a run recorded and
  // abandoned at the keypad is still filed, because the video exists and an
  // admin will still look at it.
  const timeCs =
    body?.timeCs === null || body?.timeCs === undefined
      ? null
      : typeof body.timeCs === 'number' && Number.isInteger(body.timeCs) && body.timeCs >= 0
        ? body.timeCs
        : undefined;
  const isDnf = body?.isDnf === true;
  // THE STAGE MARKS, validated here because this collection is closed to
  // clients and the route is therefore the only place a check can live.
  // readPracticeMarks DROPS anything malformed rather than refusing the
  // run: marks are a convenience for review, and a run that cannot be
  // filed is a video thrown away.
  const marks = readPracticeMarks(body?.marks);

  if (!event || !scramble || !videoKey || timeCs === undefined) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }
  // THE KEY MUST BE ONE THIS ATHLETE WAS GRANTED. The presign route derives
  // it from the verified uid, so a key under another athlete's prefix — or
  // under the competition prefix — is a client that has gone around it.
  if (!videoKey.startsWith(`${PRACTICE_VIDEO_KEY_PREFIX}/${uid}/`)) {
    return NextResponse.json({ error: 'Бичлэгийн хаяг тохирохгүй.' }, { status: 400 });
  }

  try {
    const { id, remaining } = await filePracticeRun(getOnlineCompAdminDb(), {
      uid,
      event,
      scramble,
      timeCs,
      isDnf,
      videoKey,
      marks,
    });
    return NextResponse.json({ ok: true, id, remaining }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    // The cap, and anything else the stored state knows.
    if (err instanceof PracticeError) {
      return NextResponse.json(
        err.gate ? { error: err.message, gate: err.gate } : { error: err.message },
        { status: err.status },
      );
    }
    throw err;
  }
}
