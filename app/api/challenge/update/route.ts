import { roomsRoute } from '@/lib/server/rooms-route';
import { updateChallenge } from '@/lib/server/challenges';

export const runtime = 'nodejs';

// Edit a challenge's template — refused once it has been started (locked).
export const POST = roomsRoute('challenge/update', (caller, body) => updateChallenge(caller.uid, body));
