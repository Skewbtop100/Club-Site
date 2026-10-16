import { roomsRoute } from '@/lib/server/rooms-route';
import { decideMember } from '@/lib/server/rooms';

export const runtime = 'nodejs';

// The room's coach approves / rejects a request or removes a member.
export const POST = roomsRoute('member', (caller, body) => decideMember(caller.uid, body.roomId, body.uid, body.action));
