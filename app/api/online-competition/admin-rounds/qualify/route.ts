import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { roundKey } from '@/lib/online-competition/scrambles';
import { rankRoundResults } from '@/lib/online-competition/round-results';
import { notifyRoundFinalised } from '@/lib/online-competition/notifications-server';
import {
  selectQualifiers,
  validateQualifierInput,
  type QualifierMethod,
  type RoundRanking,
  type RoundStatus,
} from '@/lib/online-competition/rounds';

// ШАЛГАРУУЛАХ — advance a round.
//
// Two modes on the same endpoint so the preview an admin approves and the
// write that follows are produced by the SAME ranking code path:
//   mode 'preview' — rank + select, return both, write nothing
//   mode 'commit'  — do it again and persist the qualifiers doc
// Re-ranking on commit (rather than trusting a uid list posted back from
// the browser) means the client can't hand-edit who advanced, and a
// submission judged between preview and commit is reflected rather than
// silently ignored.

export interface QualifyResponse {
  ranked: RoundRanking[];
  qualifiers: RoundRanking[];
  committed: boolean;
}

export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
  const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
  const round = typeof body?.round === 'number' ? body.round : NaN;
  const method: QualifierMethod | null =
    body?.method === 'count' || body?.method === 'percent' ? body.method : null;
  const value = typeof body?.value === 'number' ? body.value : NaN;
  const commit = body?.mode === 'commit';

  // A missing method is a 400, deliberately, and MUST STAY ONE.
  //
  // The competition document now carries a planned cut per round
  // transition (OnlineCompetitionEventConfig.advancement, set on the
  // admin editor's Төрөл tab). It would be easy to "helpfully" fall back
  // to it here when the body omits a method. Do not.
  //
  // That plan is an intention; roundState.qualifierMethod/qualifierValue,
  // written below at commit, is the record of what was actually applied.
  // If this route read the plan, editing the Төрөл tab later would
  // retroactively change what a re-run of ШАЛГАРУУЛАХ does, and a plan
  // edited after a commit would silently disagree with the stored record
  // with nothing marking which one produced the qualifiers. The plan
  // reaches this endpoint exactly one way: as a PREFILL in the admin's
  // form (RoundsManager's QualifyForm), which the admin sees and can
  // change before submitting. It is never an implicit server-side input.
  if (!competitionId || !eventId || !Number.isInteger(round) || round < 1 || !method) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }
  const invalid = validateQualifierInput(method, value);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  if (!(await compRef.get()).exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }

  const ranked = await rankRoundResults(db, competitionId, eventId, round);
  const qualifiers = selectQualifiers(ranked, method, value);

  if (!commit) {
    const payload: QualifyResponse = { ranked, qualifiers, committed: false };
    return NextResponse.json(payload);
  }

  const key = roundKey(eventId, round);
  const batch = db.batch();
  batch.set(compRef.collection('qualifiers').doc(key), {
    eventId,
    round,
    uids: qualifiers.map((q) => q.uid),
    qualifiedAt: FieldValue.serverTimestamp(),
  });
  // Advancing a round also ends it — there is no state where a round has
  // produced qualifiers but is still accepting attempts.
  batch.set(
    compRef.collection('roundState').doc(key),
    {
      eventId,
      round,
      status: 'done' satisfies RoundStatus,
      qualifierMethod: method,
      qualifierValue: value,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();

  // Advancing also ends the round, so this is the other moment athletes
  // are told — here with the qualifier list in hand, so those who made the
  // cut get the "шалгарлаа" wording instead of a plain result (one
  // notification either way, never two). Never throws, and its marker
  // makes a re-run of ШАЛГАРУУЛАХ send nothing a second time.
  await notifyRoundFinalised({
    competitionId,
    eventId,
    round,
    qualifiedUids: qualifiers.map((q) => q.uid),
  });

  const payload: QualifyResponse = { ranked, qualifiers, committed: true };
  return NextResponse.json(payload);
}
