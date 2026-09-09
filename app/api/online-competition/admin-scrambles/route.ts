import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { fetchScrambleRoster, type ScrambleRosterAthlete } from '@/lib/online-competition/scramble-roster';
import {
  expectedScrambleCountFor,
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
  /** `${eventId}_${round}` -> { uid -> groupIndex }: the assignment in
   *  effect, auto-seeded plus any manual moves on top. */
  assignments: Record<string, Record<string, number>>;
  /** Same keys, but the untouched result of the last auto-assignment.
   *  Comparing the two is what tells the groups tab which athletes were
   *  moved by hand, and what "revert manual edits" restores. Empty for a
   *  round only ever assigned by hand. */
  autoAssignments: Record<string, Record<string, number>>;
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
  const autoAssignments: Record<string, Record<string, number>> = {};
  for (const d of assignSnap.docs) {
    const data = d.data();
    const asMap = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, number>) : {});
    assignments[d.id] = asMap(data.assignments);
    // Docs written before this field existed have no baseline — every
    // athlete in them simply reads as auto-assigned, which is what they
    // were.
    autoAssignments[d.id] = asMap(data.autoAssignments ?? data.assignments);
  }

  const payload: ScramblesOverview = { scrambleData, assignments, autoAssignments, athletes };
  return NextResponse.json(payload);
}

/** Deletes ALL imported scramble data and group assignments for one
 *  competition — what the Файл tab's УСТГАХ action calls. Deliberately
 *  wipes both subcollections rather than just the scrambles: an assignment
 *  is an index into a specific round's groups, so keeping it without them
 *  would be meaningless state. The competition itself, its registrations
 *  and its submissions are untouched, and with no scrambleData the solve
 *  flow simply falls back to random generation again. */
export async function DELETE(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = new URL(req.url).searchParams.get('competitionId');
  if (!competitionId) {
    return NextResponse.json({ error: 'Тэмцээн сонгогдоогүй байна.' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  if (!(await compRef.get()).exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }

  const [scrambleSnap, assignSnap] = await Promise.all([
    compRef.collection('scrambleData').get(),
    compRef.collection('groupAssignments').get(),
  ]);

  const batch = db.batch();
  for (const d of [...scrambleSnap.docs, ...assignSnap.docs]) batch.delete(d.ref);
  await batch.commit();

  return NextResponse.json({
    removedScrambleData: scrambleSnap.size,
    removedGroupAssignments: assignSnap.size,
  });
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

  // The competition is read BEFORE the parse now: how many scrambles a
  // round needs depends on that event's resultFormat, which only the
  // competition knows. The client sends the same expectation, but this is
  // the authoritative one — a stale or hand-made request must not import a
  // round with the wrong number of scrambles.
  const db = getOnlineCompAdminDb();
  const compRef = db.collection('onlineCompetitions').doc(competitionId);
  const compSnapForFormat = await compRef.get();
  const compEvents = Array.isArray(compSnapForFormat.get('events')) ? compSnapForFormat.get('events') : [];

  const parsed = parseTnoodleJson(raw, expectedScrambleCountFor(compEvents));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (!(await compRef.get()).exists) {
    return NextResponse.json({ error: 'Тэмцээн олдсонгүй.' }, { status: 404 });
  }

  // An import REPLACES the competition's scramble data — it is not merged
  // into whatever was imported before. Without this, a first import of a
  // multi-event file followed by a corrected 3x3x3-only file left the
  // earlier file's 2x2x2/3x3x3-OH rounds sitting in Firestore forever,
  // and the admin page (and the solve flow) went on serving them as if
  // they were part of the current competition.
  const existing = await compRef.collection('scrambleData').get();
  const keep = new Set(parsed.rounds.map((r) => roundKey(r.eventId, r.round)));
  const stale = existing.docs.filter((d) => !keep.has(d.id)).map((d) => d.id);

  const batch = db.batch();
  for (const round of parsed.rounds) {
    batch.set(compRef.collection('scrambleData').doc(roundKey(round.eventId, round.round)), {
      ...round,
      importedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const id of stale) {
    batch.delete(compRef.collection('scrambleData').doc(id));
    // A group assignment only means anything alongside the scrambles it
    // indexes into, so a dropped round takes its assignments with it
    // rather than leaving an orphan that would silently reattach if the
    // same round were imported again later with different groups.
    batch.delete(compRef.collection('groupAssignments').doc(id));
  }
  await batch.commit();

  // Assignments for rounds the new file DOES contain are deliberately kept:
  // re-importing a corrected file for the same rounds shouldn't wipe groups
  // an admin has already hand-tuned. The admin page warns instead when a
  // round's groupCount shrinks below an existing assignment.
  return NextResponse.json({
    saved: parsed.rounds.length,
    removed: stale.length,
    rounds: parsed.rounds,
    warnings: parsed.warnings,
  });
}
