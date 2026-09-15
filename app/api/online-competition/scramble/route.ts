import { NextResponse } from 'next/server';
import cstimer from 'cstimer_module';
import { scrambleConfigFor } from '@/lib/online-competition/scramble-types';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  authorizeScrambleRequest,
  parseRequestedAttempt,
  recordScrambleServed,
} from '@/lib/online-competition/scramble-gate';
import { AthleteAuthError, requireAthlete } from '@/lib/online-competition/athlete-auth';

// firebase-admin does not run on edge, and both the token verification and
// the Firestore reads below need it. Stated rather than inherited from the
// default.
export const runtime = 'nodejs';
// The gate may wait, bounded at 15 seconds, for the athlete's previous
// attempt to finish filing — see decideScrambleAttempt.
export const maxDuration = 30;

// Server-side scramble source for the public online-competition feature.
// Separate route from app/api/scramble/route.ts (the club's internal one) —
// kept independent so this feature never shares code paths with the club's
// competition/practice system, even though both wrap cstimer_module.
//
// EVERY DECISION IS THE GATE'S (lib/online-competition/scramble-gate.ts):
//   1. the athlete's registration is approved, for this event;
//   2. a round is live for the event and they may attempt it (qualifiers);
//   3. WHICH ATTEMPT — derived from what they have already filed, with
//      planResume. The `attempt` parameter never selects a scramble;
//   4. which scramble — their group's official one, or random when the
//      round has no import.
// This file only authenticates, generates a random scramble when the gate
// says there is no official one, records the run ticket, and answers.
//
// THE RUN TICKET is what firestore.rules requires before a submission for
// this round and attempt can be created. It is written before the scramble
// is returned: a scramble whose attempt could not then be filed is worse
// than no scramble.
//
// FAILS CLOSED. Anything that throws — the registration read, the round
// gate, the ticket write — is a 500 with no scramble and no `message`, so
// the solve page shows its retryable error rather than replacing the run.

export async function GET(req: Request) {
  // ── WHO IS ASKING ──────────────────────────────────────────────────
  // From the Authorization header, verified, and from nowhere else.
  //
  // A 401 from here carries `error` and NO `message`. That distinction is
  // load-bearing for the client: `message` is the gate's own Mongolian
  // explanation, which is a final answer worth replacing the screen with.
  // An auth failure is a transient thing to retry with a fresh token, and
  // the solve flow must not tear a run down over it.
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
  const eventId = url.searchParams.get('event');
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event param' }, { status: 400 });
  }
  const cfg = scrambleConfigFor(eventId);
  if (!cfg) {
    return NextResponse.json({ error: `Unsupported event: ${eventId}` }, { status: 400 });
  }

  // REQUIRED. There is no "generator only" mode without a competition.
  const competitionId = url.searchParams.get('competitionId') ?? '';
  if (!competitionId) {
    return NextResponse.json({ error: 'Missing competitionId param' }, { status: 400 });
  }
  // What the CLIENT believes the attempt is. The gate compares it with the
  // attempt it derives, and never serves anything else.
  const requestedAttempt = parseRequestedAttempt(url.searchParams.get('attempt'));

  try {
    const db = getOnlineCompAdminDb();
    const decision = await authorizeScrambleRequest(db, { competitionId, eventId, uid, requestedAttempt });
    if (!decision.ok) {
      return NextResponse.json(
        {
          error: decision.error,
          message: decision.message,
          ...(decision.liveRound !== undefined ? { liveRound: decision.liveRound } : {}),
          ...(decision.nextAttempt !== undefined ? { nextAttempt: decision.nextAttempt } : {}),
        },
        { status: decision.status },
      );
    }

    const source = decision.official ? 'group' : 'random';
    const text = decision.official ? decision.official.scramble : cstimer.getScramble(cfg.type, cfg.len ?? 0);

    // The ticket, then the scramble — never the other way round.
    await recordScrambleServed(db, {
      competitionId,
      uid,
      eventId,
      round: decision.round,
      attempt: decision.attempt,
    });

    return NextResponse.json({
      scramble: text,
      source,
      round: decision.round,
      attempt: decision.attempt,
      ...(decision.official ? { groupLabel: decision.official.groupLabel } : {}),
    });
  } catch (e) {
    console.error('scramble: the gate could not be evaluated, refusing:', e);
    return NextResponse.json({ error: 'gate-unavailable' }, { status: 500 });
  }
}
