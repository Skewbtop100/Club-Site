import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { createNotification } from '@/lib/online-competition/notifications-server';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import { getEvent } from '@/lib/wca-events';
import type {
  OnlineCompetitionEventConfig,
  OnlineSubmissionPenalty,
  OnlineSubmissionStatus,
} from '@/lib/online-competition/types';

type ReviewAction = 'approve' | 'approve_plus2' | 'dnf';

const ACTION_TO_UPDATE: Record<ReviewAction, { status: OnlineSubmissionStatus; penalty: OnlineSubmissionPenalty }> = {
  approve: { status: 'approved', penalty: null },
  approve_plus2: { status: 'approved', penalty: '+2' },
  dnf: { status: 'rejected', penalty: 'DNF' },
};

/** Where a notification row sends the athlete. Deliberately the full
 *  in-app path, not a bare '/dashboard': the comp.* rewrite (middleware.ts)
 *  passes /online-competition/* straight through, so this is the one form
 *  that resolves on BOTH the subdomain and the club site's own
 *  /online-competition path — same reasoning as HubNav's DASHBOARD
 *  constant, where a bare '/dashboard' would land on the club's unrelated
 *  dashboard. */
const DASHBOARD_HREF = '/online-competition/dashboard';

/** Event display name, using the same source the admin panel renders from:
 *  the competition's own stored `label` (types.ts keeps it redundantly so
 *  the name list can change independently of stored eventIds), falling
 *  back to the shared WCA event map and finally the raw id. */
function eventName(events: OnlineCompetitionEventConfig[], eventId: string): string {
  return events.find((e) => e.eventId === eventId)?.label ?? getEvent(eventId)?.name ?? eventId;
}

/** Displayed time for an approved solve — fmtCentiseconds plus the same
 *  " +2" suffix the review detail panel shows. */
function approvedTimeLabel(reportedTime: number, penalty: OnlineSubmissionPenalty): string {
  const base = fmtCentiseconds(reportedTime);
  return penalty === '+2' ? `${base} +2` : base;
}

/** Notify the athlete about a decision that has ALREADY been written.
 *
 *  Every failure in here is swallowed after logging: a missing competition
 *  doc, a malformed submission, or a Firestore hiccup must never turn a
 *  successful judge decision into an error the dashboard reports as a
 *  failed review. The submission update is committed before this runs. */
async function notifyAthlete(submissionId: string, action: ReviewAction): Promise<void> {
  try {
    const db = getOnlineCompAdminDb();
    const snap = await db.collection('onlineSubmissions').doc(submissionId).get();
    const sub = snap.data();
    if (!sub?.uid) return;

    const compSnap = await db.collection('onlineCompetitions').doc(String(sub.competitionId)).get();
    const comp = compSnap.data();
    const competitionName = typeof comp?.name === 'string' ? comp.name : 'Тэмцээн';
    const events = (comp?.events ?? []) as OnlineCompetitionEventConfig[];
    const label = eventName(events, String(sub.event));

    if (action === 'dnf') {
      await createNotification({
        uid: sub.uid,
        type: 'result_rejected',
        title: `${competitionName} · ${label} оролдлого хүчингүй болсон (DNF)`,
        contextLabel: 'ШҮҮГЧ',
        href: DASHBOARD_HREF,
      });
      return;
    }

    // NOTE: a submission's `round` is its ATTEMPT index 1-5, not a
    // competition round — no field distinguishes competition rounds yet
    // (see the storage note at the top of ReviewGrid.tsx). The wording
    // here follows the approved notification copy; revisit it together
    // with the grid's round strip when real rounds land.
    const roundName = `Раунд ${sub.round}`;
    const time = approvedTimeLabel(
      Number(sub.reportedTime) || 0,
      action === 'approve_plus2' ? '+2' : null,
    );

    await createNotification({
      uid: sub.uid,
      type: 'result_approved',
      title: `${label} · ${roundName} дүн батлагдлаа — ${time}`,
      contextLabel: competitionName.toUpperCase(),
      href: DASHBOARD_HREF,
    });
  } catch (err) {
    console.warn('[online-competition] notification write failed', err);
  }
}

// The only place onlineSubmissions.status/penalty are ever written. Uses
// the Admin SDK (bypasses Firestore rules) because there's no Firebase
// Auth admin identity here — the dashboard is gated by a separate
// password cookie (lib/online-competition/admin-auth.ts). Client-side
// Firestore rules for onlineSubmissions deny direct writes to these
// fields from every client, so this route is the only legitimate path.
//
// It is also the single trigger for approve/reject notifications: the
// review grid's bulk-approve button loops over this same POST once per
// attempt rather than taking a separate write path, so notifying here
// covers both the individual and the bulk case.
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

  await notifyAthlete(body.submissionId, body.action);

  return NextResponse.json({ ok: true });
}
