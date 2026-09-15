import { NextResponse } from 'next/server';
import { adminSessionId, isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  CompetitionDeleteError,
  getCompetitionDeletion,
  previewCompetitionDeletion,
  runCompetitionDeletionStep,
  startCompetitionDeletion,
  toDeletionJobView,
} from '@/lib/online-competition/competition-delete';

// ── Competition deletion ─────────────────────────────────────────────────
// GET  — the preview: what would be removed. Reads only.
// POST { mode: 'start', confirmName } — checks the typed name, hides the
//      competition and creates the deletion record. Removes nothing yet.
// POST { mode: 'continue' } — one step of the deletion (up to ~40s of work);
//      the admin screen repeats it until `done`.
// See lib/online-competition/competition-delete.ts.

export const runtime = 'nodejs';
// A step works for STEP_BUDGET_MS, then saves and returns; the rest is a
// safety margin inside the platform's 60s ceiling.
export const maxDuration = 60;
const STEP_BUDGET_MS = 40_000;

function refusal(e: unknown) {
  if (e instanceof CompetitionDeleteError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const db = getOnlineCompAdminDb();

  const job = await getCompetitionDeletion(db, id);
  if (job && job.phase !== 'done') {
    return NextResponse.json({ preview: job.preview, job: toDeletionJobView(job) });
  }
  try {
    return NextResponse.json({ preview: await previewCompetitionDeletion(db, id), job: null });
  } catch (e) {
    return refusal(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { mode?: unknown; confirmName?: unknown } | null;
  const db = getOnlineCompAdminDb();

  try {
    if (body?.mode === 'start') {
      const job = await startCompetitionDeletion(db, id, {
        confirmName: body.confirmName,
        // Who: the admin SESSION. The admin is a shared password, so this
        // identifies a login, not a person.
        requestedBy: {
          sessionId: await adminSessionId(),
          ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
          userAgent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
        },
      });
      return NextResponse.json({ job: toDeletionJobView(job) });
    }
    if (body?.mode === 'continue') {
      const job = await runCompetitionDeletionStep(db, id, { budgetMs: STEP_BUDGET_MS });
      return NextResponse.json({ job: toDeletionJobView(job) });
    }
  } catch (e) {
    return refusal(e);
  }
  return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
}
