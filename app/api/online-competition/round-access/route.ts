import { NextResponse } from 'next/server';
import { getOnlineCompAdminDb } from '@/lib/online-competition/firebase-admin';
import {
  resolveRoundAccessForCompetition,
  type RoundAccess,
} from '@/lib/online-competition/round-access';

// Read-only companion to the solve flow's gating: tells the athlete's
// dashboard, per event, which round is live and whether they may attempt
// it. Deliberately the SAME resolver the scramble route enforces with, so
// the dashboard can never offer "Эхлүүлэх" for something that would then
// be refused.
//
// Public (no admin cookie): it exposes only round status and whether one
// uid is on a qualifiers list — the same facts that athlete is about to
// be shown anyway. It never returns the qualifier list itself.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const competitionId = url.searchParams.get('competitionId') ?? '';
  const uid = url.searchParams.get('uid') ?? '';
  if (!competitionId || !uid) {
    return NextResponse.json({ error: 'Missing competitionId or uid' }, { status: 400 });
  }

  try {
    const db = getOnlineCompAdminDb();
    const events: Record<string, RoundAccess> = await resolveRoundAccessForCompetition(
      db,
      competitionId,
      uid,
    );
    return NextResponse.json({ events });
  } catch (e) {
    // The dashboard falls back to its previous behaviour when this fails,
    // so a lookup problem degrades the badge rather than the page.
    console.error('round-access lookup failed:', e);
    return NextResponse.json({ events: {} });
  }
}
