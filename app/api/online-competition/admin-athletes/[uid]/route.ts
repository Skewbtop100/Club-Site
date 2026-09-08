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
    // The approved* fields are a snapshot of the identity this admin
    // actually reviewed. If the athlete later submits an edited profile,
    // the live fields move on but these keep pointing at what was
    // approved — approvedPhotoUrl has always worked this way for the
    // photo, and the reviewed name, birth date, gender and citizenship
    // now do too. Firestore rules lock all of them against client writes
    // (judgeFieldsUntouched in firestore.rules), so this route is the
    // only thing that can set them.
    const data = snap.data() ?? {};
    const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    await ref.update({
      profileStatus: 'approved',
      approvedPhotoUrl: str(data.photoUrl),
      approvedLastName: str(data.lastName),
      approvedFirstName: str(data.firstName),
      approvedDateOfBirth: str(data.dateOfBirth),
      approvedGender: str(data.gender),
      approvedCitizenship: str(data.citizenship),
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
