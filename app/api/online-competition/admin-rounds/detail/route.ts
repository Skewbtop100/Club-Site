import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { attemptsForFormat, resolveResultFormat } from '@/lib/online-competition/ao5';
import { normalizeStoredEvents } from '@/lib/online-competition/competition-shape';
import { eligibleAthletesForRound } from '@/lib/online-competition/round-readiness';
import { roundRosterProgress, type RosterProgressRow } from '@/lib/online-competition/round-roster-progress';
import { toAdminJudged } from '@/lib/online-competition/round-submissions';
import type { JudgedSubmission } from '@/lib/online-competition/live-view';

// ── One round, athlete by athlete ───────────────────────────────────────
// GET /api/online-competition/admin-rounds/detail?competitionId=&eventId=&round=
//
// Admin-cookie gated, Admin SDK only — the same posture as the round list
// beside it, and for the same reason: the round's roster is not publicly
// readable, and neither is a pending submission.
//
// SEPARATE FROM THE LIST deliberately. The list already computes these rows
// for every round in order to count them, but it returns only the counts:
// sending every athlete of every round would grow the page's payload with
// the competition, when the admin opens one round at a time. This endpoint
// pays for one round.
//
// ITS NUMBERS CANNOT DISAGREE WITH THE LIST'S. Both call
// roundRosterProgress over the same roster rule and the same submissions —
// the only difference is that this one also sends the rows, and resolves
// athlete names for them.

export interface RoundDetailAthlete extends RosterProgressRow {
  /** The name an admin recognises. Falls back to a shortened uid for an
   *  athlete with no display name on their profile — never blank, because
   *  a nameless row is one the admin cannot act on. */
  displayName: string;
}

export interface RoundDetailView {
  eventId: string;
  label: string;
  round: number;
  /** attemptsForFormat — how many columns the table has. */
  attempts: number;
  participants: number;
  complete: number;
  incomplete: number;
  notStarted: number;
  pendingSubmissions: number;
  pendingAthletes: number;
  athletes: RoundDetailAthlete[];
}

export async function GET(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const competitionId = params.get('competitionId') ?? '';
  const eventId = params.get('eventId') ?? '';
  const round = Number(params.get('round'));
  if (!competitionId || !eventId || !Number.isInteger(round) || round < 1) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compSnap = await db.collection('onlineCompetitions').doc(competitionId).get();
  if (!compSnap.exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }

  const event = normalizeStoredEvents(compSnap.get('events')).find((e) => e.eventId === eventId);
  if (!event) {
    return NextResponse.json({ error: 'Энэ тэмцээнд тухайн төрөл байхгүй.' }, { status: 404 });
  }
  if (round > Math.max(1, event.rounds)) {
    return NextResponse.json({ error: 'Тухайн раунд тохируулаагүй байна.' }, { status: 404 });
  }

  const format = resolveResultFormat(event.resultFormat);
  const attempts = attemptsForFormat(format);

  const [roster, subsSnap] = await Promise.all([
    // THE SAME RESOLVER the open guard uses, called directly here rather
    // than re-derived: round 1 is everyone registered for the event, round
    // 2+ is those of them in the previous round's qualifiers.
    eligibleAthletesForRound(db, competitionId, eventId, round),
    // This round only. Two equality filters, which Firestore serves by
    // merging single-field indexes — no composite index, and the same shape
    // collectRoundResults already runs in production.
    db
      .collection('onlineSubmissions')
      .where('competitionId', '==', competitionId)
      .where('competitionRound', '==', round)
      .get(),
  ]);

  const submissions: JudgedSubmission[] = [];
  for (const d of subsSnap.docs) {
    const judged = toAdminJudged(d.data());
    // The query cannot filter on `event` as well without a composite index
    // that would only exist for this one call, so it is filtered here.
    if (judged && judged.event === eventId) submissions.push(judged);
  }

  const progress = roundRosterProgress(
    roster.map((a) => a.uid),
    submissions,
    {
      format,
      attempts,
      timeLimitCs: typeof event.timeLimitCs === 'number' ? event.timeLimitCs : null,
      cutoffCs: (event.cutoffs ?? []).find((c) => c.round === round)?.cutoffCs ?? null,
    },
  );

  // eligibleAthletesForRound already carries the names it resolved through
  // the scramble roster, so no second profile read happens here.
  const nameByUid = new Map(roster.map((a) => [a.uid, a.displayName]));
  const view: RoundDetailView = {
    eventId,
    label: event.label || eventId.toUpperCase(),
    round,
    attempts,
    participants: progress.participants,
    complete: progress.complete,
    incomplete: progress.incomplete,
    notStarted: progress.notStarted,
    pendingSubmissions: progress.pendingSubmissions,
    pendingAthletes: progress.pendingAthletes,
    athletes: progress.rows.map((r) => ({
      ...r,
      displayName: nameByUid.get(r.uid)?.trim() || r.uid.slice(0, 10),
    })),
  };

  return NextResponse.json(view);
}
