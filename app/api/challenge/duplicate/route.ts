import { roomsRoute } from '@/lib/server/rooms-route';
import { duplicateChallenge } from '@/lib/server/challenges';

export const runtime = 'nodejs';

// "Хуулбарлах": copy a challenge as a new, unlocked, unassigned one.
export const POST = roomsRoute('challenge/duplicate', (caller, body) => duplicateChallenge(caller.uid, body));
