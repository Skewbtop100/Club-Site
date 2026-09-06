import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { deleteSubmissionAndVideo } from '@/lib/online-competition/submission-cleanup';

// Deletes a submission — Admin SDK only, same reasoning as
// app/api/online-competition/review/route.ts (no Firebase Auth admin
// identity here; the dashboard is gated by the shared password cookie,
// and client-side Firestore rules deny direct deletes from every client).
//
// The Cloudinary-then-Firestore deletion itself lives in
// lib/online-competition/submission-cleanup.ts, shared with the nightly
// retention sweep (app/api/online-competition/cron/sweep-videos) so the
// two can't drift. Behaviour here is unchanged by that extraction.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getOnlineCompAdminDb();
  const ref = db.collection('onlineSubmissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const cloudinaryPublicId = snap.data()?.cloudinaryPublicId as string | undefined;

  const { cloudinaryDeleted, cloudinaryDetail } = await deleteSubmissionAndVideo(
    ref,
    cloudinaryPublicId,
    'admin delete',
  );

  return NextResponse.json({ ok: true, cloudinaryDeleted, cloudinaryDetail });
}
