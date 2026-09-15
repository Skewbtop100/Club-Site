import { NextResponse } from 'next/server';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { AthleteAuthError, bearerToken, requireAthlete } from '@/lib/online-competition/athlete-auth';
import { normalizeCompetitionStatus } from '@/lib/online-competition/admin-competitions';
import { normalizeStoredEvents, normalizeStoredSchedule } from '@/lib/online-competition/competition-shape';
import { normalizeRegistrationStatus, registrationEvents } from '@/lib/online-competition/registration-shape';
import { attemptsForFormat, resolveResultFormat } from '@/lib/online-competition/ao5';
import { fetchRoundStates } from '@/lib/online-competition/round-results';
import { resolveRoundAccess } from '@/lib/online-competition/round-access';
import { roundKey } from '@/lib/online-competition/scrambles';
import { planResume, runShapeFor, type FiledAttempt, type ResumeKind } from '@/lib/online-competition/run-resume';
import { publicRosterName } from '@/lib/online-competition/roster-view';
import { roundLabel } from '@/lib/online-competition/detail-view';
import {
  attemptSlots,
  rankJudgedStandings,
  scheduledRoundStartMs,
  scheduledRoundStarts,
  type AttemptSlot,
  type JudgedSubmission,
  type LiveEventView,
  type LiveViewPayload,
  type RoundRules,
} from '@/lib/online-competition/live-view';

// firebase-admin does not run on edge.
export const runtime = 'nodejs';

// ── The athlete's live competition view ─────────────────────────────────
// GET /api/online-competition/competitions/{id}/live
//
// READ-ONLY. It has to be a route because most of what the screen needs is
// denied to clients by firestore.rules: roundState and qualifiers are
// server-only, and another athlete's submissions are owner-only. The Admin
// SDK reads them and live-view.ts decides what crosses.
//
// IDENTITY IS OPTIONAL. With no Authorization header the viewer is
// anonymous and gets the public half — round status and judged
// standings. With one, it must verify (a bad token is a 401, never a
// silent downgrade to anonymous) and the athlete's own half is added.

function toJudged(data: FirebaseFirestore.DocumentData): JudgedSubmission | null {
  if (typeof data.uid !== 'string' || typeof data.event !== 'string') return null;
  if (typeof data.round !== 'number' || typeof data.competitionRound !== 'number') return null;
  return {
    uid: data.uid,
    event: data.event,
    competitionRound: data.competitionRound,
    attempt: data.round,
    status: data.status === 'approved' || data.status === 'rejected' ? data.status : 'pending',
    reportedTime: typeof data.reportedTime === 'number' ? data.reportedTime : 0,
    isDnf: data.isDnf === true,
    penalty: data.penalty === '+2' || data.penalty === 'DNF' ? data.penalty : null,
    createdAt: data.createdAt?.toMillis?.() ?? 0,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let uid: string | null = null;
  if (bearerToken(req.headers.get('authorization')) !== null) {
    try {
      uid = await requireAthlete(req);
    } catch (e) {
      if (e instanceof AthleteAuthError) {
        return NextResponse.json({ error: e.reason }, { status: e.status });
      }
      throw e;
    }
  }

  // Per-viewer content: never let a shared cache hand one athlete's view to
  // another.
  const headers = { 'Cache-Control': 'private, no-store' };

  try {
    const db = getOnlineCompAdminDb();
    const compSnap = await db.collection('onlineCompetitions').doc(id).get();
    const status = normalizeCompetitionStatus(compSnap.get('status'));
    // A draft is not public anywhere else; it is not public here either.
    if (!compSnap.exists || status === 'draft') {
      return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404, headers });
    }

    const events = normalizeStoredEvents(compSnap.get('events'));
    const startAtMs: number | null = compSnap.get('startAt')?.toMillis?.() ?? null;
    const schedule = normalizeStoredSchedule(compSnap.get('schedule'));
    const starts = scheduledRoundStarts(schedule, startAtMs);
    // The same programme times as instants, timezone-free — what the
    // athlete's countdown and clock are built from.
    const startsMs = scheduledRoundStartMs(schedule, startAtMs);

    const [states, judgedSnap, mineSnap, regSnap] = await Promise.all([
      fetchRoundStates(db, id),
      // JUDGED — approved, and rejected (a judge's DNF): the same set, and
      // the same `in`, that collectRoundResults ranks qualifiers on.
      // PENDING is excluded at the query. `in` over two values expands to
      // equality queries on the existing (competitionId, status) index.
      db.collection('onlineSubmissions').where('competitionId', '==', id).where('status', 'in', ['approved', 'rejected']).get(),
      // The athlete's own, every status — the single-field uid filter that
      // fetchMyFiledAttempts already relies on in production; the rest is
      // an in-memory filter over one athlete's documents.
      uid ? db.collection('onlineSubmissions').where('uid', '==', uid).get() : Promise.resolve(null),
      uid ? db.collection('onlineParticipants').doc(uid).collection('registrations').doc(id).get() : Promise.resolve(null),
    ]);

    const judged = judgedSnap.docs.map((d) => toJudged(d.data())).filter((s): s is JudgedSubmission => s !== null);
    const mine = (mineSnap?.docs ?? [])
      .filter((d) => d.get('competitionId') === id)
      .map((d) => toJudged(d.data()))
      .filter((s): s is JudgedSubmission => s !== null);

    const registration =
      regSnap && regSnap.exists
        ? {
            status: normalizeRegistrationStatus(regSnap.get('status')),
            requestedEvents: registrationEvents(regSnap.data()).requested,
            events: (Array.isArray(regSnap.get('events')) ? (regSnap.get('events') as unknown[]) : []).filter(
              (e): e is string => typeof e === 'string',
            ),
          }
        : null;

    // Names for everyone on a board, with the roster's rule so the two tabs
    // never name the same athlete differently. An athlete an admin has not
    // verified keeps their row — the result stands, and the placings must
    // match the cut — but under a neutral label instead of their name;
    // the viewer always sees their own.
    const boardUids = [...new Set(judged.map((s) => s.uid))];
    const profiles =
      boardUids.length > 0 ? await db.getAll(...boardUids.map((u) => db.collection('onlineParticipants').doc(u))) : [];
    const nameByUid = new Map(
      profiles.map((p) => [p.id, publicRosterName((p.data() ?? {}) as Record<string, unknown>, p.id, uid)]),
    );
    const nameOf = (u: string) => nameByUid.get(u) ?? u.slice(0, 10);

    // The athlete's qualification INTO each round 2..N: who advanced out of
    // the round before. Only the athlete's own membership leaves this
    // route; the lists themselves stay server-side, as firestore.rules
    // intends.
    const qualifierKeys = uid
      ? events.flatMap((e) => Array.from({ length: Math.max(0, e.rounds - 1) }, (_, i) => roundKey(e.eventId, i + 1)))
      : [];
    const qualifierDocs =
      qualifierKeys.length > 0
        ? await db.getAll(...qualifierKeys.map((k) => db.collection('onlineCompetitions').doc(id).collection('qualifiers').doc(k)))
        : [];
    const advancedOut = new Map<string, boolean>();
    for (const d of qualifierDocs) {
      if (!d.exists) continue;
      const uids = d.get('uids');
      advancedOut.set(d.id, Array.isArray(uids) && uid !== null && uids.includes(uid));
    }

    const views: LiveEventView[] = [];
    for (const e of events) {
      const format = resolveResultFormat(e.resultFormat);
      const attempts = attemptsForFormat(format);
      const rulesFor = (round: number): RoundRules => ({
        format,
        attempts,
        timeLimitCs: typeof e.timeLimitCs === 'number' ? e.timeLimitCs : null,
        cutoffCs: (e.cutoffs ?? []).find((c) => c.round === round)?.cutoffCs ?? null,
      });
      const total = Math.max(1, e.rounds);

      const rounds = Array.from({ length: total }, (_, i) => {
        const round = i + 1;
        const prevKey = roundKey(e.eventId, round - 1);
        return {
          round,
          label: roundLabel(round, total),
          status: states.get(roundKey(e.eventId, round))?.status ?? 'closed',
          qualified: uid && round > 1 && advancedOut.has(prevKey) ? advancedOut.get(prevKey)! : null,
          scheduledAt: starts.get(`${e.eventId}_${round}`) ?? null,
          scheduledAtMs: startsMs.get(`${e.eventId}_${round}`) ?? null,
          standings: rankJudgedStandings(
            judged.filter((s) => s.event === e.eventId && s.competitionRound === round),
            rulesFor(round),
            nameOf,
            uid,
          ),
        };
      });

      let me: LiveEventView['me'] = null;
      if (uid) {
        const access = await resolveRoundAccess(db, id, e.eventId, uid, states);
        const myEvent = mine.filter((s) => s.event === e.eventId);

        // What the solve page will do when opened — the same planResume,
        // over the same filed attempts, with the same run shape. Computed
        // here so self-reported times are used only to decide that, and
        // never sent.
        let planKind: ResumeKind | null = null;
        let nextAttempt: number | null = null;
        if (access.liveRound !== null) {
          const filed: FiledAttempt[] = myEvent.map((s) => ({
            submissionId: '',
            attempt: s.attempt,
            competitionRound: s.competitionRound,
            reportedTime: s.reportedTime,
            isDnf: s.isDnf,
          }));
          // runShapeFor: the same shape the scramble gate plans with.
          const plan = planResume(filed, access.liveRound, runShapeFor(e, access.liveRound));
          planKind = plan.kind;
          nextAttempt = plan.nextAttempt;
        }

        const slotsByRound: Record<string, AttemptSlot[]> = {};
        const roundsWithSlots = new Set(myEvent.map((s) => s.competitionRound));
        if (access.liveRound !== null) roundsWithSlots.add(access.liveRound);
        for (const round of roundsWithSlots) {
          if (round < 1 || round > total) continue;
          slotsByRound[String(round)] = attemptSlots(
            myEvent.filter((s) => s.competitionRound === round),
            rulesFor(round),
          );
        }

        me = {
          registered: registration?.events.includes(e.eventId) ?? false,
          access,
          planKind,
          nextAttempt,
          slotsByRound,
        };
      }

      views.push({ eventId: e.eventId, label: e.label, format, attempts, rounds, me });
    }

    const payload: LiveViewPayload = {
      competitionId: id,
      status,
      signedIn: uid !== null,
      registration,
      events: views,
    };
    return NextResponse.json(payload, { headers });
  } catch (e) {
    console.error('live view lookup failed:', e);
    return NextResponse.json({ error: 'Мэдээллийг ачааллаж чадсангүй.' }, { status: 500, headers });
  }
}
