import { roomsRoute } from '@/lib/server/rooms-route';
import { renameRoom } from '@/lib/server/rooms';

export const runtime = 'nodejs';

// The room's coach renames it (members' copies of the name follow).
export const POST = roomsRoute('rooms/rename', (caller, body) => renameRoom(caller.uid, body.roomId, body.name));
