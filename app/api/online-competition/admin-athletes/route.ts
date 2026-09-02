import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import type { OnlineParticipantAdminView, OnlineParticipantProfileStatus } from '@/lib/online-competition/types';

const VALID_STATUSES: OnlineParticipantProfileStatus[] = ['incomplete', 'pending', 'approved', 'rejected'];

// Admin-only listing for the athletes review page (pending requests +
// approved roster). Reads go through the Admin SDK (bypasses Firestore
// rules) same as every other admin-* route — this dashboard is gated by
// the shared password cookie, not Firebase Auth (see
// lib/online-competition/admin-auth.ts).
export async function GET(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status') ?? 'pending';
  const status: OnlineParticipantProfileStatus = VALID_STATUSES.includes(
    statusParam as OnlineParticipantProfileStatus,
  )
    ? (statusParam as OnlineParticipantProfileStatus)
    : 'pending';

  const db = getOnlineCompAdminDb();
  // Note: 'incomplete' participants (everyone who has signed in but never
  // opened the profile form) have no `profileStatus` field at all, so a
  // `where('profileStatus', '==', 'incomplete')` query would miss them —
  // not an issue here since the admin page only ever requests 'pending' or
  // 'approved'.
  const snap = await db.collection('onlineParticipants').where('profileStatus', '==', status).get();

  const athletes: OnlineParticipantAdminView[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      displayName: data.displayName ?? '',
      email: data.email ?? null,
      lastName: data.lastName ?? '',
      firstName: data.firstName ?? '',
      dateOfBirth: data.dateOfBirth ?? '',
      gender: data.gender ?? null,
      citizenship: data.citizenship ?? '',
      photoUrl: data.photoUrl ?? null,
      profileStatus: status,
      approvedPhotoUrl: data.approvedPhotoUrl ?? null,
      submittedAt: data.submittedAt?.toMillis?.() ?? null,
      reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
      rejectionReason: data.rejectionReason ?? null,
    };
  });

  if (status === 'pending') {
    // Oldest first — first come, first reviewed.
    athletes.sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  } else {
    athletes.sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`));
  }

  return NextResponse.json({ athletes });
}
