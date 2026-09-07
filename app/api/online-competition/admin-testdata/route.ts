import { NextResponse } from 'next/server';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { deleteSubmissionAndVideo } from '@/lib/online-competition/submission-cleanup';
import { recomputeAthleteStatsForCompetition } from '@/lib/online-competition/athleteStats';
import { recomputeSeasonPointsForCompetition } from '@/lib/online-competition/seasonPoints';
import { roundKey } from '@/lib/online-competition/scrambles';
import {
  TEST_ATHLETES,
  TEST_COMPETITIONS,
  TEST_COMPETITION_IDS,
  TEST_DATA_PREFIX,
  TEST_REGISTRATIONS,
  TEST_SEASON,
  isTestDataId,
  type SeedCounts,
  type WipeCounts,
} from '@/lib/online-competition/test-data';

// ── Тест өгөгдөл: seed / wipe ───────────────────────────────────────────
// Admin-cookie gated, Admin SDK only.
//
// Read lib/online-competition/test-data.ts first: it explains why the
// `testdata-` DOCUMENT ID prefix — not the `isTestData` field — is what
// makes the wipe safe, and why `test-` would have been catastrophic
// (`test-comp-1` is real).
//
// Every delete in this file goes through assertTestDoc(). That is
// belt-and-braces on top of prefix-scoped queries: even if a query were
// ever widened by mistake, a non-test document reaching the delete path
// throws instead of being removed.

const SUBCOLLECTIONS = ['scrambleData', 'groupAssignments', 'roundState', 'qualifiers', 'scrambles'] as const;
const DAY_MS = 86_400_000;

/** Last line of defence: refuses to delete anything not id-prefixed. */
function assertTestDoc(id: string, where: string): void {
  if (!isTestDataId(id)) {
    throw new Error(
      `[testdata] REFUSING to delete non-test document "${id}" in ${where}. ` +
        'This is a bug — the wipe must only ever touch ids prefixed with ' +
        `"${TEST_DATA_PREFIX}".`,
    );
  }
}

/** Firestore has no "starts with" operator; the standard range trick is an
 *  ordered scan from the prefix up to its exclusive upper bound. Keeps the
 *  wipe from reading whole collections. */
function prefixRange(col: FirebaseFirestore.CollectionReference) {
  // U+F8FF is the highest code point Firestore sorts, so the range
  // [prefix, prefix + U+F8FF] covers exactly the ids starting with the
  // prefix. `test-comp-1` sorts before `testdata-` and falls outside it —
  // which is the whole point of choosing this prefix over `test-`.
  const end = TEST_DATA_PREFIX + String.fromCharCode(0xf8ff);
  return col.orderBy('__name__').startAt(TEST_DATA_PREFIX).endAt(end);
}

// ── GET: what currently exists ─────────────────────────────────────────
export async function GET() {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getOnlineCompAdminDb();
  const [comps, parts, subs] = await Promise.all([
    prefixRange(db.collection('onlineCompetitions')).get(),
    prefixRange(db.collection('onlineParticipants')).get(),
    prefixRange(db.collection('onlineSubmissions')).get(),
  ]);
  return NextResponse.json({
    present: comps.size > 0 || parts.size > 0 || subs.size > 0,
    counts: { competitions: comps.size, participants: parts.size, submissions: subs.size },
    prefix: TEST_DATA_PREFIX,
  });
}

// ── POST: seed ─────────────────────────────────────────────────────────
export async function POST() {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getOnlineCompAdminDb();
  const now = Date.now();
  const counts: SeedCounts = {
    competitions: 0,
    participants: 0,
    registrations: 0,
    submissions: 0,
    roundState: 0,
  };

  // ── Competitions ────────────────────────────────────────────────────
  for (const spec of TEST_COMPETITIONS) {
    await db.collection('onlineCompetitions').doc(spec.id).set({
      name: spec.name,
      description: spec.description,
      startAt: Timestamp.fromMillis(now + spec.startOffsetDays * DAY_MS),
      registrationDeadline: Timestamp.fromMillis(now + spec.registrationOffsetDays * DAY_MS),
      participantLimit: spec.participantLimit,
      events: spec.events,
      status: spec.status,
      season: spec.season,
      createdAt: FieldValue.serverTimestamp(),
      isTestData: true,
    });
    counts.competitions += 1;
  }

  // ── Athletes ────────────────────────────────────────────────────────
  // Avatars are generated data: URIs, not uploads — nothing to clean up
  // in Cloudinary later, and no dependency on an external placeholder
  // service that could 404 or rate-limit.
  const uidOf = (i: number) => `${TEST_DATA_PREFIX}${TEST_ATHLETES[i].slug}`;
  for (const athlete of TEST_ATHLETES) {
    const uid = `${TEST_DATA_PREFIX}${athlete.slug}`;
    const stats: Record<string, { pr: number; ao5: number; solveCount: number }> = {};
    for (const [eventId, pr] of Object.entries(athlete.pr)) {
      // Ao5 sits a realistic margin above the single, varied per event so
      // "best single" and "best average" leaderboards order differently.
      stats[eventId] = {
        pr,
        ao5: Math.round(pr * (1.08 + ((pr % 7) * 0.01))),
        solveCount: 5 + (pr % 11),
      };
    }
    const approved = athlete.profileStatus === 'approved';
    const submitted = athlete.profileStatus !== 'incomplete';
    await db.collection('onlineParticipants').doc(uid).set({
      uid,
      displayName: athlete.displayName,
      email: `${athlete.slug}@testdata.invalid`,
      photoURL: null,
      createdAt: FieldValue.serverTimestamp(),
      lastName: athlete.lastName,
      firstName: athlete.firstName,
      dateOfBirth: athlete.dateOfBirth,
      gender: athlete.gender,
      citizenship: 'Монгол',
      photoUrl: submitted ? avatarDataUri(athlete.displayName) : null,
      photoPublicId: null,
      profileStatus: athlete.profileStatus,
      approvedPhotoUrl: approved ? avatarDataUri(athlete.displayName) : null,
      submittedAt: submitted ? Timestamp.fromMillis(now - 20 * DAY_MS) : null,
      reviewedAt: approved || athlete.profileStatus === 'rejected' ? Timestamp.fromMillis(now - 18 * DAY_MS) : null,
      rejectionReason: athlete.profileStatus === 'rejected' ? 'Тест: зураг тодорхойгүй байна.' : null,
      ...(Object.keys(stats).length > 0 ? { stats } : {}),
      isTestData: true,
    });
    counts.participants += 1;
  }

  // ── Registrations ───────────────────────────────────────────────────
  let regOffset = 0;
  for (const [key, entries] of Object.entries(TEST_REGISTRATIONS)) {
    const competitionId = TEST_COMPETITION_IDS[key as keyof typeof TEST_COMPETITION_IDS];
    for (const entry of entries) {
      regOffset += 1;
      await db
        .collection('onlineParticipants')
        .doc(uidOf(entry.index))
        .collection('registrations')
        .doc(competitionId)
        .set({
          competitionId,
          events: entry.events,
          registeredAt: Timestamp.fromMillis(now - (60 - regOffset) * 60_000),
          status: 'registered',
          isTestData: true,
        });
      counts.registrations += 1;
    }
  }

  // ── Submissions for the finished competition ────────────────────────
  // Five attempts per athlete per event, mostly approved with a realistic
  // minority pending / rejected / DNF so the review grid, round
  // advancement and season points all have something non-uniform to work
  // against.
  const finishedId = TEST_COMPETITION_IDS.finished;
  for (const entry of TEST_REGISTRATIONS.finished) {
    const athlete = TEST_ATHLETES[entry.index];
    const uid = uidOf(entry.index);
    for (const eventId of entry.events) {
      const base = athlete.pr[eventId];
      if (!base) continue;
      for (let attempt = 1; attempt <= 5; attempt++) {
        // Spread each attempt around the athlete's single so the Ao5 is a
        // real average rather than five identical numbers.
        const jitter = [0, 47, 112, 29, 76][attempt - 1] + ((entry.index * 13) % 40);
        const isDnf = entry.index % 7 === 3 && attempt === 4;
        const status =
          entry.index % 9 === 5 && attempt === 2
            ? 'pending'
            : entry.index % 11 === 7 && attempt === 5
              ? 'rejected'
              : 'approved';
        const id = `${TEST_DATA_PREFIX}sub-${athlete.slug}-${eventId}-${attempt}`;
        await db.collection('onlineSubmissions').doc(id).set({
          competitionId: finishedId,
          uid,
          event: eventId,
          round: attempt,
          // Deliberately not a real Cloudinary asset: seeding must never
          // upload, and the wipe's Cloudinary step skips ids like this.
          videoUrl: 'https://example.invalid/testdata.webm',
          cloudinaryPublicId: '',
          reportedTime: isDnf ? 0 : base + jitter,
          isDnf,
          penalty: status === 'rejected' ? 'DNF' : null,
          status,
          createdAt: Timestamp.fromMillis(now - 29 * DAY_MS + attempt * 60_000),
          retentionExpiresAt: Timestamp.fromMillis(now + 14 * DAY_MS),
          isTestData: true,
        });
        counts.submissions += 1;
      }
    }
  }

  // ── Round state for the live competition ────────────────────────────
  // Round 1 open for every event, so solve-flow testing works with no
  // extra manual step (the scramble route refuses when no round is live).
  const liveSpec = TEST_COMPETITIONS.find((c) => c.id === TEST_COMPETITION_IDS.live)!;
  for (const e of liveSpec.events) {
    await db
      .collection('onlineCompetitions')
      .doc(TEST_COMPETITION_IDS.live)
      .collection('roundState')
      .doc(roundKey(e.eventId, 1))
      .set({
        eventId: e.eventId,
        round: 1,
        status: 'live',
        openedAt: Timestamp.fromMillis(now - 2 * 3_600_000),
        updatedAt: FieldValue.serverTimestamp(),
        isTestData: true,
      });
    counts.roundState += 1;
  }

  // Derive stats + season points from the submissions just seeded, using
  // the real recompute the admin button calls — so the rank page, season
  // leaderboard and profile stats all have consistent data immediately
  // instead of needing a manual follow-up step. Both are scoped to the
  // finished TEST competition, so they only ever read and write
  // testdata- athletes and the testdata- season.
  let recomputeError: string | null = null;
  try {
    await recomputeAthleteStatsForCompetition(TEST_COMPETITION_IDS.finished);
    await recomputeSeasonPointsForCompetition(TEST_COMPETITION_IDS.finished);
  } catch (err) {
    recomputeError = err instanceof Error ? err.message : String(err);
    console.error('[testdata] seed recompute failed:', recomputeError);
  }

  return NextResponse.json({ seeded: true, counts, recomputeError });
}

// ── DELETE: wipe ───────────────────────────────────────────────────────
export async function DELETE() {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getOnlineCompAdminDb();
  const counts: WipeCounts = {
    competitions: 0,
    participants: 0,
    registrations: 0,
    submissions: 0,
    roundState: 0,
    qualifiers: 0,
    scrambleData: 0,
    groupAssignments: 0,
    seasonPoints: 0,
    cloudinaryDeleted: 0,
  };

  // ── Competitions + every subcollection they own ─────────────────────
  const comps = await prefixRange(db.collection('onlineCompetitions')).get();
  for (const comp of comps.docs) {
    assertTestDoc(comp.id, 'onlineCompetitions');
    for (const name of SUBCOLLECTIONS) {
      const sub = await comp.ref.collection(name).get();
      for (const d of sub.docs) {
        await d.ref.delete();
        if (name === 'roundState') counts.roundState += 1;
        else if (name === 'qualifiers') counts.qualifiers += 1;
        else if (name === 'scrambleData') counts.scrambleData += 1;
        else if (name === 'groupAssignments') counts.groupAssignments += 1;
      }
    }
    await comp.ref.delete();
    counts.competitions += 1;
  }

  // ── Participants + their registrations ──────────────────────────────
  const parts = await prefixRange(db.collection('onlineParticipants')).get();
  for (const part of parts.docs) {
    assertTestDoc(part.id, 'onlineParticipants');
    const regs = await part.ref.collection('registrations').get();
    for (const d of regs.docs) {
      await d.ref.delete();
      counts.registrations += 1;
    }
    await part.ref.delete();
    counts.participants += 1;
  }

  // ── Submissions (+ any Cloudinary asset) ────────────────────────────
  const subs = await prefixRange(db.collection('onlineSubmissions')).get();
  for (const sub of subs.docs) {
    assertTestDoc(sub.id, 'onlineSubmissions');
    const publicId = sub.get('cloudinaryPublicId');
    // Seeded submissions carry no real asset, but a test submission filed
    // through the real solve flow would — so this goes through the shared
    // helper the manual delete and the retention sweep use, rather than a
    // second copy of that logic.
    const result = await deleteSubmissionAndVideo(
      sub.ref,
      typeof publicId === 'string' && publicId ? publicId : undefined,
      'testdata wipe',
    );
    if (result.cloudinaryDeleted) counts.cloudinaryDeleted += 1;
    counts.submissions += 1;
  }

  // ── Season points for the test season ───────────────────────────────
  const seasonAthletes = await db
    .collection('onlineSeasonPoints')
    .doc(TEST_SEASON)
    .collection('athletes')
    .get();
  for (const d of seasonAthletes.docs) {
    await d.ref.delete();
    counts.seasonPoints += 1;
  }
  const seasonDoc = db.collection('onlineSeasonPoints').doc(TEST_SEASON);
  if ((await seasonDoc.get()).exists) {
    assertTestDoc(seasonDoc.id, 'onlineSeasonPoints');
    await seasonDoc.delete();
  }

  return NextResponse.json({ wiped: true, counts });
}

/** Initials avatar as an inline SVG data URI — no upload, no external
 *  dependency, and nothing left behind when the data is wiped. */
function avatarDataUri(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? 'Т') + (parts[1]?.[0] ?? '')).toUpperCase();
  const hue = [...displayName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">` +
    `<rect width="160" height="160" fill="hsl(${hue} 45% 22%)"/>` +
    `<text x="80" y="80" dy="0.36em" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="64" font-weight="600" fill="hsl(${hue} 70% 78%)">${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
