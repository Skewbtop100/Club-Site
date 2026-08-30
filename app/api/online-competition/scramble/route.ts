import { NextResponse } from 'next/server';
import cstimer from 'cstimer_module';
import { ONLINE_COMP_SCRAMBLE_TYPE } from '@/lib/online-competition/scramble-types';

// Server-side scramble generator for the public online-competition feature.
// Separate route from app/api/scramble/route.ts (the club's internal one) —
// kept independent so this feature never shares code paths with the club's
// competition/practice system, even though both wrap cstimer_module.
export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('event');
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event param' }, { status: 400 });
  }
  const cfg = ONLINE_COMP_SCRAMBLE_TYPE[eventId];
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
