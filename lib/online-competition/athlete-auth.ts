// ── Who is asking? ──────────────────────────────────────────────────────
// Server-only. The athlete half of authentication, for the two PUBLIC
// routes that act on behalf of one athlete.
//
// WHAT THIS REPLACES: both routes took the athlete's uid from a query
// parameter and never checked it. Anyone could ask for another athlete's
// OFFICIAL SCRAMBLE — before that athlete had solved it — or probe whether
// a given uid had qualified for a round. Neither route had any other
// gate: they are public by design, because the solve flow has no admin
// cookie and firestore.rules does not apply to an Admin SDK read.
//
// A uid in a query string cannot be fixed by comparing it to a token
// either: a parameter that must equal the token is a parameter someone
// will eventually trust on its own. The parameter is gone; the token is
// the only source of identity.

import { getOnlineCompAdminAuth } from './firebase-admin';

export class AthleteAuthError extends Error {
  readonly status: number;
  /** A machine-readable reason for the client, distinct from the round
   *  gate's own refusals — see the note on `message` below. */
  readonly reason: 'no-token' | 'bad-token' | 'anonymous';
  constructor(reason: 'no-token' | 'bad-token' | 'anonymous', message: string) {
    super(message);
    this.name = 'AthleteAuthError';
    this.reason = reason;
    this.status = 401;
  }
}

/** The bearer token from an Authorization header, or null.
 *
 *  Pure and exported so it can be unit-tested: header parsing is exactly
 *  the kind of thing that looks obvious and has an off-by-one in it.
 *
 *  The scheme is matched case-insensitively (RFC 7235 says it is
 *  case-insensitive, and clients differ), the token itself is not. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** The verified uid of the athlete making this request.
 *
 *  THROWS rather than returning null: a route that forgets to handle the
 *  failure fails closed with a 401, not open with an undefined uid.
 *
 *  ANONYMOUS SESSIONS ARE REFUSED. They mint perfectly valid tokens, and
 *  this feature's history includes anonymous auth — the solve page already
 *  treats `isAnonymous` as signed-out, and a route that disagreed would
 *  quietly re-open the door the client closed. */
export async function requireAthlete(req: Request): Promise<string> {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) {
    throw new AthleteAuthError('no-token', 'Нэвтрэлт шаардлагатай.');
  }

  let decoded;
  try {
    // checkRevoked is deliberately off: it costs a user lookup on every
    // request, and this gate protects a scramble, not a password change.
    decoded = await getOnlineCompAdminAuth().verifyIdToken(token);
  } catch {
    // Expired, malformed, wrong project, or signed by a key that no longer
    // exists. The client's answer to all of them is the same — mint a
    // fresh token and try again — so they are one reason here.
    throw new AthleteAuthError('bad-token', 'Нэвтрэлт хүчингүй болсон байна.');
  }

  if (decoded.firebase?.sign_in_provider === 'anonymous') {
    throw new AthleteAuthError('anonymous', 'Google хаягаар нэвтэрнэ үү.');
  }
  return decoded.uid;
}
