import { NextResponse } from 'next/server';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { roundKey } from '@/lib/online-competition/scrambles';

// Group assignment writes for one event+round:
//   POST  mode:'revert' — drop every manual move, restoring the last
//                         auto-assignment exactly
//   PATCH               — move a single athlete to another group
// All admin-cookie gated and through the Admin SDK, same as every other
// write in this feature.
//
// AUTO-ASSIGNMENT NO LONGER LIVES HERE. This route used to also run a
// snake seed (A,B,C,C,B,A...), which spreads the fast athletes evenly so
// every group has the same average strength. That is what you want when
// groups are heats measured against each other; this club runs every
// athlete inside one short window, so the grouping's only job is to put
// comparable athletes on identical scrambles — which is the opposite
// arrangement. The block seeder at ../seed is now the only auto-assign,
// and having two that quietly produced different rounds was the actual
// problem.
//
// The doc keeps TWO maps: `assignments` (in effect) and `autoAssignments`
// (the untouched output of the last auto-run — now always the block
// seeder's, which writes both fields exactly as this route did). A manual
// move via PATCH writes only the first, so the difference between them is
// exactly the set of hand edits — that's what the groups tab's
// АВТОМАТ/ГАРААР badge reads and what 'revert' undoes, with no extra
// per-athlete flag to keep in sync.

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

  // 'revert' is the only POST this route still serves. Anything else is
  // refused rather than quietly treated as a revert: the removed 'auto'
  // mode wrote the whole assignments map, so a caller still sending it
  // must fail loudly instead of appearing to succeed.
  if (body?.mode !== 'revert') {
    return NextResponse.json(
      { error: 'Буруу үйлдэл. Автомат хуваарилалт "seed" үйлдэл рүү шилжсэн.' },
      { status: 400 },
    );
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

  // Restore the stored baseline rather than re-running the seeder.
  // Re-seeding instead would look identical only until someone's past
  // results changed, so this really does put the groups back the way the
  // last auto-run left them.
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
  return NextResponse.json({
    assignments,
    autoAssignments: assignments,
    assignedCount: Object.keys(assignments).length,
  });
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
