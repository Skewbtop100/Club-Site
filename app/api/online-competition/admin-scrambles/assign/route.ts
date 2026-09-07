import { NextResponse } from 'next/server';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { fetchScrambleRoster } from '@/lib/online-competition/scramble-roster';
import { autoAssign, roundKey } from '@/lib/online-competition/scrambles';

// Group assignment writes for one event+round:
//   POST  — (re)run the snake-seeded auto-assignment, replacing the doc
//   PATCH — move a single athlete to another group
// Both are admin-cookie gated and go through the Admin SDK, same as every
// other write in this feature.

interface RoundTarget {
  competitionId: string;
  eventId: string;
  round: number;
}

function readTarget(body: Record<string, unknown> | null): RoundTarget | null {
  const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
  const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
  const round = typeof body?.round === 'number' ? body.round : NaN;
  if (!competitionId || !eventId || !Number.isInteger(round) || round < 1) return null;
  return { competitionId, eventId, round };
}

export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const target = readTarget(body);
  if (!target) {
    return NextResponse.json({ error: 'Буруу хүсэлт (тэмцээн/төрөл/раунд дутуу).' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(target.competitionId);
  const key = roundKey(target.eventId, target.round);

  const scrambleSnap = await compRef.collection('scrambleData').doc(key).get();
  if (!scrambleSnap.exists) {
    return NextResponse.json(
      { error: 'Энэ раундад холилт импортлогдоогүй байна. Эхлээд JSON файлаа оруулна уу.' },
      { status: 400 },
    );
  }
  const groupCount = scrambleSnap.get('groupCount');
  if (typeof groupCount !== 'number' || groupCount < 1) {
    return NextResponse.json({ error: 'Импортлосон холилтын группын тоо буруу байна.' }, { status: 400 });
  }

  // Only athletes actually registered for THIS event get seeded — someone
  // registered for the competition but not this event has no attempt to
  // scramble for.
  const roster = (await fetchScrambleRoster(db, target.competitionId)).filter((a) =>
    a.events.includes(target.eventId),
  );
  const assignments = autoAssign(
    roster.map((a) => ({
      uid: a.uid,
      pr: a.prByEvent[target.eventId] ?? null,
      registeredAt: a.registeredAt,
    })),
    groupCount,
  );

  await compRef.collection('groupAssignments').doc(key).set({
    eventId: target.eventId,
    round: target.round,
    assignments,
    assignedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ assignments, assignedCount: Object.keys(assignments).length });
}

export async function PATCH(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const target = readTarget(body);
  const uid = typeof body?.uid === 'string' ? body.uid : '';
  const groupIndex = typeof body?.groupIndex === 'number' ? body.groupIndex : NaN;
  if (!target || !uid || !Number.isInteger(groupIndex) || groupIndex < 0) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(target.competitionId);
  const key = roundKey(target.eventId, target.round);

  const scrambleSnap = await compRef.collection('scrambleData').doc(key).get();
  if (!scrambleSnap.exists) {
    return NextResponse.json({ error: 'Энэ раундад холилт импортлогдоогүй байна.' }, { status: 400 });
  }
  const groupCount = scrambleSnap.get('groupCount');
  if (typeof groupCount !== 'number' || groupIndex >= groupCount) {
    return NextResponse.json({ error: 'Ийм групп байхгүй байна.' }, { status: 400 });
  }

  // Dotted field path so one athlete's move can't clobber a concurrent
  // move of another; `merge` creates the doc when an admin hand-places an
  // athlete before ever running auto-assignment.
  await compRef
    .collection('groupAssignments')
    .doc(key)
    .set(
      {
        eventId: target.eventId,
        round: target.round,
        assignments: { [uid]: groupIndex },
        assignedAt: FieldValue.serverTimestamp(),
      },
      { mergeFields: [new FieldPath('assignments', uid), 'eventId', 'round', 'assignedAt'] },
    );

  return NextResponse.json({ ok: true });
}
