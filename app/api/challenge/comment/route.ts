import { roomsRoute } from '@/lib/server/rooms-route';
import { commentSolve } from '@/lib/server/challenge-sessions';

export const runtime = 'nodejs';

// Student sets or clears the comment on one of their own challenge solves.
export const POST = roomsRoute('challenge/comment', (caller, body) => commentSolve(caller.uid, body));
