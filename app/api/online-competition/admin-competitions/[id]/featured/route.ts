import { NextResponse } from 'next/server';
import { isOnlineCompAdmin } from '@/lib/online-competition/admin-auth';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import { CompetitionWriteError, setCompetitionFeatured } from '@/lib/online-competition/admin-competitions';

// ── The featured flag, on its own ───────────────────────────────────────
// PATCH /api/online-competition/admin-competitions/{id}/featured
// body: { featured: boolean }
//
// ADMIN ONLY, behind the same isOnlineCompAdmin cookie every other
// admin-competitions route sits behind. Nothing here is reachable by an
// athlete: this route refuses them, and firestore.rules refuse a client
// write to onlineCompetitions outright (`allow write: if isAdmin()` — the
// club's Firebase Auth admin, which no athlete holds), so the flag needed no
// rules change to be safe.
//
// WHY A SUB-ROUTE and not PATCH on ../route.ts: that file's PUT takes the
// whole competition through validateCompetitionInput, which is right for the
// editor form and wrong for a one-click star — a partial body would fail
// validation, and a full one would mean reading the document and writing
// every field back to change a boolean. This does the one field.
//
// The exclusivity rule (at most one featured competition) lives in
// setCompetitionFeatured, shared with writeCompetitionDoc, so the star and
// the editor form cannot disagree about it.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOnlineCompAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  // Strictly a boolean: a missing or truthy-ish value is a caller bug, and
  // guessing which way it meant would silently feature the wrong thing.
  const featured = (body as { featured?: unknown } | null)?.featured;
  if (typeof featured !== 'boolean') {
    return NextResponse.json({ error: '`featured` нь boolean байх ёстой.' }, { status: 400 });
  }

  try {
    await setCompetitionFeatured(getOnlineCompAdminDb(), id, featured);
  } catch (err) {
    // A reason only the stored document knows — it does not exist, or it is
    // still a draft.
    if (err instanceof CompetitionWriteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, featured });
}
