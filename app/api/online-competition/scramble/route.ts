import { NextResponse } from 'next/server';
import cstimer from 'cstimer_module';
import { scrambleConfigFor } from '@/lib/online-competition/scramble-types';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { roundKey, type ScrambleGroup } from '@/lib/online-competition/scrambles';
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
//      the fallback for every competition that never imported scrambles
//      and every athlete who isn't in a group.
//
// Both are gated first on ROUND ACCESS (see below): which round is live
// for this event, and whether this athlete qualified into it.
//
// The group lookup is best-effort by construction: any missing param,
// missing doc, or Admin SDK failure falls through to (2) rather than
// failing the request, so a competition that doesn't use this feature —
// or a deployment without the Admin SDK env vars — behaves exactly as it
// did before this route learned about groups.

/** Looks up the athlete's official scramble; null means "fall back". */
type GroupScrambleLookup =
  | { scramble: string; groupLabel: string }
  /** The athlete HAS an official group, but asked for an attempt beyond
   *  the scrambles it holds — refuse rather than silently going random. */
  | { outOfRange: true; max: number }
  /** No official scramble applies (no import, or no group assignment) —
   *  random generation is the correct answer. */
  | null;

async function lookupGroupScramble(params: {
  competitionId: string;
  eventId: string;
  round: number;
  uid: string;
  attempt: number;
}): Promise<GroupScrambleLookup> {
  const { competitionId, eventId, round, uid, attempt } = params;
  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const key = roundKey(eventId, round);

  const [scrambleSnap, assignSnap] = await Promise.all([
    compRef.collection('scrambleData').doc(key).get(),
    compRef.collection('groupAssignments').doc(key).get(),
  ]);
  if (!scrambleSnap.exists || !assignSnap.exists) return null;

  const groupIndex = (assignSnap.get('assignments') ?? {})[uid];
  if (typeof groupIndex !== 'number') return null;

  const groups = scrambleSnap.get('groups');
  if (!Array.isArray(groups)) return null;
  const group = groups[groupIndex] as ScrambleGroup | undefined;
  if (!group) return null;

  // OUT OF RANGE IS AN ERROR, NOT A FALLBACK. This group has a definite
  // number of scrambles; an attempt beyond it means the caller and the
  // imported data disagree about the round's shape. Returning null here
  // would fall through to random cstimer generation and hand the athlete
  // an UNOFFICIAL scramble in an official round, silently. With a fixed 5
  // that was nearly unreachable; with per-event formats an off-by-one is
  // a real possibility, so it is surfaced instead.
  if (attempt > group.scrambles.length) {
    return { outOfRange: true as const, max: group.scrambles.length };
  }

  const scramble = group.scrambles[attempt - 1];
  if (typeof scramble !== 'string' || scramble.trim() === '') return null;

  return { scramble, groupLabel: group.label ?? '' };
}

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
      const official = await lookupGroupScramble({ competitionId, eventId, round, uid, attempt });
      if (official && 'outOfRange' in official) {
        return NextResponse.json(
          {
            error: `Attempt ${attempt} is out of range for this round (${official.max} scrambles).`,
            message: 'Энэ раундад ийм олон оролдлого байхгүй байна.',
          },
          { status: 400 },
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
      // Never fail a solve over the GROUP lookup — that only decides which
      // scramble text is served, not whether the athlete may solve at all,
      // so falling back to random generation is safe here.
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
