import { NextResponse } from 'next/server';
import cstimer from 'cstimer_module';
import { ONLINE_COMP_SCRAMBLE_TYPE } from '@/lib/online-competition/scramble-types';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { roundKey, type ScrambleGroup } from '@/lib/online-competition/scrambles';

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
// The group lookup is best-effort by construction: any missing param,
// missing doc, or Admin SDK failure falls through to (2) rather than
// failing the request, so a competition that doesn't use this feature —
// or a deployment without the Admin SDK env vars — behaves exactly as it
// did before this route learned about groups.

/** Looks up the athlete's official scramble; null means "fall back". */
async function lookupGroupScramble(params: {
  competitionId: string;
  eventId: string;
  round: number;
  uid: string;
  attempt: number;
}): Promise<{ scramble: string; groupLabel: string } | null> {
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
  const scramble = group?.scrambles?.[attempt - 1];
  if (typeof scramble !== 'string' || scramble.trim() === '') return null;

  return { scramble, groupLabel: group?.label ?? '' };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const eventId = url.searchParams.get('event');
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event param' }, { status: 400 });
  }
  const cfg = ONLINE_COMP_SCRAMBLE_TYPE[eventId];
  if (!cfg) {
    return NextResponse.json({ error: `Unsupported event: ${eventId}` }, { status: 400 });
  }

  const competitionId = url.searchParams.get('competitionId') ?? '';
  const uid = url.searchParams.get('uid') ?? '';
  const round = Number(url.searchParams.get('round') ?? '1');
  const attempt = Number(url.searchParams.get('attempt') ?? '1');

  if (competitionId && uid && Number.isInteger(round) && round >= 1 && Number.isInteger(attempt) && attempt >= 1) {
    try {
      const official = await lookupGroupScramble({ competitionId, eventId, round, uid, attempt });
      if (official) {
        return NextResponse.json({
          scramble: official.scramble,
          source: 'group',
          groupLabel: official.groupLabel,
        });
      }
    } catch (e) {
      // Never fail a solve over the group lookup — log and fall through to
      // the random generator below.
      console.error('Group scramble lookup failed, falling back to random:', e);
    }
  }

  try {
    const scramble = cstimer.getScramble(cfg.type, cfg.len ?? 0);
    return NextResponse.json({ scramble, source: 'random' });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
