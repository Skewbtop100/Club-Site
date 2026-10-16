import { roomsRoute } from '@/lib/server/rooms-route';
import { endSession } from '@/lib/server/challenge-sessions';

export const runtime = 'nodejs';

// Student ("Өнөөдрийг дуусгах") or coach ("Зогсоох") ends a running session.
export const POST = roomsRoute('challenge/end', (caller, body) => endSession(caller.uid, body));
