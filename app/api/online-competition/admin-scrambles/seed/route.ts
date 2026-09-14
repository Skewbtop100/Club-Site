import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { roundKey, type ScrambleGroup } from '@/lib/online-competition/scrambles';
import { eligibleAthletesForRound } from '@/lib/online-competition/round-readiness';
import {
  buildSeedPreview,
  fetchSeedTimes,
  type SeedScope,
  type SeededAthlete,
} from '@/lib/online-competition/group-seeding';

// Seeded group assignment for one event+round:
//   POST mode:'preview' — compute the proposal and return it, WRITING
//                         NOTHING
//   POST mode:'apply'   — write the proposal
//
// TWO CALLS, NOT ONE, and that is the feature rather than an artifact of
// the implementation. Group assignment decides who an athlete is
// effectively measured alongside and is invisible once done, so the admin
// sees the proposed groups — every athlete with their seed time — and
// agrees to them before anything is stored. The apply call recomputes
// from scratch rather than trusting a map posted back by the browser: a
// client-supplied assignments map would be an admin-authenticated way to
// put anybody in any group, and the preview would become decorative.
//
// SCOPE IS REQUIRED. 'unassigned' keeps everyone already placed and deals
// only the newcomers; 'all' re-seeds the round. There is no default,
// because silently overwriting an admin's hand-made groups is exactly the
// outcome this endpoint must not have.
//
// THE ONLY AUTO-ASSIGN. ../assign used to carry a second one (a snake
// seed, mode:'auto') that produced a different grouping from the same
// corner of the same screen; it is removed, and that route now serves
// only the revert. This writes `autoAssignments` exactly as it did, so
// the groups tab's АВТОМАТ/ГАРААР badge and its revert still measure hand
// edits against the last automatic run.
//
// Admin-cookie gated, Admin SDK, same as every other write in this
// feature. Never runs on its own: there is no scheduled or implicit
// caller, and opening a round deliberately does not trigger it.

export const runtime = 'nodejs';

interface SeedTarget {
  competitionId: string;
  eventId: string;
  round: number;
}

function readTarget(body: Record<string, unknown> | null): SeedTarget | null {
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

  const mode = body?.mode === 'apply' ? 'apply' : 'preview';
  if (body?.scope !== 'all' && body?.scope !== 'unassigned') {
    return NextResponse.json(
      { error: 'Хуваарилах хүрээг сонгоно уу (шинээр бүгдийг эсвэл зөвхөн хуваарилагдаагүйг).' },
      { status: 400 },
    );
  }
  const scope = body.scope as SeedScope;

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(target.competitionId);
  const key = roundKey(target.eventId, target.round);

  // ── THE GROUP LIST COMES FROM THE IMPORT ──
  // scrambleData/{event}_{round}.groups, and its length is the group
  // count. Not `groupCount`, which the importer writes alongside it:
  // assignments are INDICES INTO THIS ARRAY, and the scramble route reads
  // `groups[groupIndex]`, so the array is what an assignment can actually
  // point at. Trusting a separate count that disagreed with it would
  // produce assignments to groups that do not exist.
  const scrambleSnap = await compRef.collection('scrambleData').doc(key).get();
  if (!scrambleSnap.exists) {
    return NextResponse.json(
      { error: 'Энэ раундад холилт импортлогдоогүй байна. Эхлээд JSON файлаа оруулна уу.' },
      { status: 400 },
    );
  }
  const rawGroups = scrambleSnap.get('groups');
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    return NextResponse.json({ error: 'Импортлосон холилтод групп алга байна.' }, { status: 400 });
  }
  const groupLabels = (rawGroups as ScrambleGroup[]).map(
    (g, i) => g?.label || String.fromCharCode(65 + i),
  );

  // Exactly the set the round-start check expects to be assigned — round
  // 1 is everyone registered for the event, round 2+ only who qualified.
  const eligible = await eligibleAthletesForRound(
    db,
    target.competitionId,
    target.eventId,
    target.round,
  );
  if (eligible.length === 0) {
    return NextResponse.json(
      { error: 'Энэ раундад хуваарилах тамирчин алга байна.' },
      { status: 400 },
    );
  }

  const seeds = await fetchSeedTimes(
    db,
    target.eventId,
    eligible.map((a) => a.uid),
    target.competitionId,
  );
  const athletes: SeededAthlete[] = eligible.map((a) => ({
    uid: a.uid,
    displayName: a.displayName,
    seedCs: seeds.get(a.uid) ?? null,
  }));

  const assignRef = compRef.collection('groupAssignments').doc(key);
  const assignSnap = await assignRef.get();
  const currentRaw = assignSnap.exists ? assignSnap.get('assignments') : null;
  const current: Record<string, number> =
    currentRaw && typeof currentRaw === 'object' ? (currentRaw as Record<string, number>) : {};

  const preview = buildSeedPreview({ athletes, groupLabels, current, scope });

  if (mode === 'preview') {
    return NextResponse.json({ preview, applied: false });
  }

  // `assignments` and `autoAssignments` together, matching what
  // ../assign writes: the second is the baseline the groups tab's
  // АВТОМАТ/ГАРААР badge measures hand edits against, and what its
  // 'revert' restores. Writing only the first would leave revert pointing
  // at a seeding nobody can see any more.
  await assignRef.set(
    {
      eventId: target.eventId,
      round: target.round,
      assignments: preview.assignments,
      autoAssignments: preview.assignments,
      assignedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return NextResponse.json({ preview, applied: true });
}
