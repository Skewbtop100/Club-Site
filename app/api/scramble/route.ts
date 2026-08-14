import { NextResponse } from 'next/server';
import cstimer from 'cstimer_module';
import { CSTIMER_SCRAMBLE_TYPE } from '@/lib/scramble';

// Server-side only — cstimer_module never ships in the client bundle. Used by
// the admin Daily Practice entry flow (ResultsEntryTab) to hand the admin a
// genuine WCA random-state scramble to read to the athlete before each solve.
export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('event');
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event param' }, { status: 400 });
  }
  const cfg = CSTIMER_SCRAMBLE_TYPE[eventId];
  if (!cfg) {
    return NextResponse.json({ error: `Unsupported event: ${eventId}` }, { status: 400 });
  }
  try {
    const scramble = cstimer.getScramble(cfg.type, cfg.len ?? 0);
    return NextResponse.json({ scramble });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
