import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import type {
  OnlineSubmissionAdminView,
  OnlineSubmissionStatus,
  SolveMarks,
} from '@/lib/online-competition/types';

/** The five stage marks, in the order they occur. Listed rather than
 *  spread from the stored map so a key nobody expects cannot reach the
 *  review UI: this route reads through the Admin SDK, which bypasses
 *  firestore.rules entirely, so the map's shape is not guaranteed here
 *  the way it is on create. */
const MARK_KEYS = [
  'scrambleShown',
  // Optional and absent on every submission filed before it existed —
  // the review panel falls back to inferring this moment when it is not
  // here, so dropping it silently would look like working software.
  'coverStart',
  'solveStart',
  'solveEnd',
  'cubeShown',
  'recordingEnd',
] as const satisfies readonly (keyof SolveMarks)[];

/** Stage marks as the review UI can trust them: known keys, finite
 *  non-negative numbers, and `undefined` rather than `{}` when there is
 *  nothing usable — so "no marks recorded" is one condition downstream
 *  instead of three. */
function readMarks(value: unknown): Partial<SolveMarks> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const src = value as Record<string, unknown>;
  const out: Partial<SolveMarks> = {};
  for (const key of MARK_KEYS) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const VALID_STATUSES: OnlineSubmissionStatus[] = ['pending', 'approved', 'rejected'];

// Admin-only listing for the review dashboard. Reads go through the Admin
// SDK (server-side, bypasses Firestore rules) rather than the client SDK
// because the dashboard has no Firebase Auth identity to satisfy
// onlineSubmissions' read rule — it's gated by a separate password cookie
// instead (see lib/online-competition/admin-auth.ts).
export async function GET(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status') ?? 'pending';
  const competitionId = url.searchParams.get('competitionId');
  const db = getOnlineCompAdminDb();

  const query =
    statusParam === 'all'
      ? db.collection('onlineSubmissions').orderBy('createdAt', 'asc')
      : db
          .collection('onlineSubmissions')
          .where('status', '==', VALID_STATUSES.includes(statusParam as OnlineSubmissionStatus) ? statusParam : 'pending')
          .orderBy('createdAt', 'asc');

  const snap = await query.get();
  // Filtered in memory rather than as a 3rd Firestore query clause (which
  // would need a new composite index for every status/competitionId
  // combination) — the review dashboard's dataset is small enough that
  // this costs nothing meaningful.
  const docs = competitionId ? snap.docs.filter((d) => d.data().competitionId === competitionId) : snap.docs;
  const submissions: OnlineSubmissionAdminView[] = docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      competitionId: data.competitionId,
      uid: data.uid,
      event: data.event,
      // THE RENAME HAPPENS HERE, and only here. The document stores the
      // attempt index under `round` (OnlineSubmission.round — renaming it
      // would be a data migration); the admin view calls it `attempt`, so
      // no admin component can read a number called "round" and take it
      // for a competition round. See OnlineSubmissionAdminView.
      attempt: data.round,
      // Not renamed: competitionRound means the same thing on both sides
      // and was never the confusing one. Legacy documents predate the
      // field; round 1 was the only round that existed when they were
      // written.
      competitionRound: typeof data.competitionRound === 'number' ? data.competitionRound : 1,
      videoUrl: data.videoUrl,
      cloudinaryPublicId: data.cloudinaryPublicId,
      reportedTime: data.reportedTime,
      isDnf: data.isDnf ?? false,
      penalty: data.penalty ?? null,
      status: data.status,
      marks: readMarks(data.marks),
      createdAt: data.createdAt?.toMillis?.() ?? null,
    };
  });

  return NextResponse.json({ submissions });
}
