import { roomsRoute } from '@/lib/server/rooms-route';
import { createChallenge } from '@/lib/server/challenges';

export const runtime = 'nodejs';

// A room's coach creates a challenge (template + optional title/note).
export const POST = roomsRoute('challenge/create', (caller, body) => createChallenge(caller.uid, body));
