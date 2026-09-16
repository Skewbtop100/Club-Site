import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { PRACTICE_REASON_MAX } from '@/lib/online-competition/practice';
import {
  PracticeError,
  listPracticeScope,
  practiceAthleteNames,
  reviewPracticeRun,
  type PracticeRunView,
} from '@/lib/online-competition/practice-server';
import type { PracticeDecision } from '@/lib/online-competition/practice';

export const runtime = 'nodejs';

// ── The practice review queue ───────────────────────────────────────────
// GET  ?status=pending|all — the queue
// POST { runId, decision, reason? } — one decision
//
// ITS OWN ROUTE, not part of the submissions review, and that is the whole
// point of the separation: a practice review answers "did this athlete
// scramble and solve correctly", and the submissions route's vocabulary
// (approve / +2 / DNF, a competition, a round, a ranking) has no answer to
// that question. Nothing here touches onlineSubmissions.

export interface AdminPracticeRow extends PracticeRunView {
  displayName: string;
}

export interface AdminPracticeResponse {
  /** EVERY RUN OF EVERY ATHLETE IN SCOPE — not only the runs that matched
   *  the scope. With status=pending the scope is "athletes with something
   *  waiting", and each of those athletes arrives complete: the screen is
   *  one row per athlete with their runs across it, and a row built from
   *  pending runs alone would hide the refusals that explain the one being
   *  judged and miscount the ten. The client decides which rows to show
   *  (see PracticeReview) — it cannot decide what it was not sent. */
  runs: AdminPracticeRow[];
  pending: number;
  reasonMax: number;
}

export async function GET(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const want = new URL(req.url).searchParams.get('status') === 'all' ? 'all' : 'pending';
  const db = getOnlineCompAdminDb();
  // THE QUEUE NAMES THE ATHLETES; their decided runs come with them, so a
  // row on ХЯНАГДААГҮЙ is the athlete's whole history — see listPracticeScope.
  const { runs, matched } = await listPracticeScope(db, want);
  // Names come from the participant documents, not from the run: a name
  // stored at file time goes stale, and the admin needs the athlete they
  // know.
  const names = await practiceAthleteNames(db, runs.map((r) => r.uid));
  const payload: AdminPracticeResponse = {
    runs: runs.map((r) => ({ ...r, displayName: names.get(r.uid) ?? r.uid.slice(0, 10) })),
    // Counted off the queue, so it is the number of runs WAITING however
    // many decided ones came along for the row.
    pending: matched.filter((r) => r.status === 'pending').length,
    reasonMax: PRACTICE_REASON_MAX,
  };
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

const DECISIONS: readonly string[] = ['correct', 'incorrect', 'redo'];

export async function POST(req: Request) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const runId = typeof body?.runId === 'string' ? body.runId : '';
  const decision = DECISIONS.includes(body?.decision as string)
    ? (body!.decision as PracticeDecision)
    : null;
  const reason = typeof body?.reason === 'string' ? body.reason : null;
  if (!runId || decision === null) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }

  try {
    // practiceReviewValid is applied inside reviewPracticeRun, so the rule
    // that a refusal needs a reason is enforced in one place for both the
    // route and the screen.
    const run = await reviewPracticeRun(getOnlineCompAdminDb(), runId, decision, reason);
    return NextResponse.json({ ok: true, run }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof PracticeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
