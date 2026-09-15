import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { ONLINE_NOTIFICATIONS } from '@/lib/online-competition/types';
import {
  PROFILE_HREF,
  VERIFICATION_NOTICE_LABEL,
  parseDecisionBody,
  planDecision,
  type DecisionPlan,
} from '@/lib/online-competition/verification';

// Decides a pending athlete verification — its two parts separately.
//
// POST { submittedAt, details?: { decision: 'approve' } | { decision: 'reject', reason },
//                     photo?:   { decision: 'approve' } | { decision: 'reject', reason } }
//
// Every PENDING part must be decided; a part already approved is left alone
// and may not be decided again (verification.ts planDecision). `submittedAt`
// is the submission the admin was looking at: if the athlete has sent
// something since, the decision is refused (409) rather than approving what
// the admin never saw.
//
// Admin SDK only — same reasoning as app/api/online-competition/review/route.ts:
// this dashboard has no Firebase Auth admin identity (it's gated by the
// shared password cookie), and firestore.rules refuse an athlete approving
// or rejecting either part, or writing the approved* snapshot, the reasons
// or reviewedAt.
//
// The decision and the athlete's notification are ONE transaction: the
// athlete is told exactly once, and never about a decision that did not
// save.

const millis = (value: unknown): number | null => {
  const t = value as { toMillis?: () => number } | null | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
};

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { uid } = await params;
  const parsed = parseDecisionBody(await req.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const db = getOnlineCompAdminDb();
  const ref = db.collection('onlineParticipants').doc(uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const plan = planDecision(snap.exists ? snap.data() : null, millis(snap.get('submittedAt')), parsed.input);
      if (!plan.ok) return plan;

      tx.update(ref, { ...plan.update, reviewedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection(ONLINE_NOTIFICATIONS).doc(), {
        uid,
        type: 'profile_verification',
        title: plan.notice,
        contextLabel: VERIFICATION_NOTICE_LABEL,
        href: PROFILE_HREF,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      return plan;
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { after } = result as DecisionPlan;
    return NextResponse.json({
      ok: true,
      profileStatus: after.status,
      detailsStatus: after.details.status,
      photoStatus: after.photo.status,
    });
  } catch (err) {
    console.error(`[online-competition] verification decision for ${uid} failed:`, err);
    return NextResponse.json({ error: 'Шийдвэрийг хадгалж чадсангүй.' }, { status: 500 });
  }
}
