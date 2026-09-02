import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';

type AthleteAction = 'approve' | 'reject';

// Approves or rejects a pending athlete profile. Admin SDK only — same
// reasoning as app/api/online-competition/review/route.ts: this dashboard
// has no Firebase Auth admin identity (it's gated by the shared password
// cookie), and the client-side Firestore rules for onlineParticipants deny
// a direct client write of profileStatus: 'approved', or of
// approvedPhotoUrl/reviewedAt at all — see the rules snippet in
// firestore.rules' onlineParticipants block.
export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { uid } = await params;
  const body = (await req.json().catch(() => null)) as { action?: AthleteAction; reason?: string } | null;

  const db = getOnlineCompAdminDb();
  const ref = db.collection('onlineParticipants').doc(uid);

  if (body?.action === 'approve') {
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // approvedPhotoUrl is a snapshot of the reviewed photoUrl at approval
    // time — if the athlete later submits a new pending profile, photoUrl
    // moves on but approvedPhotoUrl keeps pointing at the photo an admin
    // actually saw.
    const photoUrl = (snap.data()?.photoUrl as string | undefined) ?? null;
    await ref.update({
      profileStatus: 'approved',
      approvedPhotoUrl: photoUrl,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: null,
    });
    return NextResponse.json({ ok: true });
  }

  if (body?.action === 'reject') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }
    await ref.update({
      profileStatus: 'rejected',
      rejectionReason: reason,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
