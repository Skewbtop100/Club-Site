import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { fetchScrambleRoster, type ScrambleRosterAthlete } from '@/lib/online-competition/scramble-roster';
import {
  parseTnoodleJson,
  roundKey,
  type ScrambleRoundData,
} from '@/lib/online-competition/scrambles';

// ── Official scramble data + group assignments ──────────────────────────
// Every write in this feature goes through this admin-cookie-gated Admin
// SDK route (and its ./assign sibling) — the two subcollections it owns,
// onlineCompetitions/{id}/scrambleData and .../groupAssignments, are
// denied to every direct client write by firestore.rules, exactly like
// onlineSubmissions.status/penalty.

export interface ScramblesOverview {
  scrambleData: ScrambleRoundData[];
  /** `${eventId}_${round}` -> { uid -> groupIndex } */
  assignments: Record<string, Record<string, number>>;
  athletes: ScrambleRosterAthlete[];
}

export async function GET(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = new URL(req.url).searchParams.get('competitionId');
  if (!competitionId) {
    return NextResponse.json({ error: 'Missing competitionId' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const [scrambleSnap, assignSnap, athletes] = await Promise.all([
    compRef.collection('scrambleData').get(),
    compRef.collection('groupAssignments').get(),
    fetchScrambleRoster(db, competitionId),
  ]);

  const scrambleData: ScrambleRoundData[] = scrambleSnap.docs.map((d) => {
    const data = d.data();
    return {
      eventId: typeof data.eventId === 'string' ? data.eventId : d.id.split('_')[0],
      round: typeof data.round === 'number' ? data.round : Number(d.id.split('_')[1]) || 1,
      groupCount: typeof data.groupCount === 'number' ? data.groupCount : (data.groups?.length ?? 0),
      groups: Array.isArray(data.groups) ? data.groups : [],
    };
  });
  scrambleData.sort((a, b) => a.eventId.localeCompare(b.eventId) || a.round - b.round);

  const assignments: Record<string, Record<string, number>> = {};
  for (const d of assignSnap.docs) {
    const map = d.data().assignments;
    assignments[d.id] = map && typeof map === 'object' ? (map as Record<string, number>) : {};
  }

  const payload: ScramblesOverview = { scrambleData, assignments, athletes };
  return NextResponse.json(payload);
}

/** Imports a TNoodle scramble JSON. The body carries the file's raw text
 *  rather than a client-parsed structure so this route runs the *same*
 *  validation the admin preview ran, on the original bytes — the preview
 *  is a convenience, never the source of truth for what gets written. */
export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    competitionId?: unknown;
    fileText?: unknown;
  } | null;
  const competitionId = typeof body?.competitionId === 'string' ? body.competitionId : '';
  const fileText = typeof body?.fileText === 'string' ? body.fileText : '';
  if (!competitionId) {
    return NextResponse.json({ error: 'Тэмцээн сонгогдоогүй байна.' }, { status: 400 });
  }
  if (!fileText.trim()) {
    return NextResponse.json({ error: 'Файлын агуулга хоосон байна.' }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return NextResponse.json({ error: 'JSON файлыг уншиж чадсангүй (буруу форматтай).' }, { status: 400 });
  }

  const parsed = parseTnoodleJson(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  if (!(await compRef.get()).exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }

  const batch = db.batch();
  for (const round of parsed.rounds) {
    batch.set(compRef.collection('scrambleData').doc(roundKey(round.eventId, round.round)), {
      ...round,
      importedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  // Group assignments are deliberately NOT cleared here: re-importing the
  // same round's scrambles (a corrected file, say) shouldn't silently wipe
  // groups an admin has already hand-tuned. The admin page shows a warning
  // instead when a round's groupCount shrinks below an existing assignment.
  return NextResponse.json({ saved: parsed.rounds.length, rounds: parsed.rounds, warnings: parsed.warnings });
}
