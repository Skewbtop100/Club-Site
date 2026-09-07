import { NextResponse } from 'next/server';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { fetchScrambleRoster } from '@/lib/online-competition/scramble-roster';
import { autoAssign, roundKey } from '@/lib/online-competition/scrambles';

// Group assignment writes for one event+round:
//   POST  mode:'auto'   — (re)run the snake-seeded auto-assignment
//   POST  mode:'revert' — drop every manual move, restoring the last
//                         auto-assignment exactly
//   PATCH               — move a single athlete to another group
// All admin-cookie gated and through the Admin SDK, same as every other
// write in this feature.
//
// The doc keeps TWO maps: `assignments` (in effect) and `autoAssignments`
// (the untouched output of the last auto-run). A manual move via PATCH
// writes only the first, so the difference between them is exactly the set
// of hand edits — that's what the groups tab's АВТОМАТ/ГАРААР badge reads
// and what 'revert' undoes, with no extra per-athlete flag to keep in
// sync.

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

  const mode = body?.mode === 'revert' ? 'revert' : 'auto';

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

  // Revert: restore the stored baseline rather than re-seeding. Re-running
  // the seeder instead would look identical only until someone's pr
  // changed, so this really does put the groups back the way the last
  // auto-run left them.
  if (mode === 'revert') {
    const assignRef = compRef.collection('groupAssignments').doc(key);
    const current = await assignRef.get();
    const baseline = current.get('autoAssignments');
    if (!current.exists || !baseline || typeof baseline !== 'object') {
      return NextResponse.json(
        { error: 'Буцаах автомат хуваарилалт байхгүй байна. Эхлээд автоматаар хуваарилна уу.' },
        { status: 400 },
      );
    }
    const assignments = baseline as Record<string, number>;
    await assignRef.set(
      { assignments, assignedAt: FieldValue.serverTimestamp() },
      { mergeFields: ['assignments', 'assignedAt'] },
    );
    return NextResponse.json({ assignments, autoAssignments: assignments, assignedCount: Object.keys(assignments).length });
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
    // The baseline manual moves are measured against, and what 'revert'
    // restores. Rewritten on every auto-run so re-seeding also resets what
    // counts as "manually edited".
    autoAssignments: assignments,
    assignedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ assignments, autoAssignments: assignments, assignedCount: Object.keys(assignments).length });
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

  const assignRef = compRef.collection('groupAssignments').doc(key);
  const existing = await assignRef.get();

  // Docs written before `autoAssignments` existed carry no baseline, and
  // the state right before the first hand edit IS the last auto-assignment
  // — so capture it now. Without this, reverting such a round would have
  // nothing to restore, and every athlete in it would keep reading as
  // auto-assigned even after being moved.
  const needsBaseline =
    existing.exists &&
    !existing.get('autoAssignments') &&
    existing.get('assignments') &&
    typeof existing.get('assignments') === 'object';

  const mergeFields: (string | FieldPath)[] = [
    new FieldPath('assignments', uid),
    'eventId',
    'round',
    'assignedAt',
  ];
  const payload: Record<string, unknown> = {
    eventId: target.eventId,
    round: target.round,
    // Dotted field path so one athlete's move can't clobber a concurrent
    // move of another; the merge also creates the doc when an admin
    // hand-places an athlete before ever running auto-assignment.
    assignments: { [uid]: groupIndex },
    assignedAt: FieldValue.serverTimestamp(),
  };
  if (needsBaseline) {
    payload.autoAssignments = existing.get('assignments');
    mergeFields.push('autoAssignments');
  }

  await assignRef.set(payload, { mergeFields });

  return NextResponse.json({ ok: true });
}
