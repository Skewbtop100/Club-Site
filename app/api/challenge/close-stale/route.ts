import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AdminNotConfiguredError } from '@/lib/server/firebase-admin';
import { closeStaleSessions } from '@/lib/server/challenge-sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Daily cleanup (docs/challenge-plan.md 4b): the Vercel cron in vercel.json
// calls this at 00:05 Ulaanbaatar (16:05 UTC) to close every challenge
// session whose end time has passed. Vercel sends
//   Authorization: Bearer <CRON_SECRET>
// on cron requests when the CRON_SECRET env var is set. Without that env
// var the route refuses to run at all (503), so it is never open.
function authorized(req: Request): boolean | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const header = req.headers.get('authorization') ?? '';
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  const ok = authorized(req);
  if (ok === null) return NextResponse.json({ error: 'not-configured', detail: 'CRON_SECRET is not set' }, { status: 503 });
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await closeStaleSessions());
  } catch (e) {
    if (e instanceof AdminNotConfiguredError) {
      return NextResponse.json({ error: 'not-configured', detail: e.message }, { status: 503 });
    }
    console.error('[api/challenge/close-stale]', e);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}

// Vercel cron jobs call GET; POST is kept for manual runs (plan B3).
export const GET = handle;
export const POST = handle;
