import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import type { OnlineSubmissionAdminView, OnlineSubmissionStatus } from '@/lib/online-competition/types';

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
      round: data.round,
      videoUrl: data.videoUrl,
      cloudinaryPublicId: data.cloudinaryPublicId,
      reportedTime: data.reportedTime,
      isDnf: data.isDnf ?? false,
      penalty: data.penalty ?? null,
      status: data.status,
      createdAt: data.createdAt?.toMillis?.() ?? null,
    };
  });

  return NextResponse.json({ submissions });
}
