import { roomsRoute } from '@/lib/server/rooms-route';
import { submitSolve } from '@/lib/server/challenge-sessions';

export const runtime = 'nodejs';

// Student submits one confirmed solve; the server scores it (and may complete the challenge).
export const POST = roomsRoute('challenge/solve', (caller, body) => submitSolve(caller.uid, body));
