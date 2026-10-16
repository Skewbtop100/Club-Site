import { roomsRoute } from '@/lib/server/rooms-route';
import { deleteChallenge } from '@/lib/server/challenges';

export const runtime = 'nodejs';

// Delete a challenge and its assignments — only if never started.
export const POST = roomsRoute('challenge/delete', (caller, body) => deleteChallenge(caller.uid, body));
