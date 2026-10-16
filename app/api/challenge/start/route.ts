import { roomsRoute } from '@/lib/server/rooms-route';
import { startSession } from '@/lib/server/challenge-sessions';

export const runtime = 'nodejs';

// Coach starts one student's session ("Эхлүүлэх") with an end time; locks the challenge.
export const POST = roomsRoute('challenge/start', (caller, body) => startSession(caller.uid, body));
