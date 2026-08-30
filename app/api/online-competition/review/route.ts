import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import type { OnlineSubmissionPenalty, OnlineSubmissionStatus } from '@/lib/online-competition/types';

type ReviewAction = 'approve' | 'approve_plus2' | 'dnf';

const ACTION_TO_UPDATE: Record<ReviewAction, { status: OnlineSubmissionStatus; penalty: OnlineSubmissionPenalty }> = {
  approve: { status: 'approved', penalty: null },
  approve_plus2: { status: 'approved', penalty: '+2' },
  dnf: { status: 'rejected', penalty: 'DNF' },
};

// The only place onlineSubmissions.status/penalty are ever written. Uses
// the Admin SDK (bypasses Firestore rules) because there's no Firebase
// Auth admin identity here — the dashboard is gated by a separate
// password cookie (lib/online-competition/admin-auth.ts). Client-side
// Firestore rules for onlineSubmissions deny direct writes to these
// fields from every client, so this route is the only legitimate path.
export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { submissionId?: string; action?: ReviewAction }
    | null;

  if (!body?.submissionId || !body.action || !(body.action in ACTION_TO_UPDATE)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const update = ACTION_TO_UPDATE[body.action];
  const db = getOnlineCompAdminDb();
  await db.collection('onlineSubmissions').doc(body.submissionId).update(update);

  return NextResponse.json({ ok: true });
}
