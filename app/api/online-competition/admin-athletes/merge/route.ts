import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { commitMerge, planMerge } from '@/lib/online-competition/merge-athlete.mjs';

// ── Мэйл солих: move an athlete's data to the uid of a new Gmail ─────────
// Admin SDK only, behind the same shared-password cookie as every other
// admin route. A client could never perform this merge even in principle:
// firestore.rules deny writing profileStatus/approved*/stats, and the whole
// point is to carry a verified profile across.
//
// The logic is NOT implemented here — it lives in
// lib/online-competition/merge-athlete.mjs, which scripts/merge-athlete-uid
// .mjs also imports. One implementation, so tests/merge-athlete-uid (84
// assertions, driven through the CLI) covers this route too.
//
// Two modes on one endpoint, so the preview an admin approves and the write
// that follows come from the SAME code path:
//   'preview' — plan + pre-flight, writes nothing
//   'commit'  — plan again (fresh reads, fresh pre-flight) then apply
// Re-planning on commit is deliberate: it means the write acts on current
// data, and a state that changed between the two clicks is caught rather
// than committed blind.
//
// `resume` is not exposed. It relaxes the "new account is fresh" guard,
// which is what stops two real athletes being fused; that escape hatch
// stays on the CLI where the operator can see the whole plan.

export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { oldEmail?: string; newEmail?: string; mode?: 'preview' | 'commit' }
    | null;

  const oldEmail = typeof body?.oldEmail === 'string' ? body.oldEmail.trim() : '';
  const newEmail = typeof body?.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : '';
  const mode = body?.mode === 'commit' ? 'commit' : 'preview';

  if (!oldEmail || !newEmail) {
    return NextResponse.json({ error: 'Missing oldEmail or newEmail' }, { status: 400 });
  }

  const db = getOnlineCompAdminDb();
  const planned = await planMerge(db, { oldEmail, newEmail });
  // Non-null whenever a plan exists at all; a resolution failure returns
  // plan: null and never reaches the summary below.
  const profile = planned.plan?.A as unknown as { merged: Record<string, unknown>; fromNew: string[] };

  // Shape the plan for the UI: the raw plan carries whole document bodies
  // and Firestore Timestamps, none of which the preview needs.
  const summary = planned.plan
    ? {
        oldUid: planned.oldUid,
        newUid: planned.newUid,
        registrations: planned.plan.B.map((r: { id: string; data: { events?: string[] } }) => ({
          competitionId: r.id,
          events: r.data.events ?? [],
        })),
        submissions: planned.plan.C.length,
        seasonPoints: planned.plan.D.map((d: { season: string; data: { totalPoints?: number } }) => ({
          season: d.season,
          totalPoints: d.data.totalPoints ?? 0,
        })),
        notifications: planned.plan.E.length,
        qualifiers: planned.plan.F.map((f: { path: string; before: string[]; after: string[]; index: number }) => ({
          path: f.path,
          index: f.index,
          length: f.before.length,
        })),
        assignments: planned.plan.G.map((g: { path: string; before: Record<string, number> }) => ({
          path: g.path,
          groupIndex: g.before[planned.oldUid],
          otherAthletes: Object.keys(g.before).length - 1,
        })),
        // Which side each merged profile field comes from — the question an
        // admin most needs answered before clicking through.
        profileFields: Object.keys(profile.merged)
          .sort()
          .map((key) => ({ key, from: profile.fromNew.includes(key) ? 'new' : 'old' })),
      }
    : null;

  if (!planned.ok) {
    return NextResponse.json(
      { ok: false, errors: planned.errors, summary, newAccountState: planned.newAccountState ?? null },
      { status: 200 },
    );
  }

  if (mode === 'preview') {
    return NextResponse.json({ ok: true, committed: false, summary });
  }

  const counts = await commitMerge(db, planned);
  return NextResponse.json({ ok: true, committed: true, summary, counts });
}
