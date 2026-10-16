import { roomsRoute } from '@/lib/server/rooms-route';
import { joinRoom } from '@/lib/server/rooms';

export const runtime = 'nodejs';

// Any signed-in club account asks to join by code → pending request.
export const POST = roomsRoute('rooms/join', (caller, body) => joinRoom(caller.uid, body.code));
