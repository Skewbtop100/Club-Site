import { roomsRoute } from '@/lib/server/rooms-route';
import { unassignChallenge } from '@/lib/server/challenges';

export const runtime = 'nodejs';

// Unassign one student — only before their assignment has started.
export const POST = roomsRoute('challenge/unassign', (caller, body) => unassignChallenge(caller.uid, body));
