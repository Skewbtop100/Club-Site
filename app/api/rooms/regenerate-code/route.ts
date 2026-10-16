import { roomsRoute } from '@/lib/server/rooms-route';
import { regenerateRoomCode } from '@/lib/server/rooms';

export const runtime = 'nodejs';

// The room's coach gets a new code; the old one stops working immediately.
export const POST = roomsRoute('regenerate-code', (caller, body) => regenerateRoomCode(caller.uid, body.roomId));
