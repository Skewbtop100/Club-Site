import { roomsRoute } from '@/lib/server/rooms-route';
import { assignChallenge } from '@/lib/server/challenges';

export const runtime = 'nodejs';

// Assign a challenge to one or many active members of its room.
export const POST = roomsRoute('challenge/assign', (caller, body) => assignChallenge(caller.uid, body));
