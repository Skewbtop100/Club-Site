import { roomsRoute } from '@/lib/server/rooms-route';
import { createRoom } from '@/lib/server/rooms';

export const runtime = 'nodejs';

// Coach (or admin) creates a room; the server picks its 6-character code.
export const POST = roomsRoute('create', (caller, body) => createRoom(caller.uid, body.name));
