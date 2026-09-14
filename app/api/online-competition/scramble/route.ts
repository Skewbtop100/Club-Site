import { NextResponse } from 'next/server';
import cstimer from 'cstimer_module';
import { scrambleConfigFor } from '@/lib/online-competition/scramble-types';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { lookupGroupScramble } from '@/lib/online-competition/group-scramble';
import { ROUND_ACCESS_MESSAGE, resolveRoundAccess } from '@/lib/online-competition/round-access';
import { AthleteAuthError, requireAthlete } from '@/lib/online-competition/athlete-auth';

// firebase-admin does not run on edge, and both the token verification and
// the Firestore reads below need it. Stated rather than inherited from the
// default.
export const runtime = 'nodejs';

// Server-side scramble source for the public online-competition feature.
// Separate route from app/api/scramble/route.ts (the club's internal one) —
// kept independent so this feature never shares code paths with the club's
// competition/practice system, even though both wrap cstimer_module.
//
// Two sources, in order:
//   1. Official imported scrambles — when the competition has had a WCA
//      TNoodle JSON imported for this event+round AND this athlete has a
//      group assignment in it, the attempt gets that group's Nth scramble
//      (see app/online-competition/admin/scrambles).
//   2. Random cstimer generation — the original behaviour, unchanged, and
//      the fallback for every competition that never imported scrambles.
//
// NO LONGER THE FALLBACK FOR AN ATHLETE WITH NO GROUP. Once a round has
// imported scrambles it is an official round, and an athlete without an
// assignment in it is REFUSED rather than handed a random scramble: they
// would otherwise record a full set of attempts against a scramble nobody
// else had, which no judge can verify and which is only discovered at
// review, after the solving is done. A round with no import at all is
// untouched and still random for everyone.
//
// Both are gated first on ROUND ACCESS (see below): which round is live
// for this event, and whether this athlete qualified into it.
//
// The group lookup is still best-effort against FAILURE — a missing
// param or an Admin SDK exception falls through to (2), so a deployment
// without the Admin SDK env vars behaves as it did before this route
// learned about groups. What changed is that a successful lookup which
// finds no group is an answer, not a failure.

export async function GET(req: Request) {
  // ── WHO IS ASKING ──────────────────────────────────────────────────
  // From the Authorization header, verified, and from nowhere else. This
  // used to be `?uid=`, unchecked: anyone could ask for anyone's official
  // scramble — before that athlete had solved it — by editing a URL.
  //
  // The parameter is GONE rather than cross-checked against the token: a
  // parameter that must equal the token is a parameter someone will
  // eventually trust on its own.
  //
  // A 401 from here carries `error` and NO `message`. That distinction is
  // load-bearing for the client: `message` is the round gate's own
  // Mongolian explanation ("this round is not open", "you did not
  // qualify"), which is a final answer worth replacing the screen with. An
  // auth failure is a transient thing to retry with a fresh token, and the
  // solve flow must not tear a run down over it.
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

  // REQUIRED NOW. There used to be a "generator only" mode — no
  // competitionId, no uid — that skipped the round gate entirely and
  // handed out a scramble to anyone. Nothing called it: the solve page is
  // the only caller and always sends a competition, and the club site's
  // own practice scrambles come from a different route (app/api/scramble).
  // It is removed rather than left as an unauthenticated path around the
  // gate.
  const competitionId = url.searchParams.get('competitionId') ?? '';
  if (!competitionId) {
    return NextResponse.json({ error: 'Missing competitionId param' }, { status: 400 });
  }
  const attempt = Number(url.searchParams.get('attempt') ?? '1');

  // ── Round gating ───────────────────────────────────────────────────
  // The round is no longer assumed to be 1: it is whichever round the
  // admin has opened for this event (app/online-competition/admin/rounds).
  // With no live round, or with the athlete not among the previous
  // round's qualifiers, the request is REFUSED rather than quietly served
  // a round-1 scramble — that refusal is the whole point of the gate.
  //
  // Unlike the group lookup below, a failure here is NOT swallowed: if the
  // gate can't be evaluated we must not hand out a scramble, because
  // failing open would let a non-qualified athlete solve.
  const access = await resolveRoundAccess(getOnlineCompAdminDb(), competitionId, eventId, uid);
  if (!access.allowed) {
    return NextResponse.json(
      {
        error: access.reason,
        message: ROUND_ACCESS_MESSAGE[access.reason as keyof typeof ROUND_ACCESS_MESSAGE],
        liveRound: access.liveRound,
      },
      { status: access.reason === 'not-qualified' ? 403 : 409 },
    );
  }
  const round = access.liveRound ?? 1;

  if (Number.isInteger(attempt) && attempt >= 1) {
    try {
      const official = await lookupGroupScramble(getOnlineCompAdminDb(), {
        competitionId,
        eventId,
        round,
        uid,
        attempt,
      });
      if (official && 'outOfRange' in official) {
        return NextResponse.json(
          {
            error: `Attempt ${attempt} is out of range for this round (${official.max} scrambles).`,
            message: 'Энэ раундад ийм олон оролдлого байхгүй байна.',
          },
          { status: 400 },
        );
      }
      // NO GROUP IN AN OFFICIAL ROUND — refused, not served randomly.
      //
      // It reaches the athlete through the same path a round refusal
      // does: a Mongolian `message`, which the solve page shows in place
      // of the start button (the blocked screen on attempt 1, the wait
      // screen from attempt 2 on). Either way the run cannot begin, and
      // because the solve page asks for a scramble at the START of every
      // attempt, an athlete who loaded the page before being assigned is
      // checked again rather than trusted from page load.
      //
      // Nothing here touches attempts already recorded without a group:
      // those documents are untouched and still reviewable.
      if (official && 'noGroup' in official) {
        return NextResponse.json(
          {
            error: 'No group assignment for this athlete in an official round.',
            message: 'Та группэд хуваарилагдаагүй байна. Зохион байгуулагчид хандана уу.',
          },
          { status: 403 },
        );
      }
      if (official) {
        return NextResponse.json({
          scramble: official.scramble,
          source: 'group',
          round,
          groupLabel: official.groupLabel,
        });
      }
    } catch (e) {
      // A THROWN lookup still falls back to random, and that is now a
      // weaker guarantee than it reads. It used to be plainly safe: the
      // lookup only chose which scramble text to serve. It now also
      // decides whether an official round will serve this athlete at all,
      // so this catch is the one remaining way an ungrouped athlete can
      // be handed a random scramble — a Firestore error at exactly the
      // wrong moment.
      //
      // Left failing OPEN deliberately, and it is a genuine trade rather
      // than an oversight: failing closed here turns any Admin SDK blip
      // into "nobody in this competition can solve", while failing open
      // risks an unjudgeable attempt that review will catch. The
      // structured no-group answer above — the common case, and the one
      // this guard is for — is unaffected either way, because it is a
      // RESULT and never an exception.
      console.error('Group scramble lookup failed, falling back to random:', e);
    }
  }

  try {
    const scramble = cstimer.getScramble(cfg.type, cfg.len ?? 0);
    return NextResponse.json({ scramble, source: 'random', round });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
